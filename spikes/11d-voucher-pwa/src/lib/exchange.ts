/**
 * iPhone（世帯・お店）と Mac（発行・精算のスクリプト）の間で受け渡す JSON の形。どれも秘密を含まない
 * - request: 世帯 → 発行。Condition（preimage のハッシュ）と端末の公開鍵のハッシュだけ
 * - vouchers: 発行 → 世帯。作った Escrow の番号（OfferSequence）など台帳に公開されている値
 * - shop-sync: 発行 → お店。自店宛ての Escrow の一覧（spike 11c の同期と同じ内容）
 * - claims: お店 → 精算。受け付けた券の Fulfillment（受け付けた時点でお店のものになる値）
 */
import type { SyncedEscrow } from '../../../11c-voucher-escrow/src/voucher/shop';

/** MVP の券の組み合わせ: 500 円券 2 枚・1,000 円券 2 枚（受給証 5 = 500 円、10 = 1,000 円とみなす） */
export const PLAN = [
  { n: 1, value: '5', label: '500 円券' },
  { n: 2, value: '5', label: '500 円券' },
  { n: 3, value: '10', label: '1,000 円券' },
  { n: 4, value: '10', label: '1,000 円券' },
] as const;
export const labelOf = (value: string) => (value === '10' ? '1,000 円券' : value === '5' ? '500 円券' : `受給証 ${value}`);

export interface RequestFile { kind: 'todoke-11d-request'; household: string; pkHash: string; vouchers: { n: number; value: string; condition: string }[] }
export interface VouchersFile {
  kind: 'todoke-11d-vouchers'; household: string; owner: string; shop: string; currency: string; issuer: string; batchTx: string;
  vouchers: { n: number; value: string; offerSequence: number; condition: string; cancelAfter: number }[];
}
export interface ShopSyncFile { kind: 'todoke-11d-shop'; shop: string; syncedAt: string; list: SyncedEscrow[] }
export interface Claim { index: string; offerSequence: number; owner: string; value: string; fulfillmentHex: string; at: string; verifyMs: number }
export interface ClaimsFile { kind: 'todoke-11d-claims'; shop: string; claims: Claim[] }

export function download(name: string, data: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name;
  a.click();
}
