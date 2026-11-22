/**
 * Todoke の台帳外の伝票（この検証で決めた形式。XRPL の標準ではない）
 *
 * 伝票（固定長 79 バイト。このバイト列に署名する）:
 *   "TODOKE-SLIP-v1\0"（15）‖ CheckID（32）‖ 通し番号 UInt32 BE（4）‖ ここまでの合計額 UInt64 BE（8）
 *   ‖ お店の ID（16、合成）‖ 時刻 UInt32 BE（4、Unix 秒）
 * 額の単位: 受給証 0.000001（10^-6）を 1 とする整数（この検証で決めた。受給証は XRPL の発行トークンで、小数の桁は任意）
 * QR に入れるもの: 伝票（79）‖ 署名 ‖ 公開鍵
 *   ECDSA P-256: 署名 64（r‖s、IEEE P1363。Web Crypto の sign の形式）・公開鍵 65（非圧縮）→ 計 208 バイト
 *   Ed25519:     署名 64・公開鍵 32 → 計 175 バイト（長さで見分ける）
 * 伝票の鍵と Check の結び付け: Check の InvoiceID = SHA-256(公開鍵の生バイト)（11a 確認 1 で台帳に残ることを確認済み）
 *
 * Node（精算スクリプト）とブラウザの両方で動く（globalThis.crypto.subtle だけを使う）。
 */
export const PREFIX = new TextEncoder().encode("TODOKE-SLIP-v1\0");
export const SLIP_BYTES = 79;
export const UNITS_PER_VOUCHER = 1_000_000n;
export type Alg = "ECDSA-P256" | "Ed25519";
const PUB_LEN: Record<Alg, number> = { "ECDSA-P256": 65, Ed25519: 32 };
const SIG_LEN = 64;

export interface Slip { checkId: Uint8Array; seq: number; total: bigint; shopId: Uint8Array; time: number }
export interface SignedSlip { slip: Slip; slipBytes: Uint8Array; signature: Uint8Array; publicKey: Uint8Array; alg: Alg }

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
export const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function encodeSlip(s: Slip): Uint8Array {
  if (s.checkId.length !== 32 || s.shopId.length !== 16) throw new Error("CheckID は 32 バイト、お店の ID は 16 バイト");
  const b = new Uint8Array(SLIP_BYTES);
  const v = new DataView(b.buffer);
  b.set(PREFIX, 0);
  b.set(s.checkId, 15);
  v.setUint32(47, s.seq);
  v.setBigUint64(51, s.total);
  b.set(s.shopId, 59);
  v.setUint32(75, s.time);
  return b;
}

export function decodeSlip(b: Uint8Array): Slip {
  if (b.length !== SLIP_BYTES || !eq(b.subarray(0, 15), PREFIX)) throw new Error("伝票ではない（長さか接頭辞が違う）");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { checkId: b.slice(15, 47), seq: v.getUint32(47), total: v.getBigUint64(51), shopId: b.slice(59, 75), time: v.getUint32(75) };
}

export function packQr(s: SignedSlip): Uint8Array {
  const out = new Uint8Array(SLIP_BYTES + SIG_LEN + s.publicKey.length);
  out.set(s.slipBytes, 0);
  out.set(s.signature, SLIP_BYTES);
  out.set(s.publicKey, SLIP_BYTES + SIG_LEN);
  return out;
}

export function unpackQr(b: Uint8Array): SignedSlip {
  const alg = (Object.keys(PUB_LEN) as Alg[]).find((a) => b.length === SLIP_BYTES + SIG_LEN + PUB_LEN[a]);
  if (!alg) throw new Error(`QR の長さ ${b.length} バイトは伝票の形式に合わない`);
  const slipBytes = b.slice(0, SLIP_BYTES);
  return { slip: decodeSlip(slipBytes), slipBytes, signature: b.slice(SLIP_BYTES, SLIP_BYTES + SIG_LEN), publicKey: b.slice(SLIP_BYTES + SIG_LEN), alg };
}

const algParams = (alg: Alg) => (alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" });
const signParams = (alg: Alg) => (alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" });

/** 取り出せない秘密鍵（extractable: false）を作る。公開鍵は常に書き出せる */
export const generateKeyPair = (alg: Alg) => crypto.subtle.generateKey(algParams(alg), false, ["sign", "verify"]) as Promise<CryptoKeyPair>;
export const exportPublicRaw = async (k: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey("raw", k));
export const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
export const sign = async (alg: Alg, key: CryptoKey, data: Uint8Array) => new Uint8Array(await crypto.subtle.sign(signParams(alg), key, data as BufferSource));
export async function verifySignature(s: SignedSlip): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", s.publicKey as BufferSource, algParams(s.alg), false, ["verify"]);
    return await crypto.subtle.verify(signParams(s.alg), key, s.signature as BufferSource, s.slipBytes as BufferSource);
  } catch {
    return false;
  }
}

/** お店が持っておく Check の一覧（オンラインのうちに取り込む） */
export interface CheckInfo { CheckID: string; SendMax: string; Expiration: number; InvoiceID: string; source?: string }
export const RIPPLE_EPOCH = 946684800;
export const toUnits = (v: string): bigint => {
  const [i, f = ""] = v.split(".");
  return BigInt(i!) * UNITS_PER_VOUCHER + BigInt((f + "000000").slice(0, 6));
};
export const fromUnits = (u: bigint) => `${u / UNITS_PER_VOUCHER}.${(u % UNITS_PER_VOUCHER).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");

export interface CheckResult {
  ok: boolean;
  a_invoiceId: boolean; b_signature: boolean; c_withinSendMax: boolean; c_beforeExpiration: boolean; d_increasing: boolean | undefined; knownCheck: boolean;
  reasons: string[];
}

/**
 * お店側の確認 a〜d（ネット不要）
 *  a 公開鍵の SHA-256 がその Check の InvoiceID と一致 / b 署名が正しい / c 合計額 ≤ SendMax・時刻 < Expiration
 *  d このお店がすでに受け取った同じ Check の伝票より、番号も合計額も大きい
 */
export async function checkSlip(s: SignedSlip, checks: CheckInfo[], previous: Slip | undefined): Promise<CheckResult> {
  const c = checks.find((x) => x.CheckID.toUpperCase() === hex(s.slip.checkId));
  const reasons: string[] = [];
  const a = !!c && hex(await sha256(s.publicKey)) === c.InvoiceID.toUpperCase();
  const b = await verifySignature(s);
  const cMax = !!c && s.slip.total <= toUnits(c.SendMax);
  const cExp = !!c && s.slip.time - RIPPLE_EPOCH < c.Expiration;
  const d = previous === undefined ? undefined : s.slip.seq > previous.seq && s.slip.total > previous.total;
  if (!c) reasons.push("この Check を知らない（一覧にない）");
  if (c && !a) reasons.push("a: 公開鍵が Check の InvoiceID と合わない");
  if (!b) reasons.push("b: 署名が正しくない");
  if (c && !cMax) reasons.push(`c: 合計額が上限を超える（${fromUnits(s.slip.total)} > ${c.SendMax}）`);
  if (c && !cExp) reasons.push("c: Check の期限が過ぎている");
  if (d === false) reasons.push(`d: 番号か合計額が、前に受け取った伝票（番号 ${previous!.seq}・合計 ${fromUnits(previous!.total)}）より大きくない`);
  return { ok: !!c && a && b && cMax && cExp && d !== false, a_invoiceId: a, b_signature: b, c_withinSendMax: cMax, c_beforeExpiration: cExp, d_increasing: d, knownCheck: !!c, reasons };
}
