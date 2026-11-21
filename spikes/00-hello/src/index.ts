import { fileURLToPath } from "node:url";
import type { Payment } from "xrpl";
import { xrpToDrops } from "xrpl";
import {
  connectTestnet,
  createFundedWallet,
  explorerTxUrl,
  isSuccess,
  loadEnvLocal,
  submitAndLog,
  writeReport,
  type Report,
  type ReportRow,
  type TxOutcome,
} from "xrpl-kit";

const REPORT_PATH = fileURLToPath(new URL("../REPORT.md", import.meta.url));
const SEND_XRP = "1";

loadEnvLocal(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const rows: ReportRow[] = [];
  const errorCodes: string[] = [];
  const unknowns: string[] = [];
  let outcome: TxOutcome | undefined;
  let failure: string | undefined;

  const client = await connectTestnet().catch((e: unknown) => {
    failure = `Testnet 接続失敗: ${e instanceof Error ? e.message : String(e)}`;
    return undefined;
  });

  if (client) {
    try {
      const alice = await createFundedWallet(client, "alice");
      const bob = await createFundedWallet(client, "bob");
      rows.push(
        {
          item: "Faucet で alice を作成",
          expected: "資金が入った状態で作成される",
          actual: `${alice.balanceXrp} XRP`,
          evidence: alice.wallet.address,
        },
        {
          item: "Faucet で bob を作成",
          expected: "資金が入った状態で作成される",
          actual: `${bob.balanceXrp} XRP`,
          evidence: bob.wallet.address,
        },
      );

      const bobBefore = await client.getXrpBalance(bob.wallet.address);
      const tx: Payment = {
        TransactionType: "Payment",
        Account: alice.wallet.address,
        Destination: bob.wallet.address,
        Amount: xrpToDrops(SEND_XRP),
      };
      outcome = await submitAndLog(client, "alice→bob 1 XRP", tx, alice.wallet);

      rows.push({
        item: `alice → bob に ${SEND_XRP} XRP を送金`,
        expected: "tesSUCCESS かつ validated",
        actual: `${outcome.engineResult ?? "(なし)"} / validated=${String(outcome.validated)}${outcome.error ? ` / error=${outcome.error}` : ""}`,
        evidence: `[${outcome.hash}](${explorerTxUrl(outcome.hash)})`,
      });
      if (outcome.engineResult && outcome.engineResult !== "tesSUCCESS") errorCodes.push(outcome.engineResult);

      if (isSuccess(outcome)) {
        const bobAfter = await client.getXrpBalance(bob.wallet.address);
        const delta = Number((bobAfter - bobBefore).toFixed(6));
        rows.push({
          item: "bob の残高増分",
          expected: `+${SEND_XRP} XRP`,
          actual: `${delta >= 0 ? "+" : ""}${delta} XRP`,
          evidence: `before=${bobBefore}, after=${bobAfter}`,
        });
        if (delta !== Number(SEND_XRP)) failure = `bob の残高増分が想定外: ${delta}`;
      } else {
        failure = outcome.error ?? `送金が成功しなかった: ${outcome.engineResult ?? "結果なし"}`;
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      console.error(`[00-hello] FAILED: ${failure}`);
    } finally {
      await client.disconnect();
    }
  }

  if (failure) {
    rows.push({ item: "実行全体", expected: "例外なく完了", actual: failure, evidence: "コンソールログ参照" });
    unknowns.push("失敗した段階より後の動作（送金・残高確認）は未検証");
  }

  const report: Report = {
    title: "00-hello: Faucet ウォレット作成と 1 XRP 送金",
    verdict: failure ? "不合格" : "合格",
    rows,
    errorCodes,
    designImpact: "なし（土台の動作確認のみ）",
    unknowns,
  };
  writeReport(REPORT_PATH, report);
  if (failure) process.exitCode = 1;
}

await main();
