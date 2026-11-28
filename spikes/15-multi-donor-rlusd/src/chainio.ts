/** 台帳の読み取り（残高・Escrow・同期データ）。書き込みはしない */
import type { Client } from "xrpl";
import { type J, flat } from "../../14-issuance-recovery/src/chain.js";
import { PK_MEMO_TYPE, hex } from "../../11c-voucher-escrow/src/voucher/core.js";
import type { SyncedEscrow } from "../../11c-voucher-escrow/src/voucher/shop.js";
import { parseDec } from "./dec.js";

/** 指定 ledger 時点のトラストライン残高（holder から見た、issuer 側の残高）。線がなければ 0 */
export async function lineBal(client: Client, holder: string, issuer: string, currency: string, ledger: number | "validated"): Promise<bigint> {
  try {
    let marker: unknown;
    do {
      const r = (await client.request({ command: "account_lines", account: holder, peer: issuer, ledger_index: ledger, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J };
      const l = (r.result["lines"] as J[]).find((x) => x["currency"] === currency);
      if (l) return parseDec(l["balance"]);
      marker = r.result["marker"];
    } while (marker);
    return 0n;
  } catch (e) {
    if ((e as { data?: { error?: string } }).data?.error === "actNotFound") return 0n;
    throw e;
  }
}

/** 発行者 V の義務（gateway_balances.obligations）。ZKV の保有者合計 */
export async function obligations(client: Client, issuer: string, currency: string, ledger: number | "validated"): Promise<bigint> {
  const r = (await client.request({ command: "gateway_balances", account: issuer, ledger_index: ledger } as never)) as unknown as { result: J };
  const o = (r.result["obligations"] ?? {}) as Record<string, string>;
  return o[currency] ? parseDec(o[currency]!) : 0n;
}

export async function ledgerInfo(client: Client, ledger: number | "validated"): Promise<{ index: number; closeTime: number; hash: string }> {
  const r = await client.request({ command: "ledger", ledger_index: ledger });
  return { index: Number(r.result.ledger_index), closeTime: Number(r.result.ledger.close_time), hash: String(r.result.ledger_hash) };
}

export async function escrowAt(client: Client, index: string, ledger: number | "validated"): Promise<J | undefined> {
  try {
    const r = (await client.request({ command: "ledger_entry", index, ledger_index: ledger } as never)) as unknown as { result: J };
    return r.result["node"] as J;
  } catch (e) {
    const err = (e as { data?: { error?: string } }).data?.error;
    if (err === "entryNotFound") return undefined;
    throw e;
  }
}

/** 店の端末が同期する「自店宛ての Escrow 一覧」を、確定した台帳から作る（spike 14 と同じ方法） */
export async function syncFromChain(client: Client, shop: string): Promise<SyncedEscrow[]> {
  const list: SyncedEscrow[] = [];
  let marker: unknown;
  do {
    const res = (await client.request({ command: "account_objects", account: shop, type: "escrow", ledger_index: "validated", ...(marker ? { marker } : {}) } as never)) as unknown as { result: J };
    for (const o of res.result["account_objects"] as J[]) {
      if (o["Destination"] !== shop) continue;
      const tx = flat(((await client.request({ command: "tx", transaction: o["PreviousTxnID"] })) as unknown as { result: J }).result);
      const memo = ((tx.tx["Memos"] as J[] | undefined) ?? []).find((m) => String(m["Memo"]?.["MemoType"]).toUpperCase() === PK_MEMO_TYPE);
      list.push({ index: o["index"], owner: o["Account"], offerSequence: Number(tx.tx["Sequence"]), destination: shop, amount: o["Amount"], condition: o["Condition"], cancelAfter: Number(o["CancelAfter"]), ...(memo ? { pkHash: memo["Memo"]["MemoData"] } : {}), createTx: o["PreviousTxnID"] });
    }
    marker = res.result["marker"];
  } while (marker);
  return list;
}
export { hex };
