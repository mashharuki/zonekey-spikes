/**
 * spike 13: 世帯の固定アドレスを公開せずに店舗券を発行できるか（ローカル検証。XRPL は模擬台帳）
 *   pnpm --filter 13-zk-bound-voucher test     （= run.ts → offline.ts）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { encodeVoucher, rippleNow, signVoucher, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";
import { Issuer, type IssuedRecord, type Program } from "./issuer.js";
import { type Req, digestToFields, encodeRequest, fieldHex, fmtUnits, hex, requestDigest, sha256, syntheticAccount, syntheticField, toUnits } from "./lib.js";
import { Roster, type Household } from "./roster.js";
import { PUBLIC_NAMES, type Statement, type Witness, Zk, expectedPublicInputs } from "./zk.js";

const out = (p: string) => new URL(`../${p}`, import.meta.url);
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
interface Row { id: string; item: string; expected: string; actual: string; ok: boolean; evidence: string }
const rows: Row[] = [];
const row = (id: string, item: string, expected: string, actual: string, evidence = "") => {
  const ok = expected === actual;
  rows.push({ id, item, expected, actual, ok, evidence });
  console.log(`${ok ? "OK  " : "FAIL"} ${id} ${item}: 期待=${expected} 実際=${actual}${evidence ? ` (${evidence})` : ""}`);
};
const proveMs: number[] = [], verifyMs: number[] = [];

// ---------- 登場人物（すべて合成） ----------
const zk = new Zk();
await zk.init();
const subtle = globalThis.crypto.subtle;
const mkHh = async (id: string, zone: number, senior: boolean, revictim: boolean, tier: number, name: string, address: string): Promise<Household> => ({
  id, secret: await syntheticField(`hh-secret|${id}`), salt: await syntheticField(`salt|${id}`), zone: BigInt(zone), senior, revictim, tier, profile: { name, address },
});
const members = [
  await mkHh("H1", 13101, true, true, 3, "合成 一郎", "架空県架空市1-1"),
  await mkHh("H2", 13102, true, false, 2, "合成 二郎", "架空県架空市2-2"),
  await mkHh("H3", 27100, true, true, 3, "合成 三郎（対象ゾーン外）", "架空県架空市3-3"),
  await mkHh("H4", 13101, true, true, 1, "合成 四郎（区分が低い）", "架空県架空市4-4"),
  await mkHh("H5", 13103, false, true, 3, "合成 五郎（高齢者でない）", "架空県架空市5-5"),
  await mkHh("H6", 13101, true, true, 3, "合成 六郎", "架空県架空市6-6"),
  await mkHh("H7", 13101, true, true, 3, "合成 七郎", "架空県架空市7-7"),
  await mkHh("H8", 13101, true, true, 3, "合成 八郎", "架空県架空市8-8"),
  await mkHh("H10", 13101, true, true, 3, "合成 十郎", "架空県架空市10-10"),
];
const hh = Object.fromEntries(members.map((m, i) => [m.id, { ...m, index: i }])) as Record<string, Household & { index: number }>;
const roster = await new Roster(members).build(zk);

const [dCounty, dNgo, shopA, shopB, assetIssuer] = await Promise.all(["D-pref", "D-ngo", "shop-A", "shop-B", "asset-issuer"].map(syntheticAccount)) as [string, string, string, string, string];
const pid = async (l: string) => syntheticField(`program|${l}`);
const countyId = await pid("pref"), ngoId = await pid("ngo");
const pad = (zs: number[]) => Array.from({ length: 8 }, (_, i) => BigInt(zs[i] ?? zs[0]!)); // 余った枠は先頭の対象ゾーンの重複で埋める
const programs = new Map<bigint, Program>([
  [countyId, { id: countyId, name: "県", owner: dCounty, currency: "ZKV", issuer: assetIssuer, allowedValues: [toUnits("5"), toUnits("10")], allowedShops: new Set([shopA, shopB]), stmt: { zoneSet: pad([13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108]), needSenior: true, needRevictim: false, minTier: 2 } }],
  [ngoId, { id: ngoId, name: "NGO", owner: dNgo, currency: "ZKV", issuer: assetIssuer, allowedValues: [toUnits("5"), toUnits("10")], allowedShops: new Set([shopA, shopB]), stmt: { zoneSet: pad([13101, 13102, 13103, 13104]), needSenior: false, needRevictim: true, minTier: 1 } }],
]);
const county = programs.get(countyId)!, ngo = programs.get(ngoId)!;
const issuer = new Issuer(zk, programs, new Set([roster.root]), () => rippleNow());
const stmtOf = (p: Program, root = roster.root): Statement => ({ ...p.stmt, root, programId: p.id });

// ---------- 世帯端末の処理 ----------
async function newDevice() {
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const preimage = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return { kp, pub, preimage, pkHash: hex(await sha256(pub)), conditionHash: hex(await sha256(preimage)) };
}
type Device = Awaited<ReturnType<typeof newDevice>>;
async function application(h: Household & { index: number }, p: Program, o: { shop?: string; value?: string; device?: Device; cancelAfter?: number; root?: bigint; stmt?: Statement; siblings?: bigint[]; w?: Partial<Witness> } = {}) {
  const device = o.device ?? (await newDevice());
  const req: Req = { programId: p.id, owner: p.owner, shop: o.shop ?? shopA, currency: p.currency, issuer: p.issuer, valueUnits: toUnits(o.value ?? "5"), cancelAfter: o.cancelAfter ?? rippleNow() + 7 * 86400, pkHash: device.pkHash, conditionHash: device.conditionHash };
  const digest = await requestDigest(req);
  const d = await zk.derive({ hhSecret: o.w?.hhSecret ?? h.secret, programId: p.id, zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, salt: h.salt, digest });
  const w: Witness = { zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, hhSecret: h.secret, salt: h.salt, index: h.index, siblings: o.siblings ?? roster.path(h.index), ...o.w };
  const inputs = zk.inputs(o.stmt ?? stmtOf(p, o.root), w, digest, d.nullifier, d.tag);
  return { req, device, digest, d, inputs };
}
const prove = async (a: { inputs: Parameters<Zk["prove"]>[0] }) => { const p = await zk.prove(a.inputs); proveMs.push(p.proveMs); return p; };
async function qrOf(rec: IssuedRecord, dev: Device, signWith: Device = dev) {
  return encodeVoucher({ owner: rec.owner, offerSequence: rec.offerSequence, preimage: dev.preimage, sig: { pub: signWith.pub, sig: await signVoucher(signWith.kp.privateKey, rec.owner, rec.offerSequence, rec.shop) } });
}
const reqOfRecord = (r: IssuedRecord): Req => ({ programId: BigInt(r.programId), owner: r.owner, shop: r.shop, currency: r.amount.currency, issuer: r.amount.issuer, valueUnits: toUnits(r.amount.value), cancelAfter: r.cancelAfter, pkHash: r.pkHash, conditionHash: r.condition.slice(8, 72) });
const tryExec = async (inputs: Parameters<Zk["execute"]>[0]) => { try { await zk.execute(inputs); return "実行できた"; } catch (e) { return `失敗: ${String((e as Error).message).split("\n")[0]}`; } };

// ================= 0. 固定ベクトル（バイト列 ⇄ Field）=================
{
  const r: Req = {
    programId: 0x9001n, owner: await syntheticAccount("vec-owner"), shop: await syntheticAccount("vec-shop"), currency: "ZKV", issuer: await syntheticAccount("vec-issuer"),
    valueUnits: 5_000_000n, cancelAfter: 900_000_000, pkHash: "11".repeat(32), conditionHash: "22".repeat(32),
  };
  const bytes = encodeRequest(r), digest = await requestDigest(r), f = digestToFields(digest);
  const d = await zk.derive({ hhSecret: 1n, programId: r.programId, zone: 1n, senior: true, revictim: true, tier: 1, salt: 1n, digest });
  const vec = { request: { ...r, programId: "0x9001" }, encodedBytesHex: hex(bytes), encodedLength: bytes.length, sha256Hex: hex(digest), req_hi_ts: fieldHex(f.hi), req_lo_ts: fieldHex(f.lo), req_hi_noir: fieldHex(d.hi), req_lo_noir: fieldHex(d.lo) };
  mkdirSync(out("vectors/"), { recursive: true });
  writeFileSync(out("vectors/bytes-field.json"), j(vec));
  row("V0", "固定ベクトル: SHA-256 の上位・下位 16B → Field が TS と Noir で一致", "true", String(d.hi === f.hi && d.lo === f.lo), `sha256=${hex(digest)} hi=${fieldHex(f.hi)} lo=${fieldHex(f.lo)}`);
  row("V0", "固定ベクトル: 申請の正規バイト列の長さ", "191", String(bytes.length), "vectors/bytes-field.json");
}

// ================= 1. H1 が県に初回申請 =================
const dev = { h1County: await newDevice() };
const a1 = await application(hh["H1"]!, county, { shop: shopA, value: "5", device: dev.h1County });
const p1 = await prove(a1);
const v1 = await zk.verify(p1); verifyMs.push(v1.ms);
row("T1", "H1→県: 実際の証明を生成し、検証器が受理", "true", String(v1.ok), `証明 ${p1.proof.length} B / 公開入力 ${p1.publicInputs.length} 個 / prove ${p1.proveMs} ms / verify ${v1.ms} ms`);
const r1 = await issuer.issue(a1.req, p1);
row("T1", "H1→県: 発券 1 枚", "created", r1.ok ? r1.status : `reject:${r1.reason}`, `台帳の記録 ${issuer.count()} 件`);
if (!r1.ok) throw new Error("T1 で止まった");
const rec1 = r1.record;
row("T1", "発券された内容から作り直した申請ダイジェスト = 証明の公開入力", "true", String(((): boolean => { const f = digestToFields(a1.digest); return BigInt(p1.publicInputs[PUBLIC_NAMES.indexOf("req_hi")]!) === f.hi && BigInt(p1.publicInputs[PUBLIC_NAMES.indexOf("req_lo")]!) === f.lo; })()), "発券前の申請と証明の対応");
row("T1", "発券記録から再構成した申請のダイジェスト = 発券前の申請のダイジェスト", "true", String(hex(await requestDigest(reqOfRecord(rec1))) === hex(a1.digest)), "実際に発行される券の内容が証明の結び付け先と同じ");

// ================= 2. H1 が県へ別の鍵で再申請 =================
const a2 = await application(hh["H1"]!, county, { shop: shopA, value: "5" }); // 新しい端末鍵・新しい preimage
const p2 = await prove(a2);
const v2 = await zk.verify(p2); verifyMs.push(v2.ms);
row("T2", "H1→県（別の鍵）: 証明は有効（回路は同じ世帯を拒まない）", "true", String(v2.ok), "止めるのは発券側の nullifier 照合");
row("T2", "同じ制度の nullifier が一致", "true", String(a1.d.nullifier === a2.d.nullifier), `nullifier=${fieldHex(a1.d.nullifier)}`);
row("T2", "別の鍵（pkHash・Condition）になっている", "true", String(a1.req.pkHash !== a2.req.pkHash && a1.req.conditionHash !== a2.req.conditionHash), "");
const r2 = await issuer.issue(a2.req, p2);
row("T2", "新しい券は 0 枚", "reject:duplicate", r2.ok ? "issued" : `reject:${r2.stage}`, r2.ok ? "" : r2.reason);
row("T2", "県×H1 の記録数", "1", String(issuer.count(county.id, a1.d.nullifier)), "");

// ================= 3. H1→NGO、H2→県 =================
const devNgo = await newDevice();
const a3 = await application(hh["H1"]!, ngo, { shop: shopA, value: "10", device: devNgo });
const p3 = await prove(a3); const v3 = await zk.verify(p3); verifyMs.push(v3.ms);
const r3 = await issuer.issue(a3.req, p3);
row("T3", "H1→NGO: 発券 1 枚", "created", r3.ok ? r3.status : `reject:${r3.reason}`, "");
row("T3", "H1 の県と NGO の nullifier は別の値", "true", String(a1.d.nullifier !== a3.d.nullifier), `県=${fieldHex(a1.d.nullifier).slice(0, 14)}… NGO=${fieldHex(a3.d.nullifier).slice(0, 14)}…`);
const devH2 = await newDevice();
const a4 = await application(hh["H2"]!, county, { shop: shopB, value: "5", device: devH2 });
const p4 = await prove(a4); const v4 = await zk.verify(p4); verifyMs.push(v4.ms);
const r4 = await issuer.issue(a4.req, p4);
row("T3", "H2→県（店 B）: 発券 1 枚", "created", r4.ok ? r4.status : `reject:${r4.reason}`, "");
row("T3", "ここまでの記録数（H1県・H1NGO・H2県）", "3", String(issuer.count()), "");
if (!r3.ok || !r4.ok) throw new Error("T3 で止まった");
const rec3 = r3.record, rec4 = r4.record;

// ================= 4. 同時申請・応答喪失・再試行 =================
{
  const h = hh["H6"]!;
  const a = await application(h, county);
  const p = await prove(a);
  const rs = await Promise.all(Array.from({ length: 8 }, () => issuer.issue(a.req, p)));
  const created = rs.filter((x) => x.ok && x.status === "created").length, replayed = rs.filter((x) => x.ok && x.status === "replayed").length;
  const seqs = new Set(rs.map((x) => (x.ok ? x.record.offerSequence : -1)));
  row("T4a", "同じ申請を 8 件同時に送る: created / replayed", "1 / 7", `${created} / ${replayed}`, "");
  row("T4a", "返った券の OfferSequence は 1 種類", "1", String(seqs.size), [...seqs].join(","));
  row("T4a", "H6×県 の記録数", "1", String(issuer.count(county.id, a.d.nullifier)), "");
}
{
  const h = hh["H7"]!;
  const a = await application(h, county), b = await application(h, county);
  const [pa, pb] = await Promise.all([prove(a), prove(b)]);
  const calls = [a, b, a, b, a, b, a, b].map((x, i) => issuer.issue(x.req, i % 2 === 0 ? pa : pb));
  const rs = await Promise.all(calls);
  const created = rs.filter((x) => x.ok && x.status === "created").length, dup = rs.filter((x) => !x.ok && x.stage === "duplicate").length, replayed = rs.filter((x) => x.ok && x.status === "replayed").length;
  row("T4b", "別の鍵 2 種×4 件を同時に送る: created / replayed / duplicate", "1 / 3 / 4", `${created} / ${replayed} / ${dup}`, "先に入った鍵だけが発券される。どちらが先かは実行ごとに変わりうる");
  row("T4b", "H7×県 の記録数", "1", String(issuer.count(county.id, a.d.nullifier)), "");
}
{
  const h = hh["H8"]!;
  const a = await application(h, county);
  const p = await prove(a);
  issuer.dropResponseAfterCommit = 1;
  let threw = "応答あり";
  try { await issuer.issue(a.req, p); } catch (e) { threw = (e as Error).message; }
  row("T4c", "発券記録を作った後に応答を返せない", "response lost（コミット済み・応答なし）", threw, `記録数 ${issuer.count(county.id, a.d.nullifier)}`);
  const pRe = await prove(a); // 同じ申請の再試行（証明は作り直し。ZK の証明は毎回別のバイト列）
  const rr = await issuer.issue(a.req, pRe);
  row("T4c", "再試行（証明を作り直す）で最初の結果が返る", "replayed", rr.ok ? rr.status : `reject:${rr.reason}`, `証明のバイト列は初回と同じか: ${hex(p.proof) === hex(pRe.proof)}`);
  const first = issuer.db.prepare("SELECT offer_sequence, condition_hex, pk_hash FROM issued WHERE program_id=? AND nullifier=?").get(county.id.toString(), a.d.nullifier.toString()) as { offer_sequence: number; condition_hex: string; pk_hash: string };
  row("T4c", "返った券は最初の記録と同一（OfferSequence・Condition・鍵ハッシュ）", "true", String(rr.ok && rr.record.offerSequence === first.offer_sequence && rr.record.condition === first.condition_hex && rr.record.pkHash === first.pk_hash), "");
  row("T4c", "H8×県 の記録数", "1", String(issuer.count(county.id, a.d.nullifier)), "");
  const aNew = await application(h, county);
  const rn = await issuer.issue(aNew.req, await prove(aNew));
  row("T4d", "応答喪失の後、端末が鍵を失って別の鍵で申請 → 矛盾する券は出さない", "reject:duplicate", rn.ok ? "issued" : `reject:${rn.stage}`, "世帯が鍵を失うと、その制度では回復できない（REPORT の未解決）");
}
{
  // 台帳（模擬）への送信が途中で落ちる
  issuer.crashSubmit = "before";
  let e1 = "落ちなかった"; try { await issuer.submitPending(); } catch (e) { e1 = (e as Error).message; }
  row("T4e", "送信前に落ちる: 台帳 0 件・記録は approved のまま", "crash before submit / 0", `${e1} / ${issuer.mockEscrowCount()}`, "");
  issuer.crashSubmit = "afterInsert";
  let e2 = "落ちなかった"; try { await issuer.submitPending(); } catch (e) { e2 = (e as Error).message; }
  const mid = issuer.mockEscrowCount();
  const n = await issuer.submitPending();
  const total = issuer.count();
  row("T4e", "台帳に書いた後・状態更新前に落ちた後の再送: 台帳の件数 = 記録の件数（二重 Escrow なし）", `${total}`, `${issuer.mockEscrowCount()}`, `途中で台帳 ${mid} 件 / 再送で状態更新 ${n} 件 / ${e2}`);
  row("T4e", "全記録が submitted", "0", String((issuer.db.prepare("SELECT COUNT(*) c FROM issued WHERE state='approved'").get() as { c: number }).c), "approved が残っていない");
}

// ================= 5. 対象外の世帯・承認されていない名簿 root =================
for (const [id, label, expect] of [["H3", "対象ゾーン外", "zone not in zone_set"], ["H4", "区分が最低未満", "tier below min_tier"], ["H5", "高齢者でない", "senior required"]] as const) {
  const a = await application(hh[id]!, county);
  const m = await tryExec(a.inputs);
  row("T5", `${id}（${label}）: 回路が証明を作らせない`, `失敗: ${expect}`, m.includes(expect) ? `失敗: ${expect}` : m, "止まった場所: 回路（実行）");
  const r = await issuer.issue(a.req, await zk.prove(a.inputs).catch(() => ({ proof: new Uint8Array(), publicInputs: [] as string[] })) as never);
  row("T5", `${id}: 証明なしで発券側へ送っても発券 0 枚`, "reject", r.ok ? "issued" : "reject", r.ok ? "" : `${r.stage}: ${r.reason}`);
}
{
  // H3 が対象ゾーンを自分のゾーンに書き換えた条件で証明を作る → 回路・検証器は通るが、発券側が制度の条件と照合して止める
  const forged = { ...stmtOf(county), zoneSet: pad([27100]) };
  const a = await application(hh["H3"]!, county, { stmt: forged });
  const p = await prove(a); const v = await zk.verify(p); verifyMs.push(v.ms);
  const r = await issuer.issue(a.req, p);
  row("T5", "H3: 対象ゾーンを自分のゾーンに書き換えた証明 → 回路と検証器は通る", "true", String(v.ok), "証明は「その条件を満たす」ことしか言わない");
  row("T5", "H3: 書き換えた条件は発券側が止める", "reject:public_input", r.ok ? "issued" : `reject:${r.stage}`, r.ok ? "" : r.reason);
}
{
  // 発券側が承認していない名簿（攻撃者が自分で作った名簿に、自分だけを載せる）
  const rogue: Household = { ...(await mkHh("R1", 13101, true, true, 3, "合成 偽名簿", "架空")) };
  const rogueRoster = await new Roster([rogue]).build(zk);
  const a = await application({ ...rogue, index: 0 }, county, { root: rogueRoster.root, siblings: rogueRoster.path(0) });
  const p = await prove(a); const v = await zk.verify(p); verifyMs.push(v.ms);
  const r = await issuer.issue(a.req, p);
  row("T5", "未承認の名簿 root: 回路と検証器は通る", "true", String(v.ok), "検証器は root が正規かを知らない");
  row("T5", "未承認の名簿 root: 発券側が止める", "reject:root", r.ok ? "issued" : `reject:${r.stage}`, r.ok ? "" : r.reason);
  // 登録されていない秘密（H1 の経路と属性をそのまま使い、秘密だけ別の値）
  const a2b = await application(hh["H1"]!, county, { w: { hhSecret: await syntheticField("not-registered") } });
  const m = await tryExec(a2b.inputs);
  row("T5", "登録されていない秘密（H1 の経路を流用）: 回路が止める", "失敗: merkle root mismatch", m.includes("merkle root mismatch") ? "失敗: merkle root mismatch" : m, "止まった場所: 回路（実行）");
}
{
  // 他人の申請内容に結び付けた証明は作れない: tag を別の値にすると回路が止める
  const a = await application(hh["H10"]!, county);
  const bad = { ...a.inputs, req_tag: fieldHex(a.d.tag + 1n) };
  const m = await tryExec(bad);
  row("T5", "req_tag を書き換える: 回路が止める", "失敗: request tag mismatch", m.includes("request tag mismatch") ? "失敗: request tag mismatch" : m, "");
  // hh_secret を知らない者が、H10 の申請内容に合う tag を作れるか: 公開値だけで作った tag は合わない
  const other = await application(hh["H10"]!, county, { w: { hhSecret: await syntheticField("attacker") } });
  const forgedIn = { ...a.inputs, req_tag: fieldHex(other.d.tag), nullifier: fieldHex(other.d.nullifier) };
  const m2 = await tryExec(forgedIn);
  row("T5", "秘密を知らない者が自分の秘密で作った tag・nullifier を H10 の葉に付ける: 回路が止める", "失敗", m2.startsWith("失敗") ? "失敗" : m2, m2);
}

// ================= 6. 承認済み申請と発券先の不一致 =================
{
  const a = await application(hh["H10"]!, county, { shop: shopA, value: "5" });
  const p = await prove(a);
  const other = await newDevice();
  const otherCond = hex(await sha256(globalThis.crypto.getRandomValues(new Uint8Array(32))));
  const variants: [string, Partial<Req>, string][] = [
    ["受取鍵（pkHash）", { pkHash: other.pkHash }, "public_input"],
    ["店（shop）", { shop: shopB }, "public_input"],
    ["額面（value 5→10）", { valueUnits: toUnits("10") }, "public_input"],
    ["期限（cancelAfter +1 時間）", { cancelAfter: a.req.cancelAfter + 3600 }, "public_input"],
    ["Condition（conditionHash）", { conditionHash: otherCond }, "public_input"],
    ["持ち主（owner = NGO の D）", { owner: dNgo }, "policy"],
    ["資産の発行者（issuer）", { issuer: await syntheticAccount("evil-issuer") }, "policy"],
    ["制度（program_id = NGO）", { programId: ngoId }, "policy"],
  ];
  for (const [name, change, stage] of variants) {
    const r2 = { ...a.req, ...change };
    const res = await issuer.issue(r2, p);
    row("T6", `${name}を変えた申請 + 元の証明 → 拒否`, `reject:${stage}`, res.ok ? "issued" : `reject:${res.stage}`, res.ok ? "" : res.reason);
    if (stage === "public_input") {
      // 公開入力の req_hi / req_lo を変えた申請に合わせて書き換えても、証明が合わない
      const f = digestToFields(await requestDigest(r2));
      const pi = [...p.publicInputs];
      pi[PUBLIC_NAMES.indexOf("req_hi")] = fieldHex(f.hi); pi[PUBLIC_NAMES.indexOf("req_lo")] = fieldHex(f.lo);
      const res2 = await issuer.issue(r2, { ...p, publicInputs: pi });
      row("T6", `${name}: 公開入力を書き換えて合わせる → 検証器が拒否`, "reject:proof", res2.ok ? "issued" : `reject:${res2.stage}`, res2.ok ? "" : res2.reason);
    }
  }
  {
    // 128 ビットを超える表現（hi + 2^128）は、回路では強制していないので、発券側の完全一致の照合で止まることを確かめる
    const pi = [...p.publicInputs];
    pi[PUBLIC_NAMES.indexOf("req_hi")] = fieldHex(BigInt(pi[PUBLIC_NAMES.indexOf("req_hi")]!) + 2n ** 128n);
    const res = await issuer.issue(a.req, { ...p, publicInputs: pi });
    row("T6", "req_hi を hi + 2^128 に書き換えた公開入力 → 発券側の照合が拒否", "reject:public_input", res.ok ? "issued" : `reject:${res.stage}`, res.ok ? "" : res.reason);
  }
  row("T6", "拒否のあと H10 の記録は 0 件（途中で何も作られない）", "0", String(issuer.count(county.id, a.d.nullifier)), "");
  const ok = await issuer.issue(a.req, p);
  row("T6", "元の申請 + 元の証明 → 発券", "created", ok.ok ? ok.status : `reject:${ok.reason}`, "");
  if (ok.ok) {
    const f = digestToFields(await requestDigest(reqOfRecord(ok.record)));
    row("T6", "実際に発行される券（記録）のダイジェスト = 証明の公開入力", "true", String(BigInt(p.publicInputs[PUBLIC_NAMES.indexOf("req_hi")]!) === f.hi && BigInt(p.publicInputs[PUBLIC_NAMES.indexOf("req_lo")]!) === f.lo), "鍵・店・額面・期限・Condition・持ち主・資産・制度のすべてが 1 つのダイジェストに入っている");
  }
}

// ================= 台帳（模擬）へ送信し、店舗の同期データと QR を作る =================
await issuer.submitPending();
const syncA = issuer.syncFor(shopA), syncB = issuer.syncFor(shopB);
const nowR = rippleNow();
const qr = {
  h1County: await qrOf(rec1, dev.h1County),
  h1Ngo: await qrOf(rec3, devNgo),
  h2County: await qrOf(rec4, devH2),
  /** H1 の県の券を、NGO の券の鍵（別の申請鍵）で署名 */
  h1CountyWrongKey: await qrOf(rec1, dev.h1County, devNgo),
  /** preimage だけを盗み見して署名なしで出す */
  h1CountyNoSig: encodeVoucher({ owner: rec1.owner, offerSequence: rec1.offerSequence, preimage: dev.h1County.preimage }),
  /** 任意の別端末の鍵で署名 */
  h1CountyStranger: await qrOf(rec1, dev.h1County, await newDevice()),
};
mkdirSync(out("exchange/"), { recursive: true });
writeFileSync(out("exchange/shop-sync.json"), j({ kind: "todoke-13-shop-sync（模擬台帳・ローカル検証）", shopA: { shop: shopA, list: syncA }, shopB: { shop: shopB, list: syncB }, nowRipple: nowR }));
writeFileSync(out("exchange/qrs.json"), j(Object.fromEntries(Object.entries(qr).map(([k, v]) => [k, hex(v)]))));
writeFileSync(out("exchange/meta.json"), j({ shopA, shopB, marginSec: 120 }));

