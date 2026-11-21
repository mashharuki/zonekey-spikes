// xrpl.js の型エクスポート確認用。存在しない名前は TS2305 として報告される（src/types.ts が解析）。
import type {
  Batch,
  CredentialAccept,
  CredentialCreate,
  DIDSet,
  EscrowCreate,
  OracleSet,
} from "xrpl";

export type Probed = [Batch, CredentialCreate, CredentialAccept, OracleSet, DIDSet, EscrowCreate];

type EscrowAmount = EscrowCreate["Amount"];

// 行番号→マーカー名で src/types.ts が判定する。true を代入できなければ（= false 型なら）エラーになる。
// CHECK_ESCROW_XRP: XRP の drops 文字列
export const CHECK_ESCROW_XRP: string extends EscrowAmount ? true : false = true;
// CHECK_ESCROW_IOU: Trust Line Token（currency/issuer/value）
export const CHECK_ESCROW_IOU: { currency: string; issuer: string; value: string } extends EscrowAmount
  ? true
  : false = true;
// CHECK_ESCROW_MPT: MPT（mpt_issuance_id/value）
export const CHECK_ESCROW_MPT: { mpt_issuance_id: string; value: string } extends EscrowAmount
  ? true
  : false = true;
