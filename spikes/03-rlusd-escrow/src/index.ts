import { fileURLToPath } from "node:url";
import { connectTestnet, loadEnvLocal, writeReport, type ReportRow } from "xrpl-kit";
import { runEscrowSpike, type SpikeResult } from "./run.js";

const HERE = fileURLToPath(import.meta.url);
const REPORT_PATH = process.env["SPIKE_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));

loadEnvLocal(HERE);

async function main(): Promise<void> {
  let result!: SpikeResult;
  const client = await connectTestnet().catch((e: unknown) => {
    const failure = `Testnet 接続失敗: ${e instanceof Error ? e.message : String(e)}`;
    result = { rows: [], errorCodes: [], unknowns: [], impacts: [], failure, verdict: "不合格" };
    return undefined;
  });
  if (client) {
    try {
      result = await runEscrowSpike(client, HERE);
    } finally {
      await client.disconnect();
    }
  }
  // client が無い場合は上の catch で result が設定済み
  const r = result;
  const rows: ReportRow[] = [...r.rows];
  const unknowns = [...r.unknowns];
  if (r.failure) {
    rows.push({ item: "実行全体", expected: "例外なく完了", actual: r.failure, evidence: "コンソールログ参照" });
    unknowns.push("失敗した段階より後は未検証");
  }
  const verdict = r.failure ? "不合格" : r.verdict;
  writeReport(REPORT_PATH, {
    title: "03-rlusd-escrow: 実 RLUSD（Testnet）での条件付き EscrowCreate",
    verdict,
    rows,
    errorCodes: r.errorCodes,
    designImpact: r.impacts.length ? r.impacts.map((s) => `- ${s}`).join("\n") : "なし",
    unknowns,
  });
  console.log(`[03-rlusd-escrow] verdict=${verdict}`);
  if (verdict !== "合格") process.exitCode = 1;
}

await main();
