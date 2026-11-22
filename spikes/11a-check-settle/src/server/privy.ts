// spike 07 の src/server/privy.ts を流用（ensureUserXrplWallet がポリシー ID も返すようにした）
import { PrivyClient } from "@privy-io/node";

let client: PrivyClient | undefined;

/** PRIVY_APP_ID / PRIVY_APP_SECRET は .env.local（サーバーだけが読む） */
export function privy(): PrivyClient {
  if (client) return client;
  const appId = process.env["PRIVY_APP_ID"] ?? process.env["VITE_PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];
  if (!appId || !appSecret) throw new Error("PRIVY_APP_ID（または VITE_PRIVY_APP_ID）と PRIVY_APP_SECRET を .env.local に設定する");
  client = new PrivyClient({ appId, appSecret });
  return client;
}

/** Privy SDK の例外を、状態コードとメッセージの 1 行にする（記録用） */
export function describePrivyError(e: unknown): string {
  // SDK の message は「状態コード + 本文」を既に含むので、そのまま使う（以前は二重に出ていた）
  const err = e as { status?: number; message?: string };
  return err.message ?? String(e);
}

/**
 * ユーザーの XRPL ウォレットを返す。既にあれば再利用し（確認 6）、無ければユーザーを所有者にして作る（確認 1）。
 */
export async function ensureUserXrplWallet(userId: string): Promise<{ walletId: string; address: string; publicKey: string; created: boolean; ownerId: string | null; policyIds: string[] }> {
  const p = privy();
  for await (const w of p.wallets().list({ user_id: userId, chain_type: "xrpl" })) {
    return { walletId: w.id, address: w.address, publicKey: w.public_key ?? "", created: false, ownerId: w.owner_id, policyIds: w.policy_ids };
  }
  const w = await p.wallets().create({ chain_type: "xrpl", owner: { user_id: userId } });
  return { walletId: w.id, address: w.address, publicKey: w.public_key ?? "", created: true, ownerId: w.owner_id, policyIds: w.policy_ids };
}
