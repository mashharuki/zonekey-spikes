/**
 * 11a 確認 7（Privy）のサーバー。spike 07 と同じく、画面でメールログイン → 本人の access token でサーバーが署名を頼む
 *   pnpm --filter 11a-check-settle start  → http://localhost:5173
 * 先に `pnpm --filter 11a-check-settle ledger` を実行して、S（SETTLEMENT_SEED）と V を用意しておく
 */
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Client } from "xrpl";
import { Abort, Recorder, connectTestnet, loadEnvLocal, walletFromEnv } from "xrpl-kit";
import { saveResults } from "../common.js";
import { describePrivyError, ensureUserXrplWallet, privy } from "./privy.js";
import { runStep7 } from "./steps7.js";

loadEnvLocal(fileURLToPath(import.meta.url));
let xrpl: Client | undefined;
const testnet = async () => (xrpl?.isConnected() ? xrpl : (xrpl = await connectTestnet()));

async function authUser(header: string | undefined): Promise<{ userId: string; jwt: string }> {
  const jwt = header?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("access token がない");
  const claims = await privy().utils().auth().verifyAccessToken(jwt);
  return { userId: claims.user_id, jwt };
}

const app = new Hono();

app.post("/api/wallet", async (c) => {
  try {
    const { userId } = await authUser(c.req.header("Authorization"));
    const w = await ensureUserXrplWallet(userId);
    return c.json({ address: w.address, walletId: w.walletId, created: w.created, userId, policyIds: w.policyIds });
  } catch (e) {
    return c.json({ error: describePrivyError(e) }, 500);
  }
});

app.post("/api/run7", async (c) => {
  const r = new Recorder("11a-7");
  let extra: Record<string, unknown> = {};
  try {
    const { userId, jwt } = await authUser(c.req.header("Authorization"));
    const S = walletFromEnv("SETTLEMENT_SEED"), V = walletFromEnv("VOUCHER_ISSUER_SEED");
    if (!S || !V) throw new Abort("SETTLEMENT_SEED / VOUCHER_ISSUER_SEED がない（先に ledger を実行する）");
    const w = await ensureUserXrplWallet(userId);
    extra = await runStep7({ client: await testnet(), r, jwt, walletId: w.walletId, address: w.address, publicKey: w.publicKey, policyIds: w.policyIds, S, V });
  } catch (e) {
    const msg = e instanceof Abort ? e.message : describePrivyError(e);
    r.add("fail", "確認7 実行", "最後まで完了", msg, "サーバーログ参照");
    r.unknowns.push(`確認7 中断: ${msg}（以降は未検証）`);
  }
  saveResults("privy", r, extra);
  return c.json({ verdict: r.verdict(), lines: r.rows.map((x) => `${x.item}: ${x.actual.replaceAll("<br>", " / ")}`) });
});

serve({ fetch: app.fetch, port: 8787 }, () => console.log("[11a] server: http://localhost:8787（画面は http://localhost:5173）"));
