/**
 * spike 14: 発券直後に通信が切れても、元の券を使えるか（Testnet 実測）
 *   pnpm --filter 14-issuance-recovery test            全ケース
 *   pnpm --filter 14-issuance-recovery test C2 C6      指定ケースだけ
 * 障害は自分のワーカー（別プロセス）に注入する: FAULT で指定した位置で process.kill(pid, SIGKILL)。Testnet のノードは通常のまま。
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Wallet, xrpToDrops } from "xrpl";
import { configureEscrowableIssuer, connectTestnet, loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog } from "xrpl-kit";
import { encodeVoucher, signVoucher } from "../../11c-voucher-escrow/src/voucher/core.js";
import type { SyncedEscrow } from "../../11c-voucher-escrow/src/voucher/shop.js";
import { type Req, hex, requestDigest, sha256, syntheticAccount, syntheticField, toUnits } from "../../13-zk-bound-voucher/src/lib.js";
import { Roster, type Household } from "../../13-zk-bound-voucher/src/roster.js";
import { Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { accountHistory, chainInfo, coversRange, flat, queryTx, waitMs, type J } from "./chain.js";
import { HERE, PKG, STATE, type AppFile, pad8, reqToJson } from "./common.js";
import { openDb, snapshotOf } from "./service.js";

loadEnvLocal(HERE);
delete process.env["FAULT"];
mkdirSync(STATE, { recursive: true });
const only = process.argv.slice(2);
const client = await connectTestnet();
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// ── 準備: V・D・店・名簿 ──
const V = (await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE)).wallet;
const D = (await loadOrCreatePersistentWallet(client, "DISTRIBUTION_SEED", "distribution D", HERE)).wallet;
const zkv = (v: string) => ({ currency: "ZKV", issuer: V.address, value: v });
const vInfo = await client.request({ command: "account_info", account: V.address, ledger_index: "validated" });
const setup: Record<string, unknown> = { issuerHadAllowTrustLineLocking: (vInfo.result.account_data.Flags & 0x00800000) !== 0 };
if (!setup["issuerHadAllowTrustLineLocking"]) for (const o of await configureEscrowableIssuer(client, V)) console.log(`V の設定: ${o.engineResult} ${o.hash}`);
const lines = await client.request({ command: "account_lines", account: D.address, peer: V.address, ledger_index: "validated" });
const bal0 = Number(lines.result.lines.find((l) => l.currency === "ZKV")?.balance ?? "-1");
if (bal0 < 0) await submitAndLog(client, "D TrustSet", { TransactionType: "TrustSet", Account: D.address, LimitAmount: zkv("1000000") }, D);
if (bal0 < 60) await submitAndLog(client, "V → D 受給証 100", { TransactionType: "Payment", Account: V.address, Destination: D.address, Amount: zkv("100") }, V);
const dxrp = Number((await client.request({ command: "account_info", account: D.address, ledger_index: "validated" })).result.account_data.Balance) / 1e6;
const shop = Wallet.generate();
const fund = await submitAndLog(client, "D → 店 2 XRP", { TransactionType: "Payment", Account: D.address, Destination: shop.address, Amount: xrpToDrops("2") }, D);
Object.assign(setup, { D: D.address, V: V.address, shop: shop.address, shopFundTx: fund.hash, dXrp: dxrp });

const zk = new Zk(); await zk.init();
const mk = async (i: number): Promise<Household> => ({ id: `K${i}`, secret: await syntheticField(`14|hh-secret|${i}`), salt: await syntheticField(`14|salt|${i}`), zone: 13101n, senior: true, revictim: true, tier: 3, profile: { name: "合成", address: "架空" } });
const members = await Promise.all(Array.from({ length: 14 }, (_, i) => mk(i)));
const roster = await new Roster(members).build(zk);
const programId = await syntheticField(`14|program|${Date.now()}`);
const world = { programId: programId.toString(), owner: D.address, issuer: V.address, shop: shop.address, root: roster.root.toString() };
writeFileSync(`${STATE}world.json`, JSON.stringify(world));
const stmt = { zoneSet: pad8([13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108]), needSenior: true, needRevictim: false, minTier: 2, root: roster.root, programId };

// ── 世帯端末（鍵と preimage はここだけが持つ） ──
const subtle = globalThis.crypto.subtle;
let hhNext = 0;
async function household(label: string) {
  const idx = hhNext++;
  const h = members[idx]!;
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const preimage = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const info = await chainInfo(client, D.address);
  const req: Req = { programId, owner: D.address, shop: shop.address, currency: "ZKV", issuer: V.address, valueUnits: toUnits("5"), cancelAfter: info.closeTime + 7200, pkHash: hex(await sha256(pub)), conditionHash: hex(await sha256(preimage)) };
  const digest = await requestDigest(req);
  const d = await zk.derive({ hhSecret: h.secret, programId, zone: h.zone, senior: true, revictim: true, tier: 3, salt: h.salt, digest });
  const inputs = zk.inputs(stmt, { zone: h.zone, senior: true, revictim: true, tier: 3, hhSecret: h.secret, salt: h.salt, index: idx, siblings: roster.path(idx) }, digest, d.nullifier, d.tag);
  const writeApp = async (suffix: string) => {
    const p = await zk.prove(inputs);
    const f = `${STATE}${label}.${suffix}.app.json`;
    const a: AppFile = { req: reqToJson(req), proofHex: Buffer.from(p.proof).toString("hex"), publicInputs: p.publicInputs };
    writeFileSync(f, JSON.stringify(a));
    return { file: f, proofHex: a.proofHex };
  };
  const qr = async (offerSequence: number) => encodeVoucher({ owner: D.address, offerSequence, preimage, sig: { pub, sig: await signVoucher(kp.privateKey, D.address, offerSequence, shop.address) } });
  return { req, condition: `A0258020${req.conditionHash.toUpperCase()}810120`, writeApp, qr, label };
}
type Hh = Awaited<ReturnType<typeof household>>;

// ── ワーカー（別プロセス）の起動 ──
interface W { err?: string; code: number | null; signal: string | null; result?: unknown; ms: number; pid: number }
function worker(db: string, cmd: "apply" | "recover", file?: string, env: Record<string, string> = {}): Promise<W> {
  return new Promise((resolve) => {
    const t = performance.now();
    const p = spawn(process.execPath, ["--import", "tsx", "src/worker.ts", db, cmd, ...(file ? [file] : [])], { cwd: PKG, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (b) => (out += String(b)));
    let err = "";
    p.stderr.on("data", (b) => (err += String(b)));
    p.on("close", (code, signal) => {
      const m = out.split("\n").find((l) => l.startsWith("RESULT "));
      resolve({ code, signal, ms: Math.round(performance.now() - t), pid: p.pid ?? 0, ...(code !== 0 && signal === null ? { err: err.split("\n").filter(Boolean).slice(-4).join(" | ") } : {}), ...(m ? { result: JSON.parse(m.slice(7)) as unknown } : {}) });
    });
  });
}
const shopCheck = (syncFile: string, qrHex: string, now: number) => new Promise<{ reason: string; ok: boolean; netAttempts: number; listSize: number }>((resolve, reject) => {
  const p = spawn(process.execPath, ["--import", "tsx", "src/shop-offline.ts", syncFile, qrHex, shop.address, String(now)], { cwd: PKG });
  let out = ""; p.stdout.on("data", (b) => (out += String(b))); p.stderr.on("data", (b) => (out += String(b)));
  p.on("close", () => { const m = out.split("\n").find((l) => l.startsWith("RESULT ")); m ? resolve(JSON.parse(m.slice(7))) : reject(new Error(out.slice(0, 400))); });
});

// ── 台帳から店の同期データを作る（11c と同じ方法） ──
async function syncFromChain(): Promise<SyncedEscrow[]> {
  const list: SyncedEscrow[] = [];
  let marker: unknown;
  do {
    const res = (await client.request({ command: "account_objects", account: shop.address, type: "escrow", ledger_index: "validated", ...(marker ? { marker } : {}) } as never)) as unknown as { result: J };
    for (const o of res.result["account_objects"] as J[]) {
      if (o["Destination"] !== shop.address) continue;
      const tx = flat(((await client.request({ command: "tx", transaction: o["PreviousTxnID"] })) as unknown as { result: J }).result);
      const memo = ((tx.tx["Memos"] as J[] | undefined) ?? []).find((m) => String(m["Memo"]?.["MemoType"]).toUpperCase() === hex(new TextEncoder().encode("todoke/pk-sha256")));
      list.push({ index: o["index"], owner: o["Account"], offerSequence: Number(tx.tx["Sequence"]), destination: shop.address, amount: o["Amount"], condition: o["Condition"], cancelAfter: Number(o["CancelAfter"]), ...(memo ? { pkHash: memo["Memo"]["MemoData"] } : {}), createTx: o["PreviousTxnID"] });
    }
    marker = (res.result as J)["marker"];
  } while (marker);
  return list;
}

// ── 台帳の履歴から、申請の Condition を持つ EscrowCreate を数える（DB は使わない） ──
async function countOnChain(l0: number, conditions: string[]) {
  const info = await chainInfo(client, D.address);
  const l1 = info.validatedIndex;
  const h = await accountHistory(client, D.address, l0, l1);
  const covered = coversRange(info.completeLedgers, l0, l1) && h.complete;
  return Object.fromEntries(conditions.map((c) => {
    const mine = h.txs.map(flat).filter((t) => t.validated && t.tx["TransactionType"] === "EscrowCreate" && t.tx["Account"] === D.address && String(t.tx["Condition"]).toUpperCase() === c);
    const ok = mine.filter((t) => t.meta?.["TransactionResult"] === "tesSUCCESS");
    return [c.slice(8, 24), { 範囲: [l0, l1], 履歴を最後まで読めた: covered, ページ数: h.pages, 成功: ok.map((t) => ({ hash: t.hash, sequence: t.tx["Sequence"], ledger: t.ledger })), 成功の件数: ok.length, 成功のhashの種類: new Set(ok.map((t) => t.hash)).size, tec等の失敗: mine.filter((t) => t.meta?.["TransactionResult"] !== "tesSUCCESS").map((t) => ({ hash: t.hash, result: t.meta?.["TransactionResult"] })), 判定: covered ? "確認済み" : "未確認（履歴不足）" }];
  }));
}

interface CaseOut { id: string; title: string; fault: string; kind: "Testnet実測"; steps: unknown[]; checks: { name: string; ok: boolean }[]; chain: unknown; db: unknown; shop: unknown; l0: number; l1: number; pass: boolean }
const results: CaseOut[] = [];
const want = (id: string) => only.length === 0 || only.includes(id);

async function finish(id: string, title: string, fault: string, l0: number, dbs: string[], hhs: Hh[], steps: unknown[], checks: { name: string; ok: boolean }[], qrs: { hh: Hh; seq: number; label: string; expect: string }[]) {
  const chain = await countOnChain(l0, hhs.map((h) => h.condition));
  const info = await chainInfo(client, D.address);
  const sync = await syncFromChain();
  const syncFile = `${STATE}${id}.sync.json`;
  writeFileSync(syncFile, JSON.stringify(sync));
  const shopRes: unknown[] = [];
  for (const q of qrs) {
    const r = await shopCheck(syncFile, hex(await q.hh.qr(q.seq)), info.closeTime);
    shopRes.push({ 確認: q.label, OfferSequence: q.seq, 期待: q.expect, 判定: r.reason, 通信の試行数: r.netAttempts, 同期データの件数: r.listSize });
    checks.push({ name: `店舗: ${q.label} → ${q.expect}`, ok: r.reason === q.expect && r.netAttempts === 0 });
  }
  for (const h of hhs) {
    const c = (chain as Record<string, { 成功の件数: number; 成功のhashの種類: number; 判定: string }>)[h.condition.slice(8, 24)]!;
    checks.push({ name: `台帳の履歴: 成功した EscrowCreate が 1 件・hash 1 種類（${h.label}）`, ok: c.成功の件数 === 1 && c.成功のhashの種類 === 1 && c.判定 === "確認済み" });
  }
  const snaps = dbs.map((p) => { const db = openDb(p); const s = snapshotOf(db); db.close(); return s; });
  for (const [i, s] of snaps.entries()) checks.push({ name: `DB${i + 1}: 発券記録の件数 = 申請数`, ok: s.issuance.length === hhs.filter((_, k) => dbs.length === 1 || k === i).length });
  const out: CaseOut = { id, title, fault, kind: "Testnet実測", steps, checks, chain, db: snaps, shop: shopRes, l0, l1: info.validatedIndex, pass: checks.every((c) => c.ok) };
  results.push(out);
  console.log(`\n${out.pass ? "合格" : "不合格"} ${id} ${title}\n${checks.map((c) => `  ${c.ok ? "OK  " : "FAIL"} ${c.name}`).join("\n")}`);
  writeFileSync(new URL("../results/testnet.json", import.meta.url), j({ at: new Date().toISOString(), setup, results }));
}
const fresh = (id: string) => { const p = `${STATE}${id}.sqlite`; for (const s of ["", "-wal", "-shm"]) rmSync(p + s, { force: true }); return p; };
const sumW = (w: W) => ({ pid: w.pid, 終了: w.signal ? `シグナル ${w.signal}` : `exit ${w.code}`, ms: w.ms, 結果: w.result });
const attemptsOf = (db: string) => { const d = openDb(db); const s = snapshotOf(d); d.close(); return s; };

// ═════════ C0 正常系 ═════════
if (want("C0")) {
  const id = "C0", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w = await worker(db, "apply", a.file); steps.push({ 操作: "apply（障害なし）", ...sumW(w) });
  const s = attemptsOf(db), seq = s.issuance[0]?.["offer_sequence"] as number;
  await finish(id, "正常系", "なし", l0, [db], [h], steps, [{ name: "確定（confirmed）", ok: s.issuance[0]?.["state"] === "confirmed" }, { name: "送信の試行 1 回", ok: s.attempts.reduce((n, x) => n + Number(x["submit_count"]), 0) === 1 }], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C1 送信前停止 ═════════
if (want("C1")) {
  const id = "C1", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w1 = await worker(db, "apply", a.file, { FAULT: "after_prepare" }); steps.push({ 操作: "apply（署名済み取引を保存した直後、送信前に SIGKILL）", ...sumW(w1) });
  const s1 = attemptsOf(db), hash = s1.attempts[0]?.["tx_hash"] as string;
  const q = await queryTx(client, hash, l0, (await chainInfo(client, D.address)).validatedIndex);
  steps.push({ 停止直後のDB: { 発券記録: s1.issuance.map((x) => x["state"]), 試行: s1.attempts.map((x) => ({ state: x["state"], 送信回数: x["submit_count"], hash: x["tx_hash"], sequence: x["sequence"], lls: x["last_ledger_sequence"] })) }, 台帳に取引はあるか: q.found });
  const w2 = await worker(db, "recover"); steps.push({ 操作: "recover（再起動）", ...sumW(w2) });
  const s2 = attemptsOf(db), seq = s2.issuance[0]?.["offer_sequence"] as number;
  await finish(id, "送信前停止", "after_prepare（保存後・送信前）", l0, [db], [h], steps, [
    { name: "停止時: 送信 0 回・台帳に取引なし", ok: s1.attempts[0]?.["submit_count"] === 0 && !q.found },
    { name: "復旧後: 同じ hash で確定・試行は 1 つ", ok: s2.issuance[0]?.["state"] === "confirmed" && s2.attempts.length === 1 && s2.attempts[0]?.["tx_hash"] === hash },
  ], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C2 送信直後の応答喪失【最優先】 ═════════
if (want("C2")) {
  const id = "C2", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w1 = await worker(db, "apply", a.file, { FAULT: "after_submit_response" }); steps.push({ 操作: "apply（Testnet へ送信し、応答がソケットに届いた直後・DB 更新前に SIGKILL）", ...sumW(w1) });
  const s1 = attemptsOf(db), hash = s1.attempts[0]?.["tx_hash"] as string;
  steps.push({ 停止直後のDB: { 発券記録: s1.issuance.map((x) => x["state"]), 試行: s1.attempts.map((x) => ({ state: x["state"], 送信回数: x["submit_count"], 最後のengine_result: x["last_engine_result"], hash: x["tx_hash"], sequence: x["sequence"], lls: x["last_ledger_sequence"] })) } });
  const a2 = await h.writeApp("2"); // 世帯の再送（証明は作り直し。元の鍵・preimage・申請内容のまま）
  steps.push({ 世帯の再送: "同じ申請（同じ鍵・preimage）を、新しく作った証明で再送", 証明のバイト列は初回と同じか: a2.proofHex === a.proofHex });
  const w2 = await worker(db, "apply", a2.file); steps.push({ 操作: "apply（世帯の再送を新しいプロセスが受ける）", ...sumW(w2) });
  const s2 = attemptsOf(db), seq = s2.issuance[0]?.["offer_sequence"] as number;
  await finish(id, "送信直後の応答喪失", "after_submit_response（送信済み・応答受領後・DB 更新前）", l0, [db], [h], steps, [
    { name: "停止時: 送信 1 回・DB は submitting のまま（台帳の結果を DB は知らない）", ok: s1.attempts[0]?.["state"] === "submitting" && s1.attempts[0]?.["submit_count"] === 1 && s1.attempts[0]?.["last_engine_result"] === null },
    { name: "復旧後: 確定。成功 hash は最初の取引と同じ", ok: s2.issuance[0]?.["state"] === "confirmed" && s2.issuance[0]?.["confirmed_tx"] === hash },
    { name: "試行は 1 つ（新しい取引を作っていない）", ok: s2.attempts.length === 1 },
    { name: "発券記録は 1 件（世帯の再送は replay）", ok: s2.issuance.length === 1 && s2.events.some((e) => e["event"] === "apply_replay") },
  ], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C3 確定後・DB 更新前停止 ═════════
if (want("C3")) {
  const id = "C3", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w1 = await worker(db, "apply", a.file, { FAULT: "after_validated_before_confirm" }); steps.push({ 操作: "apply（validated 成功を観測した直後・DB 確定の前に SIGKILL）", ...sumW(w1) });
  const s1 = attemptsOf(db), hash = s1.attempts[0]?.["tx_hash"] as string;
  steps.push({ 停止直後のDB: { 発券記録: s1.issuance.map((x) => x["state"]), 試行: s1.attempts.map((x) => ({ state: x["state"], 送信回数: x["submit_count"], hash: x["tx_hash"] })) } });
  const w2 = await worker(db, "recover"); steps.push({ 操作: "recover（照会だけで DB を直す）", ...sumW(w2) });
  const s2 = attemptsOf(db), seq = s2.issuance[0]?.["offer_sequence"] as number;
  const subs = s2.attempts.reduce((n, x) => n + Number(x["submit_count"]), 0);
  await finish(id, "確定後・DB 更新前停止", "after_validated_before_confirm", l0, [db], [h], steps, [
    { name: "停止時: DB は未確定（submitting）", ok: s1.attempts[0]?.["state"] === "submitting" && s1.issuance[0]?.["state"] === "approved" },
    { name: "復旧後: 確定。hash は同じ", ok: s2.issuance[0]?.["state"] === "confirmed" && s2.issuance[0]?.["confirmed_tx"] === hash },
    { name: "復旧で送信していない（送信回数の合計は最初の 1 回のまま）", ok: subs === 1 && s2.attempts.length === 1 },
  ], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C4a 同一申請を 2 プロセスで同時処理 ═════════
if (want("C4a")) {
  const id = "C4a", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const [w1, w2] = await Promise.all([worker(db, "apply", a.file), worker(db, "apply", a.file)]);
  steps.push({ 操作: "同じ DB を開く 2 プロセスが同じ申請を同時に処理", プロセス1: sumW(w1), プロセス2: sumW(w2) });
  const w3 = await worker(db, "recover"); steps.push({ 操作: "recover（念のため）", ...sumW(w3) });
  const s = attemptsOf(db), seq = s.issuance[0]?.["offer_sequence"] as number;
  await finish(id, "ワーカー競合（同一申請）", "なし（2 プロセスの同時処理）", l0, [db], [h], steps, [
    { name: "発券記録 1 件・確定", ok: s.issuance.length === 1 && s.issuance[0]?.["state"] === "confirmed" },
    { name: "試行は 1 つ", ok: s.attempts.length === 1 },
  ], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C4b 異なる 2 申請が配布口座を共有 ═════════
if (want("C4b")) {
  const id = "C4b", db = fresh(id), h1 = await household(id + "a"), h2 = await household(id + "b");
  const a1 = await h1.writeApp("1"), a2 = await h2.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const [w1, w2] = await Promise.all([worker(db, "apply", a1.file), worker(db, "apply", a2.file)]);
  steps.push({ 操作: "同じ DB・同じ配布口座 D を使う 2 プロセスが、異なる 2 申請を同時に処理", プロセス1: sumW(w1), プロセス2: sumW(w2) });
  const w3 = await worker(db, "recover"); steps.push({ 操作: "recover", ...sumW(w3) });
  const s = attemptsOf(db);
  const seqs = s.attempts.map((x) => Number(x["sequence"]));
  // 各申請の確定 OfferSequence が、台帳上のその Condition の EscrowCreate の Sequence と一致するか
  const hist = await accountHistory(client, D.address, l0, (await chainInfo(client, D.address)).validatedIndex);
  const seqOnChain = (h: Hh) => flat(hist.txs.find((t) => flat(t).tx["Condition"]?.toString().toUpperCase() === h.condition)!).tx["Sequence"];
  const db2 = openDb(db);
  const offerOf = (h: Hh) => (db2.prepare("SELECT offer_sequence FROM issuance WHERE condition_hex=?").get(h.condition) as { offer_sequence: number }).offer_sequence;
  const o1 = offerOf(h1), o2 = offerOf(h2); db2.close();
  steps.push({ "確定した OfferSequence": { 申請1: o1, 申請2: o2 }, "台帳上の Sequence": { 申請1: seqOnChain(h1), 申請2: seqOnChain(h2) }, "試行の Sequence": seqs });
  await finish(id, "ワーカー競合（異なる 2 申請・配布口座共有）", "なし（2 プロセス・Sequence 採番の競合）", l0, [db], [h1, h2], steps, [
    { name: "2 件とも確定", ok: s.issuance.length === 2 && s.issuance.every((x) => x["state"] === "confirmed") },
    { name: "試行の Sequence が重ならない", ok: new Set(seqs).size === seqs.length },
    { name: "確定 OfferSequence = 台帳上のその申請の Sequence（取り違えなし）", ok: o1 === seqOnChain(h1) && o2 === seqOnChain(h2) && o1 !== o2 },
  ], [{ hh: h1, seq: o1, label: "申請1 の元鍵の QR", expect: "使える" }, { hh: h2, seq: o2, label: "申請2 の元鍵の QR", expect: "使える" }, { hh: h1, seq: o2, label: "申請1 の鍵・preimage で、申請2 の OfferSequence に署名した QR", expect: "preimage が条件と合わない" }]);
}
// ═════════ C5 LastLedgerSequence 切れ ═════════
if (want("C5")) {
  const id = "C5", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w1 = await worker(db, "apply", a.file, { STOP_AFTER_PREPARE: "1", LLS_OFFSET: "2" }); steps.push({ 操作: "apply（署名済み取引を LastLedgerSequence = validated+2 で保存し、送信せず正常終了）", ...sumW(w1) });
  const s1 = attemptsOf(db), att = s1.attempts[0]!;
  for (;;) { const ix = (await chainInfo(client, D.address)).validatedIndex; if (ix > Number(att["last_ledger_sequence"])) { steps.push({ 待機: `validated=${ix} が LastLedgerSequence=${att["last_ledger_sequence"]} を越えた` }); break; } await waitMs(2000); }
  const w2 = await worker(db, "recover"); steps.push({ 操作: "recover（旧取引の不成立を照会で確定 → 新しい試行）", ...sumW(w2) });
  const s2 = attemptsOf(db), seq = s2.issuance[0]?.["offer_sequence"] as number;
  const old = await queryTx(client, att["tx_hash"] as string, Number(att["first_ledger"]), (await chainInfo(client, D.address)).validatedIndex);
  steps.push({ 旧hashを最後に照会: old.found ? "見つかった" : { 見つからない: true, searched_all: old.searchedAll } });
  await finish(id, "有効ledger期限切れ（未送信のまま）", "STOP_AFTER_PREPARE（未送信）+ LLS_OFFSET=2", l0, [db], [h], steps, [
    { name: "旧取引: 送信 0 回、failed_final。根拠（範囲・searched_all・履歴の連続性）を保存", ok: s2.attempts[0]?.["state"] === "failed_final" && s2.attempts[0]?.["submit_count"] === 0 && String(s2.attempts[0]?.["evidence"]).includes('"absentBy"') },
    { name: "新しい試行で 1 枚確定（別 hash）", ok: s2.attempts.length === 2 && s2.issuance[0]?.["state"] === "confirmed" && s2.attempts[1]?.["tx_hash"] !== att["tx_hash"] },
    { name: "旧 hash は最後まで台帳に現れない", ok: !old.found },
  ], [{ hh: h, seq, label: "元の鍵で署名した QR", expect: "使える" }]);
}
// ═════════ C6 Sequence 競合 ═════════
if (want("C6")) {
  const id = "C6", db = fresh(id), h = await household(id), a = await h.writeApp("1");
  const l0 = (await chainInfo(client, D.address)).validatedIndex, steps: unknown[] = [];
  const w1 = await worker(db, "apply", a.file, { STOP_AFTER_PREPARE: "1" }); steps.push({ 操作: "apply（署名済み取引を保存し、送信せず正常終了）", ...sumW(w1) });
  const s1 = attemptsOf(db), att = s1.attempts[0]!;
  const pay = await submitAndLog(client, "別の正規の取引（D → 店 1 drop）", { TransactionType: "Payment", Account: D.address, Destination: shop.address, Amount: "1" }, D);
  steps.push({ 競合取引: { hash: pay.hash, sequence: pay.sequence, engine_result: pay.engineResult, "予定していた Sequence": att["sequence"] } });
  const w2 = await worker(db, "recover"); steps.push({ 操作: "recover（元取引は送れるか → 不成立の根拠 → 再採番）", ...sumW(w2) });
  const s2 = attemptsOf(db), seq = s2.issuance[0]?.["offer_sequence"] as number;
  const ev = s2.attempts[0]?.["evidence"] ? JSON.parse(String(s2.attempts[0]?.["evidence"])) as J : undefined;
  await finish(id, "Sequence 競合", "別の正規の取引が予定 Sequence を先に消費", l0, [db], [h], steps, [
    { name: "競合取引が予定 Sequence を消費した", ok: pay.sequence === att["sequence"] && pay.engineResult === "tesSUCCESS" },
    { name: "旧取引の不成立: Sequence 消費元 = 競合取引（hash 一致）", ok: ev?.["reason"] === "sequence_consumed_by_other" && ev?.["sequenceConsumedBy"]?.["hash"] === pay.hash },
    { name: "再採番して確定（OfferSequence が変わった）", ok: s2.issuance[0]?.["state"] === "confirmed" && seq !== Number(att["sequence"]) && s2.attempts.length === 2 },
  ], [{ hh: h, seq, label: "元の鍵で、確定した OfferSequence に署名した QR", expect: "使える" }, { hh: h, seq: Number(att["sequence"]), label: "元の鍵で、旧 OfferSequence（競合で失われた値）に署名した QR", expect: "このお店宛ての券ではない（または未同期）" }]);
}
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} ケース合格`);
await zk.close();
await client.disconnect();
if (results.some((r) => !r.pass)) process.exitCode = 1;
