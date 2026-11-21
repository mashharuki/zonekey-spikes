import type { ReportRow } from "xrpl-kit";

export type Status = "pass" | "fail" | "unknown";

export interface CheckResult {
  rows: ReportRow[];
  errorCodes: string[];
  unknowns: string[];
  /** 各行の判定。全体の結論の集計に使う */
  statuses: Status[];
  /** 設計への影響（06_技術設計のどこを変えるべきか）。失敗・要対応の項目だけ書く */
  designImpacts: string[];
}

export const emptyResult = (): CheckResult => ({ rows: [], errorCodes: [], unknowns: [], statuses: [], designImpacts: [] });

export function addRow(r: CheckResult, status: Status, row: ReportRow): void {
  r.rows.push(row);
  r.statuses.push(status);
}
