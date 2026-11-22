/**
 * 検証アプリに事前に入れておく「信頼の起点」を作る（ネット不要）。
 * spike 09 の collect が保存した Testnet の検証者リスト（VL）とマニフェストを、src/trust/testnet-unl.json にまとめる。
 * VL の発行者鍵は spike 09 の lib/unl.ts（rippled cfg/validators-example.txt の値）で固定している。
 *   pnpm --filter 10-pwa trust
 */
import { readFileSync, writeFileSync } from "node:fs";

const s09 = (p: string) => new URL(`../../09-offline-receipt/${p}`, import.meta.url);
const vl = JSON.parse(readFileSync(s09("data/unl/vl.json"), "utf8")) as Record<string, unknown>;
const manifests = (JSON.parse(readFileSync(s09("data/unl/manifests.json"), "utf8")) as { manifest?: string }[]).flatMap((m) => (m.manifest ? [m.manifest] : []));
const ctx = JSON.parse(readFileSync(s09("data/live/context.json"), "utf8")) as { fetched_at: string };
const out = { source: "https://vl.altnet.rippletest.net と manifest メソッド（spike 09 の collect で取得）", fetchedAt: ctx.fetched_at, vl, manifests };
writeFileSync(new URL("../src/trust/testnet-unl.json", import.meta.url), JSON.stringify(out));
console.log(`[10] wrote src/trust/testnet-unl.json（マニフェスト ${manifests.length} 件）`);
