/**
 * 検証 A / B / C の本体。入力はすべて手元のバイト列（ファイルから読む）。ネットワークは使わない。
 */
import { decode } from "ripple-binary-codec";
import { type Bytes, equal, hex, unhex } from "./bytes.js";
import { type Header, describe, ledgerHash, rippleTimeIso } from "./ledger.js";
import { type ProofLevel, type Item, leafHash, proof, rootFromProof, rootHash, txId } from "./shamap.js";
import { type Manifest, quorum, signingKeyMap, verifyVl } from "./unl.js";
import { checkValidation } from "./validation.js";

export interface StageA {
  ok: boolean; txCount: number; computedRoot: string; headerTxHash: string; rootMatches: boolean;
  targetTxId: string; targetIncluded: boolean; proofLevels: number; proofRootMatches: boolean;
  target: { TransactionType?: unknown; Account?: unknown; Destination?: unknown; TransactionResult?: unknown; delivered_amount?: unknown };
}
export interface StageB { ok: boolean; computedLedgerHash: string; expectedLedgerHash: string; header: ReturnType<typeof describe>; closeTimeIso: string }
export interface StageC {
  ok: boolean; reason?: string;
  vl?: { sequence: number; effective?: number; expiration: number; expirationIso: string; publisherOk: boolean; blobSignatureValid: boolean; inForceAtClose: boolean; unlSize: number; manifestsResolved: number };
  quorum?: number; trustedSigners?: number;
  validations?: { total: number; signatureValid: number; forThisLedger: number; trustedValidFull: number; untrustedOrUnknownKey: number };
  signers?: { master: string; domain?: string; signingTime?: number }[];
}

/** 段階 A: 全 tx から木の根を作り、ヘッダの transaction_hash と比べる。対象 tx の枝も作って確かめる */
export function stageA(target: { tx: Bytes; meta: Bytes }, all: { tx: Bytes; meta: Bytes }[], header: Header): StageA & { proof: ProofLevel[] } {
  const items: Item[] = all.map(({ tx, meta }) => { const id = txId(tx); return { key: id, hash: leafHash(tx, meta, id) }; });
  const root = rootHash(items);
  const id = txId(target.tx);
  const leaf = leafHash(target.tx, target.meta, id);
  const targetIncluded = items.some((x) => equal(x.key, id) && equal(x.hash, leaf));
  const p = targetIncluded ? proof(items, id) : [];
  const proofRootMatches = targetIncluded && equal(rootFromProof(p, id, leaf), header.txHash);
  // 表示用のデコード（検証には使わない）。改ざんしたバイト列では失敗しうるので落とさない
  const safe = (b: Bytes): Record<string, unknown> => { try { return decode(hex(b)) as Record<string, unknown>; } catch { return {}; } };
  const tx = safe(target.tx);
  const meta = safe(target.meta);
  // EscrowFinish は tx に Destination がないので、meta で削除された Escrow の FinalFields から受取人と額を読む（表示用）
  const escrow = ((meta["AffectedNodes"] as Record<string, Record<string, unknown>>[] | undefined) ?? [])
    .map((n) => n["DeletedNode"]).find((d) => d?.["LedgerEntryType"] === "Escrow")?.["FinalFields"] as Record<string, unknown> | undefined;
  const rootMatches = equal(root, header.txHash);
  return {
    ok: rootMatches && targetIncluded && proofRootMatches, txCount: items.length, computedRoot: hex(root), headerTxHash: hex(header.txHash),
    rootMatches, targetTxId: hex(id), targetIncluded, proofLevels: p.length, proofRootMatches, proof: p,
    target: { TransactionType: tx["TransactionType"], Account: tx["Account"], Destination: tx["Destination"] ?? escrow?.["Destination"], TransactionResult: meta["TransactionResult"], delivered_amount: meta["DeliveredAmount"] ?? escrow?.["Amount"] ?? tx["Amount"] },
  };
}

/** 枝だけでの段階 A（受け取りパック用） */
export function stageAFromProof(target: { tx: Bytes; meta: Bytes }, p: ProofLevel[], header: Header) {
  const id = txId(target.tx);
  const root = rootFromProof(p, id, leafHash(target.tx, target.meta, id));
  return { ok: equal(root, header.txHash), computedRoot: hex(root), headerTxHash: hex(header.txHash), targetTxId: hex(id), proofLevels: p.length };
}

