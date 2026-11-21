import type { Client, IssuedCurrencyAmount } from "xrpl";

/** IOU の値を 1e-9 単位の整数にする（比較用）。生の文字列は REPORT に別途残す */
export const units = (s: string | undefined): bigint => BigInt(Math.round(Number(s ?? "0") * 1e9));
export const fmt = (u: bigint): string => {
  const neg = u < 0n;
  const a = neg ? -u : u;
  const int = a / 1_000_000_000n;
  const frac = (a % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
};

export const iou = (currency: string, issuer: string, value: string): IssuedCurrencyAmount => ({ currency, issuer, value });

/** holder が issuer に対して持つ currency の残高（トラストラインが無ければ undefined） */
export async function lineBalance(client: Client, holder: string, issuer: string, currency: string): Promise<string | undefined> {
  try {
    const r = await client.request({ command: "account_lines", account: holder, peer: issuer, ledger_index: "validated" });
    return r.result.lines.find((l) => l.currency === currency)?.balance;
  } catch (e) {
    if ((e as { data?: { error?: string } }).data?.error === "actNotFound") return undefined;
    throw e;
  }
}

export interface OfferView {
  seq: number;
  takerGets: string;
  takerPays: string;
  flags: number;
}

const amt = (a: unknown): string =>
  typeof a === "string" ? `${a} drops` : `${(a as IssuedCurrencyAmount).value} ${(a as IssuedCurrencyAmount).currency}`;

export async function accountOffers(client: Client, account: string): Promise<OfferView[]> {
  const r = await client.request({ command: "account_offers", account, ledger_index: "validated" });
  return r.result.offers?.map((o) => ({ seq: o.seq, takerGets: amt(o.taker_gets), takerPays: amt(o.taker_pays), flags: o.flags })) ?? [];
}

/** 発行者の負債（gateway_balances.obligations）。escrow 中の受給証が含まれるかの実測に使う */
export async function obligations(client: Client, issuer: string): Promise<Record<string, string>> {
  const r = await client.request({ command: "gateway_balances", account: issuer, ledger_index: "validated" });
  return r.result.obligations ?? {};
}

export async function accountFlags(client: Client, account: string): Promise<number> {
  const r = await client.request({ command: "account_info", account, ledger_index: "validated" });
  return r.result.account_data.Flags >>> 0;
}

/** 検証済みレジャーの close_time（Ripple epoch 秒） */
export async function validatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return r.result.ledger.close_time;
}

/** 検証済みレジャーの close_time が target を超えるまで待つ */
export async function waitUntilLedgerTimeAfter(client: Client, target: number, timeoutMs = 5 * 60_000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const t = await validatedCloseTime(client);
    if (t > target) return t;
    if (Date.now() - start > timeoutMs) throw new Error(`レジャー時刻が ${target} を超えない（現在 ${t}）`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}
