import { TrustSetFlags, type Client, type TrustSet, type Wallet } from "xrpl";
import { submitAndLog, type TxOutcome } from "./submit.js";

/** 出典: https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl（Testnet） */
export const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
export const RLUSD_TESTNET_ISSUER = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
export const RLUSD_FAUCET_URL = "https://tryrlusd.com/";
/** 同ドキュメントの TrustSet 例と同じ上限値 */
const TRUST_LIMIT = "1000000000";

export interface RlusdLine {
  exists: boolean;
  balance: string | undefined;
  limit: string | undefined;
  noRipple: boolean | undefined;
}

/** account_lines（読み取り専用）で RLUSD のトラストラインと残高を取得 */
export async function getRlusdLine(client: Client, address: string): Promise<RlusdLine> {
  try {
    const r = await client.request({
      command: "account_lines",
      account: address,
      peer: RLUSD_TESTNET_ISSUER,
      ledger_index: "validated",
    });
    const line = r.result.lines.find((l) => l.currency === RLUSD_CURRENCY);
    return line
      ? { exists: true, balance: line.balance, limit: line.limit, noRipple: line.no_ripple }
      : { exists: false, balance: undefined, limit: undefined, noRipple: undefined };
  } catch (e) {
    if ((e as { data?: { error?: string } }).data?.error === "actNotFound") {
      return { exists: false, balance: undefined, limit: undefined, noRipple: undefined };
    }
    throw e;
  }
}

/** RLUSD のトラストラインが無ければ TrustSet を送る。既にあれば何も送らず undefined を返す */
export async function ensureRlusdTrustLine(client: Client, wallet: Wallet): Promise<TxOutcome | undefined> {
  if ((await getRlusdLine(client, wallet.address)).exists) {
    console.log(`[xrpl-kit] RLUSD trust line already exists for ${wallet.address}`);
    return undefined;
  }
  const tx: TrustSet = {
    TransactionType: "TrustSet",
    Account: wallet.address,
    LimitAmount: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: TRUST_LIMIT },
    Flags: TrustSetFlags.tfSetNoRipple,
  };
  return submitAndLog(client, "RLUSD TrustSet", tx, wallet);
}
