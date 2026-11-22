/**
 * 検証 C の実装の自己確認（ネット不要・合成データ）。
 * 合成した発行者・検証者の鍵で、マニフェスト・VL・検証を ripple-keypairs と ripple-binary-codec で作り、
 * 正しい組では通り、各種の不正では落ちることを確かめる。実データとの一致は verify で確かめる。
 */
import { encode } from "ripple-binary-codec";
import { deriveKeypair, generateSeed, sign } from "ripple-keypairs";
import { HashPrefix, ZERO32, concat, hex, unhex } from "./lib/bytes.js";
import { stageC } from "./lib/check.js";
import { type Header, ledgerHash } from "./lib/ledger.js";

type KP = ReturnType<typeof deriveKeypair>;
const kp = (algorithm: "ed25519" | "ecdsa-secp256k1"): KP => deriveKeypair(generateSeed({ algorithm }));
function manifest(master: KP, eph: KP, seq: number): string {
  const body = { PublicKey: master.publicKey, Sequence: seq, SigningPubKey: eph.publicKey };
  const data = hex(concat(HashPrefix.Manifest, unhex(encode(body))));
  return encode({ ...body, Signature: sign(data, eph.privateKey), MasterSignature: sign(data, master.privateKey) });
}
const b64 = (h: string) => Buffer.from(h, "hex").toString("base64");

const header: Header = { seq: 1000, drops: 99n, parentHash: ZERO32, txHash: ZERO32, accountHash: ZERO32, parentCloseTime: 800000000, closeTime: 800000010, closeTimeResolution: 10, closeFlags: 0 };
const lh = hex(ledgerHash(header));
const pubM = kp("ed25519"), pubE = kp("ecdsa-secp256k1");
const vals = Array.from({ length: 10 }, () => ({ m: kp("ed25519"), e: kp("ecdsa-secp256k1") }));
const blob = Buffer.from(JSON.stringify({ sequence: 1, expiration: 900000000, validators: vals.map((v) => ({ validation_public_key: v.m.publicKey, manifest: b64(manifest(v.m, v.e, 1)) })) })).toString("base64");
const vl = { public_key: pubM.publicKey, manifest: b64(manifest(pubM, pubE, 1)), blob, signature: sign(Buffer.from(blob, "base64").toString("hex"), pubE.privateKey), version: 1 };
const validation = (e: KP, ledger = lh, flags = 0x80000001) => {
  const body = { Flags: flags, LedgerSequence: 1000, SigningTime: 800000011, LedgerHash: ledger, SigningPubKey: e.publicKey };
  return unhex(encode({ ...body, Signature: sign(hex(concat(HashPrefix.Validation, unhex(encode(body)))), e.privateKey) }));
};

// 鍵の入れ替え（新しいマニフェストを manifest メソッドで別に持っている場合）
const rotated = kp("ecdsa-secp256k1");
const { parseManifestText } = await import("./lib/unl.js");
const newer = parseManifestText(manifest(vals[0]!.m, rotated, 2));

const cases: [string, boolean, Uint8Array[], string?, Record<string, unknown>?, ReturnType<typeof parseManifestText>[]?][] = [
  ["10 人中 8 人が正しく署名（定足数 8）", true, vals.slice(0, 8).map((v) => validation(v.e))],
  ["10 人中 7 人（定足数未満）", false, vals.slice(0, 7).map((v) => validation(v.e))],
  ["同じ検証者の重複は 1 人と数える", false, [...vals.slice(0, 7), vals[0]!].map((v) => validation(v.e))],
  ["別のレジャーへの署名", false, vals.slice(0, 8).map((v) => validation(v.e, "11".repeat(32)))],
  ["部分検証（Full でない）", false, vals.slice(0, 8).map((v) => validation(v.e, lh, 0x80000000))],
  ["リストにない鍵", false, Array.from({ length: 8 }, () => validation(kp("ecdsa-secp256k1")))],
  ["信頼の起点（発行者の鍵）が違う", false, vals.slice(0, 8).map((v) => validation(v.e)), kp("ed25519").publicKey],
  ["blob を書き換え（発行者の署名が合わない）", false, vals.slice(0, 8).map((v) => validation(v.e)), undefined, { ...vl, blob: Buffer.from(Buffer.from(blob, "base64").toString().replace('"sequence":1', '"sequence":2')).toString("base64") }],
  ["鍵を入れ替えた検証者（新マニフェストあり）", true, [validation(rotated), ...vals.slice(1, 8).map((v) => validation(v.e))], undefined, undefined, [newer]],
  ["鍵を入れ替えた検証者（新マニフェストなし）", false, [validation(rotated), ...vals.slice(1, 8).map((v) => validation(v.e))]],
];
let pass = 0;
for (const [label, expect, vs, anchor, vlj, extra] of cases) {
  const c = stageC(header, unhex(lh), vs, vlj ?? vl, extra ?? [], anchor ?? pubM.publicKey);
  const good = c.ok === expect;
  pass += good ? 1 : 0;
  console.log(`${good ? "✅" : "❌"} ${label}: ok=${c.ok}（期待 ${expect}）signers=${c.trustedSigners ?? "-"} quorum=${c.quorum ?? "-"} ${c.reason ?? ""}`);
}
console.log(`[09] selftest ${pass}/${cases.length}`);
if (pass !== cases.length) process.exitCode = 1;
