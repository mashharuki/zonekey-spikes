/**
 * 11c の共通部分。根拠: xrpl.org EscrowCreate / EscrowFinish / EscrowCancel / Escrow（XLS-85）、rippled 3.4.1 の
 * EscrowFinish.cpp（期限後 tecNO_PERMISSION・条件違い tecCRYPTOCONDITION_ERROR）/ EscrowCancel.cpp（期限前 tecNO_PERMISSION）/
 * EscrowHelpers.h（宛先が自分で Finish するときだけトラストラインを作る。第三者なら tecNO_LINE）/ EscrowCreate.cpp（宛先の owner directory にも入る）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Client } from "xrpl";
import type { Recorder } from "xrpl-kit";

export const VOUCHER = "ZKV";
export const zkv = (issuer: string, value: string) => ({ currency: VOUCHER, issuer, value });

/** 券の種類（MVP: 1 店舗固定・額面 2 種類。円との換算は扱わず、「5 = 500 円券、10 = 1,000 円券」とみなす） */
export const FACE = { small: "5", large: "10" } as const;

export async function voucherBalance(client: Client, account: string, issuer: string): Promise<string | undefined> {
  try {
    const r = await client.request({ command: "account_lines", account, peer: issuer, ledger_index: "validated" });
    return r.result.lines.find((l) => l.currency === VOUCHER)?.balance;
  } catch {
    return undefined;
  }
}
export async function ownerCount(client: Client, account: string): Promise<number> {
  const r = await client.request({ command: "account_info", account, ledger_index: "validated" });
  return r.result.account_data.OwnerCount;
}
export async function xrpBalanceDrops(client: Client, account: string): Promise<bigint> {
  const r = await client.request({ command: "account_info", account, ledger_index: "validated" });
  return BigInt(r.result.account_data.Balance);
}
export async function validatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return Number(r.result.ledger.close_time);
}
export async function txJson(client: Client, hash: string): Promise<Record<string, unknown> | undefined> {
  try {
    const r = await client.request({ command: "tx", transaction: hash });
    return r.result as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const here = (p: string) => new URL(`../${p}`, import.meta.url);
/** 公開してよい結果（results/、コミットする） */
export function saveResults(name: string, r: Recorder, extra: Record<string, unknown> = {}) {
  mkdirSync(here("results/"), { recursive: true });
  writeFileSync(here(`results/${name}.json`), JSON.stringify({ at: new Date().toISOString(), verdict: r.verdict(), rows: r.rows, statuses: r.statuses, errorCodes: r.errorCodes, unknowns: r.unknowns, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`[11c] wrote results/${name}.json`);
}
export function loadResults(name: string): Record<string, unknown> | undefined {
  const f = here(`results/${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : undefined;
}
export function saveJson(path: string, v: unknown) {
  mkdirSync(new URL(".", here(path)), { recursive: true });
  writeFileSync(here(path), JSON.stringify(v, null, 2));
}
export function loadJson<T>(path: string): T {
  if (!existsSync(here(path))) throw new Error(`${path} がない。前の段階を先に実行する`);
  return JSON.parse(readFileSync(here(path), "utf8")) as T;
}

/**
 * 秘密を含む状態（.state/、gitignore 済み。コミットしない・ログに出さない）
 * - お店 A・B の seed（毎回新しく作る Testnet 専用の口座）
 * - 世帯の秘密・端末の鍵（JWK）・券の preimage と QR のバイト列
 */
export interface Spec { id: string; household: "HH1" | "HH2"; n: number; shop: "A" | "B"; value: string; short?: boolean; signed: boolean }
export interface IssuedVoucher extends Spec { offerSequence: number; conditionHex: string; preimageHex: string; qrHex: string; cancelAfter: number }
export interface State {
  at: string;
  accounts: { V: string; D: string; A: string; B: string };
  shopSeeds: { A: string; B: string };
  households: Record<string, { secretHex: string; deviceJwk?: JsonWebKey }>;
  vouchers: IssuedVoucher[];
  claims?: { id: string; offerSequence: number; fulfillmentHex: string }[];
}
export const STATE = ".state/11c.json";
export const SYNCED_A = "results/synced-A.json";
