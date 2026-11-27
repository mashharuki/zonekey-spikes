/**
 * 申請内容の正規バイト列と、バイト列 ⇄ Noir の Field の変換。
 * 券の部品（Condition・QR・端末の署名）は 11c の core.ts をそのまま使う（再実装しない）。
 */
import { decodeAccountID, encodeAccountID } from "ripple-address-codec";
import { hex, sha256, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";

export { hex, unhex, sha256 };
export const enc = new TextEncoder();

/** 申請内容。発券サービスが承認した内容 = 発券される Escrow の内容 = 証明が結び付く内容、の 3 つが同じものを指す */
export interface Req {
  programId: bigint; // 制度（県・NGO）。Field に収まる 248 ビット
  owner: string; // 券の持ち主（支援元の配布用アカウント D。世帯のアドレスではない）
  shop: string; // 店舗の XRPL アカウント（Escrow の Destination）
  currency: string; // 3 文字
  issuer: string; // 資産の発行者
  valueUnits: bigint; // 額面（100 万分の 1 単位。"5" → 5_000_000）
  cancelAfter: number; // Ripple Epoch の秒
  pkHash: string; // 端末の公開鍵（P-256 非圧縮 65B）の SHA-256（64 桁 hex）
  conditionHash: string; // SHA-256(preimage)（64 桁 hex）。XRPL の Condition = A0258020 || これ || 810120
}

export const REQ_TAG = "todoke-13-request-v1"; // 20 バイト

const be = (n: bigint, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = bytes - 1, v = n; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  if (n >> BigInt(bytes * 8) !== 0n) throw new Error(`${bytes} バイトに収まらない: ${n}`);
  return out;
};

/**
 * 正規バイト列（191 B）:
 *   "todoke-13-request-v1"(20) || program_id(32, BE) || owner AccountID(20) || shop AccountID(20) || currency ASCII(3)
 *   || issuer AccountID(20) || value(8, BE) || cancelAfter(4, BE) || pkHash(32) || conditionHash(32)
 * 可変長の項目はない（区切りの曖昧さで別の申請が同じバイト列になることがない）
 */
export function encodeRequest(r: Req): Uint8Array {
  if (r.currency.length !== 3 || !/^[A-Z0-9]{3}$/.test(r.currency)) throw new Error("通貨は 3 文字の英数字");
  const parts = [
    enc.encode(REQ_TAG),
    be(r.programId, 32),
    decodeAccountID(r.owner),
    decodeAccountID(r.shop),
    enc.encode(r.currency),
    decodeAccountID(r.issuer),
    be(r.valueUnits, 8),
    be(BigInt(r.cancelAfter), 4),
    unhex(r.pkHash),
    unhex(r.conditionHash),
  ];
  if (unhex(r.pkHash).length !== 32 || unhex(r.conditionHash).length !== 32) throw new Error("ハッシュは 32 バイト");
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const requestDigest = (r: Req) => sha256(encodeRequest(r));

/** SHA-256（32B）→ 上位 16B と下位 16B を、それぞれ big-endian の整数 = Field にする（どちらも 2^128 未満） */
export function digestToFields(d: Uint8Array): { hi: bigint; lo: bigint } {
  if (d.length !== 32) throw new Error("ダイジェストは 32 バイト");
  return { hi: BigInt(`0x${hex(d.slice(0, 16))}`), lo: BigInt(`0x${hex(d.slice(16))}`) };
}

/** Field → 公開入力の表記（0x + 64 桁 hex。bb.js が返す形式） */
export const fieldHex = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;
export const fieldOfHex = (s: string) => BigInt(s);

/** 実験用の架空アカウント（ラベルの SHA-256 の先頭 20B。秘密鍵は存在しない） */
export async function syntheticAccount(label: string): Promise<string> {
  return encodeAccountID((await sha256(enc.encode(`todoke-13-synthetic|${label}`))).slice(0, 20));
}
/** 実験用の 31 バイトの値（BN254 の体に必ず収まる）。実在の秘密ではなく、再現のためにラベルから決める */
export async function syntheticField(label: string): Promise<bigint> {
  return BigInt(`0x${hex((await sha256(enc.encode(`todoke-13-synthetic|${label}`))).slice(0, 31))}`);
}
export const fmtUnits = (u: bigint) => (u % 1_000_000n === 0n ? String(u / 1_000_000n) : `${u / 1_000_000n}.${String(u % 1_000_000n).padStart(6, "0").replace(/0+$/, "")}`);
export const toUnits = (v: string) => BigInt(v) * 1_000_000n;
