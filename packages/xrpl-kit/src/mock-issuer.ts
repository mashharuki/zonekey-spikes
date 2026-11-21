import { AccountSetAsfFlags, type Client, type IssuedCurrencyAmount, type Wallet } from "xrpl";
import { submitAndLog, type TxOutcome } from "./submit.js";

export const LSF_DEFAULT_RIPPLE = 0x00800000;
export const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;

/**
 * Token Escrow に使える発行者の設定（spike 04 で実機確認した順序）。
 * 保有者がトラストラインを張る前に asfDefaultRipple → asfAllowTrustLineLocking を立てる。
 * DefaultRipple が無いと、保有者ラインの発行者側に NoRipple が付き、DEX での償還が tecKILLED になる。
 */
export async function configureEscrowableIssuer(client: Client, issuer: Wallet): Promise<TxOutcome[]> {
  const out: TxOutcome[] = [];
  for (const flag of [AccountSetAsfFlags.asfDefaultRipple, AccountSetAsfFlags.asfAllowTrustLineLocking]) {
    out.push(await submitAndLog(client, `issuer AccountSet SetFlag=${flag}`, { TransactionType: "AccountSet", Account: issuer.address, SetFlag: flag }, issuer));
  }
  return out;
}

export const issued = (currency: string, issuer: string, value: string): IssuedCurrencyAmount => ({ currency, issuer, value });
