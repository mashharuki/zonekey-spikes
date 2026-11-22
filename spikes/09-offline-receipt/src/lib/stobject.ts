/**
 * XRPL の正規バイナリ（STObject）のフィールドを、元のバイトを保ったまま切り出す最小の読み取り器。
 * 署名対象のバイト列は「署名フィールドを除いたバイト列」なので、再エンコードせずに該当範囲だけを抜く。
 * 根拠: xrpl.org Binary Format（Field IDs / Type List / Length Prefixing）
 *       rippled STObject::getSigningHash（src/libxrpl/protocol/STObject.cpp）
 */
import { type Bytes, concat, readU32, readVL } from "./bytes.js";

export interface Field { type: number; nth: number; start: number; end: number; valueStart: number }

/** 固定長の型（バイト数）。可変長（VL）の型は別扱い */
const FIXED: Record<number, number> = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 32, 16: 1, 17: 20, 20: 12, 21: 24, 22: 48, 23: 64 };
const VL_TYPES = new Set([7, 8, 19]); // Blob, AccountID, Vector256

export function fields(b: Bytes): Field[] {
  const out: Field[] = [];
  let i = 0;
  while (i < b.length) {
    const start = i;
    const h = b[i++]!;
    let type = h >> 4, nth = h & 0x0f;
    if (type === 0 && nth === 0) { type = b[i++]!; nth = b[i++]!; }      // 3 バイト
    else if (type === 0) { type = b[i++]!; }                             // 型 ≥ 16
    else if (nth === 0) { nth = b[i++]!; }                               // フィールド ≥ 16
    const valueStart = i;
    if (FIXED[type] !== undefined) i += FIXED[type]!;
    else if (VL_TYPES.has(type)) { const [n, k] = readVL(b, i); i += k + n; }
    else if (type === 6) { const a = b[i]!; i += a & 0x80 ? 48 : a & 0x20 ? 33 : 8; } // Amount: IOU / MPT / XRP
    else throw new Error(`この読み取り器が扱わない型: type=${type} nth=${nth} at=${start}`);
    if (i > b.length) throw new Error("フィールドが途中で切れている");
    out.push({ type, nth, start, end: i, valueStart });
  }
  return out;
}

export function value(b: Bytes, f: Field): Bytes {
  const raw = b.subarray(f.valueStart, f.end);
  if (VL_TYPES.has(f.type)) { const [, k] = readVL(raw, 0); return raw.subarray(k); }
  return raw;
}

export const find = (b: Bytes, type: number, nth: number): Bytes | undefined => {
  const f = fields(b).find((x) => x.type === type && x.nth === nth);
  return f ? value(b, f) : undefined;
};

/**
 * 署名対象外（kNotSigning）のフィールド。rippled include/xrpl/protocol/detail/sfields.macro
 *   sfSignature       VL(7) 6  kNotSigning
 *   sfMasterSignature VL(7) 18 kNotSigning
 */
export const NOT_SIGNING: [number, number][] = [[7, 6], [7, 18]];

export function withoutSigningFields(b: Bytes): Bytes {
  const keep = fields(b).filter((f) => !NOT_SIGNING.some(([t, n]) => f.type === t && f.nth === n));
  return concat(...keep.map((f) => b.subarray(f.start, f.end)));
}

/** 型・フィールド番号（ripple-binary-codec の definitions.json と同じ番号） */
export const F = {
  Flags: [2, 2], LedgerSequence: [2, 6], SigningTime: [2, 9], Sequence: [2, 4], NetworkID: [2, 1],
  LedgerHash: [5, 1], ConsensusHash: [5, 23], ValidatedHash: [5, 25],
  PublicKey: [7, 1], SigningPubKey: [7, 3], Signature: [7, 6], Domain: [7, 7], MasterSignature: [7, 18],
  Version: [1, 16],
} as const satisfies Record<string, readonly [number, number]>;
export const get = (b: Bytes, f: readonly [number, number]) => find(b, f[0], f[1]);
export const getU32 = (b: Bytes, f: readonly [number, number]) => { const v = get(b, f); return v ? readU32(v) : undefined; };
