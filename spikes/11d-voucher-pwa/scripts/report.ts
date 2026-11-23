/**
 * results/issue.json・settle.json と、iPhone での確認（phone.md、人が書く）から REPORT.md を作る（ネット不要）
 *   pnpm --filter 11d-voucher-pwa report
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeReport, type ReportRow, type Verdict } from "xrpl-kit";
import { loadResults } from "./common.js";

type Part = { rows: ReportRow[]; statuses: string[]; errorCodes: string[]; unknowns: string[]; settle?: { batches?: { inner: { index: number; type: string; result?: string; hash: string }[] }[] } };
const file = (n: string) => fileURLToPath(new URL(`../${n}`, import.meta.url));
const parts = (["issue", "settle"] as const).map((n) => loadResults(n) as Part | undefined);
if (!parts[0]) throw new Error("results/issue.json がない");
// phone.md: 「| ✅ 項目 | 期待 | 実際 | 根拠 |」の行（人が iPhone で確かめた結果）
const phoneRows: ReportRow[] = existsSync(file("phone.md")) ? readFileSync(file("phone.md"), "utf8").split("\n").filter((l) => /^\| [✅❌🔎]/.test(l)).map((l) => { const [item, expected, actual, evidence] = l.split("|").slice(1, 5).map((x) => x.trim()); return { item: item!, expected: expected!, actual: actual!, evidence: evidence! }; }) : [];
const phoneStatuses = phoneRows.map((p) => (p.item.startsWith("✅") ? "pass" : p.item.startsWith("❌") ? "fail" : "observe"));
const ok = parts.filter(Boolean) as Part[];
const st = [...ok.flatMap((p) => p.statuses), ...phoneStatuses];
const fails = st.filter((s) => s === "fail").length, passes = st.filter((s) => s === "pass").length;
const pending = phoneRows.filter((p) => p.actual.includes("未確認")).length;
const complete = !!parts[1] && phoneRows.length > 0 && pending === 0;
const verdict: Verdict = fails === 0 && passes > 0 && complete ? "合格" : passes > 0 ? "一部合格" : "不合格";
const inner = (parts[1]?.settle?.batches ?? []).flatMap((b) => b.inner).filter((i) => i.result && i.result !== "tesSUCCESS").map((i) => `精算の Batch 内側 ${i.index} 件目（${i.type}、${i.hash}）: ${i.result}`);
const bullets = (n: string) => (existsSync(file(n)) ? readFileSync(file(n), "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) : []);

writeReport(file("REPORT.md"), {
  title: "11d-voucher-pwa: 券（お店宛ての受給証 Escrow）を iPhone で見せ、お店がオフラインで確かめる",
  verdict,
  rows: [...ok.flatMap((p) => p.rows), ...phoneRows],
  errorCodes: [...ok.flatMap((p) => p.errorCodes), ...inner],
  designImpact: existsSync(file("impact.md")) ? readFileSync(file("impact.md"), "utf8").trim() : "（結果を見てから impact.md に書く）",
  unknowns: [...ok.flatMap((p) => p.unknowns), ...(parts[1] ? [] : ["精算は未実施"]), ...(phoneRows.length ? [] : ["iPhone での確認（phone.md）が未記入"]), ...(pending ? [`iPhone・お店での確認のうち ${pending} 件が未確認（phone.md）`] : []), ...bullets("unknowns.md")],
});
