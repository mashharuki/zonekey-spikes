/**
 * 検証者の検証（STValidation）の署名検証。
 * 根拠（rippled 3.4.1）:
 *   - src/libxrpl/protocol/STValidation.cpp getSigningHash(): STObject::getSigningHash(HashPrefix::Validation "VAL\0")
 *   - src/libxrpl/protocol/STObject.cpp getSigningHash(): sha512Half(prefix ‖ 署名フィールドを除いたシリアライズ)
 *   - src/libxrpl/protocol/STValidation.cpp isValid(): verifyDigest(署名鍵, 署名ハッシュ, sfSignature, flags & vfFullyCanonicalSig)
 *   - src/xrpld/app/misc/NetworkOPs.cpp pubValidation(): validations ストリームの data = 署名付きの生バイト（hex）
 *   - 旗: vfFullValidation 0x00000001 / vfFullyCanonicalSig 0x80000000（include/xrpl/protocol/STValidation.h）
 */
import { type Bytes, HashPrefix, concat, hex, sha512Half } from "./bytes.js";
import { verifyDigest } from "./crypto.js";
import { F, get, getU32, withoutSigningFields } from "./stobject.js";

export const vfFullValidation = 0x00000001;
export const vfFullyCanonicalSig = 0x80000000;

export interface Validation { ledgerHash: string; ledgerSeq?: number; signingKey: string; flags: number; full: boolean; signingTime?: number; networkId?: number; signatureValid: boolean; bytes: number }

export function checkValidation(raw: Bytes): Validation {
  const flags = getU32(raw, F.Flags) ?? 0;
  const lh = get(raw, F.LedgerHash);
  const pk = get(raw, F.SigningPubKey);
  const sig = get(raw, F.Signature);
  if (!lh || !pk || !sig) throw new Error("検証に LedgerHash / SigningPubKey / Signature がない");
  const digest = sha512Half(concat(HashPrefix.Validation, withoutSigningFields(raw)));
  return {
    ledgerHash: hex(lh), ledgerSeq: getU32(raw, F.LedgerSequence), signingKey: hex(pk), flags,
    full: (flags & vfFullValidation) !== 0, signingTime: getU32(raw, F.SigningTime), networkId: getU32(raw, F.NetworkID),
    signatureValid: verifyDigest(pk, digest, sig, (flags & vfFullyCanonicalSig) !== 0), bytes: raw.length,
  };
}
