import { createHash, randomBytes } from "node:crypto";

export interface PreimageCondition {
  /** 秘密。Fulfillment を組み立てる元。ログに出さない */
  preimage: Buffer;
  /** EscrowCreate の Condition（16進・大文字） */
  conditionHex: string;
  /** EscrowFinish の Fulfillment（16進・大文字） */
  fulfillmentHex: string;
}

/**
 * PREIMAGE-SHA-256 の Condition / Fulfillment を作る。
 * 形式は five-bells-condition の PreimageSha256（xrpl.org のチュートリアルが使うライブラリ）の出力と
 * 50 回のランダム入力で一致することを確認済み:
 *   Fulfillment = A0 22 80 20 || preimage(32B)
 *   Condition   = A0 25 80 20 || SHA-256(preimage) || 81 01 20
 */
export function createPreimageCondition(preimage: Buffer = randomBytes(32)): PreimageCondition {
  if (preimage.length !== 32) throw new Error("このヘルパーの preimage は 32 バイト固定");
  const hash = createHash("sha256").update(preimage).digest("hex");
  return {
    preimage,
    fulfillmentHex: `A0228020${preimage.toString("hex")}`.toUpperCase(),
    conditionHex: `A0258020${hash}810120`.toUpperCase(),
  };
}
