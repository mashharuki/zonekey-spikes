/**
 * 券（店舗宛ての受給証 Escrow）の共通部分。ブラウザでも Node でも動く（Web Crypto だけを使う。Buffer・node:crypto は使わない）
 * 根拠:
 * - Condition / Fulfillment の形式: xrpl-kit の createPreimageCondition（five-bells-condition の PreimageSha256 と 50 件一致を確認済み）と同じ
 *     Fulfillment = A0 22 80 20 || preimage(32B) / Condition = A0 25 80 20 || SHA-256(preimage) || 81 01 20
 * - preimage は世帯の秘密（32B）から HMAC-SHA256(秘密, ラベル) で作る。消えても秘密があれば作り直せる。配布用アカウント D は Condition（ハッシュ）しか受け取らない
 */
import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const buf = (b: Uint8Array) => b as unknown as BufferSource;

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
export const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
export const sha256 = async (b: Uint8Array) => new Uint8Array(await subtle.digest("SHA-256", buf(b)));

/** 券 n 枚目のラベル（世帯の中で一意） */
export const voucherLabel = (household: string, n: number) => `todoke-11c|${household}|${n}`;

export async function derivePreimage(householdSecret: Uint8Array, label: string): Promise<Uint8Array> {
  if (householdSecret.length !== 32) throw new Error("世帯の秘密は 32 バイト");
  const k = await subtle.importKey("raw", buf(householdSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, buf(enc.encode(label))));
}

export async function conditionOf(preimage: Uint8Array): Promise<{ conditionHex: string; fulfillmentHex: string }> {
  if (preimage.length !== 32) throw new Error("preimage は 32 バイト固定");
  return { conditionHex: `A0258020${hex(await sha256(preimage))}810120`, fulfillmentHex: `A0228020${hex(preimage)}` };
}

/** EscrowCreate の Memo に入れる「端末の公開鍵のハッシュ」（世帯のアドレスではないので、世帯と店舗は台帳上で結び付かない） */
export const PK_MEMO_TYPE = hex(enc.encode("todoke/pk-sha256"));

/** 端末の鍵で署名する内容: 固定の文字列 || 券の持ち主（D）の AccountID || OfferSequence（4B BE）|| お店の AccountID */
export function signedMessage(owner: string, offerSequence: number, shop: string): Uint8Array {
  const tag = enc.encode("todoke-11c-voucher");
  const out = new Uint8Array(tag.length + 20 + 4 + 20);
  out.set(tag, 0);
  out.set(decodeAccountID(owner), tag.length);
  new DataView(out.buffer).setUint32(tag.length + 20, offerSequence);
  out.set(decodeAccountID(shop), tag.length + 24);
  return out;
}

// ── QR に入れるバイト列 ───────────────────────────────
// [版 1B][フラグ 1B][持ち主 AccountID 20B][OfferSequence 4B][preimage 32B] = 58B
// フラグ bit0 = 端末の署名つき → 続けて [公開鍵 P-256 非圧縮 65B][署名 r||s 64B] = 187B
export const VOUCHER_VERSION = 1;
export const PREIMAGE_OFFSET = 26;
export interface Voucher { owner: string; offerSequence: number; preimage: Uint8Array; sig?: { pub: Uint8Array; sig: Uint8Array } }

export function encodeVoucher(v: Voucher): Uint8Array {
  const out = new Uint8Array(58 + (v.sig ? 129 : 0));
  out[0] = VOUCHER_VERSION;
  out[1] = v.sig ? 1 : 0;
  out.set(decodeAccountID(v.owner), 2);
  new DataView(out.buffer).setUint32(22, v.offerSequence);
  out.set(v.preimage, PREIMAGE_OFFSET);
  if (v.sig) { out.set(v.sig.pub, 58); out.set(v.sig.sig, 123); }
  return out;
}

export function decodeVoucher(b: Uint8Array): Voucher | undefined {
  if (b.length < 58 || b[0] !== VOUCHER_VERSION) return undefined;
  const withSig = (b[1]! & 1) === 1;
  if (b.length !== (withSig ? 187 : 58)) return undefined;
  const v: Voucher = {
    owner: encodeAccountID(b.slice(2, 22)),
    offerSequence: new DataView(b.buffer, b.byteOffset).getUint32(22),
    preimage: b.slice(26, 58),
  };
  if (withSig) v.sig = { pub: b.slice(58, 123), sig: b.slice(123, 187) };
  return v;
}

/** 端末の署名（ECDSA P-256 / SHA-256、r||s 64B。Web Crypto の形式） */
export async function signVoucher(privateKey: CryptoKey, owner: string, offerSequence: number, shop: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buf(signedMessage(owner, offerSequence, shop))));
}
export async function verifySig(pub: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<boolean> {
  try {
    const k = await subtle.importKey("raw", buf(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, buf(sig), buf(msg));
  } catch {
    return false;
  }
}

/** Ripple Epoch（2000-01-01）の秒 */
export const rippleNow = (ms = Date.now()) => Math.floor(ms / 1000) - 946684800;
