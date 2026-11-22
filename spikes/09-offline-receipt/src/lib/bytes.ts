/**
 * バイト列・ハッシュの小道具。ネットワークは使わない。
 * Node とブラウザ（spike 10 の PWA）の両方で同じコードを動かすため、Buffer と node:crypto は使わない。
 */
import { sha512 } from "@noble/hashes/sha2.js";

export type Bytes = Uint8Array;
export const hex = (b: Bytes): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
export const unhex = (h: string): Bytes => {
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error(`hex ではない: ${h.slice(0, 20)}…`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
export const equal = (a: Bytes, b: Bytes): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
export const ZERO32 = new Uint8Array(32);

const view = (b: Bytes) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const u8 = (n: number): Bytes => Uint8Array.of(n & 0xff);
export const u16 = (n: number): Bytes => { const b = new Uint8Array(2); view(b).setUint16(0, n); return b; };
export const u32 = (n: number): Bytes => { const b = new Uint8Array(4); view(b).setUint32(0, n >>> 0); return b; };
export const u64 = (n: bigint): Bytes => { const b = new Uint8Array(8); view(b).setBigUint64(0, n); return b; };
export const readU16 = (b: Bytes): number => view(b).getUint16(0);
export const readU32 = (b: Bytes): number => view(b).getUint32(0);
export const readU64 = (b: Bytes): bigint => view(b).getBigUint64(0);

export const fromBase64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const utf8 = (b: Bytes): string => new TextDecoder().decode(b);

/** SHA-512 の先頭 256 ビット（rippled の sha512Half） */
export const sha512Half = (...parts: Bytes[]): Bytes => sha512(concat(...parts)).subarray(0, 32);

/**
 * ハッシュの接頭辞（rippled include/xrpl/protocol/HashPrefix.h: 3 文字 + 0x00 の 32 ビット値）
 */
const prefix = (s: string): Bytes => Uint8Array.of(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), 0);
export const HashPrefix = {
  TransactionId: prefix("TXN"),
  TxNode: prefix("SND"),
  InnerNode: prefix("MIN"),
  LedgerMaster: prefix("LWR"),
  Validation: prefix("VAL"),
  Manifest: prefix("MAN"),
} as const;

/**
 * 可変長の長さ接頭辞（xrpl.org Binary Format「Length Prefixing」、rippled Serializer::addEncoded）
 * 0〜192: 1 バイト / 193〜12480: 2 バイト / 12481〜918744: 3 バイト
 */
export function vl(data: Bytes): Bytes {
  const n = data.length;
  let head: Bytes;
  if (n <= 192) head = u8(n);
  else if (n <= 12480) { const o = n - 193; head = Uint8Array.of(193 + (o >> 8), o & 0xff); }
  else if (n <= 918744) { const o = n - 12481; head = Uint8Array.of(241 + (o >> 16), (o >> 8) & 0xff, o & 0xff); }
  else throw new Error(`長すぎる: ${n}`);
  return concat(head, data);
}

/** 長さ接頭辞を読む。[長さ, 接頭辞のバイト数] */
export function readVL(b: Bytes, at: number): [number, number] {
  const b0 = b[at]!;
  if (b0 <= 192) return [b0, 1];
  if (b0 <= 240) return [193 + (b0 - 193) * 256 + b[at + 1]!, 2];
  if (b0 <= 254) return [12481 + (b0 - 241) * 65536 + b[at + 1]! * 256 + b[at + 2]!, 3];
  throw new Error(`長さ接頭辞が不正: ${b0}`);
}

/** 読み取り用のカーソル（受け取りパック用） */
export class Reader {
  constructor(private readonly b: Bytes, public at = 0) {}
  take(n: number): Bytes { if (this.at + n > this.b.length) throw new Error("データが足りない"); const r = this.b.subarray(this.at, this.at + n); this.at += n; return r; }
  u8(): number { return this.take(1)[0]!; }
  u16(): number { return readU16(this.take(2)); }
  vl(): Bytes { const [n, k] = readVL(this.b, this.at); this.at += k; return this.take(n); }
  done(): boolean { return this.at === this.b.length; }
}