/** 段階 B: ヘッダのフィールドから ledger_hash を再計算 */
export function stageB(header: Header, expectedLedgerHash: Bytes): StageB {
  const h = ledgerHash(header);
  return { ok: equal(h, expectedLedgerHash), computedLedgerHash: hex(h), expectedLedgerHash: hex(expectedLedgerHash), header: describe(header), closeTimeIso: rippleTimeIso(header.closeTime) };
}

/** 段階 C: 信頼する検証者（VL）の署名が定足数そろっているか。ledgerHash は段階 B で再計算した値を渡す */
export function stageC(header: Header, ledgerHashBytes: Bytes, validations: Bytes[] | undefined, vlJson: Record<string, unknown> | undefined, extraManifests: Manifest[], trustAnchor?: string): StageC {
  if (!validations) return { ok: false, reason: "このレジャーへの検証者の署名（validation）を持っていない。validations ストリームは受信時点のものしか流れず、過去のレジャーの検証を後から取る公開 API はない" };
  if (!vlJson) return { ok: false, reason: "検証者リスト（VL）を持っていない" };
  const lists = verifyVl(vlJson, trustAnchor);
  // 有効なリスト: 発行者が信頼の起点と一致・署名が正しい・レジャーの close_time が有効期間内
  const usable = lists.filter((l) => l.publisherMatchesTrustAnchor && l.blobSignatureValid && (l.effective ?? 0) <= header.closeTime && header.closeTime < l.expiration);
  const l = usable[0] ?? lists[0]!;
  const keyMap = signingKeyMap(l, extraManifests);
  const vlInfo = {
    sequence: l.sequence, effective: l.effective, expiration: l.expiration, expirationIso: rippleTimeIso(l.expiration),
    publisherOk: l.publisherMatchesTrustAnchor && l.publisher.valid, blobSignatureValid: l.blobSignatureValid,
    inForceAtClose: (l.effective ?? 0) <= header.closeTime && header.closeTime < l.expiration, unlSize: l.validators.length, manifestsResolved: keyMap.size,
  };
  if (!usable.length) return { ok: false, reason: "検証者リストを信頼できない（発行者・署名・有効期間のいずれか）", vl: vlInfo };
  const lh = hex(ledgerHashBytes);
  const checked = validations.map((raw) => ({ raw, v: checkValidation(raw) }));
  const signers = new Map<string, { master: string; domain?: string; signingTime?: number }>();
  let untrusted = 0;
  for (const { v } of checked) {
    const who = keyMap.get(v.signingKey);
    if (!who) { untrusted++; continue; }
    if (v.signatureValid && v.full && v.ledgerHash === lh && v.ledgerSeq === header.seq) signers.set(hex(who.master), { master: hex(who.master), domain: who.domain, signingTime: v.signingTime });
  }
  const q = quorum(l.validators.length);
  return {
    ok: signers.size >= q, vl: vlInfo, quorum: q, trustedSigners: signers.size,
    validations: {
      total: checked.length, signatureValid: checked.filter((x) => x.v.signatureValid).length, forThisLedger: checked.filter((x) => x.v.ledgerHash === lh).length,
      trustedValidFull: signers.size, untrustedOrUnknownKey: untrusted,
    },
    signers: [...signers.values()],
    ...(signers.size < q ? { reason: `信頼する検証者の正しい署名が ${signers.size} 件で、定足数 ${q} に足りない` } : {}),
  };
}

/** 定足数ちょうどの、信頼できる正しい検証だけを選ぶ（受け取りパック用） */
export function pickQuorumValidations(header: Header, ledgerHashBytes: Bytes, validations: Bytes[], vlJson: Record<string, unknown>, extra: Manifest[]): Bytes[] {
  const l = verifyVl(vlJson).find((x) => x.publisherMatchesTrustAnchor && x.blobSignatureValid)!;
  const keyMap = signingKeyMap(l, extra);
  const seen = new Set<string>();
  const out: Bytes[] = [];
  for (const raw of validations) {
    const v = checkValidation(raw);
    const who = keyMap.get(v.signingKey);
    if (!who || !v.signatureValid || !v.full || v.ledgerHash !== hex(ledgerHashBytes) || v.ledgerSeq !== header.seq || seen.has(hex(who.master))) continue;
    seen.add(hex(who.master));
    out.push(raw);
  }
  return out.slice(0, quorum(l.validators.length));
}

export { unhex };
