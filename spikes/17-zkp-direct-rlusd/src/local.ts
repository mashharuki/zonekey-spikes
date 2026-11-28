/**
 * ローカル検証（Testnet なし）: 申請形式 v2 の資産拘束と、v1 との互換性。
 *   pnpm --filter 17-zkp-direct-rlusd local
 * 1) 固定ベクトル（v1 の既知ベクトルの再現・v2 の正規バイト列と XRPL codec との照合）
 * 2) 同じ Service（spike 14）に模擬ノードを繋ぎ、通貨・issuer・額面を変えた申請が発券されないこと、v1 の証明を v2 が受理しないこと、
 *    申請形式の版が違っても (制度, nullifier) で再発券できないことを確認する
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Wallet, encode } from "xrpl";
import { decodeAccountID } from "ripple-address-codec";
import { hex, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";
import { type Req, digestToFields, encodeRequest, requestDigest, sha256, syntheticAccount, syntheticField, toUnits } from "../../13-zk-bound-voucher/src/lib.js";
import { Roster } from "../../13-zk-bound-voucher/src/roster.js";
import { Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { pad8 } from "../../14-issuance-recovery/src/common.js";
import { type Program, Service } from "../../14-issuance-recovery/src/service.js";
import { RLUSD_CURRENCY, RLUSD_ISSUER } from "./config.js";
import { REQ_TAG_V2, V2_LENGTH, canonicalCurrency, currencyBytes, encodeRequestV2, requestDigestV2 } from "./reqv2.js";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const rows: { group: string; step: string; expected: string; actual: string; ok: boolean }[] = [];
const row = (group: string, step: string, expected: string, actual: string) => { rows.push({ group, step, expected, actual, ok: expected === actual }); console.log(`${expected === actual ? "OK  " : "FAIL"} [${group}] ${step}: 期待=${expected} 実際=${actual}`); };
const throws = (f: () => unknown) => { try { f(); return "受理"; } catch { return "拒否"; } };
const eqBytes = (a: Uint8Array, b: Uint8Array) => hex(a) === hex(b);

// ───────── 1. 固定ベクトル ─────────
const owner = await syntheticAccount("17|vec|owner"), shop = await syntheticAccount("17|vec|shop");
const base: Req = { programId: 0x9001n, owner, shop, currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER, valueUnits: 100000n, cancelAfter: 900000000, pkHash: "11".repeat(32), conditionHash: "22".repeat(32) };

// v1: spike 13 の既知ベクトルを再現（バイト単位で保存されている）
const v1vec = JSON.parse(readFileSync(new URL("../../13-zk-bound-voucher/vectors/bytes-field.json", import.meta.url), "utf8")) as { request: Record<string, string | number>; encodedBytesHex: string; sha256Hex: string; req_hi_ts: string; req_lo_ts: string; encodedLength: number };
const v1req: Req = { ...(v1vec.request as unknown as Req), programId: BigInt(v1vec.request["programId"]!), valueUnits: BigInt(v1vec.request["valueUnits"]!) };
row("v1 互換", "既知ベクトルの正規バイト列（191 B）が一致", v1vec.encodedBytesHex, hex(encodeRequest(v1req)));
row("v1 互換", "既知ベクトルの SHA-256 が一致", v1vec.sha256Hex, hex(await requestDigest(v1req)));
const f1 = digestToFields(await requestDigest(v1req));
row("v1 互換", "req_hi / req_lo が一致", `${v1vec.req_hi_ts}|${v1vec.req_lo_ts}`, `0x${f1.hi.toString(16).padStart(64, "0")}|0x${f1.lo.toString(16).padStart(64, "0")}`);
row("v1 互換", "v1 は 40 桁の通貨を受け付けない（v1 のコードは変更していない）", "拒否", throws(() => encodeRequest(base)));

// v2 の正規バイト列（レイアウトを 1 項目ずつ照合）
const b2 = encodeRequestV2(base);
row("v2 形式", "長さ", String(V2_LENGTH), String(b2.length));
row("v2 形式", "タグ（別の固定タグ・v1 と異なる）", "todoke-17-request-v2", new TextDecoder().decode(b2.slice(0, 20)));
const off = { program: 20, owner: 52, shop: 72, currency: 92, issuer: 112, value: 132, cancel: 140, pk: 144, cond: 176 };
row("v2 形式", "program_id 32 B（BE）", "0000…9001", hex(b2.slice(off.program, off.program + 32)).replace(/^0+(?=9001)/, "0000…"));
row("v2 形式", "owner・shop は AccountID 20 B", `${hex(decodeAccountID(owner))}|${hex(decodeAccountID(shop))}`, `${hex(b2.slice(off.owner, off.owner + 20))}|${hex(b2.slice(off.shop, off.shop + 20))}`);
row("v2 形式", "通貨は台帳上の 20 B（40 桁 hex を ASCII 40 B にしない）", RLUSD_CURRENCY, hex(b2.slice(off.currency, off.currency + 20)));
row("v2 形式", "issuer は AccountID 20 B", hex(decodeAccountID(RLUSD_ISSUER)), hex(b2.slice(off.issuer, off.issuer + 20)));
row("v2 形式", "額面は 8 B BE・10^-6 単位（0.1 → 100000）", "00000000000186A0", hex(b2.slice(off.value, off.value + 8)));
row("v2 形式", "cancelAfter 4 B BE", "35A4E900", hex(b2.slice(off.cancel, off.cancel + 4)));
row("v2 形式", "pkHash・conditionHash 各 32 B", `${"11".repeat(32)}|${"22".repeat(32)}`, `${hex(b2.slice(off.pk, off.pk + 32))}|${hex(b2.slice(off.cond, off.cond + 32))}`);
const d2 = await requestDigestV2(base), f2 = digestToFields(d2);
row("v2 形式", "SHA-256 は正規バイト列のもの", hex(await sha256(b2)), hex(d2));
row("v2 形式", "v1 の申請は v2 と同じバイト列・同じダイジェストにならない（ZKV 申請でも）", "別", hex(await requestDigest(v1req)) !== hex(await requestDigestV2({ ...v1req })) ? "別" : "同じ");

// XRPL codec（依存版 ripple-binary-codec）が直列化した Amount の中に、v2 の通貨 20 B・issuer 20 B が同じ順で並ぶこと
const codecAmount = (currency: string, issuer: string) => {
  const e = unhex(encode({ TransactionType: "EscrowCreate", Account: owner, Destination: shop, Amount: { currency, issuer, value: "0.1" }, CancelAfter: 900000000 } as never));
  return e;
};
const find = (hay: Uint8Array, needle: Uint8Array) => { for (let i = 0; i + needle.length <= hay.length; i++) { let k = 0; while (k < needle.length && hay[i + k] === needle[k]) k++; if (k === needle.length) return i; } return -1; };
for (const [label, cur] of [["非標準コード（RLUSD、40 桁大文字）", RLUSD_CURRENCY], ["標準 ISO（USD）", "USD"]] as const) {
  const ser = codecAmount(cur, RLUSD_ISSUER);
  const want = new Uint8Array([...currencyBytes(cur), ...decodeAccountID(RLUSD_ISSUER)]);
  const at = find(ser, want);
  // 直前の 8 B は Amount の値（最上位ビット=発行通貨、次ビット=正）。直前の 1 B はフィールド ID（Amount = 0x61）
  row("XRPL codec", `${label}: codec の Amount 直列化に「通貨 20 B ‖ issuer 20 B」が現れ、直前が Amount の値 8 B（先頭 0xC…）・その前が 0x61`, "true", String(at >= 9 && ser[at - 9] === 0x61 && (ser[at - 8]! & 0xc0) === 0xc0));
}
row("XRPL codec", "通貨表記: 'USD' と 40 桁の標準形式 hex は同じ 20 B", "同じ", eqBytes(currencyBytes("USD"), currencyBytes("0000000000000000000000005553440000000000")) ? "同じ" : "違う");
row("正規化", "hex の大小文字で同じバイト列・同じダイジェスト", hex(d2), hex(await requestDigestV2({ ...base, currency: RLUSD_CURRENCY.toLowerCase(), pkHash: "11".repeat(32).toLowerCase() })));
const alt = { currency: canonicalCurrency("5445535400000000000000000000000000000000"), issuer: await syntheticAccount("17|vec|other-issuer") };
row("資産拘束", "異なる通貨ならダイジェストが異なる", "別", hex(await requestDigestV2({ ...base, currency: alt.currency })) !== hex(d2) ? "別" : "同じ");
row("資産拘束", "異なる issuer ならダイジェストが異なる", "別", hex(await requestDigestV2({ ...base, issuer: alt.issuer })) !== hex(d2) ? "別" : "同じ");
row("資産拘束", "異なる額面ならダイジェストが異なる", "別", hex(await requestDigestV2({ ...base, valueUnits: 100001n })) !== hex(d2) ? "別" : "同じ");
row("資産拘束", "異なる制度・owner・店・期限・鍵ハッシュ・Condition でもダイジェストが異なる", "6/6", `${(await Promise.all([{ programId: 0x9002n }, { owner: shop }, { shop: owner }, { cancelAfter: 900000001 }, { pkHash: "12".repeat(32) }, { conditionHash: "23".repeat(32) }].map(async (m) => hex(await requestDigestV2({ ...base, ...m }) ) !== hex(d2)))).filter(Boolean).length}/6`);
const bad: [string, () => unknown][] = [
  ["通貨 39 桁", () => currencyBytes(RLUSD_CURRENCY.slice(1))], ["通貨 41 桁", () => currencyBytes(`${RLUSD_CURRENCY}0`)], ["通貨 4 文字", () => currencyBytes("USDT")], ["通貨が空", () => currencyBytes("")],
  ["非 16 進（G を含む 40 桁）", () => currencyBytes(`G${RLUSD_CURRENCY.slice(1)}`)], ["XRP", () => currencyBytes("XRP")], ["全ゼロ 40 桁", () => currencyBytes("0".repeat(40))],
  ["標準形式の崩れ（先頭 00 で予約領域に値）", () => currencyBytes("0000000000000100005553440000000000000000".slice(0, 40))], ["ISO に使えない文字", () => currencyBytes("U D")],
  ["pkHash が 63 桁", () => encodeRequestV2({ ...base, pkHash: "1".repeat(63) })], ["conditionHash が非 16 進", () => encodeRequestV2({ ...base, conditionHash: "zz".repeat(32) })],
  ["owner が不正なアドレス", () => encodeRequestV2({ ...base, owner: "rNOTANADDRESS" })], ["額面 0", () => encodeRequestV2({ ...base, valueUnits: 0n })], ["額面が 8 B を超える", () => encodeRequestV2({ ...base, valueUnits: 1n << 64n })],
];
for (const [n, f] of bad) row("不正入力", n, "拒否", throws(f));
row("対応入力", "3 文字 ISO（USD）・40 桁 hex（大文字／小文字）を受理", "受理|受理|受理", [throws(() => currencyBytes("USD")), throws(() => currencyBytes(RLUSD_CURRENCY)), throws(() => currencyBytes(RLUSD_CURRENCY.toLowerCase()))].join("|"));

mkdirSync(`${PKG}vectors`, { recursive: true });
writeFileSync(`${PKG}vectors/request-v2.json`, JSON.stringify({
  note: "v2 の固定ベクトル。通貨 20 B・発行者 20 B で資産を拘束する。v1 の既知ベクトルは spike 13 の vectors/bytes-field.json（変更なし）",
  tag: REQ_TAG_V2, length: V2_LENGTH, offsets: off, 金額単位: "10^-6（0.1 → 100000）、8 B 大端", 桁順: "req_hi = SHA-256 の上位 16 B、req_lo = 下位 16 B。それぞれ大端の整数 = Field",
  request: { ...base, programId: `0x${base.programId.toString(16)}`, valueUnits: base.valueUnits.toString() },
  encodedBytesHex: hex(b2), sha256Hex: hex(d2), req_hi: `0x${f2.hi.toString(16).padStart(64, "0")}`, req_lo: `0x${f2.lo.toString(16).padStart(64, "0")}`,
}, null, 1));

// ───────── 2. 申請・発券（模擬ノード）─────────
const zk = new Zk(); await zk.init();
const w = Wallet.generate();
const node = { blobs: new Set<string>() };
const client = {
  autofill: async () => ({ Fee: "12" }),
  request: async (r: Record<string, unknown>) => {
    switch (r["command"]) {
      case "ledger": return { result: { ledger_index: 1000, ledger: { close_time: Math.floor(Date.now() / 1000) - 946684800 } } };
      case "account_info": return { result: { account_data: { Sequence: 500 } } };
      case "server_info": return { result: { info: { complete_ledgers: "1-100000" } } };
      case "submit": node.blobs.add(String(r["tx_blob"])); return { result: { engine_result: "tesSUCCESS" } };
      default: throw new Error(`模擬ノードが知らないコマンド: ${String(r["command"])}`);
    }
  },
};
const mkH = async (id: string, senior: boolean) => ({ id, secret: await syntheticField(`17|local|${id}|secret`), salt: await syntheticField(`17|local|${id}|salt`), zone: 13101n, senior, revictim: false, tier: 3, profile: { name: "合成", address: "架空" } });
const members = [await mkH("H1", true), await mkH("H3", false)];
const roster = await new Roster(members).build(zk);
const programId = await syntheticField("17|local|program");
const stmt = { zoneSet: pad8([13101, 13102]), needSenior: false, needRevictim: false, minTier: 1 };
const now = Math.floor(Date.now() / 1000) - 946684800;
const mkReq = async (o: Partial<Req> = {}): Promise<Req> => ({ programId, owner: w.address, shop, currency: canonicalCurrency(RLUSD_CURRENCY), issuer: RLUSD_ISSUER, valueUnits: 100000n, cancelAfter: now + 7200, pkHash: hex(await sha256(globalThis.crypto.getRandomValues(new Uint8Array(65)))), conditionHash: hex(await sha256(globalThis.crypto.getRandomValues(new Uint8Array(32)))), ...o });
async function prove(req: Req, digestOf: (r: Req) => Promise<Uint8Array>, idx = 0) {
  const h = members[idx]!, digest = await digestOf(req);
  const d = await zk.derive({ hhSecret: h.secret, programId, zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, salt: h.salt, digest });
  return zk.prove(zk.inputs({ ...stmt, root: roster.root, programId }, { zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, hhSecret: h.secret, salt: h.salt, index: idx, siblings: roster.path(idx) }, digest, d.nullifier, d.tag));
}
const prog = (cur: string, iss: string, values: bigint[]): Program => ({ id: programId, owner: w.address, currency: cur, issuer: iss, allowedValues: values, allowedShops: [shop], stmt });
let n = 0;
const fresh = (digest?: (r: Req) => Promise<Uint8Array>, p: Program = prog(canonicalCurrency(RLUSD_CURRENCY), RLUSD_ISSUER, [100000n])) => {
  node.blobs.clear();
  const path = `${PKG}.state/local-${++n}.sqlite`; for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  return new Service({ dbPath: path, client: client as never, wallet: w, programs: [p], approvedRoots: [roster.root], zk, stopAfterPrepare: true, ...(digest ? { digest } : {}) });
};
mkdirSync(`${PKG}.state`, { recursive: true });
const counts = (s: Service) => { const x = s.snapshot(); return `${x.issuance.length}/${x.attempts.length}/${node.blobs.size}`; };

// 2a. v2 の正常系
const R = await mkReq();
const proofV2 = await prove(R, requestDigestV2);
const sv2 = fresh(requestDigestV2);
row("v2 発券", "v2 の申請・証明は受理される（発券記録/試行/台帳送信 = 1/1/0。stopAfterPrepare なので送信しない）", "stopped|1/1/0", `${(await sv2.apply(R, proofV2)).status}|${counts(sv2)}`);
const pi = proofV2.publicInputs.map((x) => BigInt(x));
row("v2 発券", "公開入力 req_hi/req_lo が v2 ダイジェストのもの", `0x${f2.hi.toString(16).padStart(64, "0") === "" ? "" : ""}`.slice(0, 0) + "true", String(pi[13] === digestToFields(await requestDigestV2(R)).hi && pi[14] === digestToFields(await requestDigestV2(R)).lo));
const again = await sv2.apply(R, await prove(R, requestDigestV2));
row("v2 発券", "同じ申請の再送（新しく作り直した証明）は新しい発券記録・新しい取引を作らない（発券記録/試行/一意な送信取引 = 1/1/1。同じ署名済み取引の再送のみ）", "pending|1/1/1", `${again.status}|${counts(sv2)}`);

// 2b. 元の有効証明に対し、通貨だけ／issuer だけ／額面だけを変えた申請（回路の拘束そのものを見るため、方針が通る設定で試す）
const mut: [string, Partial<Req>, Program][] = [
  ["通貨だけ違う（TEST）", { currency: canonicalCurrency("5445535400000000000000000000000000000000") }, prog(canonicalCurrency("5445535400000000000000000000000000000000"), RLUSD_ISSUER, [100000n])],
  ["issuer だけ違う", { issuer: alt.issuer }, prog(canonicalCurrency(RLUSD_CURRENCY), alt.issuer, [100000n])],
  ["額面だけ違う（0.11）", { valueUnits: 110000n }, prog(canonicalCurrency(RLUSD_CURRENCY), RLUSD_ISSUER, [100000n, 110000n])],
];
for (const [name, m, p] of mut) {
  const s = fresh(requestDigestV2, p), before = counts(s);
  const o = await s.apply({ ...R, ...m }, proofV2);
  row("資産拘束（回路・ダイジェスト）", `${name}: 方針が通る設定でも、元の証明は拒否される（public_input / req_hi）。発券記録・試行・送信は増えない`, `rejected|public_input|public input mismatch: req_hi|${before}`, `${o.status}|${"stage" in o ? o.stage : ""}|${"reason" in o ? o.reason : ""}|${counts(s)}`);
}
for (const [name, m, p] of mut) {
  void p; const s = fresh(requestDigestV2), before = counts(s);
  const o = await s.apply({ ...R, ...m }, proofV2);
  row("資産拘束（通常の方針）", `${name}: 通常の方針でも拒否（policy）。増えない`, `rejected|policy|${before}`, `${o.status}|${"stage" in o ? o.stage : ""}|${counts(s)}`);
}

// 2c. v1 の互換と、版をまたいだ扱い
const R1 = await mkReq({ currency: "ZKV", issuer: RLUSD_ISSUER });
const proofV1 = await prove(R1, requestDigest);
const p1 = prog("ZKV", RLUSD_ISSUER, [100000n]);
const s1 = fresh(undefined, p1);
row("v1 互換", "v1 の既存の経路（digest 指定なし）で v1 の証明は今も受理される", "stopped|1/1/0", `${(await s1.apply(R1, proofV1)).status}|${counts(s1)}`);
row("v1 互換", "v1 の証明の検証そのもの（bb.js）は通る", "true", String((await zk.verify(proofV1)).ok));
const sx = fresh(requestDigestV2, p1);
const ox = await sx.apply(R1, proofV1);
row("v1 互換", "v1 の証明を v2 として受理しない（public_input: req_hi）。増えない", "rejected|public_input|0/0/0", `${ox.status}|${"stage" in ox ? ox.stage : ""}|${counts(sx)}`);
// 版をまたいだ再発券: v1 で発券した世帯が、同じ制度で v2 の申請をしても再発券できない（nullifier は制度単位）
const sBoth = fresh(undefined, { ...p1 });
await sBoth.apply(R1, proofV1);
const R1b = await mkReq({ currency: "ZKV", issuer: RLUSD_ISSUER });
const sBothV2 = new Service({ dbPath: (sBoth.db as unknown as { location(): string }).location(), client: client as never, wallet: w, programs: [p1], approvedRoots: [roster.root], zk, stopAfterPrepare: true, digest: requestDigestV2 });
const ob = await sBothV2.apply(R1b, await prove(R1b, requestDigestV2));
row("nullifier", "同じ世帯・同じ制度は、版を変えて（v1→v2）申請しても再発券できない（duplicate）。記録は 1 件のまま", "rejected|duplicate|1", `${ob.status}|${"stage" in ob ? ob.stage : ""}|${sBothV2.snapshot().issuance.length}`);
// 別の世帯（H3: 高齢者でないが P 相当の制度には該当）は別の nullifier で発券できる = nullifier は世帯×制度
const R3 = await mkReq();
const sN = fresh(requestDigestV2);
await sN.apply(R, proofV2);
const o3 = await sN.apply(R3, await prove(R3, requestDigestV2, 1));
row("nullifier", "別の世帯は同じ制度でも別の nullifier で発券できる（1 世帯 1 回は制度単位）", "stopped|2", `${o3.status}|${sN.snapshot().issuance.length}`);

// Noir の fixture（TS とは別実装のバイト→Field 変換）が v2 ダイジェストでも同じ req_hi/lo を返す
const dd = await zk.derive({ hhSecret: members[0]!.secret, programId, zone: 13101n, senior: true, revictim: false, tier: 3, salt: members[0]!.salt, digest: d2 });
row("Noir 変換", "fixture の hi/lo = TS の hi/lo（v2 ダイジェスト）", `${f2.hi}|${f2.lo}`, `${dd.hi}|${dd.lo}`);
void toUnits; void mkReq;
await zk.close();

const failed = rows.filter((r) => !r.ok);
writeFileSync(`${PKG}results/local.json`, JSON.stringify({ at: new Date().toISOString(), kind: "ローカル検証（Testnet なし・模擬ノード）", total: rows.length, failed: failed.length, rows }, null, 1));
console.log(`\n${rows.length - failed.length}/${rows.length} 項目が期待どおり`);
if (failed.length) process.exitCode = 1;
