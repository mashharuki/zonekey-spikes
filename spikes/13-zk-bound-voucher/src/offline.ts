/**
 * 店頭受付（オフライン）。お店の端末が、事前同期した自店宛ての一覧（exchange/shop-sync.json）と QR のバイト列だけで確かめる。
 * 最初に fetch・ソケット・DNS・TLS を使えなくする（11c と同じ方法）。QR 画像・カメラ・実機は使わない（ペイロードのバイト列を直接渡す）。
 *   pnpm --filter 13-zk-bound-voucher offline
 */
import dns from "node:dns";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

let netAttempts = 0;
const deny = (what: string) => () => { netAttempts++; throw new Error(`オフライン確認中にネットワークを使おうとした: ${what}`); };
globalThis.fetch = deny("fetch") as never;
net.Socket.prototype.connect = deny("net.Socket.connect") as never;
(net as unknown as Record<string, unknown>)["connect"] = deny("net.connect");
(net as unknown as Record<string, unknown>)["createConnection"] = deny("net.createConnection");
(tls as unknown as Record<string, unknown>)["connect"] = deny("tls.connect");
(dns as unknown as Record<string, unknown>)["lookup"] = deny("dns.lookup");

const core = await import("../../11c-voucher-escrow/src/voucher/core.js");
const { REASONS, verifyVoucher } = await import("../../11c-voucher-escrow/src/voucher/shop.js");
type SyncedEscrow = import("../../11c-voucher-escrow/src/voucher/shop.js").SyncedEscrow;

const rd = <T>(p: string) => JSON.parse(readFileSync(new URL(`../exchange/${p}`, import.meta.url), "utf8")) as T;
const sync = rd<{ shopA: { shop: string; list: SyncedEscrow[] }; shopB: { shop: string; list: SyncedEscrow[] } }>("shop-sync.json");
const qrs = rd<Record<string, string>>("qrs.json");
const meta = rd<{ marginSec: number }>("meta.json");
const q = (k: string) => core.unhex(qrs[k]!);
const rows: { item: string; expected: string; actual: string; ok: boolean; evidence: string }[] = [];
const usedA = new Set<string>(), usedB = new Set<string>();

async function check(item: string, shop: "A" | "B", bytes: Uint8Array, expect: string, accept = false) {
  const s = shop === "A" ? sync.shopA : sync.shopB;
  const t0 = performance.now();
  const res = await verifyVoucher(bytes, s.list, { shop: s.shop, nowRipple: core.rippleNow(), marginSec: meta.marginSec, used: shop === "A" ? usedA : usedB });
  const ms = (performance.now() - t0).toFixed(1);
  if (res.ok && accept) (shop === "A" ? usedA : usedB).add(res.escrow.index);
  rows.push({ item, expected: expect, actual: res.reason, ok: res.reason === expect, evidence: `${bytes.length} B / ${ms} ms` });
  console.log(`${res.reason === expect ? "OK  " : "FAIL"} ${item}: 期待=${expect} 実際=${res.reason} (${bytes.length} B / ${ms} ms)`);
}

// 鍵の一致（判定表: 正規の券と鍵の組み合わせだけを受付）
await check("店頭: 別の申請鍵（H1 NGO の鍵）で署名した県の券を出す", "A", q("h1CountyWrongKey"), REASONS.wrongKey);
await check("店頭: preimage だけを盗み見して署名なしで出す", "A", q("h1CountyNoSig"), REASONS.noSig);
await check("店頭: 見知らぬ端末の鍵で署名した券を出す", "A", q("h1CountyStranger"), REASONS.wrongKey);
await check("店頭: H1 県の券（正規の券と鍵）", "A", q("h1County"), REASONS.ok, true);
await check("店頭: H1 県の券をもう一度出す", "A", q("h1County"), REASONS.used);
const tampered = q("h1Ngo").slice(); tampered[core.PREIMAGE_OFFSET + 3]! ^= 1;
await check("店頭: H1 NGO の券の preimage を 1 ビット書き換える", "A", tampered, REASONS.preimage);
await check("店頭: H1 NGO の券（正規の券と鍵）", "A", q("h1Ngo"), REASONS.ok, true);
await check("店頭: H2 県の券（店 B 宛て）を店 A で出す", "A", q("h2County"), REASONS.notMine);
await check("店頭: H2 県の券（店 B 宛て）を店 B で出す", "B", q("h2County"), REASONS.ok, true);
rows.push({ item: "店頭: 確認中のネットワーク利用の試み", expected: "0", actual: String(netAttempts), ok: netAttempts === 0, evidence: "fetch・ソケット・DNS・TLS を遮断して実行" });
console.log(`ネットワーク利用の試み: ${netAttempts} 回`);
writeFileSync(new URL("../results/offline.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), condition: "QR 画像・カメラ・実機は使わず、QR のバイト列（hex）を直接渡した。同期データは模擬台帳から作った", failed: rows.filter((r) => !r.ok).length, rows }, null, 2));
if (rows.some((r) => !r.ok)) process.exitCode = 1;
