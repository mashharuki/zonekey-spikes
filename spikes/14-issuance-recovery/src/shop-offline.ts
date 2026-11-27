/**
 * 店頭受付（オフライン）。別プロセスで、fetch・ソケット・DNS・TLS を遮断してから、同期データ（台帳から構成）と QR のバイト列だけで確かめる。
 *   node --import tsx src/shop-offline.ts <syncFile> <qrHex> <shop> <nowRipple>
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
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

const { unhex } = await import("../../11c-voucher-escrow/src/voucher/core.js");
const { verifyVoucher } = await import("../../11c-voucher-escrow/src/voucher/shop.js");
const [syncFile, qrHex, shop, now] = process.argv.slice(2) as [string, string, string, string];
const list = JSON.parse(readFileSync(syncFile, "utf8")) as import("../../11c-voucher-escrow/src/voucher/shop.js").SyncedEscrow[];
const res = await verifyVoucher(unhex(qrHex), list, { shop, nowRipple: Number(now), marginSec: 120, used: new Set() });
console.log(`RESULT ${JSON.stringify({ reason: res.reason, ok: res.ok, netAttempts, listSize: list.length })}`);
