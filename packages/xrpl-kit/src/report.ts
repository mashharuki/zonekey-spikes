import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Verdict = "合格" | "不合格" | "一部合格";

export interface ReportRow {
  /** 確認項目 */
  item: string;
  /** 期待 */
  expected: string;
  /** 実際 */
  actual: string;
  /** 根拠（tx hash、engine_result、計測値）。Markdown 可 */
  evidence: string;
}

export interface Report {
  title: string;
  verdict: Verdict;
  rows: ReportRow[];
  /** 実際に返ってきた tec/tem/tef。そのまま書く。無ければ空配列 */
  errorCodes?: string[];
  /** 設計への影響。無ければ「なし」 */
  designImpact?: string;
  /** 分からなかったこと。無ければ「なし」 */
  unknowns?: string[];
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", "<br>");

/** AGENTS.md の報告形式（結論 / 表 / エラーコード / 設計への影響 / 分からなかったこと）で描画 */
export function renderReport(r: Report): string {
  const lines: string[] = [];
  lines.push(`# ${r.title}`, "");
  lines.push("## 1. 結論", "", r.verdict, "");
  lines.push("## 2. 確認項目", "");
  lines.push("| 項目 | 期待 | 実際 | 根拠 |", "| --- | --- | --- | --- |");
  for (const row of r.rows) {
    lines.push(`| ${cell(row.item)} | ${cell(row.expected)} | ${cell(row.actual)} | ${cell(row.evidence)} |`);
  }
  lines.push("", "## 3. 返ってきたエラーコード", "");
  const codes = r.errorCodes ?? [];
  lines.push(...(codes.length ? codes.map((c) => `- \`${c}\``) : ["なし"]), "");
  lines.push("## 4. 設計への影響", "", r.designImpact ?? "なし", "");
  lines.push("## 5. 分からなかったこと", "");
  const unknowns = r.unknowns ?? [];
  lines.push(...(unknowns.length ? unknowns.map((u) => `- ${u}`) : ["なし"]), "");
  lines.push(`<!-- generated: ${new Date().toISOString()} -->`, "");
  return lines.join("\n");
}

export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderReport(report), "utf8");
  console.log(`[xrpl-kit] wrote ${path}`);
}
