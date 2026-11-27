/**
 * 追加検証（Testnet・合成データの券 1 枚）: ZK で検証済みの申請と、実際に台帳へ載った Escrow の
 * 宛先・資産・額面・期限・Condition・鍵ハッシュを突き合わせる。Escrow の作成は 11c と同じ形（D → 店、Condition + Memo）。
 *   pnpm --filter 13-zk-bound-voucher testnet
 * 使う口座は 11c と同じ V（受給証の発行者）・D（配布用）。店は毎回新しく作る。EscrowFinish はしない（11c で確認済み）。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Wallet, xrpToDrops } from "xrpl";
import { configureEscrowableIssuer, connectTestnet, explorerTxUrl, loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog } from "xrpl-kit";
import { PK_MEMO_TYPE, encodeVoucher, rippleNow, signVoucher } from "../../11c-voucher-escrow/src/voucher/core.js";
import { verifyVoucher, type SyncedEscrow } from "../../11c-voucher-escrow/src/voucher/shop.js";
import { Issuer, type Program } from "./issuer.js";
import { digestToFields, fieldHex, hex, requestDigest, sha256, syntheticField, toUnits, type Req } from "./lib.js";
import { Roster } from "./roster.js";
import { PUBLIC_NAMES, Zk } from "./zk.js";

loadEnvLocal(fileURLToPath(import.meta.url));
const HERE = fileURLToPath(import.meta.url);
const rows: { item: string; expected: string; actual: string; ok: boolean; evidence: string }[] = [];
const row = (item: string, expected: string, actual: string, evidence = "") => { rows.push({ item, expected, actual, ok: expected === actual, evidence }); console.log(`${expected === actual ? "OK  " : "FAIL"} ${item}: 期待=${expected} 実際=${actual} ${evidence}`); };
const zk = new Zk(); await zk.init();
const client = await connectTestnet();
const extra: Record<string, unknown> = {};
try {
  const V = (await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE)).wallet;
  const D = (await loadOrCreatePersistentWallet(client, "DISTRIBUTION_SEED", "distribution D", HERE)).wallet;
  // 発行者 V が AllowTrustLineLocking を持っていないと、トークンの EscrowCreate は tecNO_PERMISSION になる（初回の実行で実際に起きた: 73C0DBBE…）。11c と同じく持っていなければ設定する
  const vInfo = await client.request({ command: "account_info", account: V.address, ledger_index: "validated" });
  const vHad = (vInfo.result.account_data.Flags & 0x00800000) !== 0;
  if (!vHad) for (const o of await configureEscrowableIssuer(client, V)) console.log(`V の設定: ${o.engineResult} ${o.hash}`);
  extra["issuerHadAllowTrustLineLocking"] = vHad;
  const zkv = (value: string) => ({ currency: "ZKV", issuer: V.address, value });
  const lines = await client.request({ command: "account_lines", account: D.address, peer: V.address, ledger_index: "validated" });
  const bal = Number(lines.result.lines.find((l) => l.currency === "ZKV")?.balance ?? "-1");
  if (bal < 5) {
    if (bal < 0) await submitAndLog(client, "D TrustSet", { TransactionType: "TrustSet", Account: D.address, LimitAmount: zkv("1000000") }, D);
    await submitAndLog(client, "V → D 受給証 20", { TransactionType: "Payment", Account: V.address, Destination: D.address, Amount: zkv("20") }, V);
  }
  const shop = Wallet.generate();
  const fund = await submitAndLog(client, "D → 店 2 XRP", { TransactionType: "Payment", Account: D.address, Destination: shop.address, Amount: xrpToDrops("2") }, D);
  row("準備: 店の口座を作る", "tesSUCCESS", String(fund.engineResult), fund.hash);

  // 名簿・制度（ローカル）。制度の持ち主は実際の D、資産は実際の V の ZKV
  const h = { id: "H1", secret: await syntheticField("hh-secret|T1"), salt: await syntheticField("salt|T1"), zone: 13101n, senior: true, revictim: true, tier: 3, profile: { name: "合成 一郎", address: "架空" } };
  const roster = await new Roster([h]).build(zk);
  const pid = await syntheticField(`program|testnet|${Date.now()}`);
  const program: Program = { id: pid, name: "県（Testnet）", owner: D.address, currency: "ZKV", issuer: V.address, allowedValues: [toUnits("5")], allowedShops: new Set([shop.address]), stmt: { zoneSet: Array.from({ length: 8 }, () => 13101n), needSenior: true, needRevictim: false, minTier: 2 } };
  const issuer = new Issuer(zk, new Map([[pid, program]]), new Set([roster.root]), () => rippleNow());
  // 発券側が OfferSequence を採番するので、D の次の Sequence から始める（これが XRPL の Sequence と一致しないと券が作れない）
  const info = await client.request({ command: "account_info", account: D.address, ledger_index: "validated" });
  issuer.seqBase = info.result.account_data.Sequence - 1;

  const subtle = globalThis.crypto.subtle;
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const preimage = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const now = Number((await client.request({ command: "ledger", ledger_index: "validated" })).result.ledger.close_time);
  const req: Req = { programId: pid, owner: D.address, shop: shop.address, currency: "ZKV", issuer: V.address, valueUnits: toUnits("5"), cancelAfter: now + 7200, pkHash: hex(await sha256(pub)), conditionHash: hex(await sha256(preimage)) };
  const digest = await requestDigest(req);
  const d = await zk.derive({ hhSecret: h.secret, programId: pid, zone: h.zone, senior: true, revictim: true, tier: 3, salt: h.salt, digest });
  const proof = await zk.prove(zk.inputs({ ...program.stmt, root: roster.root, programId: pid }, { zone: h.zone, senior: true, revictim: true, tier: 3, hhSecret: h.secret, salt: h.salt, index: 0, siblings: roster.path(0) }, digest, d.nullifier, d.tag));
  // cancelAfter は Ripple 時刻（台帳の close_time）で作ったので、発券側の時計（Date.now）との差を許す範囲に収める
  const out = await issuer.issue(req, proof);
  row("ZK 証明の検証と発券（ローカルの発券記録）", "created", out.ok ? out.status : `reject:${out.stage}:${out.reason}`, `prove ${proof.proveMs} ms`);
  if (!out.ok) throw new Error("発券できず中断");
  const rec = out.record;

  // 発券記録から EscrowCreate を作って送る（申請ではなく、承認して記録した内容を使う）
  const tx = await submitAndLog(client, "EscrowCreate（発券記録から）", {
    TransactionType: "EscrowCreate", Account: rec.owner, Sequence: rec.offerSequence, Destination: rec.shop, Amount: rec.amount, Condition: rec.condition, CancelAfter: rec.cancelAfter,
    Memos: [{ Memo: { MemoType: PK_MEMO_TYPE, MemoData: rec.pkHash } }],
  } as never, D);
  row("EscrowCreate の結果", "tesSUCCESS", String(tx.engineResult), `${tx.hash} ${explorerTxUrl(tx.hash)}`);
  extra["createTx"] = tx.hash; extra["accounts"] = { D: D.address, V: V.address, shop: shop.address };
  if (tx.engineResult !== "tesSUCCESS") throw new Error(`EscrowCreate が通らなかった: ${tx.engineResult}`);

  // 台帳から読み戻し、申請・発券記録・台帳を突き合わせる
  const objs = await client.request({ command: "account_objects", account: shop.address, type: "escrow", ledger_index: "validated" });
  const e = (objs.result.account_objects as unknown as Record<string, unknown>[]).find((o) => o["PreviousTxnID"] === tx.hash)!;
  const txj = await client.request({ command: "tx", transaction: tx.hash });
  const tj = ((txj.result as unknown as { tx_json?: Record<string, unknown> }).tx_json ?? txj.result) as Record<string, unknown>;
  const memo = ((tj["Memos"] as { Memo: { MemoType?: string; MemoData?: string } }[]) ?? []).find((m) => m.Memo.MemoType?.toUpperCase() === PK_MEMO_TYPE)?.Memo.MemoData;
  const amt = e["Amount"] as { currency: string; issuer: string; value: string };
  const onChain: Req = { programId: pid, owner: String(e["Account"]), shop: String(e["Destination"]), currency: amt.currency, issuer: amt.issuer, valueUnits: toUnits(amt.value), cancelAfter: Number(e["CancelAfter"]), pkHash: String(memo), conditionHash: String(e["Condition"]).slice(8, 72) };
  row("台帳の Escrow: 持ち主（Account）", req.owner, onChain.owner);
  row("台帳の Escrow: 宛先（Destination）", req.shop, onChain.shop);
  row("台帳の Escrow: 資産（通貨・発行者）", `${req.currency}/${req.issuer}`, `${onChain.currency}/${onChain.issuer}`);
  row("台帳の Escrow: 額面", String(req.valueUnits), String(onChain.valueUnits));
  row("台帳の Escrow: 期限（CancelAfter）", String(req.cancelAfter), String(onChain.cancelAfter));
  row("台帳の Escrow: Condition", `A0258020${req.conditionHash.toUpperCase()}810120`, String(e["Condition"]).toUpperCase());
  row("台帳の tx の Memo: 端末の鍵のハッシュ", req.pkHash.toUpperCase(), String(memo).toUpperCase(), "XRPL は Memo の中身を強制しない。店のオフライン検証が強制する");
  row("台帳の OfferSequence（tx の Sequence）= 発券側が採番した値", String(rec.offerSequence), String(tj["Sequence"]));
  const f = digestToFields(await requestDigest(onChain));
  row("台帳の内容から作った申請ダイジェスト = ZK 証明の公開入力", "true", String(BigInt(proof.publicInputs[PUBLIC_NAMES.indexOf("req_hi")]!) === f.hi && BigInt(proof.publicInputs[PUBLIC_NAMES.indexOf("req_lo")]!) === f.lo), "検証済みの申請 = 台帳の Escrow");
  // 台帳から読んだ一覧で、店が QR を確かめる（ネットワークなしの確認は offline.ts。ここは台帳由来のデータでも通ることの確認）
  const synced: SyncedEscrow = { index: String(e["index"]), owner: onChain.owner, offerSequence: Number(tj["Sequence"]), destination: onChain.shop, amount: amt, condition: String(e["Condition"]), cancelAfter: onChain.cancelAfter, pkHash: String(memo), createTx: tx.hash };
  const qr = encodeVoucher({ owner: rec.owner, offerSequence: rec.offerSequence, preimage, sig: { pub, sig: await signVoucher(kp.privateKey, rec.owner, rec.offerSequence, rec.shop) } });
  const res = await verifyVoucher(qr, [synced], { shop: shop.address, nowRipple: now, marginSec: 120, used: new Set() });
  row("台帳由来の同期データで、店が QR を確かめる", "使える", res.reason);
  void fieldHex;
} catch (e) {
  rows.push({ item: "中断", expected: "-", actual: (e as Error).message, ok: false, evidence: "" });
  console.log(`中断: ${(e as Error).message}`);
} finally {
  writeFileSync(new URL("../results/testnet.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), failed: rows.filter((r) => !r.ok).length, rows, ...extra }, null, 2));
  await client.disconnect();
  await zk.close();
}
