/**
 * 11a の共通部分（台帳側とPrivy側の両方で使う）。
 * 根拠: xrpl.org CheckCreate / CheckCash / CheckCancel / Checks、rippled 3.4.1 CheckCash.cpp、xrpl.js 5.3 の型
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Client, TransactionMetadata } from "xrpl";
import type { Recorder } from "xrpl-kit";

/** 受給証の通貨コード（spike 04 と同じ） */
export const VOUCHER = "ZKV";
export const zkv = (issuer: string, value: string) => ({ currency: VOUCHER, issuer, value });

/** 作成した Check の ID（meta の CreatedNode の LedgerIndex） */
export function createdCheckId(meta: unknown): string | undefined {
  const nodes = (meta as TransactionMetadata | undefined)?.AffectedNodes ?? [];
  for (const n of nodes) if ("CreatedNode" in n && n.CreatedNode.LedgerEntryType === "Check") return n.CreatedNode.LedgerIndex;
  return undefined;
}

export async function txMeta(client: Client, hash: string): Promise<Record<string, unknown> | undefined> {
  try {
    const r = await client.request({ command: "tx", transaction: hash });
    return r.result.meta as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** 受給証の残高（account_lines。トラストラインが無ければ undefined） */
export async function voucherBalance(client: Client, account: string, issuer: string): Promise<string | undefined> {
  const r = await client.request({ command: "account_lines", account, peer: issuer, ledger_index: "validated" });
  return r.result.lines.find((l) => l.currency === VOUCHER)?.balance;
}

export async function ownerCount(client: Client, account: string): Promise<number> {
  const r = await client.request({ command: "account_info", account, ledger_index: "validated" });
  return r.result.account_data.OwnerCount;
}

/** その Check が台帳にあるか（ledger_entry で直接引く） */
export async function checkEntry(client: Client, checkId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const r = await client.request({ command: "ledger_entry", check: checkId, ledger_index: "validated" } as never);
    return (r as { result: { node: Record<string, unknown> } }).result.node;
  } catch {
    return undefined;
  }
}

/** 検証済みレジャーの close_time（Ripple Epoch 秒） */
export async function validatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return Number(r.result.ledger.close_time);
}

/** 結果（Recorder の中身）を JSON に保存し、report.ts で REPORT.md にまとめる */
export function saveResults(name: string, r: Recorder, extra: Record<string, unknown> = {}) {
  const dir = new URL("../results/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${name}.json`, dir), JSON.stringify({ at: new Date().toISOString(), verdict: r.verdict(), rows: r.rows, statuses: r.statuses, errorCodes: r.errorCodes, unknowns: r.unknowns, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)); // BigInt（drops）は文字列で保存
  console.log(`[11a] wrote results/${name}.json`);
}
export function loadResults(name: string): Record<string, unknown> | undefined {
  const f = new URL(`../results/${name}.json`, import.meta.url);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : undefined;
}
