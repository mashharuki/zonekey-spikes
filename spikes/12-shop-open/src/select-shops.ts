/**
 * 「券を作ってよいお店」を選ぶ（台帳を読むだけ。鍵も .env.local も使わない。公開の Testnet サーバーに接続する）
 *   pnpm --filter 12-shop-open select-shops --district z13 --issuer r... --window 600 [--check r...,r...] [--out results/select-public.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "xrpl";
import { selectShops } from "./select.js";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const district = arg("district"), issuer = arg("issuer"), windowSec = Number(arg("window") ?? 600);
if (!district || !issuer) throw new Error("--district と --issuer を渡す");
const url = "wss://s.altnet.rippletest.net:51233"; // 公開の Testnet サーバー（.env.local の XRPL_TESTNET_URL も読まない）
const client = new Client(url);
await client.connect();
try {
  const out = await selectShops(client, { district, issuer, windowSec, check: arg("check")?.split(",").filter(Boolean) });
  const json = JSON.stringify({ server: url, ...out }, null, 2);
  console.log(json);
  const o = arg("out");
  if (o) { mkdirSync(dirname(resolve(o)), { recursive: true }); writeFileSync(resolve(o), json); }
} finally {
  await client.disconnect();
}
