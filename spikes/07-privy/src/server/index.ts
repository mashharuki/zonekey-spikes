import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Client } from "xrpl";
import { Abort, Recorder, connectTestnet, loadEnvLocal, writeReport } from "xrpl-kit";
import { describePrivyError, ensureUserXrplWallet, privy } from "./privy.js";
import { loadState, saveState } from "./state.js";
import { runSteps } from "./steps.js";

const HERE = fileURLToPath(import.meta.url);
const REPORT_PATH = fileURLToPath(new URL("../../REPORT.md", import.meta.url));
loadEnvLocal(HERE);

let xrpl: Client | undefined;
const testnet = async () => (xrpl?.isConnected() ? xrpl : (xrpl = await connectTestnet()));

/** Authorization: Bearer <Privy access token> を検証して user_id を返す */
async function authUser(header: string | undefined): Promise<{ userId: string; jwt: string }> {
  const jwt = header?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("access token がない");
  const claims = await privy().utils().auth().verifyAccessToken(jwt);
  return { userId: claims.user_id, jwt };
}

const app = new Hono();

// 確認 1 / 6: ログインしたユーザーの XRPL ウォレットを用意（既存なら再利用）し、アドレスを返す
app.post("/api/wallet", async (c) => {
  try {
    const { userId } = await authUser(c.req.header("Authorization"));
    const w = await ensureUserXrplWallet(userId);
    const st = loadState();
    st.logins.push({ at: new Date().toISOString(), userId, walletId: w.walletId, address: w.address, created: w.created, userAgent: c.req.header("User-Agent") ?? "-" });
    saveState(st);
    console.log(`[07] wallet for ${userId}: ${w.address}（${w.created ? "created" : "reused"}、owner_id=${w.ownerId}）`);
    return c.json({ address: w.address, walletId: w.walletId, created: w.created, userId });
  } catch (e) {
    const msg = describePrivyError(e);
    console.error(`[07] /api/wallet 失敗: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

// 確認 2〜5 をまとめて実行し、REPORT.md を書く
app.post("/api/run", async (c) => {
  const r = new Recorder("07");
  try {
    const { userId, jwt } = await authUser(c.req.header("Authorization"));
    const w = await ensureUserXrplWallet(userId);
    r.add(w.ownerId ? "pass" : "fail", "確認1: ユーザーが所有者の XRPL ウォレット", "owner_id がある（owner: { user_id } で作成）",
      `address=${w.address}<br>wallet_id=${w.walletId}<br>owner_id=${w.ownerId}<br>public_key=${w.publicKey.slice(0, 16)}…（${w.publicKey.length / 2} バイト）`, "wallets().create / list");
    await runSteps({ client: await testnet(), r, jwt, userId, walletId: w.walletId, address: w.address, publicKey: w.publicKey, seedStartDir: HERE });
  } catch (e) {
    const msg = e instanceof Abort ? e.message : describePrivyError(e);
    r.add("fail", "実行全体", "最後まで完了", msg, "サーバーログ参照");
    r.unknowns.push("中断した段階より後は未検証");
  }

  // 確認 6: ログイン履歴（別ブラウザから同じユーザーでログインしたときのアドレス）
  const logins = loadState().logins;
  const byUser = new Map<string, Set<string>>();
  for (const l of logins) (byUser.get(l.userId) ?? byUser.set(l.userId, new Set()).get(l.userId)!).add(l.address);
  const agents = new Set(logins.map((l) => l.userAgent));
  const same = [...byUser.values()].every((s) => s.size === 1);
  r.add(agents.size >= 2 ? (same ? "pass" : "fail") : "observe", "確認6: 同じユーザーが別ブラウザでログインしたときのアドレス",
    "同じアドレス（2 つ以上の User-Agent から確認）", `ログイン ${logins.length} 回、User-Agent ${agents.size} 種類、ユーザーごとのアドレス数=${[...byUser.values()].map((s) => s.size).join(", ")}`,
    "付録のログイン履歴");
  if (agents.size < 2) r.unknowns.push("確認6: 別ブラウザからのログインがまだ（もう 1 つのブラウザで同じメールでログインしてから再実行する）");

  writeReport(REPORT_PATH, {
    title: "07-privy: Privy の XRPL ウォレット（ユーザー所有）・本人承認の署名・ポリシー",
    verdict: r.verdict(),
    rows: r.rows,
    errorCodes: r.errorCodes,
    designImpact: [
      "受益者のウォレットは Privy のユーザー所有（owner: { user_id }）で作る。サーバーは App Secret だけでは動かせず、署名のたびに本人の access token（user_jwts）が要る。同じユーザーなら別ブラウザでも同じアドレス（wallets().list で再利用）",
      "署名前のバイト列は xrpl.js の encodeForSigning()（先頭 53545800）。SigningPubKey に Privy の public_key（33 バイト）を入れてから autofill → encode → xrpl_signTransaction。署名済み blob の送信はアプリ側（Privy は送らない）",
      "Privy のポリシーで中身を検査できるのは Payment / OfferCreate / OfferCancel / TrustSet だけ。TransactionType 条件にそれ以外（CredentialAccept・EscrowFinish など）を書くと invalid_policy_format でルール自体が作れない",
      "CredentialAccept は、ポリシーで個別に許可できない。system 条件だけの ALLOW を足せば署名できるが、そのあいだは種類を問わず許可され、TrustSet の issuer 制限も効かなくなる（DENY を足した Payment だけは止まった）",
      "**結論（CredentialAccept の扱い）:** 登録時に、制限ポリシーを付ける前のウォレットで本人の承認により CredentialAccept と TrustSet を済ませ、その後で『TrustSet は指定の currency/issuer だけ』のポリシーを付ける（ポリシーの付与も本人の JWT で行える）。後から別の Credential を受け取る必要が出た場合は、DENY で Payment / OfferCreate を塞いだうえで、system 時刻条件の ALLOW を短い時間窓（gt 開始・lt 終了）で一時的に足し、終わったら削除する",
      "受益者が自分で EscrowFinish を送る設計にすると同じ問題（ポリシーで評価できない種類）になる。EscrowFinish は keeper が送る（spike 05 で、所有者でなくても完了できることを確認済み）ので、受益者のウォレットには不要",
      "@privy-io/node は 0.41.0 に固定。0.42.0 は公開から 1 日未満で pnpm の minimumReleaseAge に止められたため。今回使う API の型は 0.42.0 と同一（差はコメントと型の別名 PolicyID のみ）",
    ].map((s) => `- ${s}`).join("\n"),
    unknowns: r.unknowns,
  });
  appendFileSync(REPORT_PATH, ["", "## 付録: ログイン履歴（確認 6）", "", "| 時刻 | user_id | アドレス | 作成/再利用 | User-Agent |", "| --- | --- | --- | --- | --- |",
    ...logins.map((l) => `| ${l.at} | ${l.userId} | ${l.address} | ${l.created ? "作成" : "再利用"} | ${l.userAgent.slice(0, 60)} |`), ""].join("\n"));
  return c.json({ verdict: r.verdict(), lines: r.rows.map((x) => `${x.item}: ${x.actual.replaceAll("<br>", " / ")}`) });
});

serve({ fetch: app.fetch, port: 8787 }, () => console.log("[07] server: http://localhost:8787（画面は http://localhost:5173）"));
