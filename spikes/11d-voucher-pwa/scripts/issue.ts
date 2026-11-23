/**
 * 11d 発行（Mac・オンライン）: iPhone の世帯が書き出した申し込みから、お店宛ての券（受給証 Escrow）を作る
 *   pnpm --filter 11d-voucher-pwa issue ~/Downloads/request-XXXXXXXX.json
 * 出力（どれも秘密を含まない）: exchange/vouchers-<世帯>.json（世帯へ）/ exchange/shop-sync.json（お店へ）/ results/issue.json
 * 口座: V（VOUCHER_ISSUER_SEED）/ D 配布用（DISTRIBUTION_SEED）/ お店 S（毎回新しく作り、D から 2 XRP。seed は .state/shop.json）
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BatchFlags, Wallet, xrpToDrops, type EscrowCreate, type SubmittableTransaction } from "xrpl";
import { Abort, Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, connectTestnet, explorerTxUrl, loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog, submitBatch } from "xrpl-kit";
import { PK_MEMO_TYPE } from "../../11c-voucher-escrow/src/voucher/core.js";
import type { SyncedEscrow } from "../../11c-voucher-escrow/src/voucher/shop.js";
import type { RequestFile, ShopSyncFile, VouchersFile } from "../src/lib/exchange.js";
import { SHOP_STATE, VOUCHER, readJson, saveResults, txJson, validatedCloseTime, voucherBalance, writeJson, zkv } from "./common.js";

const HERE = fileURLToPath(import.meta.url);
loadEnvLocal(HERE);
const arg = process.argv[2];
if (!arg || !existsSync(resolve(arg))) throw new Error("申し込みのファイル（request-….json）のパスを渡す");
const req = readJson<RequestFile>(resolve(arg));
if (req.kind !== "todoke-11d-request" || !/^[0-9A-F]{64}$/.test(req.pkHash) || req.vouchers.some((v) => !/^A0258020[0-9A-F]{64}810120$/.test(v.condition))) throw new Error("申し込みの形式が不正");
const CANCEL_AFTER_SEC = 24 * 3600;

const r = new Recorder("11d");
const extra: Record<string, unknown> = {};
const client = await connectTestnet();
try {
  const V = (await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE)).wallet;
  const D = (await loadOrCreatePersistentWallet(client, "DISTRIBUTION_SEED", "distribution D", HERE)).wallet;
  const need = req.vouchers.reduce((s, v) => s + Number(v.value), 0);
  if (Number((await voucherBalance(client, D.address, V.address)) ?? 0) < need) {
    r.tx(`準備: V → D 受給証 ${need + 10}（本番は D が RLUSD で買う）`, await submitAndLog(client, "V → D", { TransactionType: "Payment", Account: V.address, Destination: D.address, Amount: zkv(V.address, String(need + 10)) }, V), "tesSUCCESS");
  }
  const S = Wallet.generate();
  const fund = await submitAndLog(client, "D → お店 S 2 XRP", { TransactionType: "Payment", Account: D.address, Destination: S.address, Amount: xrpToDrops("2") }, D);
  if (fund.engineResult !== "tesSUCCESS") { r.tx("準備: お店の口座を作る", fund, "tesSUCCESS"); throw new Abort("お店の口座を作れない"); }
  writeJson(SHOP_STATE, { shop: S.address, seed: S.seed });
  r.add("observe", "発行: 口座", "-", `D=${D.address}<br>お店 S=${S.address}<br>世帯 ${req.household}（XRPL の口座なし）`, "お店の seed は .state/shop.json（コミットしない）");

  const now = await validatedCloseTime(client);
  const inners: SubmittableTransaction[] = req.vouchers.map((v) => ({
    TransactionType: "EscrowCreate", Account: D.address, Destination: S.address, Amount: zkv(V.address, v.value), Condition: v.condition,
    CancelAfter: now + CANCEL_AFTER_SEC, Memos: [{ Memo: { MemoType: PK_MEMO_TYPE, MemoData: req.pkHash } }],
  }) as EscrowCreate);
  const fee = batchFeeDrops(inners, await baseFeeDrops(client));
  const built = await buildSingleAccountBatch(client, D, BatchFlags.tfAllOrNothing, inners, fee.total);
  const out = await submitBatch(client, D, built);
  const ok = out.engineResult === "tesSUCCESS" && out.inner.length === inners.length && out.inner.every((i) => i.result === "tesSUCCESS");
  r.add(ok ? "pass" : "fail", `発行: D が券 ${inners.length} 枚を Batch（tfAllOrNothing）で作る`, "外側・内側すべて tesSUCCESS", `外側 ${out.engineResult ?? out.error} / 内側 [${out.inner.map((i) => i.result ?? "未記録").join(", ")}]`, `[${out.hash}](${explorerTxUrl(out.hash)})<br>手数料 ${out.fee} drops（${fee.formula}）`);
  if (!ok) throw new Abort("券を作れない");

  // お店の同期（11c と同じ: account_objects の Escrow と、作成 tx の Memo）
  const objs = await client.request({ command: "account_objects", account: S.address, type: "escrow", ledger_index: "validated" });
  const list: SyncedEscrow[] = [];
  for (const o of objs.result.account_objects as unknown as Record<string, unknown>[]) {
    const tx = await txJson(client, String(o["PreviousTxnID"]));
    const tj = ((tx?.["tx_json"] as Record<string, unknown> | undefined) ?? tx) as Record<string, unknown>;
    const memo = ((tj["Memos"] as { Memo: { MemoType?: string; MemoData?: string } }[] | undefined) ?? []).find((m) => m.Memo.MemoType?.toUpperCase() === PK_MEMO_TYPE);
    list.push({ index: String(o["index"]), owner: String(o["Account"]), offerSequence: Number(tj["Sequence"]), destination: S.address, amount: o["Amount"] as SyncedEscrow["amount"],
      condition: String(o["Condition"]), cancelAfter: Number(o["CancelAfter"]), ...(memo?.Memo.MemoData ? { pkHash: memo.Memo.MemoData } : {}), createTx: String(o["PreviousTxnID"]) });
  }
  list.sort((a, b) => a.offerSequence - b.offerSequence);
  r.eq("発行: お店の一覧（account_objects）の枚数", `${inners.length}`, `${list.length}`, "Escrow は宛先の owner directory にも入る");

  const vouchers: VouchersFile = {
    kind: "todoke-11d-vouchers", household: req.household, owner: D.address, shop: S.address, currency: VOUCHER, issuer: V.address, batchTx: out.hash,
    vouchers: req.vouchers.map((v, i) => ({ n: v.n, value: v.value, offerSequence: built.sequence + 1 + i, condition: v.condition, cancelAfter: now + CANCEL_AFTER_SEC })),
  };
  const missing = vouchers.vouchers.filter((v) => !list.some((e) => e.offerSequence === v.offerSequence && e.condition.toUpperCase() === v.condition));
  r.eq("発行: 世帯に渡す券の番号・Condition が台帳と一致", "0 件の不一致", `${missing.length} 件の不一致`, "account_objects と照合");
  writeJson(`exchange/vouchers-${req.household}.json`, vouchers);
  writeJson("exchange/shop-sync.json", { kind: "todoke-11d-shop", shop: S.address, syncedAt: new Date().toISOString(), list } satisfies ShopSyncFile);
  extra["issue"] = { household: req.household, D: D.address, shop: S.address, batch: { hash: out.hash, fee: out.fee, inner: out.inner }, vouchers: vouchers.vouchers };
} catch (e) {
  if (!(e instanceof Abort)) throw e;
  r.unknowns.push(`中断: ${e.message}`);
} finally {
  saveResults("issue", r, extra);
  await client.disconnect();
}