// ================= 8. 公開範囲の点検 =================
{
  const artifacts: Record<string, string> = {
    "証明の公開入力（H1 県・H1 NGO・H2 県）": j([p1.publicInputs, p3.publicInputs, p4.publicInputs]),
    "発券記録（返却分）": j([rec1, rec3, rec4]),
    "店舗の同期データ（A・B）": j([syncA, syncB]),
    "QR（全種）": Object.values(qr).map(hex).join("\n"),
    "想定する公開取引（EscrowCreate 相当）": j(syncA.map((e) => ({ TransactionType: "EscrowCreate", Account: e.owner, Destination: e.destination, Amount: e.amount, CancelAfter: e.cancelAfter, Condition: e.condition, Memos: [{ MemoType: "todoke/pk-sha256", MemoData: e.pkHash }] }))),
    "発券サービスの DB（全表）": j(issuer.dump()),
  };
  const secrets: [string, string][] = [];
  for (const m of members) {
    secrets.push([`${m.id} hh_secret`, m.secret.toString(16)], [`${m.id} salt`, m.salt.toString(16)], [`${m.id} hh_id`, roster.hhIds.get(m.id)!.toString(16)], [`${m.id} 氏名`, m.profile.name], [`${m.id} 住所`, m.profile.address]);
  }
  for (const [name, text] of Object.entries(artifacts)) {
    const low = text.toLowerCase();
    const hits = secrets.filter(([, v]) => low.includes(v.toLowerCase())).map(([k]) => k);
    row("T8", `${name} に世帯の秘密・hh_id・salt・氏名・住所が出ない`, "なし", hits.length ? hits.join(",") : "なし", `検索対象 ${secrets.length} 値`);
  }
  // 世帯の固定アドレスは、この設計には存在しない（世帯は XRPL アカウントを名簿にも申請にも出さない）
  const accounts = new Set(syncA.concat(syncB).flatMap((e) => [e.owner, e.destination]));
  row("T8", "公開取引に現れる XRPL アカウントは支援元 D と店舗だけ", "true", String([...accounts].every((a) => [dCounty, dNgo, shopA, shopB].includes(a))), `${[...accounts].length} 件`);
  // 制度間の使い回し
  row("T8", "H1 の県と NGO で、端末鍵（pkHash）が別", "true", String(rec1.pkHash !== rec3.pkHash), "");
  row("T8", "H1 の県と NGO で、Condition（券固有の秘密）が別", "true", String(rec1.condition !== rec3.condition), "");
  row("T8", "H1 の県と NGO で、持ち主（支援元のアカウント）が別", "true", String(rec1.owner !== rec3.owner), "");
  row("T8", "H1 の県と NGO で、nullifier が別（公開入力）", "true", String(p1.publicInputs[PUBLIC_NAMES.indexOf("nullifier")] !== p3.publicInputs[PUBLIC_NAMES.indexOf("nullifier")]), "");
  row("T8", "H1 の県への再申請でも pkHash・Condition は使い回さない", "true", String(a1.req.pkHash !== a2.req.pkHash && a1.req.conditionHash !== a2.req.conditionHash), "同じ制度の再申請で見える共通点は nullifier だけ");
  {
    // 公開入力 17 個が、制度の条件（発券側の設定）・申請ダイジェスト・nullifier・tag だけで説明できる（世帯の属性の値が入る余地がない）
    const e = expectedPublicInputs(stmtOf(county), digestToFields(a1.digest).hi, digestToFields(a1.digest).lo, a1.d.nullifier, a1.d.tag);
    row("T8", "公開入力 17 個はすべて「制度の設定・申請ダイジェスト・nullifier・tag」で説明できる（世帯の属性の値は入らない）", "true", String(p1.publicInputs.length === e.length && p1.publicInputs.every((x, i) => BigInt(x) === e[i])), "H1→県の証明で照合");
  }
}

