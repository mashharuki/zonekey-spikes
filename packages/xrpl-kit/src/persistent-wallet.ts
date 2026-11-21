import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Wallet, type Client } from "xrpl";
import { explorerAccountUrl } from "./testnet.js";

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** pnpm-workspace.yaml があるディレクトリ（= リポジトリルート）を探す */
function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/**
 * シードをリポジトリ直下の .env.local に保存する（gitignore 済み）。
 * 値は標準出力に出さない。空の `NAME=` 行があれば置き換え、無ければ追記する。
 */
export function saveSeedToEnvLocal(envVar: string, seed: string, startDir: string = process.cwd()): string {
  if (!ENV_NAME.test(envVar)) throw new Error(`環境変数名が不正: ${envVar}`);
  const path = resolve(findRepoRoot(startDir), ".env.local");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const line = new RegExp(`^${envVar}=(.*)$`, "m");
  const m = line.exec(current);
  if (m && (m[1] ?? "").trim() !== "") {
    throw new Error(`${envVar} は ${path} に既に値がある。上書きしない`);
  }
  const next = m
    ? current.replace(line, `${envVar}=${seed}`)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${envVar}=${seed}\n`;
  writeFileSync(path, next, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  process.env[envVar] = seed;
  return path;
}

/** 環境変数のシードからウォレットを復元する。未設定なら undefined。値は決して表示しない */
export function walletFromEnv(envVar: string): Wallet | undefined {
  const seed = process.env[envVar]?.trim();
  if (!seed) return undefined;
  try {
    return Wallet.fromSeed(seed);
  } catch {
    throw new Error(`${envVar} が有効なシードではない（値は表示しない）`);
  }
}

export async function isAccountActivated(client: Client, address: string): Promise<boolean> {
  try {
    await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return true;
  } catch (e) {
    if ((e as { data?: { error?: string } }).data?.error === "actNotFound") return false;
    throw e;
  }
}

export interface PersistentWallet {
  wallet: Wallet;
  /** このシードを今回新規に作って .env.local に保存した */
  createdNow: boolean;
  /** 今回 Faucet で XRP を入れた（アカウントが未作成だった） */
  fundedNow: boolean;
  /** 新規作成時に書き込んだ .env.local のパス */
  envPath: string | undefined;
}

/**
 * 固定ウォレットを使う。.env.local（または環境変数）に <envVar> があればそれを復元し、
 * 無ければ生成して .env.local に保存する。アカウントが未作成なら Faucet で資金を入れる。
 * シードは保存を先に行う（資金投入が失敗してもシードを失わない）。ログに出すのはアドレスだけ。
 */
export async function loadOrCreatePersistentWallet(
  client: Client,
  envVar: string,
  label: string,
  startDir: string = process.cwd(),
): Promise<PersistentWallet> {
  let wallet = walletFromEnv(envVar);
  let createdNow = false;
  let envPath: string | undefined;
  if (!wallet) {
    wallet = Wallet.generate();
    envPath = saveSeedToEnvLocal(envVar, wallet.seed ?? "", startDir);
    createdNow = true;
    console.log(`[xrpl-kit] "${label}": new wallet ${wallet.address}; seed saved to ${envPath} as ${envVar} (not printed)`);
  } else {
    console.log(`[xrpl-kit] "${label}": using ${envVar} → ${wallet.address}`);
  }

  let fundedNow = false;
  if (!(await isAccountActivated(client, wallet.address))) {
    console.log(`[xrpl-kit] "${label}": account not activated; funding via faucet...`);
    const { balance } = await client.fundWallet(wallet);
    fundedNow = true;
    console.log(`[xrpl-kit] "${label}": funded balance=${balance} XRP ${explorerAccountUrl(wallet.address)}`);
  }
  return { wallet, createdNow, fundedNow, envPath };
}
