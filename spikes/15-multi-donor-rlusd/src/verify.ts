/**
 * 読み取り専用の検算コマンド。署名鍵・シード・.env.local を一切読まない。書き込み（submit）もしない。
 *   pnpm --filter 15-multi-donor-rlusd verify                       results/manifest.json を検算
 *   pnpm --filter 15-multi-donor-rlusd verify -- --manifest <path>   別の manifest
 *   pnpm --filter 15-multi-donor-rlusd verify -- --zk                 加えて、公開された ZK 証明を再検証（回路・bb が必要）
 * 入力: manifest（取引 hash・口座・券の内容）。公開台帳（validated）から、確定取引・メタデータ・確定残高を読み、
 *       券ごとの流れと P・N・S・V の期待差額を、十進の固定精度（10^-15 刻みの BigInt）で再計算する。丸めない。
 * 終了コード: すべて期待どおりなら 0、1 つでも違えば 1。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "xrpl";
import { ACCOUNT_ONE, NETWORK } from "./config.js";
import { fmtDec, fmtSigned, parseDec } from "./dec.js";
import { type LineDelta, escrowNodes, lineDeltas } from "./deltas.js";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PKG = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const manifestPath = argOf("--manifest") ?? `${PKG}results/manifest.json`;
const outPath = argOf("--out") ?? manifestPath.replace(/manifest(\.[^/]*)?\.json$/, "verify$1.json");
const wantZk = args.includes("--zk");

interface Ticket { id: string; program: "P" | "N"; donor: string; household: string; shop: string; value: string; cancelAfter: number; condition: string; pkHash: string; offerSequence: number; escrowIndex: string; createTx: string; outcome: "used" | "expired"; finalRecipient: "S" | "N"; finishTx: string | null; cancelTx: string | null; redeemTx: string | null }
interface Tx { label: string; phase: "prep" | "scenario"; role: string; ticket: string | null; account: string; type: string; hash: string; expect: string; ledger: number; fee: string | null }
interface Manifest {
  network: string; endpoint: string; asset: { RLUSD: { currency: string; issuer: string }; ZKV: { currency: string; issuer: string } };
  accounts: Record<"P" | "N" | "S" | "V" | "K", { address: string; role: string }>; baselineLedger: number; endLedger: number;
  midCheck: { ticket: string; ledger: number; closeTime: number; cancelAfter: number } | null; contributions: { P: string; N: string };
  tickets: Ticket[]; transactions: Tx[];
}
const M = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const host = new URL(M.endpoint).hostname;
if (!["s.altnet.rippletest.net", "clio.altnet.rippletest.net"].includes(host)) throw new Error(`Testnet 以外には接続しない: ${host}`);

const A = Object.fromEntries(Object.entries(M.accounts).map(([k, v]) => [k, v.address])) as Record<"P" | "N" | "S" | "V" | "K", string>;
const nameOf = (a: string) => (Object.entries(A).find(([, v]) => v === a)?.[0] ?? a);
const RL = M.asset.RLUSD, ZK = M.asset.ZKV;
const sha256hex = (hexStr: string) => createHash("sha256").update(Buffer.from(hexStr, "hex")).digest("hex").toUpperCase();

interface Check { section: string; name: string; expected: string; actual: string; ok: boolean; evidence: string }
const checks: Check[] = [];
const add = (section: string, name: string, expected: string, actual: string, evidence: string, ok = expected === actual) => { checks.push({ section, name, expected, actual, ok, evidence }); };

const client = new Client(M.endpoint);
await client.connect();

async function ledgerClose(i: number): Promise<number> { return Number((await client.request({ command: "ledger", ledger_index: i })).result.ledger.close_time); }
async function lineBalAt(holder: string, peer: string, currency: string, ledger: number): Promise<bigint> {
  try {
    let marker: unknown;
    do {
      const r = (await client.request({ command: "account_lines", account: holder, peer, ledger_index: ledger, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J };
      const l = (r.result["lines"] as J[]).find((x) => x["currency"] === currency);
      if (l) return parseDec(l["balance"]);
      marker = r.result["marker"];
    } while (marker);
    return 0n;
  } catch (e) { if ((e as { data?: { error?: string } }).data?.error === "actNotFound") return 0n; throw e; }
}
async function obligationsAt(ledger: number): Promise<bigint> {
  const r = (await client.request({ command: "gateway_balances", account: A.V, ledger_index: ledger } as never)) as unknown as { result: J };
  const o = (r.result["obligations"] ?? {}) as Record<string, string>;
  return o[ZK.currency] ? parseDec(o[ZK.currency]!) : 0n;
}
async function escrowAt(index: string, ledger: number): Promise<J | undefined> {
  try { return ((await client.request({ command: "ledger_entry", index, ledger_index: ledger } as never)) as unknown as { result: J }).result["node"]; } catch (e) { if ((e as { data?: { error?: string } }).data?.error === "entryNotFound") return undefined; throw e; }
}
async function ownedEscrows(acct: string, ledger: number) {
  let n = 0; let marker: unknown;
  do { const r = (await client.request({ command: "account_objects", account: acct, type: "escrow", ledger_index: ledger, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J }; n += (r.result["account_objects"] as J[]).length; marker = r.result["marker"]; } while (marker);
  return n;
}

/** 取引メタデータから、口座ごとの RLUSD / ZKV の増減（RLUSD は発行者 RL.issuer との線、ZKV は V との線）。V の ZKV は義務（発行残高）の増減 */
function perAccount(ds: LineDelta[]) {
  const out: Record<string, { RLUSD: bigint; ZKV: bigint }> = {};
  const slot = (a: string) => (out[a] ??= { RLUSD: 0n, ZKV: 0n });
  for (const d of ds) {
    if (d.currency === RL.currency && d.counterparty === RL.issuer && d.account !== RL.issuer) slot(nameOf(d.account)).RLUSD += d.delta;
    if (d.currency === ZK.currency && d.account !== A.V && d.counterparty === A.V) slot(nameOf(d.account)).ZKV += d.delta;
    if (d.currency === ZK.currency && d.account === A.V) slot("V").ZKV += d.delta; // V 側（負 = 義務の増加）
  }
  return out;
}

