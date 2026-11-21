import { fileURLToPath } from "node:url";
import { connectTestnet, loadEnvLocal, resolveTestnetUrl, writeReport, type Report, type Verdict } from "xrpl-kit";
import { checkAmendments } from "./amendments.js";
import { emptyResult, type CheckResult, type Status } from "./check.js";
import { checkIssuer } from "./issuer.js";
import { describeError } from "./readonly.js";
import { checkReserves } from "./reserves.js";
import { checkTypes } from "./types.js";

loadEnvLocal(fileURLToPath(import.meta.url));

// 取引は送らない（読み取り専用）。REPORT の出力先は検証用に環境変数で変えられる
const REPORT_PATH = process.env["PREFLIGHT_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));

function verdictOf(statuses: Status[]): Verdict {
  if (statuses.length > 0 && statuses.every((s) => s === "pass")) return "合格";
  if (statuses.some((s) => s === "pass") && statuses.some((s) => s === "fail")) return "一部合格";
  if (statuses.some((s) => s === "fail")) return "不合格";
  // pass と unknown だけ、または全部 unknown: 未確認が残るので「一部合格」とし、分からなかったことに書く
  return statuses.some((s) => s === "pass") ? "一部合格" : "不合格";
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const connection = emptyResult();

  // 4) 型の確認はネットワーク不要
  results.push(await checkTypes());

  let url = "(未解決)";
  try {
    url = resolveTestnetUrl();
    const client = await connectTestnet();
    try {
      results.unshift(await checkIssuer(client));
      results.unshift(await checkReserves(client));
      results.unshift(await checkAmendments(client));
    } finally {
      await client.disconnect();
    }
  } catch (e) {
    const d = describeError(e);
    connection.rows.push({
      item: "Testnet への接続",
      expected: "接続できる",
      actual: `${d.code ?? "error"}: ${d.message}`,
      evidence: url,
    });
    connection.statuses.push("fail");
    connection.unknowns.push("接続できなかったため、amendment・準備金・RLUSD 発行者フラグは未確認");
  }
  results.unshift(connection);

  const all = results.flatMap((r) => r.statuses);
  const impacts = results.flatMap((r) => r.designImpacts);
  const report: Report = {
    title: "01-preflight: Testnet の前提確認（読み取り専用）",
    verdict: verdictOf(all),
    rows: results.flatMap((r) => r.rows),
    errorCodes: results.flatMap((r) => r.errorCodes),
    designImpact: impacts.length ? impacts.map((s) => `- ${s}`).join("\n") : "なし",
    unknowns: results.flatMap((r) => r.unknowns),
  };
  writeReport(REPORT_PATH, report);
  console.log(`[01-preflight] verdict=${report.verdict}`);
  if (report.verdict !== "合格") process.exitCode = 1;
}

await main();
