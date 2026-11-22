/**
 * 受け取りパック 1 つを検証する入口（Node とブラウザで共通）。spike 10 の PWA がこれを呼ぶ。
 * 入力: パックのバイト列（そのまま、または deflate-raw で圧縮したもの）と、事前に持っておく検証者リスト（VL）・マニフェスト
 * 判定: 確定済み = A（対象 tx がヘッダの木に入っている）かつ C（ヘッダから計算した ledger_hash に、
 *       信頼する検証者が定足数以上署名している）かつ 取引の結果が tesSUCCESS
 * B（ヘッダ → ledger_hash）は C が署名を確かめる相手の値を作る段階。パック単体では比べる「期待値」はない。
 */
import { type Bytes, equal, hex } from "./bytes.js";
import { describeTarget, stageAFromProof, stageC } from "./check.js";
import { ledgerHash, rippleTimeIso } from "./ledger.js";
import { MAGIC, decodeReceipt } from "./receipt.js";
import { TESTNET_VL_PUBLISHER_KEY, parseManifestText } from "./unl.js";

export interface Trust { vl: Record<string, unknown>; manifests: string[]; publisherKey?: string }

async function inflateRaw(b: Bytes): Promise<Bytes> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(Uint8Array.from(b)).then(() => writer.close()).catch(() => undefined);
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** パックそのままならそのまま、そうでなければ deflate-raw の展開を試す */
export async function unpack(input: Bytes): Promise<{ bytes: Bytes; compressed: boolean }> {
  if (input.length >= 4 && equal(input.subarray(0, 4), MAGIC)) return { bytes: input, compressed: false };
  const bytes = await inflateRaw(input);
  if (!equal(bytes.subarray(0, 4), MAGIC)) throw new Error("受け取りパックではない（先頭が ZKR1 でない）");
  return { bytes, compressed: true };
}

export async function verifyReceipt(input: Bytes, trust: Trust) {
  const started = performance.now();
  const { bytes, compressed } = await unpack(input);
  const r = decodeReceipt(bytes);
  const A = stageAFromProof({ tx: r.tx, meta: r.meta }, r.proof, r.header);
  const lh = ledgerHash(r.header);
  const C = stageC(r.header, lh, r.validations.length ? r.validations : undefined, trust.vl, trust.manifests.map(parseManifestText), trust.publisherKey ?? TESTNET_VL_PUBLISHER_KEY);
  const target = describeTarget(r.tx, r.meta);
  const succeeded = target.TransactionResult === "tesSUCCESS";
  const reasons = [
    ...(A.ok ? [] : ["A: 対象の取引がヘッダの木に入っていない（取引・meta・枝のどれかが違う）"]),
    ...(C.ok ? [] : [r.validations.length ? `C: ${C.reason ?? "検証者の署名が足りない"}` : "C: パックに検証者の署名が入っていない（A・B だけのパック）。確定したことは確かめられない"]),
    ...(succeeded ? [] : [`取引の結果が tesSUCCESS ではない（${String(target.TransactionResult ?? "読めない")}）`]),
  ];
  return {
    confirmed: A.ok && C.ok && succeeded, reasons,
    input: { bytes: input.length, unpackedBytes: bytes.length, compressed },
    target, txId: A.targetTxId,
    ledger: { index: r.header.seq, hash: hex(lh), closeTime: rippleTimeIso(r.header.closeTime) },
    A: { ok: A.ok, proofLevels: A.proofLevels },
    C: { ok: C.ok, signers: C.trustedSigners ?? 0, quorum: C.quorum, unlSize: C.vl?.unlSize, vlSequence: C.vl?.sequence, vlExpiration: C.vl?.expirationIso },
    ms: Math.round((performance.now() - started) * 10) / 10,
  };
}
export type Verdict = Awaited<ReturnType<typeof verifyReceipt>>;
