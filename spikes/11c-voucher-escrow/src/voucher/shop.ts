/**
 * お店の端末側: オンライン中に同期した「自店宛ての Escrow 一覧」だけを使って、券をオフラインで確かめる。ネットワークは使わない
 * 確かめる順: 形式 → 自店宛ての一覧にあるか → 使用済みか → 期限（CancelAfter − 余裕）→ SHA-256(preimage) と Condition → 端末の署名（Memo に公開鍵のハッシュがある券だけ）
 */
import { PK_MEMO_TYPE, conditionOf, decodeVoucher, hex, sha256, signedMessage, verifySig } from "./core.js";

export interface SyncedEscrow {
  /** Escrow の ledger index */
  index: string;
  owner: string;
  offerSequence: number;
  destination: string;
  amount: { currency: string; issuer: string; value: string };
  condition: string;
  cancelAfter: number;
  /** EscrowCreate の Memo（todoke/pk-sha256）。あれば端末の署名が必須 */
  pkHash?: string;
  createTx: string;
}
export interface ShopCtx { shop: string; nowRipple: number; marginSec: number; used: Set<string> }
export type ShopResult = { ok: true; reason: "使える"; escrow: SyncedEscrow; fulfillmentHex: string } | { ok: false; reason: string };

export const REASONS = {
  ok: "使える",
  format: "形式が不正",
  notMine: "このお店宛ての券ではない（または未同期）",
  used: "使用済み",
  expired: "期限切れ（精算が間に合わない）",
  preimage: "preimage が条件と合わない",
  noSig: "端末の署名がない",
  wrongKey: "端末の公開鍵が券と合わない",
  badSig: "署名が合わない",
} as const;

export async function verifyVoucher(qr: Uint8Array, list: SyncedEscrow[], ctx: ShopCtx): Promise<ShopResult> {
  const v = decodeVoucher(qr);
  if (!v) return { ok: false, reason: REASONS.format };
  const e = list.find((x) => x.owner === v.owner && x.offerSequence === v.offerSequence && x.destination === ctx.shop);
  if (!e) return { ok: false, reason: REASONS.notMine };
  if (ctx.used.has(e.index)) return { ok: false, reason: REASONS.used };
  if (e.cancelAfter - ctx.marginSec <= ctx.nowRipple) return { ok: false, reason: REASONS.expired };
  const { conditionHex, fulfillmentHex } = await conditionOf(v.preimage);
  if (conditionHex !== e.condition.toUpperCase()) return { ok: false, reason: REASONS.preimage };
  if (e.pkHash) {
    if (!v.sig) return { ok: false, reason: REASONS.noSig };
    if (hex(await sha256(v.sig.pub)) !== e.pkHash.toUpperCase()) return { ok: false, reason: REASONS.wrongKey };
    if (!(await verifySig(v.sig.pub, v.sig.sig, signedMessage(v.owner, v.offerSequence, ctx.shop)))) return { ok: false, reason: REASONS.badSig };
  }
  return { ok: true, reason: REASONS.ok, escrow: e, fulfillmentHex };
}

export { PK_MEMO_TYPE };
