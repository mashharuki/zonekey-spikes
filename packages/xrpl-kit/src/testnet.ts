import { Client } from "xrpl";

export const DEFAULT_TESTNET_URL = "wss://s.altnet.rippletest.net:51233";

/** 接続を許可するホスト。Mainnet などに繋がらないよう Testnet のみ。 */
const ALLOWED_HOSTS = new Set(["s.altnet.rippletest.net", "clio.altnet.rippletest.net"]);

export const EXPLORER_BASE = "https://testnet.xrpl.org";
export const explorerTxUrl = (hash: string): string => `${EXPLORER_BASE}/transactions/${hash}`;
export const explorerAccountUrl = (address: string): string => `${EXPLORER_BASE}/accounts/${address}`;

export function resolveTestnetUrl(): string {
  const url = process.env["XRPL_TESTNET_URL"]?.trim() || DEFAULT_TESTNET_URL;
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Testnet 以外には接続しません: ${host}（許可: ${[...ALLOWED_HOSTS].join(", ")}）`,
    );
  }
  return url;
}

/** Testnet に接続した Client を返す。使い終わったら client.disconnect() すること。 */
export async function connectTestnet(): Promise<Client> {
  const url = resolveTestnetUrl();
  const client = new Client(url);
  console.log(`[xrpl-kit] connecting: ${url}`);
  await client.connect();
  console.log(`[xrpl-kit] connected (networkID=${client.networkID ?? "n/a"})`);
  return client;
}
