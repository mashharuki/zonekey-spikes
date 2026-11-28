/**
 * spike 15: 2 ドナーの給付（P: 県・N: NGO）と未使用分の返還を、RLUSD の残高で検算する（Testnet 実測）
 *   pnpm --filter 15-multi-donor-rlusd run:scenario            前回の続き（完了していれば、既存 run の再照合だけ）
 *   pnpm --filter 15-multi-donor-rlusd run:scenario -- --new   新しい独立試験（前回の .state・results を archive へ退避）
 *   ... -- --prep-only                                          準備（口座・RLUSD・V の注文）だけ
 * 状態は .state/（gitignore 済み。署名済みバイト列・世帯の秘密・券の preimage を含む）。公開してよい結果は results/。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AccountSetAsfFlags, OfferCreateFlags, type Client, type Wallet } from "xrpl";
import { connectTestnet, loadEnvLocal, loadOrCreatePersistentWallet } from "xrpl-kit";
import { PK_MEMO_TYPE, encodeVoucher, sha256, signVoucher, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";
import { type Req, hex, requestDigest, syntheticField } from "../../13-zk-bound-voucher/src/lib.js";
import { Roster, type Household } from "../../13-zk-bound-voucher/src/roster.js";
import { PUBLIC_NAMES, Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { chainInfo, waitMs } from "../../14-issuance-recovery/src/chain.js";
import { type AppFile, pad8, proofOf, reqFromJson, reqToJson } from "../../14-issuance-recovery/src/common.js";
import { type Outcome, type Program, Service } from "../../14-issuance-recovery/src/service.js";
import { AMOUNTS, CONTRIB, NETWORK, RLUSD, TESTNET_WSS, ZKV_CURRENCY } from "./config.js";
import { escrowAt, ledgerInfo, lineBal, obligations, syncFromChain } from "./chainio.js";
import { fmtDec, fmtSigned, parseDec } from "./dec.js";
import { lineDeltas } from "./deltas.js";
import { Journal, StopError, type TxRec, tracked } from "./track.js";

const HERE = fileURLToPath(import.meta.url);
const PKG = fileURLToPath(new URL("../", import.meta.url));
const REPO14 = fileURLToPath(new URL("../../14-issuance-recovery/", import.meta.url));
let STATE = `${PKG}.state/`;
const RESULTS = `${PKG}results/`;
loadEnvLocal(HERE);

const argv = process.argv.slice(2);
const NEW_RUN = argv.includes("--new");
const PREP_ONLY = argv.includes("--prep-only");
const TTL_C = 420; // 券 C の期限（秒）。発券〜A・B の精算より長く、待ちが長すぎない値
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// ───────────── 独立試験の切り替え ─────────────
mkdirSync(RESULTS, { recursive: true });
if (NEW_RUN && existsSync(`${STATE}journal.json`)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const arch = `${PKG}.state-archive-${stamp}/`;
  renameSync(STATE, arch);
  for (const f of ["manifest.json", "run.json", "verify.json"]) if (existsSync(`${RESULTS}${f}`)) renameSync(`${RESULTS}${f}`, `${RESULTS}${f.replace(".json", `.${stamp}.json`)}`);
  console.log(`[run] --new: 前回の状態を ${arch} へ退避した（新しい独立試験）`);
}
mkdirSync(STATE, { recursive: true });
const readJson = <T>(f: string): T | undefined => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined);
const writeSecret = (f: string, v: unknown) => writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });

const client: Client = await connectTestnet();
const jr = new Journal(`${STATE}journal.json`);
const zk = new Zk();
const svcs: Service[] = [];
try {
  const run = await main();
  console.log(run);
} catch (e) {
  if (e instanceof StopError) { console.error(`\n[停止] ${e.message}`); process.exitCode = 2; } else throw e;
} finally {
  for (const s of svcs) s.db.close();
  await zk.close?.().catch(() => undefined);
  await client.disconnect();
}

// ───────────────────────────────────────────────────────────────────
async function main() {
  const t0 = new Date().toISOString();
  const srv = await client.request({ command: "server_info" });
  const serverInfo = { build_version: srv.result.info.build_version, complete_ledgers: srv.result.info.complete_ledgers, validated: srv.result.info.validated_ledger?.seq, network_id: srv.result.info.network_id ?? null };
  console.log(`[run] ${NETWORK} ${j(serverInfo)}`);

  // ── 0. 資産の確認（読み取りだけ） ──
  const issuerInfo = (await client.request({ command: "account_info", account: RLUSD.issuer, ledger_index: "validated" })).result.account_data;
  const LSF = { DefaultRipple: 0x00800000, AllowTrustLineLocking: 0x40000000, DepositAuth: 0x01000000, DisableMaster: 0x00100000, DisallowXRP: 0x00080000, AllowTrustLineClawback: 0x80000000, RequireAuth: 0x00040000, GlobalFreeze: 0x00400000 };
  const issuerFlags = Object.fromEntries(Object.entries(LSF).map(([k, v]) => [k, (issuerInfo.Flags & v) !== 0]));
  const gb = (await client.request({ command: "gateway_balances", account: RLUSD.issuer, ledger_index: "validated" } as never)) as unknown as { result: { obligations?: Record<string, string> } };
  let amm: unknown = null;
  try { amm = ((await client.request({ command: "amm_info", asset: { currency: "XRP" }, asset2: { currency: RLUSD.currency, issuer: RLUSD.issuer } } as never)) as unknown as { result: { amm: Record<string, unknown> } }).result.amm; } catch { amm = null; }
  const ammInfo = amm ? { account: (amm as Record<string, string>)["account"], xrpDrops: (amm as Record<string, string>)["amount"], rlusd: ((amm as Record<string, Record<string, string>>)["amount2"])?.["value"] } : null;
  const staleIssuer = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
  let staleExists = true;
  try { await client.request({ command: "account_info", account: staleIssuer, ledger_index: "validated" }); } catch { staleExists = false; }
  const asset = { currency: RLUSD.currency, issuer: RLUSD.issuer, source: RLUSD.source, issuerFlags, issuerDomain: issuerInfo.Domain ? Buffer.from(String(issuerInfo.Domain), "hex").toString() : null, obligations: gb.result.obligations ?? {}, amm: ammInfo, repoConstantIssuerStillExists: staleExists };
  console.log(`[run] RLUSD 発行者 ${RLUSD.issuer} flags=${j(issuerFlags)} AMM=${j(ammInfo)} 旧定数 ${staleIssuer} 存在=${staleExists}`);
  if (!issuerFlags.DefaultRipple) throw new StopError("RLUSD 発行者が想定と違う（DefaultRipple なし）");

  // ── 1. 口座 ──
  const P = (await loadOrCreatePersistentWallet(client, "PREFECTURE_P_SEED", "県 P（支援元）", HERE)).wallet;
  const N = (await loadOrCreatePersistentWallet(client, "NGO_N_SEED", "NGO N（支援元）", HERE)).wallet;
  const S = (await loadOrCreatePersistentWallet(client, "SETTLEMENT_SEED", "店舗 S", HERE)).wallet;
  const V = (await loadOrCreatePersistentWallet(client, "ZKV15_ISSUER_V_SEED", "受給証の発行・償還 V（spike 15 専用）", HERE)).wallet;
  const K = (await loadOrCreatePersistentWallet(client, "KEEPER_SEED", "keeper（期限切れの取消）", HERE)).wallet;
  const acct = { P: P.address, N: N.address, S: S.address, V: V.address, K: K.address };
  const wallets: Record<string, Wallet> = { P, N, S, V, K };
  const zkv = (v: string) => ({ currency: ZKV_CURRENCY, issuer: V.address, value: v });
  const rl = (v: string) => ({ currency: RLUSD.currency, issuer: RLUSD.issuer, value: v });
  const TL = "1000000";
  const prep = (label: string, who: string, tx: Parameters<typeof tracked>[4], role: string, expect?: string) =>
    tracked(client, jr, label, wallets[who]!, tx, { role, phase: "prep", ...(expect ? { expect } : {}) });
  const scen = (label: string, who: string, tx: Parameters<typeof tracked>[4], role: string, ticket?: string, expect?: string) =>
    tracked(client, jr, label, wallets[who]!, tx, { role, phase: "scenario", ...(ticket ? { ticket } : {}), ...(expect ? { expect } : {}) });

  // ── 2. 準備（給付とは別計上）。開始点（baseline.json）を一度確定したら、再実行では準備を一切やり直さない ──
  const isCur = (a: unknown, c: string) => typeof a === "object" && a !== null && (a as { currency: string }).currency === c;
  const BOOK = "1000";
  const baselineFile = `${STATE}baseline.json`;
  const baselineSaved = existsSync(baselineFile);
  if (!baselineSaved) {
  // ── 2. 準備（給付とは別計上）: V の設定、トラストライン、RLUSD の入手、V の 1:1 注文 ──
  const vFlags = (await client.request({ command: "account_info", account: V.address, ledger_index: "validated" })).result.account_data.Flags;
  if (!(vFlags & LSF.DefaultRipple)) await prep("prep:V:asfDefaultRipple", "V", { TransactionType: "AccountSet", Account: V.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple }, "prep-issuer-setup");
  if (!(vFlags & LSF.AllowTrustLineLocking)) await prep("prep:V:asfAllowTrustLineLocking", "V", { TransactionType: "AccountSet", Account: V.address, SetFlag: AccountSetAsfFlags.asfAllowTrustLineLocking }, "prep-issuer-setup");
  for (const w of ["P", "N", "S", "V"]) await prep(`prep:${w}:TrustSet RLUSD`, w, { TransactionType: "TrustSet", Account: wallets[w]!.address, LimitAmount: rl(TL) }, "prep-trustline");
  for (const w of ["P", "N", "S"]) await prep(`prep:${w}:TrustSet ZKV`, w, { TransactionType: "TrustSet", Account: wallets[w]!.address, LimitAmount: zkv(TL) }, "prep-trustline");
  // RLUSD の入手: 公式 faucet（tryrlusd.com）は GitHub サインインとブラウザウォレットが必要で自動化できない。XRP→RLUSD の AMM で買う（本物の発行者の RLUSD。自前発行ではない）
  for (const w of ["P", "N"] as const) {
    const need = parseDec(CONTRIB[w]);
    const have = await lineBal(client, wallets[w]!.address, RLUSD.issuer, RLUSD.currency, "validated");
    // 購入済みかは journal で判定する（残高で判定すると、使った後の再実行で買い足してしまう。実測した不具合）
    const bought = jr.list().some((r) => r.label.startsWith(`prep:${w}:buy RLUSD`) && r.status === "validated");
    if (!bought && have < need) {
      const buy = fmtDec(need - have);
      await prep(`prep:${w}:buy RLUSD ${buy} via AMM`, w, { TransactionType: "Payment", Account: wallets[w]!.address, Destination: wallets[w]!.address, Amount: rl(buy), SendMax: "3000000" }, "prep-rlusd-acquire");
    }
  }
  // V の 1:1 注文（発行: V が ZKV を売り RLUSD を受ける / 償還: V が RLUSD を売り ZKV を受ける・tfPassive）
  const offers = (await client.request({ command: "account_offers", account: V.address, ledger_index: "validated" })).result.offers ?? [];
  const hasIssue = offers.some((o) => isCur(o.taker_gets, ZKV_CURRENCY) && isCur(o.taker_pays, RLUSD.currency));
  if (!hasIssue) await prep("prep:V:issue offer ZKV→RLUSD 1:1", "V", { TransactionType: "OfferCreate", Account: V.address, TakerGets: zkv(BOOK), TakerPays: rl(BOOK) }, "prep-v-offer");
  // 償還注文（V が RLUSD を売り ZKV を受ける）は、V が RLUSD を持ってからでないと置けない（tecUNFUNDED_OFFER。実測）ので、P の拠出のあとに置く
  }

  // 開始点: 準備の最後の取引の ledger。以降の取引だけを「今回分」として数える（確定したら固定）
  const snap = async (ledger: number) => {
    const out: Record<string, { RLUSD: string; ZKV: string; }> = {};
    for (const [k, a] of Object.entries(acct)) {
      if (k === "K") continue;
      const isV = k === "V";
      out[k] = { RLUSD: fmtDec(await lineBal(client, a, RLUSD.issuer, RLUSD.currency, ledger)), ZKV: isV ? fmtDec(-(await obligations(client, V.address, ZKV_CURRENCY, ledger))) : fmtDec(await lineBal(client, a, V.address, ZKV_CURRENCY, ledger)) };
    }
    return out;
  };
  type Base = { ledger: number; index: number; closeTime: number; hash: string; balances: Record<string, { RLUSD: string; ZKV: string }>; vOffers: number; note: string; xrp: Record<string, string> };
  let baseline = readJson<Base>(baselineFile);
  if (!baseline) {
    const baseLedger = Math.max(...jr.list().filter((r) => r.phase === "prep").map((r) => r.ledger ?? 0));
    const xrp = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, (await client.request({ command: "account_info", account: a, ledger_index: baseLedger })).result.account_data.Balance])));
    baseline = { ledger: baseLedger, ...(await ledgerInfo(client, baseLedger)), balances: await snap(baseLedger), vOffers: ((await client.request({ command: "account_offers", account: V.address, ledger_index: baseLedger })).result.offers ?? []).length, note: "V の ZKV は「発行済み残高（義務）」の符号反転。専用の新しい発行者なので試験外の残高はない", xrp };
    for (const w of ["P", "N"] as const) {
      const have = parseDec(baseline.balances[w]!.RLUSD);
      if (have < parseDec(CONTRIB[w])) throw new StopError(`RLUSD 不足: ${w}(${acct[w]}) は ${baseline.balances[w]!.RLUSD}、必要 ${CONTRIB[w]}。公式 faucet（https://tryrlusd.com/）か AMM で補い、再実行する`);
    }
    writeFileSync(baselineFile, JSON.stringify(baseline, null, 1));
  }
  const baseLedger = baseline.ledger;
  const xrpBefore = baseline.xrp;
  console.log(`[run] 開始点 ledger=${baseLedger} balances=${j(baseline.balances)}`);
  if (PREP_ONLY) return `準備完了（開始点 ledger ${baseLedger}）`;

  // ── 3. 拠出: RLUSD → ZKV（V の発行注文と交差、IoC） ──
  for (const w of ["P", "N"] as const) {
    await scen(`contrib:${w}`, w, { TransactionType: "OfferCreate", Account: acct[w], TakerGets: rl(CONTRIB[w]), TakerPays: zkv(CONTRIB[w]), Flags: OfferCreateFlags.tfImmediateOrCancel }, "contribution");
    if (w === "P") {
      const vo = (await client.request({ command: "account_offers", account: V.address, ledger_index: "validated" })).result.offers ?? [];
      if (!vo.some((o) => isCur(o.taker_gets, RLUSD.currency) && isCur(o.taker_pays, ZKV_CURRENCY)))
        await scen("v:redeem offer RLUSD→ZKV 1:1 passive", "V", { TransactionType: "OfferCreate", Account: V.address, TakerGets: rl(BOOK), TakerPays: zkv(BOOK), Flags: OfferCreateFlags.tfPassive }, "v-redeem-offer");
    }
  }

  // ── 4. 世帯・名簿・申請・発券 ──
  await zk.init();
  interface Sec { households: { id: string; secret: string; salt: string; zone: string; senior: boolean; revictim: boolean; tier: number }[]; programs: { P: string; N: string }; tickets: Record<string, { app: AppFile; preimage: string; keyJwk: JsonWebKey; pub: string; household: string; donor: string }> }
  let sec = readJson<Sec>(`${STATE}secrets.json`);
  const rnd = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(31)));
  if (!sec) {
    sec = {
      households: [
        { id: "H1", secret: rnd(), salt: rnd(), zone: "13101", senior: true, revictim: false, tier: 3 },
        { id: "H2", secret: rnd(), salt: rnd(), zone: "13102", senior: true, revictim: false, tier: 3 },
        { id: "H3", secret: rnd(), salt: rnd(), zone: "13103", senior: false, revictim: false, tier: 3 }, // 対照: 対象地区だが高齢者要件を満たさない
      ],
      programs: { P: rnd(), N: rnd() }, tickets: {},
    };
    writeSecret(`${STATE}secrets.json`, sec);
  }
  const bi = (h: string) => BigInt(`0x${h}`);
  const members: Household[] = sec.households.map((h) => ({ id: h.id, secret: bi(h.secret), salt: bi(h.salt), zone: BigInt(h.zone), senior: h.senior, revictim: h.revictim, tier: h.tier, profile: { name: "合成", address: "架空" } }));
  const roster = await new Roster(members).build(zk);
  const progId = { P: bi(sec.programs.P), N: bi(sec.programs.N) };
  const zones = pad8([13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108]);
  const programs: Record<"P" | "N", Program> = {
    P: { id: progId.P, owner: P.address, currency: ZKV_CURRENCY, issuer: V.address, allowedValues: [100000n], allowedShops: [S.address], stmt: { zoneSet: zones, needSenior: false, needRevictim: false, minTier: 1 }, minTtlSec: 120 },
    N: { id: progId.N, owner: N.address, currency: ZKV_CURRENCY, issuer: V.address, allowedValues: [50000n], allowedShops: [S.address], stmt: { zoneSet: zones, needSenior: true, needRevictim: false, minTier: 1 }, minTtlSec: 120 },
  };
  const roots = [roster.root];
  const mkSvc = (w: "P" | "N") => { const s = new Service({ dbPath: `${STATE}issuer-${w}.db`, client, wallet: wallets[w]!, programs: [programs[w]], approvedRoots: roots, zk }); svcs.push(s); return s; };
  const svc = { P: mkSvc("P"), N: mkSvc("N") };

  // 対照: H3（高齢者でない）は N の制度の証明を作れない（回路が拒否する）
  const negative = await (async () => {
    const idx = 2, h = members[idx]!;
    const probe: Req = { programId: progId.N, owner: N.address, shop: S.address, currency: ZKV_CURRENCY, issuer: V.address, valueUnits: 50000n, cancelAfter: 1, pkHash: "00".repeat(32), conditionHash: "00".repeat(32) };
    const digest = await requestDigest(probe);
    const d = await zk.derive({ hhSecret: h.secret, programId: progId.N, zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, salt: h.salt, digest });
    try {
      await zk.prove(zk.inputs({ ...programs.N.stmt, root: roster.root, programId: progId.N }, { zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, hhSecret: h.secret, salt: h.salt, index: idx, siblings: roster.path(idx) }, digest, d.nullifier, d.tag));
      return { household: "H3", program: "N", proofCreated: true, error: null as string | null };
    } catch (e) { return { household: "H3", program: "N", proofCreated: false, error: String((e as Error).message).split("\n")[0]!.slice(0, 160) }; }
  })();
  console.log(`[run] 対照 H3→N: ${j(negative)}`);

  const subtle = globalThis.crypto.subtle;
  const spec = {
    A: { donor: "P" as const, hh: 0, value: "0.1", units: 100000n, ttl: 7200 },
    B: { donor: "N" as const, hh: 0, value: "0.05", units: 50000n, ttl: 7200 },
    C: { donor: "N" as const, hh: 1, value: "0.05", units: 50000n, ttl: TTL_C },
  };
  const issued: Record<string, { outcome: Outcome; req: Req; app: AppFile; proveMs: number | undefined }> = {};
  for (const id of ["A", "B", "C"] as const) {
    const sp = spec[id];
    let t = sec.tickets[id];
    let proveMs: number | undefined;
    if (!t) {
      const h = members[sp.hh]!;
      const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
      const preimage = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const info = await chainInfo(client, acct[sp.donor]);
      const req: Req = { programId: progId[sp.donor], owner: acct[sp.donor], shop: S.address, currency: ZKV_CURRENCY, issuer: V.address, valueUnits: sp.units, cancelAfter: info.closeTime + sp.ttl, pkHash: hex(await sha256(pub)), conditionHash: hex(await sha256(preimage)) };
      const digest = await requestDigest(req);
      const d = await zk.derive({ hhSecret: h.secret, programId: progId[sp.donor], zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, salt: h.salt, digest });
      const inputs = zk.inputs({ ...programs[sp.donor].stmt, root: roster.root, programId: progId[sp.donor] }, { zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, hhSecret: h.secret, salt: h.salt, index: sp.hh, siblings: roster.path(sp.hh) }, digest, d.nullifier, d.tag);
      const p = await zk.prove(inputs);
      proveMs = p.proveMs;
      const app: AppFile = { req: reqToJson(req), proofHex: Buffer.from(p.proof).toString("hex"), publicInputs: p.publicInputs };
      t = { app, preimage: hex(preimage), keyJwk: await subtle.exportKey("jwk", kp.privateKey), pub: hex(pub), household: h.id, donor: sp.donor };
      sec.tickets[id] = t; writeSecret(`${STATE}secrets.json`, sec);
    }
    const req = reqFromJson(t.app.req);
    // 発券記録が確定済みなら、再度 apply しない（期限切れの券の apply は方針検査で拒否されるため。既存 run の再照合）
    const db = svc[sp.donor].db;
    const done = db.prepare("SELECT id, offer_sequence, escrow_index, confirmed_tx FROM issuance WHERE program_id=? AND req_digest=? AND state='confirmed'").get(req.programId.toString(), hex(await requestDigest(req))) as { id: number; offer_sequence: number; escrow_index: string; confirmed_tx: string } | undefined;
    const outcome: Outcome = done
      ? { status: "confirmed", offerSequence: done.offer_sequence, txHash: done.confirmed_tx, escrowIndex: done.escrow_index, attempts: (db.prepare("SELECT COUNT(*) c FROM attempts WHERE issuance_id=?").get(done.id) as { c: number }).c }
      : await svc[sp.donor].apply(req, proofOf(t.app));
    if (outcome.status !== "confirmed") throw new StopError(`券 ${id} の発券が確定しない: ${j(outcome)}`);
    issued[id] = { outcome, req, app: t.app, proveMs };
    const row = svc[sp.donor].db.prepare("SELECT confirmed_tx FROM issuance WHERE offer_sequence=? AND owner=?").get(outcome.offerSequence, acct[sp.donor]) as { confirmed_tx: string };
    const info = await client.request({ command: "tx", transaction: row.confirmed_tx });
    const lg = Number((info.result as { ledger_index?: number }).ledger_index);
    jr.recs[`issue:${id}`] = { label: `issue:${id}`, role: "escrow-create", ticket: id, phase: "scenario", account: acct[sp.donor], type: "EscrowCreate", hash: row.confirmed_tx, blob: "", lls: 0, firstLedger: 0, status: "validated", result: "tesSUCCESS", ledger: lg, closeTime: (await ledgerInfo(client, lg)).closeTime, attempts: outcome.attempts, supersededHashes: [], note: "発券サービス（spike 14 の Service）が確定した取引" };
    jr.save();
    console.log(`[run] 券 ${id}: 発券確定 tx=${outcome.txHash} OfferSequence=${outcome.offerSequence} escrow=${outcome.escrowIndex}`);
  }

  // 発券確認: 承認内容と台帳の Escrow を照合
  interface Ticket { id: string; program: "P" | "N"; donor: string; household: string; shop: string; value: string; cancelAfter: number; condition: string; pkHash: string; offerSequence: number; escrowIndex: string; createTx: string; createLedger: number; attempts: number; proofSha256: string; nullifier: string; reqDigest: string; proveMs?: number }
  const tickets: Ticket[] = [];
  const escrowChecks: { ticket: string; checks: Record<string, boolean> }[] = [];
  for (const id of ["A", "B", "C"] as const) {
    const it = issued[id]!, sp = spec[id];
    const oc = it.outcome as Extract<Outcome, { status: "confirmed" }>;
    const rec = jr.get(`issue:${id}`)!;
    const esc = await escrowAt(client, oc.escrowIndex, rec.ledger!);
    const condHex = `A0258020${it.req.conditionHash.toUpperCase()}810120`;
    const tx = (await client.request({ command: "tx", transaction: oc.txHash })).result as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const memo = ((tx["tx_json"]?.["Memos"] ?? tx["Memos"] ?? []) as { Memo: { MemoType: string; MemoData: string } }[]).map((m) => m.Memo);
    const pi = it.app.publicInputs;
    const checks = {
      "Escrow の持ち主 = 申請の支援元": esc?.["Account"] === it.req.owner,
      "宛先 = 店舗 S": esc?.["Destination"] === S.address,
      "資産 = ZKV（V 発行）": esc?.["Amount"]?.currency === ZKV_CURRENCY && esc?.["Amount"]?.issuer === V.address,
      "額面が一致": esc !== undefined && parseDec(esc["Amount"].value) === parseDec(sp.value),
      "CancelAfter が一致": esc?.["CancelAfter"] === it.req.cancelAfter,
      "Condition が一致": String(esc?.["Condition"]).toUpperCase() === condHex,
      "Memo の鍵ハッシュ = 申請の pkHash": memo.some((m) => m.MemoType.toUpperCase() === PK_MEMO_TYPE && m.MemoData.toUpperCase() === it.req.pkHash.toUpperCase()),
      "OfferSequence = 台帳上の Sequence": (tx["tx_json"]?.["Sequence"] ?? tx["Sequence"]) === oc.offerSequence,
      "制度の公開入力（program_id）が申請の制度": BigInt(pi[PUBLIC_NAMES.indexOf("program_id")]!) === it.req.programId,
    };
    escrowChecks.push({ ticket: id, checks });
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new StopError(`券 ${id}: 承認内容と台帳の Escrow が違う: ${bad.join(", ")}`);
    tickets.push({ id, program: sp.donor, donor: it.req.owner, household: sec.tickets[id]!.household, shop: S.address, value: sp.value, cancelAfter: it.req.cancelAfter, condition: condHex, pkHash: it.req.pkHash.toUpperCase(), offerSequence: oc.offerSequence, escrowIndex: oc.escrowIndex, createTx: oc.txHash, createLedger: rec.ledger!, attempts: oc.attempts, proofSha256: hex(await sha256(Uint8Array.from(Buffer.from(it.app.proofHex, "hex")))), nullifier: String(BigInt(pi[PUBLIC_NAMES.indexOf("nullifier")]!)), reqDigest: hex(await requestDigest(it.req)), ...(it.proveMs !== undefined ? { proveMs: it.proveMs } : {}) });
  }
  // 公開してよい証明（公開入力と証明本体。秘密ではない）。第三者が verify --zk で検証できる
  writeFileSync(`${RESULTS}proofs.json`, JSON.stringify({ note: "ZK 証明と公開入力（秘密を含まない）。検算コマンドの --zk で検証できる", rootHex: `0x${roster.root.toString(16)}`, tickets: Object.fromEntries(["A", "B", "C"].map((id) => [id, { req: issued[id]!.app.req, proofHex: issued[id]!.app.proofHex, publicInputs: issued[id]!.app.publicInputs }])) }, null, 1));

  // ── 5. A・B: オフライン受付 → EscrowFinish（S）→ 償還（S）。1 枚ずつ順に ──
  const offline: Record<string, unknown> = {};
  for (const id of ["A", "B"] as const) {
    const t = tickets.find((x) => x.id === id)!;
    if (!jr.get(`finish:${id}`)) {
      // 店の端末: オンライン中に同期した一覧（台帳から構成）と、世帯の QR だけで、ネットワークを遮断して確かめる
      const sync = await syncFromChain(client, S.address);
      const syncFile = `${STATE}sync.${id}.json`;
      writeFileSync(syncFile, JSON.stringify(sync));
      const st = sec.tickets[id]!;
      const priv = await subtle.importKey("jwk", st.keyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const pub = unhex(st.pub);
      const qr = hex(encodeVoucher({ owner: t.donor, offerSequence: t.offerSequence, preimage: unhex(st.preimage), sig: { pub, sig: await signVoucher(priv, t.donor, t.offerSequence, S.address) } }));
      const now = (await ledgerInfo(client, "validated")).closeTime;
      const r = await shopOffline(syncFile, qr, S.address, now);
      offline[id] = { ...r, syncSize: sync.length, checkedAtRippleTime: now };
      if (!r.ok || r.netAttempts !== 0) throw new StopError(`券 ${id} のオフライン受付が通らない: ${j(r)}`);
      console.log(`[run] 券 ${id}: オフライン受付 ${r.reason}（通信の試み ${r.netAttempts}）一覧 ${sync.length} 件`);
      writeFileSync(`${STATE}offline.${id}.json`, JSON.stringify(offline[id]));
    } else offline[id] = readJson(`${STATE}offline.${id}.json`) ?? { note: "前回の run で受付済み" };
    const st = sec.tickets[id]!;
    await scen(`finish:${id}`, "S", { TransactionType: "EscrowFinish", Account: S.address, Owner: t.donor, OfferSequence: t.offerSequence, Condition: t.condition, Fulfillment: `A0228020${st.preimage}` }, "escrow-finish", id);
    await scen(`redeem:${id}`, "S", { TransactionType: "OfferCreate", Account: S.address, TakerGets: zkv(t.value), TakerPays: rl(t.value), Flags: OfferCreateFlags.tfImmediateOrCancel }, "redeem", id);
  }

  // ── 6. C: 期限まで未使用の Escrow があることを確認 → 期限後に keeper が EscrowCancel → N が償還 ──
  const tC = tickets.find((x) => x.id === "C")!;
  let midRec = readJson<{ ledger: number; closeTime: number; cancelAfter: number; exists: boolean }>(`${STATE}mid.C.json`);
  if (!midRec && !jr.get("cancel:C")) {
    const li = await ledgerInfo(client, "validated");
    const e = await escrowAt(client, tC.escrowIndex, li.index);
    if (li.closeTime >= tC.cancelAfter) throw new StopError(`券 C の期限（${tC.cancelAfter}）を、A・B の精算中に過ぎた。--new で新しい試験にするか、TTL_C を伸ばす（validated close_time=${li.closeTime}）`);
    midRec = { ledger: li.index, closeTime: li.closeTime, cancelAfter: tC.cancelAfter, exists: e !== undefined };
    writeFileSync(`${STATE}mid.C.json`, JSON.stringify(midRec));
    console.log(`[run] 券 C: 期限前の確認 ledger=${li.index} close_time=${li.closeTime} < CancelAfter=${tC.cancelAfter}、Escrow は ${e ? "存在" : "存在しない"}`);
    if (!e) throw new StopError("券 C の Escrow が期限前に存在しない");
  }
  if (!jr.get("cancel:C")) {
    for (;;) {
      const li = await ledgerInfo(client, "validated");
      if (li.closeTime > tC.cancelAfter + 5) break;
      console.log(`[run] 券 C: 期限待ち（あと ${tC.cancelAfter + 5 - li.closeTime} 秒、validated close_time=${li.closeTime}）`);
      await waitMs(Math.min(15000, Math.max(3000, (tC.cancelAfter + 5 - li.closeTime) * 1000)));
    }
  }
  await scen("cancel:C", "K", { TransactionType: "EscrowCancel", Account: K.address, Owner: tC.donor, OfferSequence: tC.offerSequence }, "escrow-cancel", "C");
  await scen("redeem:C", "N", { TransactionType: "OfferCreate", Account: N.address, TakerGets: zkv(tC.value), TakerPays: rl(tC.value), Flags: OfferCreateFlags.tfImmediateOrCancel }, "redeem", "C");

  // ── 7. 実測の整理（各段階の残高差。取引の ledger L−1 → L） ──
  const scenRecs = jr.list().filter((r) => r.phase === "scenario").sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0) || a.label.localeCompare(b.label));
  const endLedger = Math.max(...scenRecs.map((r) => r.ledger ?? 0));
  const steps: unknown[] = [];
  for (const r of scenRecs) {
    const before = await snap(r.ledger! - 1), after = await snap(r.ledger!);
    const tx = (await client.request({ command: "tx", transaction: r.hash })).result as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const deltas = lineDeltas(tx["meta"]).filter((d) => (d.currency === RLUSD.currency && d.counterparty === RLUSD.issuer) || (d.currency === ZKV_CURRENCY && d.counterparty === V.address) || (d.currency === ZKV_CURRENCY && d.account === V.address) || (d.currency === RLUSD.currency && d.account === RLUSD.issuer && false));
    const bal: Record<string, Record<string, string>> = {};
    for (const k of ["P", "N", "S", "V"]) for (const cur of ["RLUSD", "ZKV"] as const) {
      const d = parseDec(after[k]![cur]) - parseDec(before[k]![cur]);
      if (d !== 0n) (bal[k] ??= {})[cur] = fmtSigned(d);
    }
    steps.push({ label: r.label, role: r.role, ticket: r.ticket ?? null, account: Object.entries(acct).find(([, a]) => a === r.account)?.[0], type: r.type, hash: r.hash, result: r.result, ledger: r.ledger, closeTime: r.closeTime, attempts: r.attempts, "残高の差_台帳L-1からL": bal, メタデータからの差: deltas.filter((d) => Object.values(acct).includes(d.account) && d.account !== K.address).map((d) => ({ 口座: Object.entries(acct).find(([, a]) => a === d.account)?.[0], 通貨: d.currency === RLUSD.currency ? "RLUSD" : d.currency, 差: fmtSigned(d.delta) })) });
  }
  const endBal = await snap(endLedger);
  const net: Record<string, Record<string, string>> = {};
  for (const k of ["P", "N", "S", "V"]) net[k] = { RLUSD: fmtSigned(parseDec(endBal[k]!.RLUSD) - parseDec(baseline.balances[k]!.RLUSD)), ZKV: fmtSigned(parseDec(endBal[k]!.ZKV) - parseDec(baseline.balances[k]!.ZKV)) };

  // ── 8. 公開用 manifest（秘密なし）と run.json ──
  const txList = jr.list().filter((r) => r.phase !== "outside").sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0)).map((r) => ({ label: r.label, phase: r.phase, role: r.role, ticket: r.ticket ?? null, account: r.account, type: r.type, hash: r.hash, expect: r.expected ?? "tesSUCCESS", ledger: r.ledger, fee: r.fee ?? null }));
  const manifest = {
    schema: "todoke-spike15-manifest/1",
    generatedAt: new Date().toISOString(),
    network: NETWORK, endpoint: TESTNET_WSS,
    asset: { RLUSD: { currency: RLUSD.currency, issuer: RLUSD.issuer }, ZKV: { currency: ZKV_CURRENCY, issuer: V.address } },
    accounts: { P: { address: acct.P, role: "県（支援元）" }, N: { address: acct.N, role: "NGO（支援元）" }, S: { address: acct.S, role: "店舗" }, V: { address: acct.V, role: "受給証の発行・償還" }, K: { address: acct.K, role: "keeper（期限切れの取消）" } },
    baselineLedger: baseLedger, endLedger,
    midCheck: midRec ? { ticket: "C", ledger: midRec.ledger, closeTime: midRec.closeTime, cancelAfter: tC.cancelAfter } : null,
    contributions: { P: CONTRIB.P, N: CONTRIB.N },
    tickets: tickets.map((t) => ({ ...t, outcome: t.id === "C" ? "expired" : "used", finalRecipient: t.id === "C" ? "N" : "S", finishTx: jr.get(`finish:${t.id}`)?.hash ?? null, cancelTx: jr.get(`cancel:${t.id}`)?.hash ?? null, redeemTx: jr.get(`redeem:${t.id}`)?.hash ?? null })),
    transactions: txList,
    outsideWindow: jr.list().filter((r) => r.phase === "outside").map((r) => ({ label: r.label, hash: r.hash, account: r.account, type: r.type, ledger: r.ledger, result: r.result, note: r.note ?? null })),
    prepNote: "prep の取引（V の設定・トラストライン・AMM での RLUSD 入手・V の 1:1 注文）は給付ではない。baselineLedger までに完了。",
  };
  writeFileSync(`${RESULTS}manifest.json`, JSON.stringify(manifest, null, 1));
  // 世帯の同一性の根拠（合成データの試験ハーネスだけが知る事実と、公開台帳から分かる事実を分ける）
  const tk = (id: string) => tickets.find((t) => t.id === id)!;
  const links = {
    schema: "todoke-spike15-harness-links/1",
    注意: "これは試験ハーネス（合成データ）の照合記録であり、公開台帳には存在しない。世帯 H1・H2 は合成で、氏名・住所・固定の識別子は台帳にも Memo にも入れていない。秘密・未使用券を使える情報は含めない",
    ハーネスが知っていること: {
      H1: { 券: tickets.filter((t) => t.household === "H1").map((t) => t.id), 制度: tickets.filter((t) => t.household === "H1").map((t) => t.program), 実際に証明を作った: "A（P: 基本給付）と B（N: 高齢者追加給付）の両方で、H1 の同じ世帯秘密から証明を作り、発券サービスが検証した" },
      H2: { 券: tickets.filter((t) => t.household === "H2").map((t) => t.id), 制度: tickets.filter((t) => t.household === "H2").map((t) => t.program) },
      対照H3: negative,
    },
    公開台帳から検算できること: {
      券ごとの資金の流れ: "持ち主・宛先・額面・期限・Condition・鍵ハッシュ・取引 hash・残高の増減（検算コマンド）",
      世帯の同一性: "分からない。A と B は持ち主（P / N）、制度の nullifier、鍵ハッシュ、Condition がすべて異なり、共通するのは宛先の店舗 S だけ",
    },
    発券サービスの記録または本人の協力が必要なこと: "H1 が P と N の両方の資格を持つこと（名簿の root、制度ごとの ZK 証明の検証、制度ごとの nullifier の一意性）。2 枚が同じ世帯のものだと第三者に示す ZK 証明は未実装（spike 13 から未着手）",
    確認: {
      "A と B は同じ世帯 H1": tk("A").household === tk("B").household,
      "A と B の制度は異なる": tk("A").program !== tk("B").program,
      "A と B の nullifier は異なる（制度ごとに別）": tk("A").nullifier !== tk("B").nullifier,
      "A と B の鍵ハッシュ（申請鍵）は異なる": tk("A").pkHash !== tk("B").pkHash,
      "A と B の Condition は異なる": tk("A").condition !== tk("B").condition,
      "C は別世帯 H2": tk("C").household !== tk("B").household,
      "対照: 高齢者要件を満たさない H3 は N の証明を作れない": negative.proofCreated === false,
    },
    券: tickets.map((t) => ({ id: t.id, 制度: t.program, 世帯: t.household, nullifier: t.nullifier, pkHash: t.pkHash, createTx: t.createTx })),
  };
  writeFileSync(`${RESULTS}harness-links.json`, JSON.stringify(links, null, 1));
  const nowIso = new Date().toISOString();
  const run = {
    schema: "todoke-spike15-run/1", startedAt: t0, finishedAt: nowIso, server: serverInfo, asset,
    accounts: acct, xrpAtBaseline: xrpBefore, baseline, endLedger, endBalances: endBal, 純増減_開始点から終了点: net,
    negativeControl: negative, escrowChecks, offlineAcceptance: offline,
    tickets: tickets.map((t) => ({ ...t })), steps, midCheck: midRec ?? null,
    environment: { node: process.version, xrpl: "5.3.0" },
  };
  writeFileSync(`${RESULTS}run.json`, j(run));
  return `完了: results/manifest.json, results/run.json（開始 ledger ${baseLedger} → 終了 ledger ${endLedger}）\n純増減 ${j(net)}`;
}

function shopOffline(syncFile: string, qrHex: string, shop: string, now: number) {
  return new Promise<{ reason: string; ok: boolean; netAttempts: number; listSize: number }>((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", `${REPO14}src/shop-offline.ts`, syncFile, qrHex, shop, String(now)], { cwd: PKG });
    let out = ""; p.stdout.on("data", (b) => (out += String(b))); p.stderr.on("data", (b) => (out += String(b)));
    p.on("close", () => { const m = out.split("\n").find((l) => l.startsWith("RESULT ")); m ? resolve(JSON.parse(m.slice(7))) : reject(new Error(out.slice(0, 400))); });
  });
}
export type { TxRec };
