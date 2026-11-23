/**
 * 11c 段階 1（オンライン）: 配布用アカウント D が、お店宛ての受給証 Escrow（券）を Batch でまとめて作る → お店が自店宛ての一覧を同期する → 世帯の券の QR を作る
 *   pnpm --filter 11c-voucher-escrow issue
 * 口座: V = 受給証の発行者（VOUCHER_ISSUER_SEED）/ D = 支援団体の配布用アカウント（DISTRIBUTION_SEED、.env.local に保存）
 *       A・B = お店（毎回新しく作り、D から 2 XRP。seed は .state/ にだけ置く）
 *       世帯 HH1・HH2 は XRPL の口座を持たない。持つのは 32B の秘密（と HH1 は端末の鍵）だけ
 */
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { BatchFlags, Wallet, xrpToDrops, type EscrowCreate, type SubmittableTransaction } from "xrpl";
import {
  Abort, Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, configureEscrowableIssuer, connectTestnet, explorerTxUrl,
  loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog, submitBatch,
} from "xrpl-kit";
import { FACE, STATE, SYNCED_A, type IssuedVoucher, type Spec, type State, ownerCount, saveJson, saveResults, txJson, validatedCloseTime, voucherBalance, xrpBalanceDrops, zkv } from "./common.js";
import { PK_MEMO_TYPE, conditionOf, derivePreimage, encodeVoucher, hex, sha256, signVoucher, voucherLabel } from "./voucher/core.js";
import type { SyncedEscrow } from "./voucher/shop.js";

const HERE = fileURLToPath(import.meta.url);
loadEnvLocal(HERE);
const r = new Recorder("11c");
const extra: Record<string, unknown> = {};
const link = (h: string) => `[${h.slice(0, 16)}…](${explorerTxUrl(h)})`;
const subtle = globalThis.crypto.subtle;

// 券の一覧。v5 だけお店 B 宛て。v6 は期限が短い（期限切れの確認用）。v7 は台帳で「条件違いの Fulfillment」を試す用
const SPECS: Spec[] = [
  { id: "v1", household: "HH1", n: 1, shop: "A", value: FACE.small, signed: true },
  { id: "v2", household: "HH1", n: 2, shop: "A", value: FACE.large, signed: true },
  { id: "v3", household: "HH1", n: 3, shop: "A", value: FACE.large, signed: true },
  { id: "v4", household: "HH2", n: 1, shop: "A", value: FACE.small, signed: false },
  { id: "v5", household: "HH2", n: 2, shop: "B", value: FACE.large, signed: false },
  { id: "v6", household: "HH2", n: 3, shop: "A", value: FACE.small, signed: false, short: true },
  { id: "v7", household: "HH2", n: 4, shop: "A", value: FACE.small, signed: false },
];
const LONG_SEC = 3600, SHORT_SEC = 300;

