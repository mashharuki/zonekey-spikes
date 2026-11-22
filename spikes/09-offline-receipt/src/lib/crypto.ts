/**
 * rippled と同じ規則で署名を検証する。
 * 根拠: rippled src/libxrpl/protocol/PublicKey.cpp verify() / verifyDigest()
 *   - secp256k1 鍵（先頭 0x02/0x03）: メッセージの sha512Half に対する ECDSA（DER）。
 *     mustBeFullyCanonical のときは low-S のみ受け付ける。そうでなければ high-S も受け付ける（正規化して検証）
 *   - Ed25519 鍵（先頭 0xED + 32 バイト）: メッセージそのものに対する Ed25519。S が正規でなければ拒否
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Bytes, hex, sha512Half } from "./bytes.js";

export type KeyType = "secp256k1" | "ed25519";
export function keyType(pk: Bytes): KeyType | undefined {
  if (pk.length === 33 && pk[0] === 0xed) return "ed25519";
  if (pk.length === 33 && (pk[0] === 0x02 || pk[0] === 0x03)) return "secp256k1";
  return undefined;
}

export function verifyDigest(pk: Bytes, digest: Bytes, sig: Bytes, mustBeFullyCanonical = true): boolean {
  try {
    const s = secp256k1.Signature.fromHex(hex(sig), "der");
    if (mustBeFullyCanonical && s.hasHighS()) return false;
    return secp256k1.verify(s.toBytes("compact"), digest, pk, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

export function verify(pk: Bytes, message: Bytes, sig: Bytes, mustBeFullyCanonical = true): boolean {
  const t = keyType(pk);
  if (t === "secp256k1") return verifyDigest(pk, sha512Half(message), sig, mustBeFullyCanonical);
  if (t === "ed25519") {
    try { return ed25519.verify(sig, message, pk.subarray(1), { zip215: false }); } catch { return false; }
  }
  return false;
}
