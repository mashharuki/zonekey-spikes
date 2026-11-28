/**
 * 取引の追跡つき送信。署名済みバイト列を「送信より先に」journal へ保存し、再実行で二重に送らない。
 *  - validated で見つかった取引は、再実行ではそのまま使う（再送しない）
 *  - 見つからない間は同じバイト列を再送する（同一 hash なので二重にならない）
 *  - LastLedgerSequence を越え、かつ履歴が連続して検索範囲に含まれ searched_all のときだけ「不成立」と確定して新しく署名する
 *  - 確定できない（判定不能）ときは hash を残して止まる。確定結果を照会してから続行する
 * 秘密（seed）は journal に入れない。署名済みバイト列は送信可能なので .state（gitignore 済み）にだけ置く。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Client, SubmittableTransaction, Wallet } from "xrpl";
import { type J, chainInfo, coversRange, queryTx, waitMs } from "../../14-issuance-recovery/src/chain.js";

export interface TxRec {
  label: string; role: string; ticket?: string; phase: "prep" | "scenario" | "outside";
  account: string; type: string; hash: string; blob: string; lls: number; firstLedger: number;
  status: "prepared" | "validated" | "failed_final";
  result?: string; ledger?: number; closeTime?: number; attempts: number; supersededHashes: string[];
  fee?: string; note?: string; expected?: string;
}
export class StopError extends Error {}

export class Journal {
  recs: Record<string, TxRec> = {};
  constructor(readonly path: string) { if (existsSync(path)) this.recs = JSON.parse(readFileSync(path, "utf8")) as Record<string, TxRec>; }
  save() { const t = `${this.path}.tmp`; writeFileSync(t, JSON.stringify(this.recs, null, 1), { mode: 0o600 }); renameSync(t, this.path); }
  get(label: string) { return this.recs[label]; }
  list() { return Object.values(this.recs); }
}

export interface TrackOpts { role: string; ticket?: string; phase: "prep" | "scenario"; expect?: string; pollMs?: number }

async function ledgerCloseTime(client: Client, index: number): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: index });
  return Number(r.result.ledger.close_time);
}

export async function tracked(client: Client, jr: Journal, label: string, wallet: Wallet, tx: SubmittableTransaction, o: TrackOpts): Promise<TxRec> {
  const expect = o.expect ?? "tesSUCCESS";
  let rec = jr.get(label);
  const poll = o.pollMs ?? 2000;
  if (rec && rec.status === "validated") return check(rec, expect);
  if (rec && rec.status === "prepared") {
    // 前回、署名・保存のあとで止まった。まず元の hash を照会する（送ったかもしれない）
    const info = await chainInfo(client, wallet.address);
    const q = await queryTx(client, rec.hash, rec.firstLedger, info.validatedIndex);
    if (q.found && q.validated) return check(await settle(client, jr, rec, q), expect);
    if (info.validatedIndex > rec.lls) {
      const covered = coversRange(info.completeLedgers, rec.firstLedger, info.validatedIndex);
      if (!(covered && !q.found && q.searchedAll === true)) throw new StopError(`判定不能: ${label} hash=${rec.hash} は LastLedgerSequence(${rec.lls}) を越えたが、不成立を確定できない（searched_all=${q.found ? "found" : q.searchedAll}, 連続=${covered}）。確定結果を照会してから再実行する`);
      rec.status = "failed_final"; rec.supersededHashes.push(rec.hash); jr.save();
      rec = undefined; // 新しく署名し直す
    } else {
      await submitBlob(client, rec.blob);
      return check(await waitValidated(client, jr, rec, poll), expect);
    }
  }
  // 新規（または不成立が確定した再署名）
  const prev = jr.get(label);
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const info = await chainInfo(client, wallet.address);
  const nrec: TxRec = {
    label, role: o.role, phase: o.phase, ...(o.ticket ? { ticket: o.ticket } : {}), account: wallet.address, type: tx.TransactionType, hash: signed.hash, blob: signed.tx_blob,
    lls: Number(prepared.LastLedgerSequence), firstLedger: info.validatedIndex, status: "prepared", attempts: (prev?.attempts ?? 0) + 1, supersededHashes: prev?.supersededHashes ?? [], fee: String(prepared.Fee), expected: expect,
  };
  jr.recs[label] = nrec; jr.save(); // 送信より先に保存
  console.log(`[tx] ${label}: ${tx.TransactionType} hash=${signed.hash}`);
  await submitBlob(client, nrec.blob);
  return check(await waitValidated(client, jr, nrec, poll), expect);
}

async function submitBlob(client: Client, blob: string) {
  try { await client.request({ command: "submit", tx_blob: blob } as never); } catch (e) { console.log(`[tx] submit の応答なし（結果は hash で照会する）: ${(e as Error).message}`); }
}

async function settle(client: Client, jr: Journal, rec: TxRec, q: Extract<Awaited<ReturnType<typeof queryTx>>, { found: true }>): Promise<TxRec> {
  rec.status = "validated"; rec.result = q.result ?? "?"; rec.ledger = q.ledgerIndex ?? 0;
  rec.closeTime = await ledgerCloseTime(client, rec.ledger);
  jr.save();
  console.log(`[tx] ${rec.label}: ${rec.result} ledger=${rec.ledger}`);
  return rec;
}

async function waitValidated(client: Client, jr: Journal, rec: TxRec, poll: number): Promise<TxRec> {
  for (let i = 0; ; i++) {
    const info = await chainInfo(client, rec.account);
    const q = await queryTx(client, rec.hash, rec.firstLedger, info.validatedIndex);
    if (q.found && q.validated) return settle(client, jr, rec, q);
    if (info.validatedIndex > rec.lls + 1) {
      const covered = coversRange(info.completeLedgers, rec.firstLedger, info.validatedIndex);
      throw new StopError(`未確定: ${rec.label} hash=${rec.hash} は LastLedgerSequence(${rec.lls}) を越えても validated で見つからない（searched_all=${q.found ? "found/未validated" : q.searchedAll}, 連続=${covered}）。journal に残したので、再実行すると照会から続ける`);
    }
    if (i % 5 === 4) await submitBlob(client, rec.blob); // 同一バイト列の再送（同一 hash）
    await waitMs(poll);
  }
}

function check(rec: TxRec, expect: string): TxRec {
  if (rec.result !== expect) throw new StopError(`${rec.label}: 期待 ${expect} だが実際は ${rec.result}（hash=${rec.hash}, ledger=${rec.ledger}）。ここで止めて事実を記録する`);
  return rec;
}
export type { J };
