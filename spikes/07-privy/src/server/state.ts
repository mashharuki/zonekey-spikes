import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 秘密は入れない（Privy の user/wallet/policy ID とアドレスだけ）。gitignore 済みの .state/ に置く */
const DIR = fileURLToPath(new URL("../../.state/", import.meta.url));
const FILE = `${DIR}state.json`;

export interface LoginRecord { at: string; userId: string; walletId: string; address: string; created: boolean; userAgent: string }
export interface State { policyId?: string; logins: LoginRecord[] }

export function loadState(): State {
  if (!existsSync(FILE)) return { logins: [] };
  return JSON.parse(readFileSync(FILE, "utf8")) as State;
}
export function saveState(s: State): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}
