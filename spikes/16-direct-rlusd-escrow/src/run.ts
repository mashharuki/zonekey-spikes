/**
 * spike 16: ZKV・交換注文を介さず、公式 Testnet RLUSD そのものを条件付き Escrow にロックできるか（Testnet 実測）
 *   pnpm --filter 16-direct-rlusd-escrow run:scenario            前回の続き（完了済みなら再照合のみ）
 *   ... -- --new                                                  新しい独立試験（状態を退避）
 * 状態は .state/（gitignore 済み。署名済みバイト列・preimage を含む）。公開してよい結果は results/。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client, Wallet } from "xrpl";
import { connectTestnet, loadEnvLocal, loadOrCreatePersistentWallet } from "xrpl-kit";
import { conditionOf, hex } from "../../11c-voucher-escrow/src/voucher/core.js";
import { chainInfo, waitMs } from "../../14-issuance-recovery/src/chain.js";
import { escrowAt, ledgerInfo, lineBal, obligations } from "../../15-multi-donor-rlusd/src/chainio.js";
import { fmtDec, fmtSigned, parseDec } from "../../15-multi-donor-rlusd/src/dec.js";
import { escrowNodes, lineDeltas } from "../../15-multi-donor-rlusd/src/deltas.js";
import { Journal, StopError, type TxRec, tracked } from "../../15-multi-donor-rlusd/src/track.js";

const HERE = fileURLToPath(import.meta.url);
const PKG = fileURLToPath(new URL("../", import.meta.url));
const STATE = `${PKG}.state/`, RESULTS = `${PKG}results/`;
loadEnvLocal(HERE);
const argv = process.argv.slice(2);
const AMOUNT = { A: "0.1", B: "0.05" } as const;
const TTL = { A: 7200, B: 360 } as const; // A: 2 時間 / B: 6 分（期限到来を待つため短い）
const AMM_CAP_DROPS = "1000000"; // 試験用 XRP の投入上限: 1 XRP（0.15 RLUSD ≒ 0.15 XRP）
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

mkdirSync(RESULTS, { recursive: true });
if (argv.includes("--new") && existsSync(`${STATE}journal.json`)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(STATE, `${PKG}.state-archive-${stamp}/`);
  for (const f of ["manifest.json", "run.json", "verify.json"]) if (existsSync(`${RESULTS}${f}`)) renameSync(`${RESULTS}${f}`, `${RESULTS}${f.replace(".json", `.${stamp}.json`)}`);
}
mkdirSync(STATE, { recursive: true });
const readJson = <T>(f: string): T | undefined => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined);

const client: Client = await connectTestnet();
const jr = new Journal(`${STATE}journal.json`);
try { console.log(await main()); } catch (e) {
  if (e instanceof StopError) { console.error(`\n[停止] ${e.message}`); process.exitCode = 2; } else throw e;
} finally { await client.disconnect(); }

/** tracked の結果を「期待どおりでなくても」受け取る（初回結果を残すため）。未確定の停止は再送出 */
async function attempt(label: string, w: Wallet, tx: Parameters<typeof tracked>[4], role: string, ticket?: string): Promise<TxRec> {
  try { return await tracked(client, jr, label, w, tx, { role, phase: "scenario", ...(ticket ? { ticket } : {}) }); } catch (e) {
    const r = jr.get(label);
    if (e instanceof StopError && r?.status === "validated") return r; // validated だが tesSUCCESS ではない
    throw e;
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  // ── 1. 公式の発行者・ネットワークの確認（実行時） ──
  const page = await fetch("https://tryrlusd.com/addresses");
  const text = (await page.text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /XRPL Testnet Issued currency Trustline required Explorer RLUSD issuer \S+ (r[1-9A-HJ-NP-Za-km-z]{24,34}) Currency code · RLUSD, hex-encoded \S+ ([0-9A-F]{40})/.exec(text);
  if (!m) throw new StopError("公式ページ（tryrlusd.com/addresses）の XRPL Testnet 欄を読み取れない。公式に確認できない資産では代替しない");
  const official = { source: "https://tryrlusd.com/addresses（XRPL Testnet 欄）", httpStatus: page.status, fetchedAt: new Date().toISOString(), issuer: m[1]!, currency: m[2]!, comparisonIssuerFromSpike15: "rpcFL7MzZvGYFCihoUx9nrhhgAp4nSDdvG" };
  const RL = { currency: official.currency, issuer: official.issuer };
  const rl = (v: string) => ({ ...RL, value: v });
  const srv = (await client.request({ command: "server_info" })).result.info;
  const led0 = await ledgerInfo(client, "validated");
  const network = { endpoint: "wss://s.altnet.rippletest.net:51233", network_id: srv.network_id ?? null, build_version: srv.build_version, complete_ledgers: srv.complete_ledgers, validatedLedger: led0 };
  console.log(`[run] 公式 RLUSD issuer=${RL.issuer}（spike 15 と ${RL.issuer === official.comparisonIssuerFromSpike15 ? "同じ" : "違う"}） rippled=${srv.build_version} ledger=${led0.index}`);
  const issuerRoot = (await client.request({ command: "account_info", account: RL.issuer, ledger_index: "validated" })).result.account_data as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const FL: Record<string, number> = { DefaultRipple: 0x00800000, AllowTrustLineLocking: 0x40000000, AllowTrustLineClawback: 0x80000000, DepositAuth: 0x01000000, RequireAuth: 0x00040000, GlobalFreeze: 0x00400000, DisallowIncomingTrustline: 0x20000000 };
  const issuer = { account: RL.issuer, flagsHex: (issuerRoot["Flags"] as number).toString(16), flags: Object.fromEntries(Object.entries(FL).map(([k, v]) => [k, ((issuerRoot["Flags"] as number) & v) !== 0])), TransferRate: issuerRoot["TransferRate"] ?? null, TransferRateNote: issuerRoot["TransferRate"] ? "あり（1,000,000,000 = 手数料なし）" : "なし（手数料なし）", Domain: issuerRoot["Domain"] ? Buffer.from(String(issuerRoot["Domain"]), "hex").toString() : null };
  let tokenEscrow: string;
  try { const f = (await client.request({ command: "feature", feature: "TokenEscrow" } as never)) as unknown as { result: Record<string, Record<string, unknown>> }; const v = Object.values(f.result).find((x) => x && typeof x === "object" && "enabled" in x); tokenEscrow = v ? `enabled=${String(v["enabled"])}` : "未確認（応答に enabled なし）"; } catch (e) { tokenEscrow = `未確認（feature RPC: ${(e as { data?: { error?: string } }).data?.error ?? (e as Error).message}）`; }
  if (!issuer.flags["AllowTrustLineLocking"]) console.log("[run] 注意: 発行者に AllowTrustLineLocking が無い（03 と同じ状況）。結果を記録して続行する");

  // ── 2. 口座と準備（開始残高の前。給付区間と別計上） ──
  const D = (await loadOrCreatePersistentWallet(client, "DIRECT16_D_SEED", "ドナー D", HERE)).wallet;
  const S = (await loadOrCreatePersistentWallet(client, "DIRECT16_S_SEED", "店舗 S", HERE)).wallet;
  const K = (await loadOrCreatePersistentWallet(client, "DIRECT16_K_SEED", "keeper K", HERE)).wallet;
  if (new Set([D.address, S.address, K.address]).size !== 3) throw new StopError("D・S・K が同じアカウント");
  const W: Record<string, Wallet> = { D, S, K };
  const baselineFile = `${STATE}baseline.json`;
  type Base = { ledger: number; hash: string; closeTime: number; D: string; S: string; xrp: Record<string, string> };
  let base = readJson<Base>(baselineFile);
  if (!base) {
    const prep = (label: string, w: string, tx: Parameters<typeof tracked>[4], role: string) => tracked(client, jr, label, W[w]!, tx, { role, phase: "prep" });
    for (const w of ["D", "S"]) await prep(`prep:${w}:TrustSet RLUSD`, w, { TransactionType: "TrustSet", Account: W[w]!.address, LimitAmount: rl("1000000") }, "prep-trustline");
    const have = await lineBal(client, D.address, RL.issuer, RL.currency, "validated");
    if (!jr.list().some((r) => r.label.startsWith("prep:D:buy") && r.status === "validated") && have < parseDec("0.15"))
      await prep("prep:D:buy RLUSD 0.15 via AMM", "D", { TransactionType: "Payment", Account: D.address, Destination: D.address, Amount: rl(fmtDec(parseDec("0.15") - have)), SendMax: AMM_CAP_DROPS }, "prep-rlusd-acquire");
    const ledger = Math.max(...jr.list().filter((r) => r.phase === "prep").map((r) => r.ledger ?? 0));
    const li = await ledgerInfo(client, ledger);
    const xrp = Object.fromEntries(await Promise.all(Object.entries(W).map(async ([k, w]) => [k, (await client.request({ command: "account_info", account: w.address, ledger_index: ledger })).result.account_data.Balance])));
    base = { ledger, hash: li.hash, closeTime: li.closeTime, D: fmtDec(await lineBal(client, D.address, RL.issuer, RL.currency, ledger)), S: fmtDec(await lineBal(client, S.address, RL.issuer, RL.currency, ledger)), xrp };
    if (parseDec(base.D) < parseDec("0.15")) throw new StopError(`RLUSD 不足: D(${D.address}) は ${base.D}、必要 0.15`);
    writeFileSync(baselineFile, JSON.stringify(base, null, 1));
  }
  // 事前点検（取得できない項目は未確認と書く）
  const lineOf = async (a: string) => {
    const r = (await client.request({ command: "account_lines", account: a, peer: RL.issuer, ledger_index: base!.ledger } as never)) as unknown as { result: { lines: Record<string, any>[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const l = r.result.lines.find((x) => x["currency"] === RL.currency);
    return l ? { balance: l["balance"], limit: l["limit"], freeze: l["freeze"] ?? false, freeze_peer: l["freeze_peer"] ?? false, authorized: l["authorized"] ?? "(RequireAuth なし)", peer_authorized: l["peer_authorized"] ?? null, no_ripple: l["no_ripple"] ?? false } : null;
  };
  const serverState = (await client.request({ command: "server_info" })).result.info.validated_ledger;
  const preflight = { issuer, tokenEscrowAmendment: tokenEscrow, trustLineD: await lineOf(D.address), trustLineS: await lineOf(S.address), xrpDropsAtBaseline: base.xrp, reserve: { base_xrp: serverState?.reserve_base_xrp, inc_xrp: serverState?.reserve_inc_xrp }, availableRlusdD: base.D, 備考: "Escrow の Owner 準備金は XRP 0.2（reserve_inc）。送受の trust line は枠 1,000,000" };
  console.log(`[run] 開始点 ledger=${base.ledger} D=${base.D} S=${base.S} preflight=${j({ ...preflight, xrpDropsAtBaseline: undefined })}`);

  // ── 3. 直接ロック: A → 判定 → B ──
  const sec = readJson<{ A: string; B: string }>(`${STATE}secrets.json`) ?? (() => { const s = { A: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))), B: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))) }; writeFileSync(`${STATE}secrets.json`, JSON.stringify(s), { mode: 0o600 }); return s; })();
  const esc: Record<string, { id: "A" | "B"; value: string; cancelAfter: number; condition: string; fulfillment: string }> = {};
  const created: Record<string, { rec: TxRec; index?: string; meta?: Record<string, any>; tx?: Record<string, any> }> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const verdict: Record<string, string> = {};
  for (const id of ["A", "B"] as const) {
    const { conditionHex, fulfillmentHex } = await conditionOf(Uint8Array.from(Buffer.from(sec[id], "hex")));
    const planned = readJson<{ cancelAfter: number }>(`${STATE}plan.${id}.json`) ?? (() => { return undefined; })();
    let cancelAfter = planned?.cancelAfter;
    if (!cancelAfter) { cancelAfter = (await chainInfo(client, D.address)).closeTime + TTL[id]; writeFileSync(`${STATE}plan.${id}.json`, JSON.stringify({ cancelAfter })); }
    esc[id] = { id, value: AMOUNT[id], cancelAfter, condition: conditionHex, fulfillment: fulfillmentHex };
    const rec = await attempt(`create:${id}`, D, { TransactionType: "EscrowCreate", Account: D.address, Destination: S.address, Amount: rl(AMOUNT[id]), Condition: conditionHex, CancelAfter: cancelAfter }, "escrow-create", id);
    const tx = (await client.request({ command: "tx", transaction: rec.hash })).result as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    created[id] = { rec, tx, meta: tx["meta"] };
    if (rec.result !== "tesSUCCESS") {
      verdict["直接ロック"] = `不成立（${id}: ${rec.result}）`;
      console.log(`[run] 直接ロック不成立: ${id} ${rec.result} hash=${rec.hash}`);
      return await finish(verdict);
    }
    const node = escrowNodes(tx["meta"]).find((e) => e.kind === "created");
    created[id]!.index = node?.index;
    console.log(`[run] 券 ${id}: EscrowCreate tesSUCCESS ledger=${rec.ledger} escrow=${node?.index}`);
  }

  // ── 4. ロック中の確認（ledger_entry で A・B、D の escrow オブジェクト、合計 0.15） ──
  const lockedAt = (await ledgerInfo(client, "validated"));
  const lockLedger = Math.max(created["A"]!.rec.ledger!, created["B"]!.rec.ledger!);
  const lockLi = await ledgerInfo(client, lockLedger);
  let locked = 0n; const lockChecks: Record<string, unknown> = {};
  for (const id of ["A", "B"] as const) {
    const e = await escrowAt(client, created[id]!.index!, lockLedger);
    const amt = e?.["Amount"] as { currency: string; issuer: string; value: string } | undefined;
    if (amt) locked += parseDec(amt.value);
    lockChecks[id] = { exists: Boolean(e), Account: e?.["Account"] === D.address, Destination: e?.["Destination"] === S.address, Amount: amt && amt.currency === RL.currency && amt.issuer === RL.issuer && parseDec(amt.value) === parseDec(AMOUNT[id]), Condition: String(e?.["Condition"]).toUpperCase() === esc[id]!.condition, CancelAfter: e?.["CancelAfter"] === esc[id]!.cancelAfter, Sequence: (created[id]!.tx?.["tx_json"] ?? created[id]!.tx)?.["Sequence"] };
  }
  const dAvail = await lineBal(client, D.address, RL.issuer, RL.currency, lockLedger);
  const sBal = await lineBal(client, S.address, RL.issuer, RL.currency, lockLedger);
  console.log(`[run] ロック中 ledger=${lockLedger} 合計=${fmtDec(locked)} D 利用可能=${fmtDec(dAvail)} S=${fmtDec(sBal)}`);
  const lock = { ledger: lockLedger, hash: lockLi.hash, closeTime: lockLi.closeTime, lockedTotal: fmtDec(locked), dAvailable: fmtDec(dAvail), sBalance: fmtDec(sBal), checks: lockChecks };
  void lockedAt;
  verdict["直接ロック"] = locked === parseDec("0.15") ? "成立" : `不成立（ロック合計 ${fmtDec(locked)}）`;

  // ── 5. 使用: A を期限前に S が Finish ──
  const fin = await attempt("finish:A", S, { TransactionType: "EscrowFinish", Account: S.address, Owner: D.address, OfferSequence: Number((created["A"]!.tx?.["tx_json"] ?? created["A"]!.tx)?.["Sequence"]), Condition: esc["A"]!.condition, Fulfillment: esc["A"]!.fulfillment }, "escrow-finish", "A");
  let finishNote = "";
  if (fin.result === "tesSUCCESS") {
    const sB = parseDec(fmtDec(await lineBal(client, S.address, RL.issuer, RL.currency, fin.ledger! - 1))), sA = await lineBal(client, S.address, RL.issuer, RL.currency, fin.ledger!);
    finishNote = `S の RLUSD ${fmtDec(sB)} → ${fmtDec(sA)}（${fmtSigned(sA - sB)}）`;
    verdict["店舗着金"] = sA - sB === parseDec("0.1") ? "成立（額面どおり +0.10）" : `一部成立（直接処理は成立・額面と違う: ${fmtSigned(sA - sB)}）`;
  } else verdict["店舗着金"] = `不成立（${fin.result}）`;
  console.log(`[run] A Finish: ${fin.result} ${finishNote}`);

  // ── 6. 未使用・返還: B ──
  const cB = esc["B"]!;
  // 期限前の確認は最初の実行で一度だけ取り、保存する（再実行で上書きしない）
  let beforeExpiry = readJson<{ ledger: number; hash: string; closeTime: number; cancelAfter: number; bExists: boolean; sRlusd: string; beforeDeadline: boolean }>(`${STATE}before.json`);
  if (!beforeExpiry) {
    const li1 = await ledgerInfo(client, "validated");
    const bBefore = await escrowAt(client, created["B"]!.index!, li1.index);
    beforeExpiry = { ledger: li1.index, hash: li1.hash, closeTime: li1.closeTime, cancelAfter: cB.cancelAfter, bExists: Boolean(bBefore), sRlusd: fmtDec(await lineBal(client, S.address, RL.issuer, RL.currency, li1.index)), beforeDeadline: li1.closeTime < cB.cancelAfter };
    writeFileSync(`${STATE}before.json`, JSON.stringify(beforeExpiry));
  }
  const sBeforeExpiry = parseDec(beforeExpiry.sRlusd);
  console.log(`[run] 期限前の確認 ${j(beforeExpiry)}`);
  if (!beforeExpiry.beforeDeadline && !jr.get("cancel:B")) throw new StopError("B の期限を、A の処理中に過ぎた。--new で再実行する");
  let expiry = readJson<{ ledger: number; hash: string; closeTime: number }>(`${STATE}expiry.json`);
  if (!expiry) {
    for (;;) {
      const li = await ledgerInfo(client, "validated");
      if (li.closeTime > cB.cancelAfter) { expiry = { ledger: li.index, hash: li.hash, closeTime: li.closeTime }; break; }
      console.log(`[run] B 期限待ち あと ${cB.cancelAfter - li.closeTime} 秒`);
      await waitMs(Math.min(15000, Math.max(3000, (cB.cancelAfter - li.closeTime + 1) * 1000)));
    }
    writeFileSync(`${STATE}expiry.json`, JSON.stringify(expiry));
  }
  console.log(`[run] 期限到来を確認 ledger=${expiry.ledger} close_time=${expiry.closeTime} > CancelAfter=${cB.cancelAfter}`);
  const can = await attempt("cancel:B", K, { TransactionType: "EscrowCancel", Account: K.address, Owner: D.address, OfferSequence: Number((created["B"]!.tx?.["tx_json"] ?? created["B"]!.tx)?.["Sequence"]) }, "escrow-cancel", "B");
  if (can.result === "tesSUCCESS") {
    const dB = await lineBal(client, D.address, RL.issuer, RL.currency, can.ledger! - 1), dA = await lineBal(client, D.address, RL.issuer, RL.currency, can.ledger!);
    const sA = await lineBal(client, S.address, RL.issuer, RL.currency, can.ledger!);
    const gone = (await escrowAt(client, created["B"]!.index!, can.ledger!)) === undefined;
    verdict["期限後のドナー返還"] = dA - dB === parseDec("0.05") && sA === sBeforeExpiry && gone ? "成立（D +0.05、S 差額 0、B 消滅）" : `不成立または一部（D ${fmtSigned(dA - dB)}、S 差 ${fmtSigned(sA - sBeforeExpiry)}、B 消滅=${gone}）`;
  } else verdict["期限後のドナー返還"] = `不成立（${can.result}）`;
  return await finish(verdict, { lock, beforeExpiry, expiry, preflight, official, network });

  // ── 7. 最終 ──
  async function finish(v: Record<string, string>, extra: Record<string, unknown> = {}) {
    const recs = jr.list().sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0));
    const scen = recs.filter((r) => r.phase === "scenario");
    const endLedger = Math.max(...scen.map((r) => r.ledger ?? 0));
    const endLi = await ledgerInfo(client, endLedger);
    const bal = async (l: number) => ({ D: fmtDec(await lineBal(client, D.address, RL.issuer, RL.currency, l)), S: fmtDec(await lineBal(client, S.address, RL.issuer, RL.currency, l)) });
    const steps: unknown[] = [];
    for (const r of scen) {
      const t = (await client.request({ command: "tx", transaction: r.hash })).result as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const b0 = await bal(r.ledger! - 1), b1 = await bal(r.ledger!);
      const li = await ledgerInfo(client, r.ledger!);
      steps.push({ label: r.label, hash: r.hash, type: r.type, result: r.result, ledger: r.ledger, ledgerHash: li.hash, closeTime: li.closeTime, 残高差_D: fmtSigned(parseDec(b1.D) - parseDec(b0.D)), 残高差_S: fmtSigned(parseDec(b1.S) - parseDec(b0.S)), エスクロー: escrowNodes(t["meta"]).map((e) => ({ kind: e.kind, index: e.index })), 取引メタデータの増減: lineDeltas(t["meta"]).filter((d) => d.currency === RL.currency && [D.address, S.address].includes(d.account)).map((d) => ({ 口座: d.account === D.address ? "D" : "S", 差: fmtSigned(d.delta) })) });
    }
    const bEnd = await bal(endLedger);
    const net = { D: fmtSigned(parseDec(bEnd.D) - parseDec(base!.D)), S: fmtSigned(parseDec(bEnd.S) - parseDec(base!.S)) };
    const open = [] as string[];
    for (const id of ["A", "B"] as const) { const c = created[id]; if (c?.index && (await escrowAt(client, c.index, endLedger))) open.push(id); }
    const general = verdict["直接ロック"]?.startsWith("成立") && verdict["店舗着金"]?.startsWith("成立") && verdict["期限後のドナー返還"]?.startsWith("成立") ? "成立" : verdict["直接ロック"]?.startsWith("成立") ? "条件付きまたは一部成立" : "不成立";
    const manifest = {
      schema: "todoke-spike16-manifest/1", generatedAt: new Date().toISOString(), network: { ...network, validatedLedger: undefined }, official, asset: RL,
      accounts: { D: D.address, S: S.address, K: K.address }, baseline: { ledger: base!.ledger, hash: base!.hash, closeTime: base!.closeTime },
      lock: (extra["lock"] as Record<string, unknown> | undefined) ?? null, expiry: (extra["expiry"] as Record<string, unknown> | undefined) ?? null, beforeExpiry: (extra["beforeExpiry"] as Record<string, unknown> | undefined) ?? null,
      end: { ledger: endLedger, hash: endLi.hash, closeTime: endLi.closeTime },
      escrows: (["A", "B"] as const).filter((id) => created[id]).map((id) => ({ id, value: AMOUNT[id], cancelAfter: esc[id]!.cancelAfter, condition: esc[id]!.condition, owner: D.address, destination: S.address, escrowIndex: created[id]!.index ?? null, sequence: (created[id]!.tx?.["tx_json"] ?? created[id]!.tx)?.["Sequence"] ?? null, createTx: created[id]!.rec.hash, createResult: created[id]!.rec.result, outcome: id === "A" ? "finish" : "cancel", finishTx: jr.get(`finish:${id}`)?.hash ?? null, cancelTx: jr.get(`cancel:${id}`)?.hash ?? null })),
      transactions: recs.map((r) => ({ label: r.label, phase: r.phase, account: r.account, type: r.type, hash: r.hash, expect: r.label.startsWith("create:") || r.phase !== "scenario" ? "tesSUCCESS" : "tesSUCCESS", ledger: r.ledger, observedResult: r.result })),
    };
    writeFileSync(`${RESULTS}manifest.json`, JSON.stringify(manifest, null, 1));
    writeFileSync(`${RESULTS}run.json`, j({ schema: "todoke-spike16-run/1", startedAt, finishedAt: new Date().toISOString(), verdict: v, 総合: general, baseline: base, 開始から終了の純増減: net, 未決Escrow: open, steps, ...extra, environment: { node: process.version, xrpl: "5.3.0" } }));
    return `判定 ${j(v)}\n総合: ${general}\n純増減 ${j(net)} 未決Escrow=${j(open)}\nresults/manifest.json, results/run.json`;
  }
}
