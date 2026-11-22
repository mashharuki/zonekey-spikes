import type { InputMap } from "@noir-lang/noirc_abi";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { randomBytes } from "node:crypto";

export const DEPTH = 12;
/** 0x + 31 バイトの乱数（BN254 の体の範囲に必ず収まる） */
const rf = () => `0x${randomBytes(31).toString("hex")}`;
const ZONE_SET = ["13101", "13102", "13103", "13104", "13105", "13106", "13107", "13108"];

/**
 * 証明 1 件分の入力を作る。根と nullifier は回路と同じ関数を持つ fixture 回路を execute して得る
 * （JS で Poseidon2 を別実装すると食い違いの原因になるため）。
 */
export async function makeInputs(fixture: Noir, i: number): Promise<InputMap> {
  const priv = {
    acct: rf(), zone: ZONE_SET[i % 8]!, senior: true, revictim: i % 2 === 0, tier: String(2 + (i % 3)),
    hh_secret: rf(), salt: rf(), index: String(i % 4096), siblings: Array.from({ length: DEPTH }, rf),
  };
  const program_id = "0x9001";
  const { returnValue } = await fixture.execute({ ...priv, program_id });
  const [root, nullifier] = returnValue as [string, string];
  return {
    root, acct: priv.acct, program_id, zone_set: ZONE_SET,
    need_senior: true, need_revictim: false, min_tier: "2", nullifier,
    zone: priv.zone, senior: priv.senior, revictim: priv.revictim, tier: priv.tier,
    hh_secret: priv.hh_secret, salt: priv.salt, index: priv.index, siblings: priv.siblings,
  };
}

export const loadCircuit = async (name: string): Promise<CompiledCircuit> =>
  JSON.parse(await (await import("node:fs/promises")).readFile(new URL(`../circuits/target/${name}.json`, import.meta.url), "utf8")) as CompiledCircuit;