const client = await connectTestnet();
try {
  const si = await client.request({ command: "server_info" });
  const vl = si.result.info.validated_ledger;
  r.add("observe", "準備: Testnet", "-", `rippled ${si.result.info.build_version} / 準備金 ${vl?.reserve_base_xrp} XRP + ${vl?.reserve_inc_xrp} XRP/件 / 基本手数料 ${vl?.base_fee_xrp} XRP`, "server_info");
  const feat = (await client.request({ command: "feature", feature: "TokenEscrow" } as never)) as { result: Record<string, { enabled?: boolean }> };
  const te = Object.values(feat.result)[0];
  r.add(te?.enabled ? "pass" : "fail", "準備: amendment TokenEscrow", "enabled", String(te?.enabled), "feature TokenEscrow");
  if (!te?.enabled) throw new Abort("TokenEscrow が無効");

  // ── 準備: V・D・お店 ─────────────────────────────
  const V = (await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE)).wallet;
  const D = (await loadOrCreatePersistentWallet(client, "DISTRIBUTION_SEED", "distribution D", HERE)).wallet;
  const vInfo = await client.request({ command: "account_info", account: V.address, ledger_index: "validated" });
  if ((vInfo.result.account_data.Flags & 0x00800000) === 0) for (const o of await configureEscrowableIssuer(client, V)) r.tx("準備: V の AccountSet（DefaultRipple → AllowTrustLineLocking）", o, "tesSUCCESS");
  if ((await voucherBalance(client, D.address, V.address)) === undefined) r.tx("準備: D の受給証トラストライン", await submitAndLog(client, "D TrustSet", { TransactionType: "TrustSet", Account: D.address, LimitAmount: zkv(V.address, "1000000") }, D), "tesSUCCESS");
  if (Number(await voucherBalance(client, D.address, V.address)) < 60) {
    const o = await submitAndLog(client, "V → D 受給証 60", { TransactionType: "Payment", Account: V.address, Destination: D.address, Amount: zkv(V.address, "60") }, V);
    r.tx("準備: V → D 受給証 60（本番は D が RLUSD で 1:1 に買う。spike 04 で確認済み）", o, "tesSUCCESS");
  }
  const A = Wallet.generate(), B = Wallet.generate();
  for (const [name, w] of [["A", A], ["B", B]] as const) {
    const o = await submitAndLog(client, `D → お店 ${name} 2 XRP`, { TransactionType: "Payment", Account: D.address, Destination: w.address, Amount: xrpToDrops("2") }, D);
    if (o.engineResult !== "tesSUCCESS") { r.tx(`準備: お店 ${name} の口座を作る`, o, "tesSUCCESS"); throw new Abort("お店の口座を作れない"); }
  }
  r.add("observe", "準備: 口座", "-", `V=${V.address}<br>D=${D.address}<br>お店 A=${A.address}<br>お店 B=${B.address}<br>世帯 HH1・HH2 は XRPL の口座なし`, "お店は受給証のトラストラインを張らない（Finish のときに自動で作られるかを確認 6 で見る）");
  extra["accounts"] = { V: V.address, D: D.address, A: A.address, B: B.address };

  // ── 世帯側: 秘密・端末の鍵・Condition を作る。D に渡すのは Condition（と公開鍵のハッシュ）だけ ──
  const households: State["households"] = {};
  const keys: Record<string, CryptoKeyPair> = {};
  for (const h of ["HH1", "HH2"]) households[h] = { secretHex: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))) };
  // Node で段階をまたいで鍵を使うため、この検証では書き出せる鍵にして .state/ に置く（ブラウザでは書き出せない鍵で動くことを 11b で確認済み）
  keys["HH1"] = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  households["HH1"]!.deviceJwk = await subtle.exportKey("jwk", keys["HH1"].privateKey);
  const pubRaw = new Uint8Array(await subtle.exportKey("raw", keys["HH1"].publicKey));
  const pkHashHex = hex(await sha256(pubRaw));
  const unhexB = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));
  const preimages = new Map<string, Uint8Array>();
  const requests: { spec: Spec; conditionHex: string; pkHash?: string }[] = [];
  for (const s of SPECS) {
    const pre = await derivePreimage(unhexB(households[s.household]!.secretHex), voucherLabel(s.household, s.n));
    preimages.set(s.id, pre);
    requests.push({ spec: s, conditionHex: (await conditionOf(pre)).conditionHex, pkHash: s.signed ? pkHashHex : undefined });
  }
  const again = await derivePreimage(unhexB(households["HH1"]!.secretHex), voucherLabel("HH1", 1));
  r.eq("確認2: 世帯の秘密から preimage を作り直せる（v1 を 2 回導出）", "一致", hex(again) === hex(preimages.get("v1")!) ? "一致" : "不一致", "HMAC-SHA256(秘密, todoke-11c|HH1|1)。preimage の値は出力しない");

  // ── 確認 1: D が Batch（AllOrNothing）で券 7 枚を作る ──────────────
  const now = await validatedCloseTime(client);
  const shopAddr = { A: A.address, B: B.address };
  const inners: SubmittableTransaction[] = requests.map(({ spec, conditionHex, pkHash }) => ({
    TransactionType: "EscrowCreate", Account: D.address, Destination: shopAddr[spec.shop], Amount: zkv(V.address, spec.value),
    Condition: conditionHex, CancelAfter: now + (spec.short ? SHORT_SEC : LONG_SEC),
    ...(pkHash ? { Memos: [{ Memo: { MemoType: PK_MEMO_TYPE, MemoData: pkHash } }] } : {}),
  }) as EscrowCreate);
  const oc0 = await ownerCount(client, D.address), x0 = await xrpBalanceDrops(client, D.address), z0 = await voucherBalance(client, D.address, V.address);
  const fee = batchFeeDrops(inners, await baseFeeDrops(client));
  const built = await buildSingleAccountBatch(client, D, BatchFlags.tfAllOrNothing, inners, fee.total);
  const out = await submitBatch(client, D, built);
  const innerOk = out.inner.length === 7 && out.inner.every((i) => i.result === "tesSUCCESS");
  r.add(out.engineResult === "tesSUCCESS" && innerOk ? "pass" : "fail", "確認1: D が EscrowCreate 7 件を Batch（tfAllOrNothing）で送る", "外側 tesSUCCESS・内側 7 件すべて tesSUCCESS",
    `外側 ${out.engineResult ?? out.error} / 内側 [${out.inner.map((i) => i.result ?? "未記録").join(", ")}]`, `${link(out.hash)}<br>手数料 ${out.fee} drops（${fee.formula}）`);
  if (!innerOk) throw new Abort("券を作れない。以降は実施しない");
  const seqOf = (i: number) => built.sequence + 1 + i;
  const oc1 = await ownerCount(client, D.address), x1 = await xrpBalanceDrops(client, D.address), z1 = await voucherBalance(client, D.address, V.address);
  r.eq("確認1: D の OwnerCount（Escrow 1 件 = 1）", `${oc0 + 7}`, `${oc1}`, `${oc0} → ${oc1}。準備金 ${vl?.reserve_inc_xrp} XRP × 7 を D が持つ`);
  r.add("observe", "確認1: D の残高の変化", "受給証 −50、XRP は手数料だけ減る", `受給証 ${z0} → ${z1}<br>XRP ${x0} → ${x1} drops（差 ${x1 - x0}）`, "account_lines / account_info");

  // 台帳に preimage が出ていないか（外側 tx の JSON 全体を探す）
  const outerJson = JSON.stringify(await txJson(client, out.hash));
  const leaked = SPECS.filter((s) => outerJson.includes(hex(preimages.get(s.id)!)));
  r.eq("確認1: 台帳の tx に preimage が出ていない", "0 件", `${leaked.length} 件`, "Batch の tx JSON を全文検索（D が受け取ったのは Condition だけ）");

  // ── 確認 7 の一部: 期限前の EscrowCancel ───────────────
  r.tx("確認7: 期限前に D が EscrowCancel（v1）", await submitAndLog(client, "D EscrowCancel v1（期限前）", { TransactionType: "EscrowCancel", Account: D.address, Owner: D.address, OfferSequence: seqOf(0) }, D), "tecNO_PERMISSION", "期待は rippled EscrowCancel.cpp（CancelAfter 前）");

  // ── 確認 3 の準備: お店が自店宛ての Escrow を同期する（オンライン中）────────
  async function sync(addr: string): Promise<SyncedEscrow[]> {
    const res = await client.request({ command: "account_objects", account: addr, type: "escrow", ledger_index: "validated" });
    const list: SyncedEscrow[] = [];
    for (const o of res.result.account_objects as unknown as Record<string, unknown>[]) {
      if (o["Destination"] !== addr) continue;
      const tx = (await txJson(client, String(o["PreviousTxnID"]))) as { tx_json?: Record<string, unknown> } & Record<string, unknown> | undefined;
      const tj = (tx?.["tx_json"] ?? tx) as Record<string, unknown> | undefined;
      const memo = ((tj?.["Memos"] as { Memo: { MemoType?: string; MemoData?: string } }[] | undefined) ?? []).find((m) => m.Memo.MemoType?.toUpperCase() === PK_MEMO_TYPE);
      list.push({ index: String(o["index"]), owner: String(o["Account"]), offerSequence: Number(tj?.["Sequence"]), destination: addr, amount: o["Amount"] as SyncedEscrow["amount"],
        condition: String(o["Condition"]), cancelAfter: Number(o["CancelAfter"]), ...(memo?.Memo.MemoData ? { pkHash: memo.Memo.MemoData } : {}), createTx: String(o["PreviousTxnID"]) });
    }
    return list.sort((a, b) => a.offerSequence - b.offerSequence);
  }
  const listA = await sync(A.address), listB = await sync(B.address);
  r.eq("確認3: お店 A が account_objects で自店宛ての券を一覧できる", "6 件", `${listA.length} 件`, "v1〜v4・v6・v7。Escrow は宛先の owner directory にも入る（rippled EscrowCreate.cpp の dirInsert）");
  r.eq("確認3: お店 B の一覧", "1 件", `${listB.length} 件`, "v5。account_objects");
  const mismatch = requests.filter((q, i) => { const e = [...listA, ...listB].find((x) => x.offerSequence === seqOf(i)); return !e || e.condition.toUpperCase() !== q.conditionHex || e.owner !== D.address || e.destination !== shopAddr[q.spec.shop]; });
  r.eq("確認3: 同期した券の持ち主・宛先・Condition が作った内容と一致", "0 件の不一致", `${mismatch.length} 件の不一致`, "持ち主 = D（世帯のアドレスは台帳に出ない）");
  const memoCount = listA.filter((e) => e.pkHash).length;
  r.eq("確認3: 端末の公開鍵のハッシュ（Memo）を同期で取れる", "3 件", `${memoCount} 件`, "v1〜v3。Escrow には Memo が残らないので、PreviousTxnID の tx から読む");
  saveJson(SYNCED_A, listA);

  // ── 世帯側: 券の QR を作る ─────────────────────────
  const vouchers: IssuedVoucher[] = [];
  for (const [i, q] of requests.entries()) {
    const seq = seqOf(i), pre = preimages.get(q.spec.id)!;
    const sig = q.spec.signed ? { pub: pubRaw, sig: await signVoucher(keys["HH1"]!.privateKey, D.address, seq, shopAddr[q.spec.shop]) } : undefined;
    const qr = encodeVoucher({ owner: D.address, offerSequence: seq, preimage: pre, sig });
    vouchers.push({ ...q.spec, offerSequence: seq, conditionHex: q.conditionHex, preimageHex: hex(pre), qrHex: hex(qr), cancelAfter: now + (q.spec.short ? SHORT_SEC : LONG_SEC) });
  }
  const sizes = [...new Set(vouchers.map((v) => v.qrHex.length / 2))].sort();
  const qrInfo = sizes.map((n) => {
    const qv = (ec: "L" | "M") => QRCode.create([{ data: new Uint8Array(n), mode: "byte" }], { errorCorrectionLevel: ec }).version;
    return `${n} B → QR 型番 ${qv("L")}（L）/ ${qv("M")}（M）`;
  });
  r.add("observe", "確認3: 券の QR の大きさ", "1 枚に収まる", qrInfo.join("<br>"), "署名なし 58 B = 版・フラグ・持ち主・OfferSequence・preimage / 署名つき 187 B = + 公開鍵 65 B・署名 64 B（qrcode で型番を計算）");
  extra["vouchers"] = vouchers.map((v) => ({ id: v.id, household: v.household, shop: v.shop, value: v.value, offerSequence: v.offerSequence, condition: v.conditionHex, cancelAfter: v.cancelAfter, signed: v.signed, qrBytes: v.qrHex.length / 2 }));
  extra["batch"] = { hash: out.hash, fee: out.fee, formula: fee.formula, inner: out.inner };

  const state: State = { at: new Date().toISOString(), accounts: { V: V.address, D: D.address, A: A.address, B: B.address }, shopSeeds: { A: A.seed!, B: B.seed! }, households, vouchers };
  saveJson(STATE, state);
  console.log("[11c] wrote .state/11c.json（秘密を含む。コミットしない）");
} catch (e) {
  if (!(e instanceof Abort)) throw e;
  r.unknowns.push(`中断: ${e.message}`);
} finally {
  saveResults("issue", r, extra);
  await client.disconnect();
}
