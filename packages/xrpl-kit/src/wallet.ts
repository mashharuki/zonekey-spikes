import type { Client, Wallet } from "xrpl";
import { explorerAccountUrl } from "./testnet.js";

export interface FundedWallet {
  label: string;
  wallet: Wallet;
  /** Faucet 投入後の XRP 残高 */
  balanceXrp: number;
}

/**
 * Faucet で資金を入れたウォレットを作る。
 * アドレスと残高のみログに出す（シード・秘密鍵は出力しない）。
 */
export async function createFundedWallet(client: Client, label: string): Promise<FundedWallet> {
  console.log(`[xrpl-kit] funding wallet "${label}" via faucet...`);
  const { wallet, balance } = await client.fundWallet();
  console.log(
    `[xrpl-kit] funded "${label}": ${wallet.address} balance=${balance} XRP ${explorerAccountUrl(wallet.address)}`,
  );
  return { label, wallet, balanceXrp: balance };
}
