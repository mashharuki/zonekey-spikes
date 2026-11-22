/**
 * results/ledger.json（確認 1〜6・8）と results/privy.json（確認 7）から REPORT.md を作る（ネット不要）
 *   pnpm --filter 11a-check-settle report
 * 「設計への影響」は結果を見て人（またはエージェント）が書く impact.md を読み込む（数値から自動で結論を作らない）
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeReport, type ReportRow, type Verdict } from "xrpl-kit";
import { loadResults } from "./common.js";

type Part = { verdict: Verdict; rows: ReportRow[]; statuses: string[]; errorCodes: string[]; unknowns: string[]; at: string };
const ledger = loadResults("ledger") as Part | undefined;
const privyPart = loadResults("privy") as Part | undefined;
if (!ledger) throw new Error("results/ledger.json がない。先に ledger を実行する");

const parts = [ledger, privyPart].filter(Boolean) as Part[];
const statuses = parts.flatMap((p) => p.statuses);
const fails = statuses.filter((s) => s === "fail").length, passes = statuses.filter((s) => s === "pass").length;
const verdict: Verdict = fails === 0 && passes > 0 && privyPart ? "合格" : passes > 0 ? "一部合格" : "不合格";
const impactFile = fileURLToPath(new URL("../impact.md", import.meta.url));
const unknownsFile = fileURLToPath(new URL("../unknowns.md", import.meta.url));
const extraUnknowns = existsSync(unknownsFile) ? readFileSync(unknownsFile, "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) : [];

writeReport(fileURLToPath(new URL("../REPORT.md", import.meta.url)), {
  title: "11a-check-settle: 受給証の Check・Privy のゆるいロック・Batch での精算",
  verdict,
  rows: parts.flatMap((p) => p.rows),
  errorCodes: parts.flatMap((p) => p.errorCodes),
  designImpact: existsSync(impactFile) ? readFileSync(impactFile, "utf8").trim() : "（結果を見てから impact.md に書く）",
  unknowns: [...parts.flatMap((p) => p.unknowns), ...(privyPart ? [] : ["確認 7（Privy）は未実施"]), ...extraUnknowns],
});
