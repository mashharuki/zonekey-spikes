/**
 * results/run.json（確認 1〜8）と results/measure.json（確認 9）から REPORT.md を作る（ネット不要）
 *   pnpm --filter 12-shop-open report
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeReport, type ReportRow, type Verdict } from "xrpl-kit";
import { loadResults } from "./common.js";

type Part = { rows: ReportRow[]; statuses: string[]; errorCodes: string[]; unknowns: string[] };
const run = loadResults("run") as Part | undefined, measure = loadResults("measure") as Part | undefined;
if (!run) throw new Error("results/run.json がない。先に spike を実行する");
const ok = [run, measure].filter(Boolean) as Part[];
const st = ok.flatMap((p) => p.statuses);
const fails = st.filter((s) => s === "fail").length, passes = st.filter((s) => s === "pass").length;
const verdict: Verdict = fails === 0 && passes > 0 && measure ? "合格" : passes > 0 ? "一部合格" : "不合格";
const file = (n: string) => fileURLToPath(new URL(`../${n}`, import.meta.url));
const bullets = (n: string) => (existsSync(file(n)) ? readFileSync(file(n), "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) : []);
writeReport(file("REPORT.md"), {
  title: "12-shop-open: 開店の届け・お店の Credential・券を作るお店の選び方",
  verdict,
  rows: ok.flatMap((p) => p.rows),
  errorCodes: ok.flatMap((p) => p.errorCodes),
  designImpact: existsSync(file("impact.md")) ? readFileSync(file("impact.md"), "utf8").trim() : "（結果を見てから impact.md に書く）",
  unknowns: [...ok.flatMap((p) => p.unknowns), ...(measure ? [] : ["確認 9（計測）は未実施"]), ...bullets("unknowns.md")],
});
