import type { Client, SubmittableTransaction, Wallet } from "xrpl";
import { explorerTxUrl } from "./testnet.js";

export interface TxOutcome {
  label: string;
  /** 署名済みトランザクションの hash（送信前に確定するので失敗時も残る） */
  hash: string;
  /** メタデータの TransactionResult（tesSUCCESS / tecXXX など）。取得できなければ undefined */
  engineResult: string | undefined;
  validated: boolean | undefined;
  ledgerIndex: number | undefined;
  explorerUrl: string;
  /** submitAndWait が例外を投げた場合のメッセージ（tem/tef 等はここに出ることがある） */
  error: string | undefined;
}

/**
 * submitAndWait のラッパー。
 * autofill → 署名 → hash をログ → submitAndWait → engine_result をログ、を必ず行う。
 * 例外が出ても hash と error を TxOutcome に入れて返す（呼び出し側が記録・判断する）。
 */
export async function submitAndLog(
  client: Client,
  label: string,
  tx: SubmittableTransaction,
  wallet: Wallet,
): Promise<TxOutcome> {
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const base = { label, hash: signed.hash, explorerUrl: explorerTxUrl(signed.hash) };
  console.log(`[xrpl-kit] ${label}: submitting ${tx.TransactionType} hash=${signed.hash}`);

  try {
    const res = await client.submitAndWait(signed.tx_blob);
    const meta = res.result.meta;
    const engineResult = typeof meta === "object" ? meta.TransactionResult : undefined;
    const outcome: TxOutcome = {
      ...base,
      engineResult,
      validated: res.result.validated,
      ledgerIndex: res.result.ledger_index,
      error: undefined,
    };
    console.log(
      `[xrpl-kit] ${label}: engine_result=${engineResult ?? "(none)"} validated=${String(outcome.validated)} ledger=${String(outcome.ledgerIndex)} hash=${outcome.hash}`,
    );
    console.log(`[xrpl-kit] ${label}: ${outcome.explorerUrl}`);
    return outcome;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[xrpl-kit] ${label}: FAILED hash=${base.hash} error=${message}`);
    return {
      ...base,
      engineResult: undefined,
      validated: undefined,
      ledgerIndex: undefined,
      error: message,
    };
  }
}

export function isSuccess(outcome: TxOutcome): boolean {
  return outcome.engineResult === "tesSUCCESS" && outcome.validated === true;
}
