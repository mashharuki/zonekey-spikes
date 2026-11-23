/**
 * results/issue.json・offline.json・settle.json から REPORT.md を作る（ネット不要）
 *   pnpm --filter 11c-voucher-escrow report
 * 「設計への影響」「分からなかったこと」は結果を見て書く impact.md / unknowns.md を読み込む
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeReport, type ReportRow, type Verdict } from "xrpl-kit";
import { loadResults } from "./common.js";

type Part = { verdict: Verdict; rows: ReportRow[]; statuses: string[]; errorCodes: string[]; unknowns: string[] };
const names = ["issue", "offline", "settle"] as const;
const parts = names.map((n) => loadResults(n) as Part | undefined);
const missing = names.filter((_, i) => !parts[i]);
if (!parts[0]) throw new Error("results/issue.json がない。先に issue を実行する");
const ok = parts.filter(Boolean) as Part[];
const st = ok.flatMap((p) => p.statuses);
const fails = st.filter((s) => s === "fail").length, passes = st.filter((s) => s === "pass").length;
// Batch の内側の結果は Recorder の errorCodes に入らないので、results の batch / settleBatch からも拾う
type Inner = { index: number; type: string; result?: string; hash: string };
const innerCodes = (["issue", "settle"] as const).flatMap((n) => {
  const x = loadResults(n) as { batch?: { inner?: Inner[] }; settleBatch?: { inner?: Inner[] } } | undefined;
  return (x?.batch?.inner ?? x?.settleBatch?.inner ?? []).filter((i) => i.result && i.result !== "tesSUCCESS").map((i) => `${n} の Batch 内側 ${i.index} 件目（${i.type}、${i.hash}）: ${i.result}`);
});
const verdict: Verdict = fails === 0 && passes > 0 && missing.length === 0 ? "合格" : passes > 0 ? "一部合格" : "不合格";
const file = (n: string) => fileURLToPath(new URL(`../${n}`, import.meta.url));
const bullets = (n: string) => (existsSync(file(n)) ? readFileSync(file(n), "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) : []);

writeReport(file("REPORT.md"), {
  title: "11c-voucher-escrow: お店宛ての受給証 Escrow（券）をオフラインで使う",
  verdict,
  rows: ok.flatMap((p) => p.rows),
  errorCodes: [...ok.flatMap((p) => p.errorCodes), ...innerCodes],
  designImpact: existsSync(file("impact.md")) ? readFileSync(file("impact.md"), "utf8").trim() : "（結果を見てから impact.md に書く）",
  unknowns: [...ok.flatMap((p) => p.unknowns), ...missing.map((m) => `段階 ${m} は未実施`), ...bullets("unknowns.md")],
});
