import { explorerTxUrl, type ReportRow, type TxOutcome } from "xrpl-kit";

export type Status = "pass" | "fail" | "observe";

export class Recorder {
  rows: ReportRow[] = [];
  statuses: Status[] = [];
  errorCodes: string[] = [];
  unknowns: string[] = [];
  impacts: string[] = [];

  add(status: Status, item: string, expected: string, actual: string, evidence: string): void {
    const mark = status === "pass" ? "✅" : status === "fail" ? "❌" : "🔎";
    this.rows.push({ item: `${mark} ${item}`, expected, actual, evidence });
    this.statuses.push(status);
    console.log(`[04] ${mark} ${item}: ${actual}`);
  }

  /** トランザクション結果を記録する。expectCode と一致すれば pass */
  tx(item: string, o: TxOutcome, expectCode: string, extra = ""): boolean {
    const code = o.engineResult ?? o.error ?? "(結果なし)";
    if (code !== "tesSUCCESS") this.errorCodes.push(`${item}: ${code}`);
    const ok = o.engineResult === expectCode && o.validated === true;
    this.add(
      ok ? "pass" : "fail",
      item,
      `${expectCode}（validated）`,
      `${code} / validated=${String(o.validated)}`,
      `[${o.hash}](${explorerTxUrl(o.hash)})${extra ? `。${extra}` : ""}`,
    );
    return ok;
  }

  /** 値の一致を記録する */
  eq(item: string, expected: string, actual: string, evidence: string): boolean {
    const ok = expected === actual;
    this.add(ok ? "pass" : "fail", item, expected, actual, evidence);
    return ok;
  }
}

/** 前提が崩れたら以降のステップを止めるための例外 */
export class Abort extends Error {}
