/**
 * 検証者リスト（Validator List, VL）とマニフェストの検証。
 * 根拠:
 *   - xrpl.org Validator List Method（外側: public_key / manifest / blob / signature / version、blob: sequence / expiration / validators）
 *   - XLS-45（version 2: blobs_v2、effective）
 *   - rippled src/xrpld/app/misc/detail/ValidatorList.cpp ValidatorList::verify()
 *       発行者マニフェストの署名鍵（ephemeral）で base64 を戻した blob の生バイトを検証
 *   - rippled src/libxrpl/server/Manifest.cpp Manifest::verify()
 *       "MAN\0" ‖ 署名フィールドを除いたマニフェスト を、署名鍵（sfSignature）と主鍵（sfMasterSignature）の両方で検証。
 *       Sequence が 0xFFFFFFFF なら主鍵の失効（署名鍵なし）
 *   - Testnet の発行元と鍵: rippled cfg/validators-example.txt
 *       https://vl.altnet.rippletest.net / ED264807102805220DA0F312E71FC2C69E1552C9C5790F6C25E3729DEB573D5860
 */
import { type Bytes, HashPrefix, concat, equal, hex, unhex } from "./bytes.js";
import { verify } from "./crypto.js";
import { F, get, getU32, withoutSigningFields } from "./stobject.js";

export const TESTNET_VL_SITE = "https://vl.altnet.rippletest.net";
export const TESTNET_VL_PUBLISHER_KEY = "ED264807102805220DA0F312E71FC2C69E1552C9C5790F6C25E3729DEB573D5860";

export interface Manifest { master: Bytes; signingKey?: Bytes; sequence: number; domain?: string; revoked: boolean; valid: boolean; raw: Bytes }

const decodeManifestText = (s: string): Bytes => (/^[0-9A-Fa-f]+$/.test(s) ? unhex(s) : new Uint8Array(Buffer.from(s, "base64")));

export function parseManifest(raw: Bytes): Manifest {
  const master = get(raw, F.PublicKey);
  const sequence = getU32(raw, F.Sequence);
  const masterSig = get(raw, F.MasterSignature);
  if (!master || sequence === undefined || !masterSig) throw new Error("マニフェストに必須フィールドがない");
  const signingKey = get(raw, F.SigningPubKey);
  const sig = get(raw, F.Signature);
  const domain = get(raw, F.Domain);
  const revoked = sequence === 0xffffffff;
  const data = concat(HashPrefix.Manifest, withoutSigningFields(raw));
  const valid = (revoked || (!!signingKey && !!sig && verify(signingKey, data, sig))) && verify(master, data, masterSig);
  return { master, signingKey, sequence, domain: domain ? Buffer.from(domain).toString("ascii") : undefined, revoked, valid, raw };
}
export const parseManifestText = (s: string) => parseManifest(decodeManifestText(s));

export interface UnlValidator { master: Bytes; manifest?: Manifest }
export interface Unl {
  publisher: Manifest; sequence: number; effective?: number; expiration: number; validators: UnlValidator[];
  blobSignatureValid: boolean; publisherMatchesTrustAnchor: boolean;
}

/** VL を検証する。trustAnchor は事前に持っておく発行者の主鍵（hex） */
export function verifyVl(vl: Record<string, unknown>, trustAnchor = TESTNET_VL_PUBLISHER_KEY): Unl[] {
  const topManifest = typeof vl["manifest"] === "string" ? (vl["manifest"] as string) : undefined;
  const entries: { blob: string; signature: string; manifest?: string }[] =
    Array.isArray(vl["blobs_v2"]) ? (vl["blobs_v2"] as { blob: string; signature: string; manifest?: string }[]) : [{ blob: String(vl["blob"]), signature: String(vl["signature"]) }];
  return entries.map((e) => {
    const publisher = parseManifestText(e.manifest ?? topManifest!);
    const blob = new Uint8Array(Buffer.from(e.blob, "base64"));
    const blobSignatureValid = publisher.valid && !publisher.revoked && !!publisher.signingKey && verify(publisher.signingKey, blob, unhex(e.signature));
    const list = JSON.parse(Buffer.from(blob).toString("utf8")) as { sequence: number; expiration: number; effective?: number; validators: { validation_public_key: string; manifest?: string }[] };
    return {
      publisher, sequence: list.sequence, effective: list.effective, expiration: list.expiration, blobSignatureValid,
      publisherMatchesTrustAnchor: equal(publisher.master, unhex(trustAnchor)),
      validators: list.validators.map((v) => ({ master: unhex(v.validation_public_key), manifest: v.manifest ? parseManifestText(v.manifest) : undefined })),
    };
  });
}

/**
 * 主鍵 → 署名鍵の対応表。VL 内のマニフェストと、manifest メソッドで別に取ったものを合わせ、
 * 主鍵で正しく署名された中で Sequence が最大のものを採る（Manifest.cpp と同じ「大きい Sequence が古いものを無効にする」）
 */
export function signingKeyMap(unl: Unl, extra: Manifest[]): Map<string, { master: Bytes; signingKey: Bytes; sequence: number; domain?: string }> {
  const best = new Map<string, Manifest>();
  const masters = new Set(unl.validators.map((v) => hex(v.master)));
  for (const m of [...unl.validators.flatMap((v) => (v.manifest ? [v.manifest] : [])), ...extra]) {
    const k = hex(m.master);
    if (!masters.has(k) || !m.valid) continue;
    if (!best.has(k) || best.get(k)!.sequence < m.sequence) best.set(k, m);
  }
  const out = new Map<string, { master: Bytes; signingKey: Bytes; sequence: number; domain?: string }>();
  for (const [k, m] of best) if (!m.revoked && m.signingKey) out.set(hex(m.signingKey), { master: m.master, signingKey: m.signingKey, sequence: m.sequence, domain: m.domain ?? k });
  return out;
}

/** 定足数。rippled ValidatorList::calculateQuorum(): max(ceil(有効UNL×0.8), ceil(UNL×0.6))。有効 UNL が分からないときは UNL 全体を使う（厳しい側） */
export const quorum = (unlSize: number, effectiveUnlSize = unlSize): number => Math.max(Math.ceil(effectiveUnlSize * 0.8), Math.ceil(unlSize * 0.6));
