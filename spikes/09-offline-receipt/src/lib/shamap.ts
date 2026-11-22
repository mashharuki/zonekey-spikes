/**
 * トランザクションの木（SHAMap）の再計算と、1 件分の枝（証明）の作成・検証。
 * 根拠（rippled 3.4.1）:
 *   - 葉: sha512Half(HashPrefix::TxNode "SND\0", VL(tx) ‖ VL(meta), 鍵=txid)
 *       include/xrpl/shamap/SHAMapTxPlusMetaLeafNode.h updateHash()、src/libxrpl/ledger/Ledger.cpp rawTxInsert()
 *   - 内部ノード: sha512Half(HashPrefix::InnerNode "MIN\0", 子 16 個のハッシュ。空の子は 0)。子が 1 つもなければ 0
 *       src/libxrpl/shamap/SHAMapInnerNode.cpp updateHash()、include/xrpl/shamap/detail/TaggedPointer.ipp iterChildren()
 *   - 枝の選び方: 深さ d で鍵の d 番目の 4 ビット（偶数=上位、奇数=下位）
 *       src/libxrpl/shamap/SHAMapNodeID.cpp selectBranch()
 *   - txid: sha512Half(HashPrefix::TransactionId "TXN\0", tx)  src/libxrpl/protocol/STTx.cpp
 */
import { type Bytes, HashPrefix, ZERO32, concat, equal, sha512Half, vl } from "./bytes.js";

export const txId = (tx: Bytes): Bytes => sha512Half(HashPrefix.TransactionId, tx);
export const leafHash = (tx: Bytes, meta: Bytes, id: Bytes): Bytes => sha512Half(HashPrefix.TxNode, vl(tx), vl(meta), id);
export const nibble = (key: Bytes, depth: number): number => (depth % 2 === 0 ? key[depth >> 1]! >> 4 : key[depth >> 1]! & 0x0f);

export interface Item { key: Bytes; hash: Bytes }

const inner = (children: Bytes[]): Bytes => (children.every((c) => equal(c, ZERO32)) ? ZERO32 : sha512Half(HashPrefix.InnerNode, ...children));

/** 深さ depth の部分木のハッシュ。葉は「その枝に 1 件しかない最も浅い深さ」に置かれる（根は常に内部ノード） */
function subtree(items: Item[], depth: number): Bytes {
  if (items.length === 0) return ZERO32;
  if (items.length === 1 && depth > 0) return items[0]!.hash;
  if (depth >= 64) throw new Error("鍵が重複している");
  const groups: Item[][] = Array.from({ length: 16 }, () => []);
  for (const it of items) groups[nibble(it.key, depth)]!.push(it);
  return inner(groups.map((g) => subtree(g, depth + 1)));
}
export const rootHash = (items: Item[]): Bytes => subtree(items, 0);

/** 対象の葉から根までの各段の「兄弟 15 個」。空でない兄弟だけを持つ */
export interface ProofLevel { branch: number; siblings: (Bytes | null)[] }
export function proof(items: Item[], key: Bytes): ProofLevel[] {
  const levels: ProofLevel[] = [];
  let cur = items;
  for (let depth = 0; ; depth++) {
    const groups: Item[][] = Array.from({ length: 16 }, () => []);
    for (const it of cur) groups[nibble(it.key, depth)]!.push(it);
    const branch = nibble(key, depth);
    levels.push({ branch, siblings: groups.map((g, i) => (i === branch || g.length === 0 ? null : subtree(g, depth + 1))) });
    cur = groups[branch]!;
    if (!cur.some((x) => equal(x.key, key))) throw new Error("対象の tx が木にない");
    if (cur.length === 1) return levels;
  }
}

/** 枝だけから根を計算する（全トランザクションは不要） */
export function rootFromProof(levels: ProofLevel[], key: Bytes, leaf: Bytes): Bytes {
  let h = leaf;
  for (let d = levels.length - 1; d >= 0; d--) {
    const lv = levels[d]!;
    if (lv.branch !== nibble(key, d)) throw new Error(`枝の位置が鍵と合わない（深さ ${d}）`);
    h = inner(lv.siblings.map((s, i) => (i === lv.branch ? h : s ?? ZERO32)));
  }
  return h;
}

export const proofBytes = (levels: ProofLevel[]): number => levels.reduce((a, l) => a + 2 + 32 * l.siblings.filter(Boolean).length, 1);
export { concat };
