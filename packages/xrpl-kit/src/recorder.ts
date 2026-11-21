import type { ReportRow, Verdict } from "./report.js";
import type { TxOutcome } from "./submit.js";
import { explorerTxUrl } from "./testnet.js";

export type Status = "pass" | "fail" | "observe";

/** 確認項目を記録し、REPORT の行・エラーコード・判定を集める */
export class Recorder {
  rows: ReportRow[] = [];
  statuses: Status[] = [];
  errorCodes: string[] = [];
  unknowns: string[] = [];
  impacts: string[] = [];

  constructor(private readonly tag: string) {}

  add(status: Status, item: string, expected: string, actual: string, evidence: string): void {
    const mark = status === "pass" ? "✅" : status === "fail" ? "❌" : "🔎";
    this.rows.push({ item: `${mark} ${item}`, expected, actual, evidence });
    this.statuses.push(status);
    console.log(`[${this.tag}] ${mark} ${item}: ${actual.replaceAll("<br>", " / ")}`);
  }

  tx(item: string, o: TxOutcome, expectCode: string, extra = ""): boolean {
    const code = o.engineResult ?? o.error ?? "(結果なし)";
    if (code !== "tesSUCCESS") this.errorCodes.push(`${item}: ${code}`);
    const ok = o.engineResult === expectCode && o.validated === true;
    this.add(ok ? "pass" : "fail", item, `${expectCode}（validated）`, `${code} / validated=${String(o.validated)}`,
      `[${o.hash}](${explorerTxUrl(o.hash)})${extra ? `。${extra}` : ""}`);
    return ok;
  }

  eq(item: string, expected: string, actual: string, evidence: string): boolean {
    const ok = expected === actual;
    this.add(ok ? "pass" : "fail", item, expected, actual, evidence);
    return ok;
  }

  verdict(): Verdict {
    const fails = this.statuses.filter((s) => s === "fail").length;
    const passes = this.statuses.filter((s) => s === "pass").length;
    return fails === 0 && passes > 0 ? "合格" : passes > 0 ? "一部合格" : "不合格";
  }
}

/** 前提が崩れて以降を続けられないときに投げる */
export class Abort extends Error {}
