/**
 * XRPL への問い合わせ（Reliable Transaction Submission の部品）。判断は service.ts。
 * 「見つからない」と「存在しない」を区別するため、tx は検索範囲（min_ledger〜max_ledger）を付けて問い合わせ、searched_all を記録する。
 */
import { Client, type Wallet } from "xrpl";

export type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const txJsonOf = (r: J): J => (r["tx_json"] ?? r) as J;

export type TxQuery =
  | { found: true; validated: boolean; tx: J; meta: J | undefined; result: string | undefined; ledgerIndex: number | undefined; hash: string }
  | { found: false; searchedAll: boolean | undefined; error: string };

export async function queryTx(client: Client, hash: string, min: number, max: number): Promise<TxQuery> {
  try {
    const r = await client.request({ command: "tx", transaction: hash, min_ledger: min, max_ledger: max } as never) as unknown as { result: unknown };
    const res = r.result as unknown as J;
    const meta = (res["meta"] ?? undefined) as J | undefined;
    return { found: true, validated: res["validated"] === true, tx: txJsonOf(res), meta, result: meta?.["TransactionResult"] as string | undefined, ledgerIndex: res["ledger_index"] as number | undefined, hash };
  } catch (e) {
    const data = ((e as J)["data"] ?? {}) as J;
    const err = String(data["error"] ?? (e as Error).message);
    if (err === "txnNotFound") return { found: false, searchedAll: typeof data["searched_all"] === "boolean" ? (data["searched_all"] as boolean) : undefined, error: err };
    return { found: false, searchedAll: undefined, error: `${err}: ${(e as Error).message}` };
  }
}

export interface ChainInfo { validatedIndex: number; closeTime: number; seqCurrent: number; seqValidated: number; completeLedgers: string; fee: string }
export async function chainInfo(client: Client, account: string): Promise<ChainInfo> {
  const [led, cur, val, si, fee] = await Promise.all([
    client.request({ command: "ledger", ledger_index: "validated" }),
    client.request({ command: "account_info", account, ledger_index: "current" }),
    client.request({ command: "account_info", account, ledger_index: "validated" }),
    client.request({ command: "server_info" }),
    client.autofill({ TransactionType: "AccountSet", Account: account }),
  ]);
  return {
    validatedIndex: Number(led.result.ledger_index), closeTime: Number(led.result.ledger.close_time),
    seqCurrent: cur.result.account_data.Sequence, seqValidated: val.result.account_data.Sequence,
    completeLedgers: String(si.result.info.complete_ledgers), fee: String((fee as unknown as { Fee: string }).Fee),
  };
}

/** complete_ledgers（例 "1-4000,4010-5000"）が [min,max] を連続して含むか */
export function coversRange(complete: string, min: number, max: number): boolean {
  return complete.split(",").some((p) => { const [a, b] = p.split("-").map(Number); return a !== undefined && b !== undefined && a <= min && max <= b; });
}

/** account_tx を forward でページ末尾まで読む。返り値の complete = 最後までページを読み切れた */
export async function accountHistory(client: Client, account: string, min: number, max: number): Promise<{ txs: J[]; complete: boolean; pages: number }> {
  const txs: J[] = [];
  let marker: unknown;
  let pages = 0;
  for (;;) {
    const r = (await client.request({ command: "account_tx", account, ledger_index_min: min, ledger_index_max: max, forward: true, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: unknown };
    pages++;
    txs.push(...((r.result as unknown as J)["transactions"] as J[]));
    marker = (r.result as unknown as J)["marker"];
    if (!marker) return { txs, complete: true, pages };
    if (pages > 200) return { txs, complete: false, pages };
  }
}
export const flat = (t: J): { tx: J; meta: J | undefined; validated: boolean; hash: string; ledger: number | undefined } => ({
  tx: txJsonOf(t), meta: (t["meta"] ?? undefined) as J | undefined, validated: t["validated"] === true, hash: String((t["hash"] ?? txJsonOf(t)["hash"] ?? t["tx_json"]?.["hash"]) as string), ledger: (t["ledger_index"] ?? t["tx_json"]?.["ledger_index"]) as number | undefined,
});

export const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type { Client, Wallet };
