/**
 * 持ち運び用の「受け取りパック」（この検証で決めた形式。XRPL の標準ではない）
 *   "ZKR1"(4) ‖ ヘッダ(118) ‖ VL(tx) ‖ VL(meta) ‖ 枝 ‖ u8 検証の数 ‖ VL(検証)…
 *   枝 = u8 段数 ‖ 段ごとに u16 ビット表（空でない兄弟）‖ 兄弟のハッシュ 32 バイト × ビット数
 *   （各段で対象が進む位置は txid から決まるので書かない）
 * 検証者リスト（VL）とマニフェストは「検証アプリに事前に入れておく」前提でパックに含めない。
 */
import { type Bytes, Reader, concat, u16, u8, utf8, vl } from "./bytes.js";
import { HEADER_BYTES, type Header, parseHeader, serializeHeader } from "./ledger.js";
import { type ProofLevel, nibble, txId } from "./shamap.js";

export const MAGIC = new TextEncoder().encode("ZKR1");

export function encodeReceipt(header: Header, tx: Bytes, meta: Bytes, proof: ProofLevel[], validations: Bytes[]): Bytes {
  const levels = proof.map((l) => {
    let bits = 0;
    const hs: Bytes[] = [];
    l.siblings.forEach((s, i) => { if (s) { bits |= 1 << i; hs.push(s); } });
    return concat(u16(bits), ...hs);
  });
  return concat(MAGIC, serializeHeader(header), vl(tx), vl(meta), u8(proof.length), ...levels, u8(validations.length), ...validations.map(vl));
}

export function decodeReceipt(b: Bytes) {
  const r = new Reader(b);
  if (utf8(r.take(4)) !== "ZKR1") throw new Error("受け取りパックではない");
  const header = parseHeader(r.take(HEADER_BYTES));
  const tx = r.vl(), meta = r.vl();
  const id = txId(tx);
  const n = r.u8();
  const proof: ProofLevel[] = [];
  for (let d = 0; d < n; d++) {
    const bits = r.u16();
    const siblings: (Bytes | null)[] = Array.from({ length: 16 }, (_, i) => ((bits >> i) & 1 ? r.take(32) : null));
    proof.push({ branch: nibble(id, d), siblings });
  }
  const validations: Bytes[] = [];
  const m = r.u8();
  for (let i = 0; i < m; i++) validations.push(r.vl());
  if (!r.done()) throw new Error("余分なバイトがある");
  return { header, tx, meta, proof, validations };
}
