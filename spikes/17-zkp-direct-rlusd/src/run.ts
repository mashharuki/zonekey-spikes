/**
 * spike 17: 資格の ZK 証明（v2: 資産拘束）→ 発券（Service）→ オフライン受付 → 直接 RLUSD の Escrow → Finish／期限後 Cancel を、同じ Testnet 実行で追跡する。
 *   pnpm --filter 17-zkp-direct-rlusd run:scenario            前回の続き（完了済みなら既存 run の再照合のみ。取引は増やさない）
 *   ... -- --new                                               新しい独立試験（.state と results を退避）
 * 状態は .state/（gitignore 済み。署名済みバイト列・世帯秘密・preimage・QR を含む）。公開してよい結果は results/。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client, Wallet } from "xrpl";
import { connectTestnet, loadEnvLocal, loadOrCreatePersistentWallet } from "xrpl-kit";
import { PK_MEMO_TYPE, encodeVoucher, sha256, signVoucher, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";
import { type Req, hex } from "../../13-zk-bound-voucher/src/lib.js";
import { Roster, type Household } from "../../13-zk-bound-voucher/src/roster.js";
import { PUBLIC_NAMES, Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { chainInfo, waitMs } from "../../14-issuance-recovery/src/chain.js";
import { type AppFile, pad8, proofOf, reqFromJson, reqToJson } from "../../14-issuance-recovery/src/common.js";
import { type Outcome, type Program, Service } from "../../14-issuance-recovery/src/service.js";
import { escrowAt, ledgerInfo, lineBal, syncFromChain } from "../../15-multi-donor-rlusd/src/chainio.js";
import { fmtDec, fmtSigned, parseDec } from "../../15-multi-donor-rlusd/src/dec.js";
import { escrowNodes, lineDeltas } from "../../15-multi-donor-rlusd/src/deltas.js";
import { Journal, StopError, type TxRec, tracked } from "../../15-multi-donor-rlusd/src/track.js";
import { OFFICIAL_PAGE, RLUSD_ISSUER, TESTNET_WSS } from "./config.js";
import { canonicalCurrency, requestDigestV2 } from "./reqv2.js";

const HERE = fileURLToPath(import.meta.url);
const PKG = fileURLToPath(new URL("../", import.meta.url));
const SHOP_OFFLINE = fileURLToPath(new URL("./shop-offline.ts", import.meta.url));
const STATE = `${PKG}.state/`, RESULTS = `${PKG}results/`;
loadEnvLocal(HERE);
const argv = process.argv.slice(2);
const TTL_C = 420;
const AMM_CAP_DROPS = "1000000"; // 試験用 XRP の投入上限（1 人 1 XRP）
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
type X = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

mkdirSync(RESULTS, { recursive: true });
if (argv.includes("--new") && existsSync(`${STATE}journal.json`)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(STATE, `${PKG}.state-archive-${stamp}/`);
  for (const f of ["manifest.json", "run.json", "verify.json", "proofs.json", "trust.json", "harness-links.json"]) if (existsSync(`${RESULTS}${f}`)) renameSync(`${RESULTS}${f}`, `${RESULTS}${f.replace(".json", `.${stamp}.json`)}`);
}
mkdirSync(STATE, { recursive: true });
const readJson = <T>(f: string): T | undefined => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined);
const writeSecret = (f: string, v: unknown) => writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });

const client: Client = await connectTestnet();
const jr = new Journal(`${STATE}journal.json`);
const zk = new Zk();
const svcs: Service[] = [];
try { console.log(await main()); } catch (e) {
  if (e instanceof StopError) { console.error(`\n[停止] ${e.message}`); process.exitCode = 2; } else throw e;
} finally { for (const s of svcs) s.db.close(); await zk.close().catch(() => undefined); await client.disconnect(); }

async function main() {
  const startedAt = new Date().toISOString();
  // ── 0. 公式の発行者・ネットワーク（実行時） ──
  const page = await fetch(OFFICIAL_PAGE);
  const text = (await page.text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const mm = /XRPL Testnet Issued currency Trustline required Explorer RLUSD issuer \S+ (r[1-9A-HJ-NP-Za-km-z]{24,34}) Currency code · RLUSD, hex-encoded \S+ ([0-9A-F]{40})/.exec(text);
  if (!mm) throw new StopError("公式ページの XRPL Testnet 欄を読み取れない。公式に確認できない資産では代替しない");
  const official = { source: `${OFFICIAL_PAGE}（XRPL Testnet 欄）`, httpStatus: page.status, fetchedAt: new Date().toISOString(), issuer: mm[1]!, currency: mm[2]!, knownFromSpike16: RLUSD_ISSUER };
  const RL = { currency: canonicalCurrency(official.currency), issuer: official.issuer };
  const rl = (v: string) => ({ ...RL, value: v });
  const srv = (await client.request({ command: "server_info" })).result.info;
  const led0 = await ledgerInfo(client, "validated");
  const network = { endpoint: TESTNET_WSS, network_id: srv.network_id ?? null, build_version: srv.build_version, complete_ledgers: srv.complete_ledgers, ledgerAtStart: led0 };
  const iroot = (await client.request({ command: "account_info", account: RL.issuer, ledger_index: "validated" })).result.account_data as unknown as X;
  const FL: Record<string, number> = { DefaultRipple: 0x00800000, AllowTrustLineLocking: 0x40000000, AllowTrustLineClawback: 0x80000000, DepositAuth: 0x01000000, RequireAuth: 0x00040000, GlobalFreeze: 0x00400000 };
  const issuer = { account: RL.issuer, flagsHex: (iroot["Flags"] as number).toString(16), flags: Object.fromEntries(Object.entries(FL).map(([k, v]) => [k, ((iroot["Flags"] as number) & v) !== 0])), TransferRate: iroot["TransferRate"] ?? null, Domain: iroot["Domain"] ? Buffer.from(String(iroot["Domain"]), "hex").toString() : null };
  let tokenEscrow: string;
  try { const f = (await client.request({ command: "feature", feature: "TokenEscrow" } as never)) as unknown as { result: Record<string, X> }; const v = Object.values(f.result).find((x) => x && typeof x === "object" && "enabled" in x); tokenEscrow = v ? `enabled=${String(v["enabled"])}` : "未確認"; } catch (e) { tokenEscrow = `未確認（${(e as { data?: { error?: string } }).data?.error ?? (e as Error).message}）`; }
  console.log(`[run] 公式 RLUSD issuer=${RL.issuer}（spike 16 と ${RL.issuer === RLUSD_ISSUER ? "同じ" : "違う"}） rippled=${srv.build_version} ledger=${led0.index} TokenEscrow ${tokenEscrow} TransferRate=${issuer.TransferRate ?? "なし"}`);
  if (!issuer.flags["AllowTrustLineLocking"]) throw new StopError("発行者に AllowTrustLineLocking が無い。直接 Escrow は成立しない前提のため停止（結果を記録する）");

  // ── 1. 口座・準備（基準点の前。給付区間と別計上） ──
  const P = (await loadOrCreatePersistentWallet(client, "INTEG17_P_SEED", "県 P", HERE)).wallet;
  const N = (await loadOrCreatePersistentWallet(client, "INTEG17_N_SEED", "NGO N", HERE)).wallet;
  const S = (await loadOrCreatePersistentWallet(client, "INTEG17_S_SEED", "店舗 S", HERE)).wallet;
  const K = (await loadOrCreatePersistentWallet(client, "INTEG17_K_SEED", "keeper K", HERE)).wallet;
  const W: Record<string, Wallet> = { P, N, S, K };
  const acct = { P: P.address, N: N.address, S: S.address, K: K.address };
  if (new Set(Object.values(acct)).size !== 4) throw new StopError("P・N・S・K が重複");
  const baselineFile = `${STATE}baseline.json`;
  type Base = { ledger: number; hash: string; closeTime: number; balances: Record<string, string>; xrp: Record<string, string> };
  let base = readJson<Base>(baselineFile);
  if (!base) {
    const prep = (label: string, w: string, tx: Parameters<typeof tracked>[4], role: string) => tracked(client, jr, label, W[w]!, tx, { role, phase: "prep" });
    for (const w of ["P", "N", "S"]) await prep(`prep:${w}:TrustSet RLUSD`, w, { TransactionType: "TrustSet", Account: W[w]!.address, LimitAmount: rl("1000000") }, "prep-trustline");
    for (const [w, v] of [["P", "0.1"], ["N", "0.1"]] as const) {
      if (!jr.list().some((r) => r.label.startsWith(`prep:${w}:buy`) && r.status === "validated") && (await lineBal(client, W[w]!.address, RL.issuer, RL.currency, "validated")) < parseDec(v))
        await prep(`prep:${w}:buy RLUSD ${v} via AMM`, w, { TransactionType: "Payment", Account: W[w]!.address, Destination: W[w]!.address, Amount: rl(v), SendMax: AMM_CAP_DROPS }, "prep-rlusd-acquire");
    }
    const ledger = Math.max(...jr.list().filter((r) => r.phase === "prep").map((r) => r.ledger ?? 0));
    const li = await ledgerInfo(client, ledger);
    const balances = Object.fromEntries(await Promise.all(["P", "N", "S"].map(async (k) => [k, fmtDec(await lineBal(client, acct[k as "P"], RL.issuer, RL.currency, ledger))])));
    const xrp = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, (await client.request({ command: "account_info", account: a, ledger_index: ledger })).result.account_data.Balance])));
    if (parseDec(balances["P"]!) < parseDec("0.1") || parseDec(balances["N"]!) < parseDec("0.1")) throw new StopError(`RLUSD 不足: ${j(balances)}`);
    base = { ledger, hash: li.hash, closeTime: li.closeTime, balances, xrp };
    writeFileSync(baselineFile, JSON.stringify(base, null, 1));
  }
  const lineOf = async (a: string) => { const r = (await client.request({ command: "account_lines", account: a, peer: RL.issuer, ledger_index: base!.ledger } as never)) as unknown as { result: { lines: X[] } }; const l = r.result.lines.find((x) => x["currency"] === RL.currency); return l ? { balance: l["balance"], limit: l["limit"], freeze: l["freeze"] ?? false, freeze_peer: l["freeze_peer"] ?? false } : null; };
  const preflight = { issuer, tokenEscrowAmendment: tokenEscrow, trustLines: { P: await lineOf(P.address), N: await lineOf(N.address), S: await lineOf(S.address) }, balancesAtBaseline: base.balances, xrpDropsAtBaseline: base.xrp };
  console.log(`[run] 基準点 ledger=${base.ledger} ${j(base.balances)}`);

  // ── 2. 世帯・名簿・制度（信頼する設定） ──
  await zk.init();
  interface Sec { hh: { id: string; secret: string; salt: string; zone: string; senior: boolean }[]; prog: { P: string; N: string }; tk: Record<string, { app: AppFile; preimage: string; keyJwk: JsonWebKey; pub: string; household: string }>; dup?: AppFile }
  let sec = readJson<Sec>(`${STATE}secrets.json`);
  const rnd = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(31)));
  if (!sec) { sec = { hh: [{ id: "H1", secret: rnd(), salt: rnd(), zone: "13101", senior: true }, { id: "H2", secret: rnd(), salt: rnd(), zone: "13102", senior: true }, { id: "H3", secret: rnd(), salt: rnd(), zone: "13103", senior: false }], prog: { P: rnd(), N: rnd() }, tk: {} }; writeSecret(`${STATE}secrets.json`, sec); }
  const bi = (h: string) => BigInt(`0x${h}`);
  const members: Household[] = sec.hh.map((h) => ({ id: h.id, secret: bi(h.secret), salt: bi(h.salt), zone: BigInt(h.zone), senior: h.senior, revictim: false, tier: 3, profile: { name: "合成", address: "架空" } }));
  const roster = await new Roster(members).build(zk);
  const pid = { P: bi(sec.prog.P), N: bi(sec.prog.N) };
  const zones = pad8([13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108]);
  const stmts = { P: { zoneSet: zones, needSenior: false, needRevictim: false, minTier: 1 }, N: { zoneSet: zones, needSenior: true, needRevictim: false, minTier: 1 } };
  const programs: Record<"P" | "N", Program> = {
    P: { id: pid.P, owner: P.address, currency: RL.currency, issuer: RL.issuer, allowedValues: [100000n], allowedShops: [S.address], stmt: stmts.P, minTtlSec: 120 },
    N: { id: pid.N, owner: N.address, currency: RL.currency, issuer: RL.issuer, allowedValues: [50000n], allowedShops: [S.address], stmt: stmts.N, minTtlSec: 120 },
  };
  // 第三者が事前に信頼する設定（承認済みの名簿 root・制度 ID・制度条件・ドナーとの対応・資産）。発券側が選ぶ
  const trust = { schema: "todoke-spike17-trust/1", 注意: "検算コマンドが外部から信頼する入力: 承認済みの名簿 root、制度 ID と条件、制度とドナーの対応、資産。世帯の秘密は含まない", rosterRoot: `0x${roster.root.toString(16)}`, asset: { currency: RL.currency, issuer: RL.issuer }, programs: Object.fromEntries((["P", "N"] as const).map((k) => [k, { id: `0x${pid[k].toString(16)}`, owner: acct[k], zoneSet: stmts[k].zoneSet.map(String), needSenior: stmts[k].needSenior, needRevictim: stmts[k].needRevictim, minTier: stmts[k].minTier, name: k === "P" ? "県 P 基本給付（対象地区）" : "NGO N 追加給付（対象地区・高齢者要件）" }])) };
  writeFileSync(`${RESULTS}trust.json`, JSON.stringify(trust, null, 1));
  const mkSvc = (w: "P" | "N") => { const s = new Service({ dbPath: `${STATE}issuer-${w}.db`, client, wallet: W[w]!, programs: [programs[w]], approvedRoots: [roster.root], zk, digest: requestDigestV2 }); svcs.push(s); return s; };
  const svc = { P: mkSvc("P"), N: mkSvc("N") };

  const subtle = globalThis.crypto.subtle;
  async function buildApp(donor: "P" | "N", hhIdx: number, value: bigint, ttl: number) {
    const h = members[hhIdx]!;
    const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
    const preimage = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const info = await chainInfo(client, acct[donor]);
    const req: Req = { programId: pid[donor], owner: acct[donor], shop: S.address, currency: RL.currency, issuer: RL.issuer, valueUnits: value, cancelAfter: info.closeTime + ttl, pkHash: hex(await sha256(pub)), conditionHash: hex(await sha256(preimage)) };
    const digest = await requestDigestV2(req);
    const d = await zk.derive({ hhSecret: h.secret, programId: pid[donor], zone: h.zone, senior: h.senior, revictim: false, tier: 3, salt: h.salt, digest });
    const p = await zk.prove(zk.inputs({ ...stmts[donor], root: roster.root, programId: pid[donor] }, { zone: h.zone, senior: h.senior, revictim: false, tier: 3, hhSecret: h.secret, salt: h.salt, index: hhIdx, siblings: roster.path(hhIdx) }, digest, d.nullifier, d.tag));
    return { app: { req: reqToJson(req), proofHex: Buffer.from(p.proof).toString("hex"), publicInputs: p.publicInputs } as AppFile, kp, pub, preimage, proveMs: p.proveMs };
  }

  // ── 3. 3 枚の申請・発券（Service の通常入口） ──
  const spec = { A: { donor: "P" as const, hh: 0, value: "0.1", units: 100000n, ttl: 7200 }, B: { donor: "N" as const, hh: 0, value: "0.05", units: 50000n, ttl: 7200 }, C: { donor: "N" as const, hh: 1, value: "0.05", units: 50000n, ttl: TTL_C } };
  const issued: Record<string, { outcome: Extract<Outcome, { status: "confirmed" }>; req: Req; app: AppFile; proveMs?: number }> = {};
  for (const id of ["A", "B", "C"] as const) {
    const sp = spec[id];
    let t = sec.tk[id], proveMs: number | undefined;
    if (!t) {
      const b = await buildApp(sp.donor, sp.hh, sp.units, sp.ttl);
      proveMs = b.proveMs;
      t = { app: b.app, preimage: hex(b.preimage), keyJwk: await subtle.exportKey("jwk", b.kp.privateKey), pub: hex(b.pub), household: members[sp.hh]!.id };
      sec.tk[id] = t; writeSecret(`${STATE}secrets.json`, sec);
    }
    const req = reqFromJson(t.app.req);
    const db = svc[sp.donor].db;
    const done = db.prepare("SELECT id, offer_sequence, escrow_index, confirmed_tx FROM issuance WHERE program_id=? AND req_digest=? AND state='confirmed'").get(req.programId.toString(), hex(await requestDigestV2(req))) as X | undefined;
    const outcome: Outcome = done ? { status: "confirmed", offerSequence: done["offer_sequence"], txHash: done["confirmed_tx"], escrowIndex: done["escrow_index"], attempts: (db.prepare("SELECT COUNT(*) c FROM attempts WHERE issuance_id=?").get(done["id"]) as X)["c"] } : await svc[sp.donor].apply(req, proofOf(t.app));
    if (outcome.status !== "confirmed") throw new StopError(`券 ${id} の発券が確定しない: ${j(outcome)}`);
    issued[id] = { outcome, req, app: t.app, ...(proveMs !== undefined ? { proveMs } : {}) };
    if (!jr.get(`issue:${id}`)) {
      const tr = (await client.request({ command: "tx", transaction: outcome.txHash })).result as unknown as X;
      const lg = Number(tr["ledger_index"]);
      jr.recs[`issue:${id}`] = { label: `issue:${id}`, role: "escrow-create", ticket: id, phase: "scenario", account: acct[sp.donor], type: "EscrowCreate", hash: outcome.txHash, blob: "", lls: 0, firstLedger: 0, status: "validated", result: tr["meta"]["TransactionResult"], ledger: lg, closeTime: (await ledgerInfo(client, lg)).closeTime, attempts: outcome.attempts, supersededHashes: [], note: "Service が確定した EscrowCreate（直接 RLUSD）" };
      jr.save();
    }
    console.log(`[run] 券 ${id}: 発券確定 tx=${outcome.txHash} OfferSequence=${outcome.offerSequence} escrow=${outcome.escrowIndex}`);
  }

  // ── 4. 対照: 重複申請と対象外 ──
  const negFile = `${STATE}negative.json`;
  let negative = readJson<X>(negFile);
  if (!negative) {
    const seqNow = async (a: string) => Number((await client.request({ command: "account_info", account: a, ledger_index: "current" })).result.account_data.Sequence);
    const cnt = (s: Service) => { const x = s.snapshot(); return { issuance: x.issuance.length, attempts: x.attempts.length }; };
    const before = { P: cnt(svc.P), N: cnt(svc.N), seqP: await seqNow(P.address), seqN: await seqNow(N.address) };
    // H1 が県 P に、別の申請鍵・preimage で再度申請（発券 0 件になるはず）
    const dupB = await buildApp("P", 0, 100000n, 7200);
    const dupOut = await svc.P.apply(reqFromJson(dupB.app.req), proofOf(dupB.app));
    // 高齢者要件を満たさない H3 の N への申請（証明を作れない）
    let h3: X;
    try { await buildApp("N", 2, 50000n, 7200); h3 = { proofCreated: true }; } catch (e) { h3 = { proofCreated: false, error: String((e as Error).message).split("\n")[0]!.slice(0, 160) }; }
    const after = { P: cnt(svc.P), N: cnt(svc.N), seqP: await seqNow(P.address), seqN: await seqNow(N.address) };
    negative = { H1_duplicate_to_P: { outcome: dupOut, 発券記録_前後: [before.P.issuance, after.P.issuance], 試行_前後: [before.P.attempts, after.P.attempts], 署名者Sequence_前後: [before.seqP, after.seqP] }, H3_to_N: { ...h3, 発券記録_前後N: [before.N.issuance, after.N.issuance] } };
    writeFileSync(negFile, JSON.stringify(negative));
  }
  console.log(`[run] 対照 ${j(negative)}`);

  // ── 5. 発券記録 ↔ 確定 Escrow の照合 ──
  interface Ticket { id: string; program: "P" | "N"; donor: string; household: string; shop: string; value: string; cancelAfter: number; condition: string; pkHash: string; offerSequence: number; escrowIndex: string; createTx: string; createLedger: number; attempts: number; proofSha256: string; nullifier: string; reqDigestV2: string; proveMs?: number }
  const tickets: Ticket[] = []; const escrowChecks: X[] = [];
  for (const id of ["A", "B", "C"] as const) {
    const it = issued[id]!, sp = spec[id], rec = jr.get(`issue:${id}`)!;
    const esc = await escrowAt(client, it.outcome.escrowIndex, rec.ledger!);
    const tr = (await client.request({ command: "tx", transaction: it.outcome.txHash })).result as unknown as X;
    const tj = (tr["tx_json"] ?? tr) as X;
    const condHex = `A0258020${it.req.conditionHash.toUpperCase()}810120`;
    const memo = ((tj["Memos"] ?? []) as X[]).map((m) => m["Memo"] as X);
    const pi = it.app.publicInputs;
    const checks = {
      "Escrow の持ち主 = 申請の支援元": esc?.["Account"] === it.req.owner, "宛先 = 店舗 S": esc?.["Destination"] === S.address,
      "資産 = 公式 RLUSD（通貨・issuer）": esc?.["Amount"]?.currency === RL.currency && esc?.["Amount"]?.issuer === RL.issuer,
      "額面が一致": esc !== undefined && parseDec(esc["Amount"].value) === parseDec(sp.value), "CancelAfter が一致": esc?.["CancelAfter"] === it.req.cancelAfter,
      "Condition が一致": String(esc?.["Condition"]).toUpperCase() === condHex, "Memo の鍵ハッシュ = 申請の pkHash": memo.some((m) => m["MemoType"].toUpperCase() === PK_MEMO_TYPE && m["MemoData"].toUpperCase() === it.req.pkHash.toUpperCase()),
      "OfferSequence = 台帳上の Sequence": tj["Sequence"] === it.outcome.offerSequence, "公開入力の制度 ID = 申請の制度": BigInt(pi[PUBLIC_NAMES.indexOf("program_id")]!) === it.req.programId,
    };
    escrowChecks.push({ ticket: id, checks });
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new StopError(`券 ${id}: 承認内容と台帳の Escrow が違う: ${bad.join(", ")}`);
    tickets.push({ id, program: sp.donor, donor: it.req.owner, household: sec.tk[id]!.household, shop: S.address, value: sp.value, cancelAfter: it.req.cancelAfter, condition: condHex, pkHash: it.req.pkHash.toUpperCase(), offerSequence: it.outcome.offerSequence, escrowIndex: it.outcome.escrowIndex, createTx: it.outcome.txHash, createLedger: rec.ledger!, attempts: it.outcome.attempts, proofSha256: hex(await sha256(Uint8Array.from(Buffer.from(it.app.proofHex, "hex")))), nullifier: String(BigInt(pi[PUBLIC_NAMES.indexOf("nullifier")]!)), reqDigestV2: hex(await requestDigestV2(it.req)), ...(it.proveMs !== undefined ? { proveMs: it.proveMs } : {}) });
  }
  writeFileSync(`${RESULTS}proofs.json`, JSON.stringify({ note: "ZK 証明と公開入力（秘密を含まない）。申請 JSON はこの申請者側の主張で、検算コマンドは台帳の EscrowCreate から申請を復元して照合する", vkSha256: createHash("sha256").update(zk.vk).digest("hex").toUpperCase(), tickets: Object.fromEntries(["A", "B", "C"].map((id) => [id, { req: issued[id]!.app.req, proofHex: issued[id]!.app.proofHex, publicInputs: issued[id]!.app.publicInputs }])) }, null, 1));

  // ── 6. A・B: 店頭（オフライン）受付 → 再接続 → 保存した受付データで Finish ──
  const acceptance: Record<string, X> = {};
  for (const id of ["A", "B"] as const) {
    const t = tickets.find((x) => x.id === id)!;
    const accFile = `${STATE}accepted.${id}.json`;
    if (!existsSync(accFile)) {
      const sync = await syncFromChain(client, S.address); // 確定した台帳から作った同期データ（S 宛ての全 Escrow）
      const syncFile = `${STATE}sync.${id}.json`;
      const syncText = JSON.stringify(sync);
      writeFileSync(syncFile, syncText);
      const st = sec.tk[id]!;
      const priv = await subtle.importKey("jwk", st.keyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const qr = hex(encodeVoucher({ owner: t.donor, offerSequence: t.offerSequence, preimage: unhex(st.preimage), sig: { pub: unhex(st.pub), sig: await signVoucher(priv, t.donor, t.offerSequence, S.address) } }));
      const now = (await ledgerInfo(client, "validated")).closeTime;
      const r = await shopOffline(syncFile, qr, S.address, now);
      if (!r.ok || r.netAttempts !== 0 || !r.accepted) throw new StopError(`券 ${id} のオフライン受付が通らない: ${j({ ...r, accepted: undefined })}`);
      writeSecret(accFile, { ...r, syncSha256: createHash("sha256").update(syncText).digest("hex").toUpperCase(), checkedAtRipple: now, syncEscrows: sync.map((e) => e.index) });
      console.log(`[run] 券 ${id}: オフライン受付 ${r.reason}（通信の試み ${r.netAttempts}、同期データ ${sync.length} 件）`);
    }
    const acc = readJson<X>(accFile)!;
    // 精算の入力は、店頭が受け付けて保存した券のデータ（Escrow の Owner・OfferSequence・Condition・Fulfillment）。QR の再読込や試験コードの秘密は使わない
    const e = acc["accepted"].escrow as X, ful = String(acc["accepted"].fulfillmentHex);
    if (e["index"] !== t.escrowIndex) throw new StopError(`券 ${id}: 受け付けた Escrow が発券記録と違う`);
    acceptance[id] = { reason: acc["reason"], netAttempts: acc["netAttempts"], syncEscrowCount: acc["listSize"], syncSha256: acc["syncSha256"], syncIncludesTicket: (acc["syncEscrows"] as string[]).includes(t.escrowIndex), acceptedEscrowIndex: e["index"], checkedAtRipple: acc["checkedAtRipple"], fulfillmentSha256: createHash("sha256").update(Buffer.from(ful.slice(8), "hex")).digest("hex").toUpperCase(), 精算の入力: "店頭受付が保存した Escrow・Fulfillment（QR のペイロードで実施。カメラ・実機は使っていない）" };
    const fin = await attempt(`finish:${id}`, S, { TransactionType: "EscrowFinish", Account: S.address, Owner: e["owner"], OfferSequence: e["offerSequence"], Condition: e["condition"], Fulfillment: ful }, "escrow-finish", id);
    if (fin.result === "tesSUCCESS") {
      const b0 = await lineBal(client, S.address, RL.issuer, RL.currency, fin.ledger! - 1), b1 = await lineBal(client, S.address, RL.issuer, RL.currency, fin.ledger!);
      acceptance[id]!["finishSDelta"] = fmtSigned(b1 - b0);
      console.log(`[run] 券 ${id}: Finish ${fin.result} S ${fmtDec(b0)} → ${fmtDec(b1)}`);
    } else throw new StopError(`券 ${id}: Finish が ${fin.result}（hash=${fin.hash}）。事実を記録して停止`);
  }

  // ── 7. C: 期限前の存在・未使用 → 期限到来 → K が Cancel ──
  const tC = tickets.find((x) => x.id === "C")!;
  let before = readJson<X>(`${STATE}before.C.json`);
  if (!before && !jr.get("cancel:C")) {
    const li = await ledgerInfo(client, "validated");
    if (li.closeTime >= tC.cancelAfter) throw new StopError(`C の期限を A・B の処理中に過ぎた（close_time=${li.closeTime}）。--new で再実行する`);
    const e = await escrowAt(client, tC.escrowIndex, li.index);
    before = { ledger: li.index, hash: li.hash, closeTime: li.closeTime, cancelAfter: tC.cancelAfter, escrowExists: Boolean(e), sRlusd: fmtDec(await lineBal(client, S.address, RL.issuer, RL.currency, li.index)), nRlusd: fmtDec(await lineBal(client, N.address, RL.issuer, RL.currency, li.index)) };
    writeFileSync(`${STATE}before.C.json`, JSON.stringify(before));
    console.log(`[run] 券 C: 期限前の確認 ${j(before)}`);
  }
  let expiry = readJson<X>(`${STATE}expiry.C.json`);
  if (!expiry) {
    for (;;) {
      const li = await ledgerInfo(client, "validated");
      if (li.closeTime > tC.cancelAfter) { expiry = { ledger: li.index, hash: li.hash, closeTime: li.closeTime }; break; }
      console.log(`[run] C 期限待ち あと ${tC.cancelAfter - li.closeTime} 秒`);
      await waitMs(Math.min(15000, Math.max(3000, (tC.cancelAfter - li.closeTime + 1) * 1000)));
    }
    writeFileSync(`${STATE}expiry.C.json`, JSON.stringify(expiry));
  }
  const can = await attempt("cancel:C", K, { TransactionType: "EscrowCancel", Account: K.address, Owner: tC.donor, OfferSequence: tC.offerSequence }, "escrow-cancel", "C");
  if (can.result !== "tesSUCCESS") throw new StopError(`C の Cancel が ${can.result}（hash=${can.hash}）`);

  // ── 8. 実測の整理 ──
  const scen = jr.list().filter((r) => r.phase === "scenario").sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0) || a.label.localeCompare(b.label));
  const endLedger = Math.max(...scen.map((r) => r.ledger ?? 0));
  const endLi = await ledgerInfo(client, endLedger);
  const bal = async (l: number) => Object.fromEntries(await Promise.all(["P", "N", "S"].map(async (k) => [k, fmtDec(await lineBal(client, acct[k as "P"], RL.issuer, RL.currency, l))])));
  const steps: X[] = [];
  for (const r of scen) {
    const tr = (await client.request({ command: "tx", transaction: r.hash })).result as unknown as X;
    const b0 = await bal(r.ledger! - 1), b1 = await bal(r.ledger!);
    const li = await ledgerInfo(client, r.ledger!);
    const diff: X = {}; for (const k of ["P", "N", "S"]) { const d = parseDec(b1[k]!) - parseDec(b0[k]!); if (d !== 0n) diff[k] = fmtSigned(d); }
    steps.push({ label: r.label, ticket: r.ticket ?? null, hash: r.hash, type: r.type, result: r.result, ledger: r.ledger, ledgerHash: li.hash, closeTime: li.closeTime, 残高差_台帳L1からL: diff, エスクロー: escrowNodes(tr["meta"]).map((e) => ({ kind: e.kind, index: e.index })), メタデータの増減: lineDeltas(tr["meta"]).filter((d) => d.currency === RL.currency && Object.values(acct).includes(d.account) && d.counterparty === RL.issuer).map((d) => ({ 口座: Object.entries(acct).find(([, a]) => a === d.account)?.[0], 差: fmtSigned(d.delta) })) });
  }
  const endBal = await bal(endLedger);
  const net: X = {}; for (const k of ["P", "N", "S"]) net[k] = fmtSigned(parseDec(endBal[k]!) - parseDec(base.balances[k]!));
  net["合計"] = fmtDec(["P", "N", "S"].reduce((a, k) => a + parseDec(endBal[k]!) - parseDec(base!.balances[k]!), 0n));
  const open: string[] = []; for (const t of tickets) if (await escrowAt(client, t.escrowIndex, endLedger)) open.push(t.id);
  const manifest = {
    schema: "todoke-spike17-manifest/1", generatedAt: new Date().toISOString(), network, official, asset: RL,
    accounts: { P: acct.P, N: acct.N, S: acct.S, K: acct.K }, baseline: { ledger: base.ledger, hash: base.hash, closeTime: base.closeTime, balances: base.balances }, end: { ledger: endLedger, hash: endLi.hash, closeTime: endLi.closeTime },
    beforeExpiryC: before ?? null, expiryC: expiry ?? null, vkSha256: createHash("sha256").update(zk.vk).digest("hex").toUpperCase(),
    tickets: tickets.map((t) => ({ ...t, outcome: t.id === "C" ? "expired" : "used", finalRecipient: t.id === "C" ? "N" : "S", finishTx: jr.get(`finish:${t.id}`)?.hash ?? null, cancelTx: jr.get(`cancel:${t.id}`)?.hash ?? null })),
    acceptance, negativeControls: negative,
    transactions: jr.list().filter((r) => r.phase !== "outside").sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0)).map((r) => ({ label: r.label, phase: r.phase, ticket: r.ticket ?? null, account: r.account, type: r.type, hash: r.hash, expect: "tesSUCCESS", ledger: r.ledger })),
    expectedNet: { P: "-0.1", N: "-0.05", S: "+0.15" },
  };
  writeFileSync(`${RESULTS}manifest.json`, JSON.stringify(manifest, null, 1));
  const tk = (id: string) => tickets.find((t) => t.id === id)!;
  writeFileSync(`${RESULTS}harness-links.json`, JSON.stringify({
    schema: "todoke-spike17-harness-links/1", 注意: "合成データの試験ハーネスの照合記録。公開台帳には存在しない。世帯の秘密・鍵・preimage は含まない。個々の資格証明の検証（verify）と、2 券の保有者が同一世帯であることの第三者証明は別物（後者は未実装）",
    ハーネスが知っていること: { H1: { 券: ["A", "B"], 制度: ["P", "N"], 実際に証明を作った: "A（P）と B（N）の両方で、H1 の同じ世帯秘密から証明を作り、Service が検証した" }, H2: { 券: ["C"], 制度: ["N"] } },
    確認: { "A と B は同じ世帯 H1": tk("A").household === tk("B").household, "A と B の制度は異なる": tk("A").program !== tk("B").program, "A と B の nullifier は異なる": tk("A").nullifier !== tk("B").nullifier, "A と B の鍵ハッシュは異なる": tk("A").pkHash !== tk("B").pkHash, "A と B の Condition は異なる": tk("A").condition !== tk("B").condition, "C は別世帯 H2": tk("C").household !== tk("B").household },
    公開台帳から分かること: "A と B に共通する台帳上の項目は宛先の店舗 S と資産だけ。世帯の同一性は分からない",
  }, null, 1));
  writeFileSync(`${RESULTS}run.json`, j({ schema: "todoke-spike17-run/1", startedAt, finishedAt: new Date().toISOString(), network, official, preflight, 基準点: base, 終了: { ledger: endLedger, hash: endLi.hash }, 終了残高: endBal, 純増減: net, 未決Escrow: open, escrowChecks, acceptance, negativeControls: negative, steps, beforeExpiryC: before, expiryC: expiry, environment: { node: process.version, xrpl: "5.3.0" } }));
  return `完了: 基準 ${base.ledger} → 終了 ${endLedger}\n純増減 ${j(net)} 未決Escrow=${j(open)}`;
}

async function attempt(label: string, w: Wallet, tx: Parameters<typeof tracked>[4], role: string, ticket?: string): Promise<TxRec> {
  try { return await tracked(client, jr, label, w, tx, { role, phase: "scenario", ...(ticket ? { ticket } : {}) }); } catch (e) {
    const r = jr.get(label);
    if (e instanceof StopError && r?.status === "validated") return r;
    throw e;
  }
}
function shopOffline(syncFile: string, qrHex: string, shop: string, now: number) {
  return new Promise<{ reason: string; ok: boolean; netAttempts: number; listSize: number; accepted?: { escrow: X; fulfillmentHex: string } }>((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", SHOP_OFFLINE, syncFile, qrHex, shop, String(now)], { cwd: PKG });
    let out = ""; p.stdout.on("data", (b) => (out += String(b))); p.stderr.on("data", (b) => (out += String(b)));
    p.on("close", () => { const m = out.split("\n").find((l) => l.startsWith("RESULT ")); m ? resolve(JSON.parse(m.slice(7))) : reject(new Error(out.slice(0, 400))); });
  });
}