async function main() {
  console.log(`# 検算: ${NETWORK}  manifest=${manifestPath}`);
  console.log(`  開始点 ledger ${M.baselineLedger} → 終了 ledger ${M.endLedger}。読み取りのみ（署名鍵なし）。\n`);
  const sv = await client.request({ command: "server_info" });
  add("0 前提", "接続先は Testnet（network_id=1）", "1", String(sv.result.info.network_id ?? "?"), "server_info");
  add("0 前提", "履歴が開始点から終了点まで連続している", "true", String(String(sv.result.info.complete_ledgers).split(",").some((p) => { const [a, b] = p.split("-").map(Number); return a! <= M.baselineLedger && M.endLedger <= b!; })), `complete_ledgers=${sv.result.info.complete_ledgers}`);
  const issuerInfo = (await client.request({ command: "account_info", account: RL.issuer, ledger_index: "validated" })).result.account_data;
  add("0 前提", "RLUSD の発行者が実在（自前発行の同名資産ではない）", "実在・Domain あり", `${issuerInfo.Account} Domain=${issuerInfo.Domain ? Buffer.from(String(issuerInfo.Domain), "hex").toString() : "なし"}`, "account_info", Boolean(issuerInfo.Domain));
  add("0 前提", "ZKV の発行者 V は RLUSD の発行者と別口座", "別", A.V === RL.issuer ? "同じ" : "別", "manifest");

  // ── 1. 取引ごとの確定結果 ──
  const txs: Record<string, { tx: J; meta: J; ledger: number; close: number; deltas: LineDelta[] }> = {};
  for (const t of M.transactions) {
    const r = (await client.request({ command: "tx", transaction: t.hash } as never)) as unknown as { result: J };
    const res = r.result, tj = (res["tx_json"] ?? res) as J, meta = res["meta"] as J;
    const close = await ledgerClose(res["ledger_index"]);
    txs[t.hash] = { tx: tj, meta, ledger: res["ledger_index"], close, deltas: lineDeltas(meta) };
    add("1 取引の確定", `${t.label}`, `${t.expect} / validated / ledger ${t.ledger}`, `${meta["TransactionResult"]} / ${res["validated"] ? "validated" : "未validated"} / ledger ${res["ledger_index"]}`, t.hash, meta["TransactionResult"] === t.expect && res["validated"] === true && res["ledger_index"] === t.ledger);
    add("1 取引の確定", `${t.label}: 署名した口座`, nameOf(t.account), nameOf(String(tj["Account"])), t.hash);
  }

  // ── 2. 券ごとの流れ（確定取引・メタデータ）──
  const flow: Record<string, J> = {};
  for (const k of M.tickets) {
    const need = [k.createTx, k.finishTx, k.cancelTx, k.redeemTx].filter((h): h is string => Boolean(h));
    const missing = need.filter((h) => !txs[h]);
    if (missing.length) { add(`2 券 ${k.id}`, "券の取引（作成・Finish/Cancel・償還）がすべて manifest の取引に含まれる", `${need.length} 件`, `${need.length - missing.length} 件（欠落 ${missing.join(",")}）`, "manifest", false); continue; }
    if (k.outcome === "used" ? !(k.finishTx && k.redeemTx) : !(k.cancelTx && k.redeemTx)) { add(`2 券 ${k.id}`, "券の結末に必要な取引が manifest にある", "あり", "なし", "manifest", false); continue; }
    const cr = txs[k.createTx]!;
    const esc = escrowNodes(cr.meta).find((e) => e.kind === "created");
    const memo = ((cr.tx["Memos"] ?? []) as J[]).map((m) => m["Memo"] as J);
    const S = `2 券 ${k.id}`;
    add(S, "EscrowCreate: 持ち主・宛先・資産・額面・期限", `${nameOf(k.donor)}→S ${k.value} ZKV(V) CancelAfter=${k.cancelAfter}`, `${nameOf(cr.tx["Account"])}→${nameOf(cr.tx["Destination"])} ${cr.tx["Amount"]["value"]} ${cr.tx["Amount"]["currency"]}(${nameOf(cr.tx["Amount"]["issuer"])}) CancelAfter=${cr.tx["CancelAfter"]}`, k.createTx, cr.tx["Account"] === k.donor && cr.tx["Destination"] === k.shop && cr.tx["Amount"]["issuer"] === A.V && cr.tx["Amount"]["currency"] === ZK.currency && parseDec(cr.tx["Amount"]["value"]) === parseDec(k.value) && cr.tx["CancelAfter"] === k.cancelAfter);
    add(S, "Condition・Memo の鍵ハッシュ・OfferSequence・Escrow index", "一致", esc && String(cr.tx["Condition"]).toUpperCase() === k.condition.toUpperCase() && memo.some((m) => String(m["MemoData"]).toUpperCase() === k.pkHash.toUpperCase()) && cr.tx["Sequence"] === k.offerSequence && esc.index === k.escrowIndex ? "一致" : "不一致", `Escrow ${k.escrowIndex}`);
    add(S, "台帳・Memo に世帯の識別子を載せていない（Memo は鍵ハッシュ 1 つだけ）", "Memo 1 件", `Memo ${memo.length} 件`, k.createTx, memo.length === 1);
    const row: J = { create: { ZKV_donor: fmtSigned(perAccount(cr.deltas)[nameOf(k.donor)]?.ZKV ?? 0n) } };
    const value = parseDec(k.value);
    add(S, "EscrowCreate で支援元の ZKV が額面ぶん減る（Escrow に拘束）", fmtSigned(-value), fmtSigned(perAccount(cr.deltas)[nameOf(k.donor)]?.ZKV ?? 0n), k.createTx);
    if (k.outcome === "used") {
      const fin = txs[k.finishTx!]!, red = txs[k.redeemTx!]!;
      const f = perAccount(fin.deltas), r = perAccount(red.deltas);
      const fe = escrowNodes(fin.meta).find((e) => e.kind === "deleted");
      add(S, "EscrowFinish: 店 S が実行・Owner・OfferSequence", `S / ${k.donor} / ${k.offerSequence}`, `${nameOf(fin.tx["Account"])} / ${fin.tx["Owner"]} / ${fin.tx["OfferSequence"]}`, k.finishTx!, fin.tx["Account"] === k.shop && fin.tx["Owner"] === k.donor && fin.tx["OfferSequence"] === k.offerSequence);
      add(S, "Fulfillment の SHA-256 が Condition と一致・消えた Escrow が券のもの", "一致", String(fin.tx["Fulfillment"]).length === 72 && String(fin.tx["Fulfillment"]).startsWith("A0228020") && `A0258020${sha256hex(String(fin.tx["Fulfillment"]).slice(8))}810120` === k.condition.toUpperCase() && fe?.index === k.escrowIndex ? "一致" : "不一致", k.finishTx!);
      add(S, "期限前に Finish（Finish の ledger の close_time < CancelAfter）", "true", String(fin.close < k.cancelAfter), `close_time=${fin.close} CancelAfter=${k.cancelAfter}`);
      add(S, "店の ZKV が増える（精算）", fmtSigned(value), fmtSigned(f["S"]?.ZKV ?? 0n), k.finishTx!);
      add(S, "償還: 店の ZKV が減る", fmtSigned(-value), fmtSigned(r["S"]?.ZKV ?? 0n), k.redeemTx!);
      add(S, "償還: 店の RLUSD が増える（満額約定）", fmtSigned(value), fmtSigned(r["S"]?.RLUSD ?? 0n), k.redeemTx!);
      add(S, "償還: V の RLUSD が減る・V の ZKV 義務が減る", `${fmtSigned(-value)} / ${fmtSigned(-value)}`, `${fmtSigned(r["V"]?.RLUSD ?? 0n)} / ${fmtSigned(-(r["V"]?.ZKV ?? 0n))}`, k.redeemTx!);
      Object.assign(row, { finish: { S_ZKV: fmtSigned(f["S"]?.ZKV ?? 0n) }, redeem: { S_ZKV: fmtSigned(r["S"]?.ZKV ?? 0n), S_RLUSD: fmtSigned(r["S"]?.RLUSD ?? 0n), V_RLUSD: fmtSigned(r["V"]?.RLUSD ?? 0n) } });
    } else {
      const can = txs[k.cancelTx!]!, red = txs[k.redeemTx!]!;
      const c = perAccount(can.deltas), r = perAccount(red.deltas);
      const ce = escrowNodes(can.meta).find((e) => e.kind === "deleted");
      add(S, "EscrowCancel: keeper(K) が実行・Owner・OfferSequence・消えた Escrow", `K / ${k.donor} / ${k.offerSequence} / ${k.escrowIndex}`, `${nameOf(can.tx["Account"])} / ${can.tx["Owner"]} / ${can.tx["OfferSequence"]} / ${ce?.index}`, k.cancelTx!, can.tx["Account"] === A.K && can.tx["Owner"] === k.donor && can.tx["OfferSequence"] === k.offerSequence && ce?.index === k.escrowIndex);
      add(S, "期限後に Cancel（Cancel の ledger の close_time > CancelAfter）", "true", String(can.close > k.cancelAfter), `close_time=${can.close} CancelAfter=${k.cancelAfter}`);
      add(S, "一度も EscrowFinish されていない（manifest の取引に Finish なし・店の ZKV 変化なし）", "0 件", `${M.transactions.filter((t) => t.type === "EscrowFinish" && txs[t.hash]!.tx["OfferSequence"] === k.offerSequence && txs[t.hash]!.tx["Owner"] === k.donor).length} 件`, "manifest + メタデータ");
      add(S, "【返還 ZKV】支援元へ ZKV が戻る", fmtSigned(value), fmtSigned(c[nameOf(k.donor)]?.ZKV ?? 0n), k.cancelTx!);
      add(S, "【償還 RLUSD】支援元の ZKV が減る", fmtSigned(-value), fmtSigned(r[nameOf(k.donor)]?.ZKV ?? 0n), k.redeemTx!);
      add(S, "【償還 RLUSD】支援元の RLUSD が増える（満額約定）", fmtSigned(value), fmtSigned(r[nameOf(k.donor)]?.RLUSD ?? 0n), k.redeemTx!);
      Object.assign(row, { cancel: { [`${nameOf(k.donor)}_ZKV`]: fmtSigned(c[nameOf(k.donor)]?.ZKV ?? 0n) }, redeem: { [`${nameOf(k.donor)}_ZKV`]: fmtSigned(r[nameOf(k.donor)]?.ZKV ?? 0n), [`${nameOf(k.donor)}_RLUSD`]: fmtSigned(r[nameOf(k.donor)]?.RLUSD ?? 0n) } });
    }
    flow[k.id] = row;
  }
  if (M.midCheck) {
    const k = M.tickets.find((t) => t.id === M.midCheck!.ticket)!;
    const e = await escrowAt(k.escrowIndex, M.midCheck.ledger);
    const close = await ledgerClose(M.midCheck.ledger);
    add("2 券 C", "期限前（validated ledger の close_time < CancelAfter）は未使用の Escrow が存在", "存在 / true", `${e ? "存在" : "なし"} / ${close < k.cancelAfter}`, `ledger ${M.midCheck.ledger} close_time=${close} CancelAfter=${k.cancelAfter}`, Boolean(e) && close < k.cancelAfter);
  }

  // ── 3. 拠出 ──
  for (const w of ["P", "N"] as const) {
    const t = M.transactions.find((x) => x.label === `contrib:${w}`)!;
    const p = perAccount(txs[t.hash]!.deltas);
    const v = parseDec(M.contributions[w]);
    add("3 拠出", `${w}: RLUSD を拠出し ZKV を受ける（1:1）`, `RLUSD ${fmtSigned(-v)} / ZKV ${fmtSigned(v)}`, `RLUSD ${fmtSigned(p[w]?.RLUSD ?? 0n)} / ZKV ${fmtSigned(p[w]?.ZKV ?? 0n)}`, t.hash);
    add("3 拠出", `${w}: V の RLUSD 準備金が増える・ZKV 義務が増える`, `${fmtSigned(v)} / ${fmtSigned(v)}`, `${fmtSigned(p["V"]?.RLUSD ?? 0n)} / ${fmtSigned(-(p["V"]?.ZKV ?? 0n))}`, t.hash);
  }

  // ── 4. P・N・S・V の差額（確定残高の差 = 取引メタデータの合計 = 期待値）──
  const keys = ["P", "N", "S", "V"] as const;
  const sumMeta: Record<string, { RLUSD: bigint; ZKV: bigint }> = Object.fromEntries(keys.map((k) => [k, { RLUSD: 0n, ZKV: 0n }]));
  for (const t of M.transactions.filter((x) => x.phase === "scenario")) { const p = perAccount(txs[t.hash]!.deltas); for (const k of keys) { sumMeta[k]!.RLUSD += p[k]?.RLUSD ?? 0n; sumMeta[k]!.ZKV += p[k]?.ZKV ?? 0n; } }
  const bal = async (ledger: number) => {
    const o: Record<string, { RLUSD: bigint; ZKV: bigint }> = {};
    for (const k of keys) o[k] = { RLUSD: await lineBalAt(A[k], RL.issuer, RL.currency, ledger), ZKV: k === "V" ? -(await obligationsAt(ledger)) : await lineBalAt(A[k], A.V, ZK.currency, ledger) };
    return o;
  };
  const b0 = await bal(M.baselineLedger), b1 = await bal(M.endLedger);
  // 期待値: 拠出と券の結末だけから計算する（観測値は使わない）
  const exp: Record<string, bigint> = { P: 0n, N: 0n, S: 0n, V: 0n };
  for (const w of ["P", "N"] as const) { exp[w]! -= parseDec(M.contributions[w]); exp["V"]! += parseDec(M.contributions[w]); }
  for (const k of M.tickets) { const v = parseDec(k.value); exp["V"]! -= v; exp[k.finalRecipient]! += v; }
  const table: J[] = [];
  for (const k of keys) {
    const net = b1[k]!.RLUSD - b0[k]!.RLUSD;
    add("4 差額", `${k}: RLUSD の純増減（開始点 ${M.baselineLedger} → 終了 ${M.endLedger}）`, fmtSigned(exp[k]!), fmtSigned(net), `account_lines / gateway_balances（validated ledger ${M.baselineLedger} と ${M.endLedger}）`);
    add("4 差額", `${k}: 確定残高の差 = 取引メタデータの合計（説明できない差額）`, "0", fmtDec(net - sumMeta[k]!.RLUSD), "残高の差 − Σ(manifest の取引のメタデータ)");
    const zNet = b1[k]!.ZKV - b0[k]!.ZKV;
    add("4 差額", `${k}: ZKV の純増減（${k === "V" ? "V は発行残高の符号反転" : "保有"}）。最終的に残らない`, "0", fmtDec(zNet), "account_lines / gateway_balances");
    table.push({ account: k, RLUSD開始: fmtDec(b0[k]!.RLUSD), RLUSD終了: fmtDec(b1[k]!.RLUSD), RLUSD純増減: fmtSigned(net), 期待: fmtSigned(exp[k]!), ZKV純増減: fmtSigned(zNet) });
  }
  add("4 差額", "P+N+S+V の RLUSD 純増減の合計", "0", fmtDec(keys.reduce((a, k) => a + (b1[k]!.RLUSD - b0[k]!.RLUSD), 0n)), "合計");
  const nTotal = b1["N"]!.RLUSD - b0["N"]!.RLUSD;
  add("4 差額", "【N の純負担】= 拠出 − 返還（−0.10 + 0.05）", fmtSigned(-parseDec(M.contributions.N) + M.tickets.filter((t) => t.outcome === "expired" && t.donor === A.N).reduce((a, t) => a + parseDec(t.value), 0n)), fmtSigned(nTotal), "N の RLUSD 純増減");

  // ── 5. 終了時点の残り（未決 Escrow・未償還 ZKV）──
  let pendingEscrows = 0;
  for (const k of M.tickets) { const e = await escrowAt(k.escrowIndex, M.endLedger); if (e) pendingEscrows++; }
  add("5 終了時点", "試験対象の未決 Escrow（券 A・B・C の Escrow が台帳に残っているか）", "0", String(pendingEscrows), `ledger_entry @${M.endLedger}`);
  let owned = 0; for (const k of ["P", "N", "S"] as const) owned += await ownedEscrows(A[k], M.endLedger);
  add("5 終了時点", "P・N・S に関わる Escrow オブジェクトの総数", "0", String(owned), `account_objects(type=escrow) @${M.endLedger}`);
  const zkvOut = (await obligationsAt(M.endLedger)) - (await obligationsAt(M.baselineLedger));
  add("5 終了時点", "未償還の ZKV（V の発行残高の増減）", "0", fmtDec(zkvOut), `gateway_balances(V) @${M.baselineLedger}→${M.endLedger}`);
  add("5 終了時点", "V の RLUSD 準備金 − ZKV の発行残高（1:1 の裏付け）", "0", fmtDec(b1["V"]!.RLUSD + b1["V"]!.ZKV), "V の RLUSD 残高 + (−発行残高)");

  // ── 6. 説明できない取引（manifest にない取引が、開始点以降に P・N・S・V・K に触れていないか）──
  const known = new Set(M.transactions.map((t) => t.hash));
  const unknown: J[] = [];
  for (const k of ["P", "N", "S", "V", "K"] as const) {
    let marker: unknown;
    do {
      const r = (await client.request({ command: "account_tx", account: A[k], ledger_index_min: M.baselineLedger + 1, ledger_index_max: M.endLedger, forward: true, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J };
      for (const t of r.result["transactions"] as J[]) { const h = String(t["hash"] ?? t["tx_json"]?.["hash"]); if (!known.has(h)) unknown.push({ account: k, hash: h, type: (t["tx_json"] ?? t["tx"])?.["TransactionType"], ledger: t["ledger_index"] }); }
      marker = r.result["marker"];
    } while (marker);
  }
  add("6 説明できない取引", "開始点より後に P・N・S・V・K に触れた manifest 外の取引", "0 件", `${new Set(unknown.map((u) => u.hash)).size} 件`, unknown.length ? JSON.stringify(unknown.slice(0, 5)) : "account_tx（各口座、ページ末尾まで）");

  // ── 7. 別計上: XRP 手数料 ──
  const fees: Record<string, bigint> = {};
  for (const t of M.transactions) { const f = BigInt(String(txs[t.hash]!.tx["Fee"])); const a = nameOf(t.account); fees[a] = (fees[a] ?? 0n) + (t.phase === "scenario" ? f : 0n); }
  const feeInfo = Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, `${v} drops`]));

  // ── 8. （任意）公開された ZK 証明の再検証 ──
  if (wantZk) {
    const { Zk } = await import("../../13-zk-bound-voucher/src/zk.js");
    const { PUBLIC_NAMES } = await import("../../13-zk-bound-voucher/src/zk.js");
    const { requestDigest, digestToFields } = await import("../../13-zk-bound-voucher/src/lib.js");
    const proofs = JSON.parse(readFileSync(manifestPath.replace(/manifest[^/]*$/, "proofs.json"), "utf8")) as { tickets: Record<string, { req: J; proofHex: string; publicInputs: string[] }> };
    const zk = new Zk(); await zk.init();
    try {
      for (const k of M.tickets) {
        const p = proofs.tickets[k.id]!;
        const ok = (await zk.verify({ proof: Uint8Array.from(Buffer.from(p.proofHex, "hex")), publicInputs: p.publicInputs })).ok;
        const req = { ...(p.req as never as Record<string, string>), programId: BigInt(p.req["programId"]), valueUnits: BigInt(p.req["valueUnits"]) } as never;
        const { hi, lo } = digestToFields(await requestDigest(req));
        const pi = p.publicInputs.map((x) => BigInt(x));
        add(`2 券 ${k.id}`, "ZK 証明が検証を通る・公開入力の申請ダイジェストが申請の内容（店・額面・期限・Condition・鍵ハッシュ）と一致", "true / 一致", `${ok} / ${pi[PUBLIC_NAMES.indexOf("req_hi")] === hi && pi[PUBLIC_NAMES.indexOf("req_lo")] === lo ? "一致" : "不一致"}`, "bb.js verify + SHA-256", ok && pi[PUBLIC_NAMES.indexOf("req_hi")] === hi && pi[PUBLIC_NAMES.indexOf("req_lo")] === lo);
        add(`2 券 ${k.id}`, "申請の内容が台帳の EscrowCreate と一致（Condition・店・持ち主・期限）", "一致", String(p.req["owner"]) === k.donor && String(p.req["shop"]) === k.shop && Number(p.req["cancelAfter"]) === k.cancelAfter && `A0258020${String(p.req["conditionHash"]).toUpperCase()}810120` === k.condition.toUpperCase() ? "一致" : "不一致", k.createTx);
      }
    } finally { await zk.close(); }
  }

  // ── 出力 ──
  let sec = "";
  for (const c of checks) {
    if (c.section !== sec) { sec = c.section; console.log(`\n■ ${sec}`); }
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}\n      期待=${c.expected}  実際=${c.actual}  根拠=${c.evidence}`);
  }
  const bad = checks.filter((c) => !c.ok);
  console.log("\n■ 差額の表（RLUSD。開始点 → 終了）");
  console.table(table);
  console.log("■ 券ごとの流れ"); console.log(JSON.stringify(flow, null, 1));
  console.log(`\n■ XRP 手数料（今回分・別計上）: ${JSON.stringify(feeInfo)}`);
  console.log(`\n結果: ${checks.length - bad.length}/${checks.length} 項目が期待どおり。 未決 Escrow=${pendingEscrows} 未償還ZKV=${fmtDec(zkvOut)} 説明できない取引=${new Set(unknown.map((u) => u.hash)).size} 件`);
  writeFileSync(outPath, JSON.stringify({ schema: "todoke-spike15-verify/1", verifiedAt: new Date().toISOString(), manifest: manifestPath, zkChecked: wantZk, passed: bad.length === 0, total: checks.length, failed: bad.length, 純増減: table, 券ごとの流れ: flow, 未決Escrow: pendingEscrows, 未償還ZKV: fmtDec(zkvOut), 説明できない取引: unknown, XRP手数料_今回分: feeInfo, checks }, null, 1));
  console.log(`詳細: ${outPath}`);
  if (bad.length) { console.error(`\n期待と違う項目: ${bad.length}`); process.exitCode = 1; }
}
void ACCOUNT_ONE;

try { await main(); } finally { await client.disconnect(); }
