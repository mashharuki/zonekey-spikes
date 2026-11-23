/** 11d の Node スクリプトの共通部分（発行・精算）。根拠は 11c と同じ（xrpl.org Escrow 各ページ・rippled 3.4.1 のソース） */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Client } from "xrpl";
import type { Recorder } from "xrpl-kit";

export const VOUCHER = "ZKV";
export const zkv = (issuer: string, value: string) => ({ currency: VOUCHER, issuer, value });
export const here = (p: string) => new URL(`../${p}`, import.meta.url);

export async function voucherBalance(client: Client, account: string, issuer: string): Promise<string | undefined> {
  try {
    const r = await client.request({ command: "account_lines", account, peer: issuer, ledger_index: "validated" });
    return r.result.lines.find((l) => l.currency === VOUCHER)?.balance;
  } catch { return undefined; }
}
export async function validatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return Number(r.result.ledger.close_time);
}
export async function txJson(client: Client, hash: string): Promise<Record<string, unknown> | undefined> {
  try { return (await client.request({ command: "tx", transaction: hash })).result as unknown as Record<string, unknown>; } catch { return undefined; }
}
export function saveResults(name: string, r: Recorder, extra: Record<string, unknown> = {}) {
  mkdirSync(here("results/"), { recursive: true });
  writeFileSync(here(`results/${name}.json`), JSON.stringify({ at: new Date().toISOString(), verdict: r.verdict(), rows: r.rows, statuses: r.statuses, errorCodes: r.errorCodes, unknowns: r.unknowns, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`[11d] wrote results/${name}.json`);
}
export const loadResults = (name: string) => (existsSync(here(`results/${name}.json`)) ? (JSON.parse(readFileSync(here(`results/${name}.json`), "utf8")) as Record<string, unknown>) : undefined);
export function writeJson(path: string, v: unknown) {
  mkdirSync(new URL(".", here(path)), { recursive: true });
  writeFileSync(here(path), JSON.stringify(v, null, 2));
  console.log(`[11d] wrote ${path}`);
}
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** お店の seed（Testnet 専用。毎回の発行で新しく作る）は .state/ にだけ置く（gitignore 済み） */
export const SHOP_STATE = ".state/shop.json";