// ================= 結果 =================
const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
const stats = {
  proof: { bytes: p1.proof.length, publicInputs: p1.publicInputs.length, publicInputsBytes: p1.publicInputs.length * 32, vkBytes: zk.vk.length },
  proveMs: { n: proveMs.length, avg: avg(proveMs), min: Math.min(...proveMs), max: Math.max(...proveMs) },
  verifyMs: { n: verifyMs.length, avg: avg(verifyMs), min: Math.min(...verifyMs), max: Math.max(...verifyMs) },
  zk: zk.stats,
  env: { platform: `${process.platform}/${process.arch}`, node: process.version, cpus: cpus().length, cpuModel: cpus()[0]?.model, memGB: Math.round(totalmem() / 2 ** 30), bb: "@aztec-foundation/bb.js 6.0.0 native", noir: "1.0.0（noir_wasm でコンパイル）" },
  roster: { root: fieldHex(roster.root), members: members.length, depth: 12 },
  nullifiers: { H1_county: fieldHex(a1.d.nullifier), H1_ngo: fieldHex(a3.d.nullifier), H2_county: fieldHex(a4.d.nullifier) },
};
const failed = rows.filter((r) => !r.ok);
writeFileSync(out("results/run.json"), j({ at: new Date().toISOString(), failed: failed.length, total: rows.length, rows, stats, ledger: "模擬（SQLite の mock_escrow 表。XRPL には送っていない）" }));
console.log(`\n${rows.length} 項目中 ${rows.length - failed.length} 件が期待どおり / ${failed.length} 件が期待と違う`);
await zk.close();
if (failed.length) process.exitCode = 1;
void unhex; void fmtUnits;
