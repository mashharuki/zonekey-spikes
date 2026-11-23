/**
 * 12 の共通部分。根拠:
 * - xrpl.org CredentialCreate / CredentialAccept / CredentialDelete / Credential、xrpl.js 5.3 の型（Subject・Issuer・CredentialType・Expiration）
 * - rippled 3.4.1: Protocol.h kMaxCredentialTypeLength = 64 / LedgerFormats.h lsfAccepted = 0x00010000 /
 *   CredentialHelpers.cpp checkExpired: now > Expiration で期限切れ / CredentialCreate.cpp: 発行者とお店の両方の owner directory に入る
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Client } from "xrpl";
import type { Recorder } from "xrpl-kit";

export const LSF_ACCEPTED = 0x00010000;
export const toHex = (s: string) => Buffer.from(s, "utf8").toString("hex").toUpperCase();
export const fromHex = (h: string) => Buffer.from(h, "hex").toString("utf8");
/** CredentialType: "todoke:shop:z13" のような地区つきの文字列（16 進で 64 バイトまで） */
export const credType = (district: string) => toHex(`todoke:shop:${district}`);
/** 開店の届けの Memo。MemoType = "todoke/open"、MemoData = "地区|時刻（Ripple Epoch 秒）"。中身は信用しない（届けである印として使うだけ） */
export const OPEN_MEMO_TYPE = toHex("todoke/open");
export const openMemo = (district: string, t: number) => [{ Memo: { MemoType: OPEN_MEMO_TYPE, MemoData: toHex(`${district}|${t}`) } }];

export async function validatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return Number(r.result.ledger.close_time);
}

const here = (p: string) => new URL(`../${p}`, import.meta.url);
export function saveResults(name: string, r: Recorder, extra: Record<string, unknown> = {}) {
  mkdirSync(here("results/"), { recursive: true });
  writeFileSync(here(`results/${name}.json`), JSON.stringify({ at: new Date().toISOString(), verdict: r.verdict(), rows: r.rows, statuses: r.statuses, errorCodes: r.errorCodes, unknowns: r.unknowns, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`[12] wrote results/${name}.json`);
}
export const loadResults = (name: string) => (existsSync(here(`results/${name}.json`)) ? (JSON.parse(readFileSync(here(`results/${name}.json`), "utf8")) as Record<string, unknown>) : undefined);
