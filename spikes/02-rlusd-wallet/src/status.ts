import { fileURLToPath } from "node:url";
import {
  RLUSD_FAUCET_URL,
  connectTestnet,
  explorerAccountUrl,
  getRlusdLine,
  loadEnvLocal,
  walletFromEnv,
} from "xrpl-kit";

loadEnvLocal(fileURLToPath(import.meta.url));

// 読み取り専用。取引は送らない。
const wallet = walletFromEnv("DONOR_SEED");
if (!wallet) {
  console.error("DONOR_SEED が未設定。先に `pnpm --filter 02-rlusd-wallet start` を実行する");
  process.exit(1);
}

const client = await connectTestnet();
try {
  const xrp = await client.getXrpBalance(wallet.address).catch(() => undefined);
  const line = await getRlusdLine(client, wallet.address);
  console.log(`address : ${wallet.address}`);
  console.log(`explorer: ${explorerAccountUrl(wallet.address)}`);
  console.log(`XRP     : ${xrp === undefined ? "アカウント未有効化" : xrp}`);
  console.log(
    line.exists
      ? `RLUSD   : ${line.balance}（limit=${line.limit}）`
      : `RLUSD   : トラストラインなし（先に start を実行）`,
  );
  console.log(`faucet  : ${RLUSD_FAUCET_URL}`);
} finally {
  await client.disconnect();
}
