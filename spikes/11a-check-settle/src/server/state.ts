import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 秘密は入れない（Privy の policy ID だけ）。gitignore 済みの .state/ に置く */
const DIR = fileURLToPath(new URL("../../.state/", import.meta.url));
const FILE = `${DIR}11a.json`;
export interface State { looseLockPolicyId?: string }
export const loadState = (): State => (existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as State) : {});
export function saveState(s: State): void { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(s, null, 2)); }
