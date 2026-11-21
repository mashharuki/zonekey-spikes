import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Recorder, connectTestnet, loadEnvLocal, writeReport } from "xrpl-kit";
import { setupAccounts } from "./accounts.js";
import { batchLogs, ledgerTable, runScenario } from "./scenario.js";

const HERE = fileURLToPath(import.meta.url);
const REPORT_PATH = process.env["SPIKE_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));
loadEnvLocal(HERE);

const r = new Recorder("05");
try {
  const client = await connectTestnet();
  try {
    const accounts = await setupAccounts(client, r);
    await runScenario(client, r, accounts);
  } finally {
    await client.disconnect();
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[05] 中断: ${msg}`);
  r.add("fail", "実行全体", "最後まで完了", msg, "コンソールログ参照");
  r.unknowns.push("中断した段階より後は未検証");
}

const verdict = r.verdict();
if (verdict === "合格") {
  r.impacts.push("keeper の一斉 EscrowFinish / EscrowCancel は 1 Batch = 最大 8 件。世帯数 N なら ceil(N/8) 件の Batch が要る（外側の Sequence も同数消費）");
  r.impacts.push("1 件だけ失敗しても他を通したい一斉支給は Independent、全件同時を保証したい場合は AllOrNothing を使う（付録 B）");
}
r.unknowns.push("OnlyOne / UntilFailure は未検証", "複数アカウントの内側（BatchSigners）は未検証", "11/25 の Testnet リセットで本検証の tx は消える");

writeReport(REPORT_PATH, {
  title: "05-batch: Batch（BatchV1_1）で Escrow の一斉作成・完了・取消",
  verdict,
  rows: r.rows,
  errorCodes: r.errorCodes,
  designImpact: r.impacts.length ? r.impacts.map((s) => `- ${s}`).join("\n") : "なし",
  unknowns: r.unknowns,
});

const feeTable = [
  "",
  "## 付録 A: Batch ごとの手数料と結果",
  "",
  "外側の手数料の計算式（xrpl.js の autofill と同じ）: `基本手数料 × 2 + Σ（各内側が単独で送られた場合の手数料）`。",
  "内側が Fulfillment 付きの EscrowFinish なら、その単独手数料は `基本手数料 × (33 + Fulfillment バイト数 / 16)`（切り上げ）。それ以外は基本手数料。",
  "内側の Fee フィールドは必ず \"0\"。各 Batch で「計算値 − 1 drop」を先に送り、拒否されることで計算値が下限であることを確かめた（「下限プローブ」列）。",
  "",
  "| Batch | モード | 内側 | 計算式（drops） | 下限プローブ | Fee（drops） | 残高差（drops） | 消費 Sequence | 外側 | 内側の結果 | hash |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...batchLogs.map((b) => `| ${b.name} | ${b.mode} | ${b.innerCount} | ${b.formula} | ${b.probe} | ${b.fee} | ${b.balanceDelta} | ${b.seqConsumed} | ${b.outer} | ${b.inner} | [${b.hash.slice(0, 10)}…](https://testnet.xrpl.org/transactions/${b.hash}) |`),
  "",
  ...ledgerTable,
].join("\n");
appendFileSync(REPORT_PATH, feeTable);
console.log(`[05] verdict=${verdict}`);
if (verdict !== "合格") process.exitCode = 1;
