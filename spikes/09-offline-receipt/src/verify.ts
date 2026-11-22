/**
 * 段階 6: ネットを切った状態で、ファイルだけから検証 A / B / C を行う
 *   pnpm --filter 09-offline-receipt verify
 * 最初に fetch・ソケット・DNS・TLS を使えなくする（呼ばれたら回数を数えて例外）。Wi-Fi を切って実行してもよい。
 */
import dns from "node:dns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

// ── ネットワーク遮断（以降の import より前に行う）
let netAttempts = 0;
const deny = (what: string) => () => { netAttempts++; throw new Error(`オフライン検証中にネットワークを使おうとした: ${what}`); };
globalThis.fetch = deny("fetch") as never;
net.Socket.prototype.connect = deny("net.Socket.connect") as never;
(net as unknown as Record<string, unknown>)["connect"] = deny("net.connect");
(net as unknown as Record<string, unknown>)["createConnection"] = deny("net.createConnection");
(tls as unknown as Record<string, unknown>)["connect"] = deny("tls.connect");
(dns as unknown as Record<string, unknown>)["lookup"] = deny("dns.lookup");

const { bundleNames, loadBundle } = await import("./lib/bundle.js");
const { stageA, stageAFromProof, stageB, stageC } = await import("./lib/check.js");
const { decodeReceipt } = await import("./lib/receipt.js");
const { ledgerHash } = await import("./lib/ledger.js");
const { hex } = await import("./lib/bytes.js");

const out = (p: string) => new URL(`../${p}`, import.meta.url);
mkdirSync(out("results/"), { recursive: true });
const flip = (b: Uint8Array, i: number) => { const c = Uint8Array.from(b); c[i] = c[i]! ^ 0x01; return c; };

if (bundleNames().length === 0) throw new Error("data/ に取得済みのデータがない。先に collect を実行する（Mac・ネットあり）");
const report: Record<string, unknown>[] = [];
for (const name of bundleNames()) {
  const b = loadBundle(name);
  const header = b.headerFromJson;
  // B を先に: ヘッダのフィールドから ledger_hash を作り、以降は「再計算した値」だけを使う
  const B = stageB(header, b.ledgerHash);
  const headerBinaryMatchesJson = b.headerFromBinary ? hex(ledgerHash(b.headerFromBinary)) === B.computedLedgerHash : undefined;
  const { proof: _p, ...A } = stageA(b.target, b.all, header);
  const C = stageC(header, ledgerHash(header), b.validations, b.vl, b.manifests);

  // 改ざん検査: 1 ビット変えたら、それぞれの段階で落ちること
  const tamper = {
    metaFlipped_A: stageA({ ...b.target, meta: flip(b.target.meta, b.target.meta.length - 1) }, b.all, header).ok,
    closeTimePlus1_B: stageB({ ...header, closeTime: header.closeTime + 1 }, b.ledgerHash).ok,
    accountHashFlipped_B: stageB({ ...header, accountHash: flip(header.accountHash, 0) }, b.ledgerHash).ok,
    ...(b.validations?.length && b.vl
      ? { firstValidationFlipped_C_signersAfter: stageC(header, ledgerHash(header), [flip(b.validations[0]!, 10), ...b.validations.slice(1)], b.vl, b.manifests).trustedSigners }
      : {}),
  };

  // 受け取りパック（pack.ts の出力）だけでの検証。VL とマニフェストは事前に持っている前提
  const receipts: Record<string, unknown> = {};
  for (const kind of ["ab", "abc"]) {
    const f = out(`receipts/${name}-${kind}.bin`);
    if (!existsSync(f)) continue;
    const bytes = new Uint8Array(readFileSync(f));
    const r = decodeReceipt(bytes);
    const rb = stageB(r.header, b.ledgerHash);
    receipts[kind] = {
      bytes: bytes.length,
      A: stageAFromProof({ tx: r.tx, meta: r.meta }, r.proof, r.header),
      B: { ok: rb.ok, computedLedgerHash: rb.computedLedgerHash },
      C: kind === "abc" ? (({ signers: _s, ...c }) => c)(stageC(r.header, ledgerHash(r.header), r.validations, b.vl, b.manifests)) : "（署名を入れていない）",
    };
  }

  const row = { name, context: b.context, validatedFlagFromApi: b.validated, serverVersion: b.serverVersion, serverQuorum: b.serverQuorum, A, B: { ...B, headerBinaryMatchesJson }, C, tamper, receipts };
  report.push(row);
  console.log(`\n[09] ${name}: A=${A.ok} B=${B.ok} C=${C.ok}${C.reason ? `（${C.reason}）` : ""}`);
  console.log(JSON.stringify({ A: { txCount: A.txCount, rootMatches: A.rootMatches, targetIncluded: A.targetIncluded, proofLevels: A.proofLevels, target: A.target }, B: { computed: B.computedLedgerHash, expected: B.expectedLedgerHash }, C: { quorum: C.quorum, trustedSigners: C.trustedSigners, validations: C.validations, vl: C.vl }, tamper, receipts }, null, 1));
}
writeFileSync(out("results/verify.json"), JSON.stringify({ at: new Date().toISOString(), networkAttempts: netAttempts, bundles: report }, null, 2));
console.log(`\n[09] ネットワーク利用の試み: ${netAttempts} 回 / wrote results/verify.json`);
