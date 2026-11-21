import { fileURLToPath } from "node:url";
import {
  RLUSD_FAUCET_URL,
  RLUSD_TESTNET_ISSUER,
  connectTestnet,
  ensureRlusdTrustLine,
  explorerAccountUrl,
  explorerTxUrl,
  getRlusdLine,
  isSuccess,
  loadEnvLocal,
  loadOrCreatePersistentWallet,
  writeReport,
  type ReportRow,
} from "xrpl-kit";

const ENV_VAR = "DONOR_SEED";
const REPORT_PATH = process.env["SPIKE_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));

loadEnvLocal(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const rows: ReportRow[] = [];
  const errorCodes: string[] = [];
  let failure: string | undefined;
  let address: string | undefined;

  const client = await connectTestnet().catch((e: unknown) => {
    failure = `Testnet 接続失敗: ${e instanceof Error ? e.message : String(e)}`;
    return undefined;
  });

  if (client) {
    try {
      const pw = await loadOrCreatePersistentWallet(client, ENV_VAR, "donor", fileURLToPath(import.meta.url));
      address = pw.wallet.address;
      rows.push({
        item: "固定ウォレット（donor）",
        expected: `${ENV_VAR} のシードから復元、無ければ新規作成して .env.local に保存`,
        actual: pw.createdNow ? "新規作成し .env.local に保存（シードは出力しない）" : `既存の ${ENV_VAR} を使用`,
        evidence: `[${address}](${explorerAccountUrl(address)})`,
      });

      const xrp = await client.getXrpBalance(address);
      rows.push({
        item: "XRP 残高（手数料・準備金用）",
        expected: "アカウントが有効化され XRP がある",
        actual: `${xrp} XRP${pw.fundedNow ? "（今回 Faucet で入金）" : ""}`,
        evidence: "account_info（validated）",
      });

      const outcome = await ensureRlusdTrustLine(client, pw.wallet);
      if (outcome) {
        rows.push({
          item: "RLUSD の TrustSet 送信",
          expected: "tesSUCCESS かつ validated",
          actual: `${outcome.engineResult ?? "(なし)"} / validated=${String(outcome.validated)}${outcome.error ? ` / error=${outcome.error}` : ""}`,
          evidence: `[${outcome.hash}](${explorerTxUrl(outcome.hash)})`,
        });
        if (outcome.engineResult && outcome.engineResult !== "tesSUCCESS") errorCodes.push(outcome.engineResult);
        if (!isSuccess(outcome)) failure = outcome.error ?? `TrustSet が成功しなかった: ${outcome.engineResult ?? "結果なし"}`;
      } else {
        rows.push({
          item: "RLUSD の TrustSet 送信",
          expected: "未設定なら送る／設定済みなら送らない",
          actual: "既に設定済みのため送信なし",
          evidence: "account_lines",
        });
      }

      const line = await getRlusdLine(client, address);
      rows.push({
        item: "RLUSD トラストラインの存在",
        expected: `account_lines に ${RLUSD_TESTNET_ISSUER} の RLUSD がある`,
        actual: line.exists
          ? `あり（balance=${line.balance}, limit=${line.limit}, no_ripple=${String(line.noRipple)}）`
          : "なし",
        evidence: "account_lines（validated）",
      });
      if (!line.exists && !failure) failure = "TrustSet 後もトラストラインが確認できない";

      if (line.exists) {
        console.log("");
        console.log(`[02-rlusd-wallet] 次の手順: ${RLUSD_FAUCET_URL} で、このアドレスに Testnet RLUSD を受け取る`);
        console.log(`[02-rlusd-wallet] address: ${address}`);
        console.log(`[02-rlusd-wallet] 受取後の確認: pnpm --filter 02-rlusd-wallet status`);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      console.error(`[02-rlusd-wallet] FAILED: ${failure}`);
    } finally {
      await client.disconnect();
    }
  }

  if (failure) rows.push({ item: "実行全体", expected: "例外なく完了", actual: failure, evidence: "コンソールログ参照" });

  writeReport(REPORT_PATH, {
    title: "02-rlusd-wallet: 固定ウォレットと RLUSD トラストライン",
    verdict: failure ? "不合格" : "合格",
    rows,
    errorCodes,
    designImpact: "なし（RLUSD を貯めるための準備作業）",
    unknowns: [
      "tryrlusd.com の 1 日 10 枚の上限が、GitHub ログイン単位かウォレット単位かは未確認",
      "faucet が受取先に『ブラウザウォレット接続』を要求する場合の、このウォレットの使い方（シードのインポート可否）は未確認",
    ],
  });
  if (failure) process.exitCode = 1;
}

await main();
