/**
 * 11c 段階 3（オンライン）: お店が受け付けた券を EscrowFinish でまとめて精算する。期限切れの券は D が取り消して回収する
 *   pnpm --filter 11c-voucher-escrow settle
 */
import { fileURLToPath } from "node:url";
import { BatchFlags, Wallet, type EscrowFinish, type SubmittableTransaction } from "xrpl";
import { Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, connectTestnet, explorerTxUrl, loadEnvLocal, submitAndLog, submitBatch, walletFromEnv } from "xrpl-kit";
import { STATE, type State, loadJson, ownerCount, saveResults, validatedCloseTime, voucherBalance, xrpBalanceDrops } from "./common.js";
import { conditionOf, hex } from "./voucher/core.js";

const HERE = fileURLToPath(import.meta.url);
loadEnvLocal(HERE);
const r = new Recorder("11c");
const extra: Record<string, unknown> = {};
const link = (h: string) => `[${h.slice(0, 16)}…](${explorerTxUrl(h)})`;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const state = loadJson<State>(STATE);
if (!state.claims?.length) throw new Error("受け付けた券がない。先に offline を実行する");
const D = walletFromEnv("DISTRIBUTION_SEED")!;
const A = Wallet.fromSeed(state.shopSeeds.A), B = Wallet.fromSeed(state.shopSeeds.B);
const V = state.accounts.V;
const v = (id: string) => state.vouchers.find((x) => x.id === id)!;
const finish = (acct: string, id: string, fulfillment: string): EscrowFinish => ({ TransactionType: "EscrowFinish", Account: acct, Owner: state.accounts.D, OfferSequence: v(id).offerSequence, Condition: v(id).conditionHex, Fulfillment: fulfillment });
const fulfil = (id: string) => `A0228020${v(id).preimageHex}`;

const client = await connectTestnet();
try {
  const bal = async (a: string) => (await voucherBalance(client, a, V)) ?? "（線なし）";
  r.add("observe", "確認6 準備: お店 A の受給証トラストライン", "なし", await bal(state.accounts.A), "issue でお店は TrustSet をしていない");

  // ── 確認 6: お店 A が Batch（tfIndependent）で精算。v7 だけ条件違いの Fulfillment を混ぜる ──
  const bogus = (await conditionOf(globalThis.crypto.getRandomValues(new Uint8Array(32)))).fulfillmentHex;
  const inners: SubmittableTransaction[] = [...state.claims.map((c) => finish(A.address, c.id, c.fulfillmentHex)), finish(A.address, "v7", bogus)];
  const fee = batchFeeDrops(inners, await baseFeeDrops(client));
  const xa0 = await xrpBalanceDrops(client, A.address);
  const built = await buildSingleAccountBatch(client, A, BatchFlags.tfIndependent, inners, fee.total);
  const out = await submitBatch(client, A, built);
  const got = out.inner.map((i) => i.result ?? "未記録");
  const want = [...state.claims.map(() => "tesSUCCESS"), "tecCRYPTOCONDITION_ERROR"];
  r.eq("確認6: お店 A が EscrowFinish 5 件を Batch（tfIndependent）で送る（4 件は受け付けた券、5 件目は v7 に条件違いの Fulfillment）", want.join(", "), got.join(", "), `外側 ${out.engineResult ?? out.error}・${link(out.hash)}<br>手数料 ${out.fee} drops（${fee.formula}）`);
  const total = state.claims.reduce((s, c) => s + Number(v(c.id).value), 0);
  r.eq("確認6: お店 A の受給証残高", `${total}`, await bal(A.address), "宛先が自分で Finish したので、トラストラインは自動で作られる（EscrowHelpers.h）");
  r.add("observe", "確認6: お店 A の XRP の変化", "手数料 + トラストラインの準備金ぶん減る（準備金は残高から引かれない）", `${xa0} → ${await xrpBalanceDrops(client, A.address)} drops`, "account_info");
  r.tx("確認6: v7 を正しい Fulfillment で Finish（条件違いの失敗で券が消えていない）", await submitAndLog(client, "A EscrowFinish v7", finish(A.address, "v7", fulfil("v7")), A), "tesSUCCESS");
  r.tx("確認5: 精算済みの v1 をもう一度 Finish", await submitAndLog(client, "A EscrowFinish v1 again", finish(A.address, "v1", fulfil("v1")), A), "tecNO_TARGET", "Escrow は消えているので台帳上でも二重には受け取れない");

  // ── 確認 6: お店 B（トラストラインなし）。第三者の D が Finish → B 自身が Finish ──
  r.tx("確認6: 第三者 D が v5（お店 B 宛て）を Finish（B はトラストラインなし）", await submitAndLog(client, "D EscrowFinish v5", finish(D.address, "v5", fulfil("v5")), D), "tecNO_LINE", "期待は rippled EscrowHelpers.h（宛先以外が出すとラインを作らない）");
  r.tx("確認6: お店 B 自身が v5 を Finish", await submitAndLog(client, "B EscrowFinish v5", finish(B.address, "v5", fulfil("v5")), B), "tesSUCCESS");
  r.eq("確認6: お店 B の受給証残高", v("v5").value, await bal(B.address), "トラストラインは自動で作られた");

  // ── 確認 7: 期限切れ（v6）。期限後は Finish できず、D が Cancel して回収する ──
  const exp = v("v6").cancelAfter, until = Date.now() + 420_000;
  while ((await validatedCloseTime(client)) <= exp + 5 && Date.now() < until) await sleep(5000);
  r.add("observe", "確認7: v6 の期限が過ぎるまで待つ", "-", `CancelAfter=${exp} / 検証済みレジャーの close_time=${await validatedCloseTime(client)}`, "ledger");
  r.tx("確認7: 期限後にお店 A が v6 を Finish", await submitAndLog(client, "A EscrowFinish v6（期限後）", finish(A.address, "v6", fulfil("v6")), A), "tecNO_PERMISSION", "期待は rippled EscrowFinish.cpp（CancelAfter 後）");
  const zd0 = await bal(D.address);
  r.tx("確認7: 期限後に D が v6 を EscrowCancel", await submitAndLog(client, "D EscrowCancel v6", { TransactionType: "EscrowCancel", Account: D.address, Owner: D.address, OfferSequence: v("v6").offerSequence }, D), "tesSUCCESS");
  r.add("observe", "確認7: D の受給証残高", `+${v("v6").value}`, `${zd0} → ${await bal(D.address)}`, "account_lines");

  // ── 確認 9: コスト ─────────────────────────────
  const issue = loadJson<{ batch?: { fee: string } }>("results/issue.json");
  const oc = await ownerCount(client, D.address);
  r.add("observe", "確認9: 世帯 1 軒あたりのコスト（券 5 枚の場合）", "-",
    `作成: Batch 1 件で内側 5 件なら 10×2 + 10×5 = 70 drops（今回 7 件で ${issue.batch?.fee ?? "?"} drops）<br>準備金: 券 1 枚 0.2 XRP × 5 = 1 XRP を D が精算まで拘束<br>精算: EscrowFinish 1 件 353 drops（330 + 10 × 36/16 の切り上げ）を お店が負担`,
    `D の OwnerCount は今 ${oc}（残っている Escrow の数 + トラストライン）`);
  extra["settleBatch"] = { hash: out.hash, fee: out.fee, formula: fee.formula, inner: out.inner };
} finally {
  saveResults("settle", r, extra);
  await client.disconnect();
}
