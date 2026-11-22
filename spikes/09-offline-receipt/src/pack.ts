/**
 * 段階 5: 持ち運び。検証に要る最小のデータを決め、大きさを測り、QR コード 1 つに入るかを試す（ネット不要）
 *   pnpm --filter 09-offline-receipt receipt
 * receipts/<name>-ab.bin（A・B だけ）/ <name>-abc.bin（C の署名つき）を書き出す
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import QRCode from "qrcode";
import { type Bytes, vl } from "./lib/bytes.js";
import { bundleNames, loadBundle } from "./lib/bundle.js";
import { pickQuorumValidations, stageA } from "./lib/check.js";
import { ledgerHash } from "./lib/ledger.js";
import { encodeReceipt } from "./lib/receipt.js";

const out = (p: string) => new URL(`../${p}`, import.meta.url);
mkdirSync(out("receipts/"), { recursive: true });
mkdirSync(out("results/"), { recursive: true });

/** QR コードに入るか（バイトモード）。誤り訂正 L / M で試し、入れば型番（1〜40）を返す */
function qrFit(b: Bytes) {
  const r: Record<string, string> = {};
  for (const level of ["L", "M"] as const) {
    try { r[level] = `入る（型番 ${QRCode.create([{ data: b, mode: "byte" }], { errorCorrectionLevel: level }).version}）`; }
    catch (e) { r[level] = `入らない（${(e as Error).message.slice(0, 80)}）`; }
  }
  return r;
}

if (bundleNames().length === 0) throw new Error("data/ に取得済みのデータがない。先に collect を実行する（Mac・ネットあり）");
const results: Record<string, unknown>[] = [];
for (const name of bundleNames()) {
  const b = loadBundle(name);
  const a = stageA(b.target, b.all, b.headerFromJson);
  const lh = ledgerHash(b.headerFromJson);
  const sizeOf = (xs: Bytes[]) => xs.reduce((s, x) => s + x.length, 0);
  const vlBytes = b.vl ? Buffer.byteLength(JSON.stringify(b.vl)) : 0;
  const manifestBytes = sizeOf(b.manifests.map((m) => m.raw));

  // 全部持つ場合（ヘッダ + 全 tx + 集めた全検証 + VL + マニフェスト）
  const fullBytes = 118 + sizeOf(b.all.flatMap(({ tx, meta }) => [vl(tx), vl(meta)])) + sizeOf((b.validations ?? []).map(vl)) + vlBytes + manifestBytes;

  const ab = encodeReceipt(b.headerFromJson, b.target.tx, b.target.meta, a.proof, []);
  writeFileSync(out(`receipts/${name}-ab.bin`), ab);
  const row: Record<string, unknown> = {
    name, txCount: b.all.length, proofLevels: a.proof.length,
    parts: {
      header: 118, tx: b.target.tx.length, meta: b.target.meta.length,
      proof: ab.length - 4 - 118 - vl(b.target.tx).length - vl(b.target.meta).length - 1,
      allTxs: sizeOf(b.all.flatMap(({ tx, meta }) => [tx, meta])), vlJson: vlBytes, manifests: manifestBytes,
    },
    full: { bytes: fullBytes },
    ab: { bytes: ab.length, deflated: deflateRawSync(ab, { level: 9 }).length, qr: qrFit(ab), qrDeflated: qrFit(deflateRawSync(ab, { level: 9 })) },
  };
  if (b.validations && b.vl) {
    const q = pickQuorumValidations(b.headerFromJson, lh, b.validations, b.vl, b.manifests);
    const abc = encodeReceipt(b.headerFromJson, b.target.tx, b.target.meta, a.proof, q);
    writeFileSync(out(`receipts/${name}-abc.bin`), abc);
    const z = deflateRawSync(abc, { level: 9 });
    row["abc"] = {
      bytes: abc.length, validations: q.length, validationBytes: q.map((x) => x.length), deflated: z.length, qr: qrFit(abc), qrDeflated: qrFit(z),
      withUnl: { bytes: abc.length + vlBytes + manifestBytes, note: "VL とマニフェストもパックに入れた場合" },
    };
  }
  results.push(row);
  console.log(`[09] ${name}:`, JSON.stringify(row));
}
// 見積もり: 検証を持たない束（S2）に、他の束で実際に集めた定足数分の検証を同じ数・同じ大きさで足した場合
// （署名は別レジャー宛てなので検証には使えない。大きさを見るためだけ）
const donor = results.find((r) => r["abc"]);
if (donor) {
  const b = loadBundle(String(donor["name"]));
  const q = pickQuorumValidations(b.headerFromJson, ledgerHash(b.headerFromJson), b.validations!, b.vl!, b.manifests);
  for (const r of results.filter((x) => !x["abc"])) {
    const nb = loadBundle(String(r["name"]));
    const a = stageA(nb.target, nb.all, nb.headerFromJson);
    const est = encodeReceipt(nb.headerFromJson, nb.target.tx, nb.target.meta, a.proof, q);
    const z = deflateRawSync(est, { level: 9 });
    r["abcEstimate"] = { bytes: est.length, deflated: z.length, qr: qrFit(est), qrDeflated: qrFit(z), note: `${String(donor["name"])} の検証 ${q.length} 件を大きさの見積もりに使った（署名は無効）` };
    console.log(`[09] ${String(r["name"])}: C 付きの見積もり`, JSON.stringify(r["abcEstimate"]));
  }
}
writeFileSync(out("results/pack.json"), JSON.stringify(results, null, 2));
console.log("[09] wrote results/pack.json");
