/** 証明の生成と検証（noir_js 1.0.0 + @aztec-foundation/bb.js 6.0.0、UltraHonk、native bb）。spike 08 と同じ呼び方 */
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { gunzipSync } from "node:zlib";
import { BackendType, Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend, type ProofData } from "@aztec-foundation/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import type { InputMap } from "@noir-lang/noirc_abi";
import { digestToFields, fieldHex } from "./lib.js";

export const DEPTH = 12;
export const ZONES = 8;
export const TARGET = { verifierTarget: "noir-recursive" as const };
const load = (name: string) => JSON.parse(readFileSync(new URL(`../circuits/target/${name}.json`, import.meta.url), "utf8")) as CompiledCircuit;
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;

export interface Witness {
  zone: bigint; senior: boolean; revictim: boolean; tier: number; hhSecret: bigint; salt: bigint; index: number; siblings: bigint[];
}
export interface Statement {
  root: bigint; programId: bigint; zoneSet: bigint[]; needSenior: boolean; needRevictim: boolean; minTier: number;
}
export interface Derived { hhId: bigint; leaf: bigint; nullifier: bigint; tag: bigint; node: bigint; hi: bigint; lo: bigint }

const F = (x: bigint) => fieldHex(x);

export class Zk {
  readonly circuit = load("eligibility_bound");
  readonly noir = new Noir(this.circuit);
  readonly fixture = new Noir(load("fixture13"));
  api!: Barretenberg;
  honk!: UltraHonkBackend;
  verifier!: UltraHonkVerifierBackend;
  vk!: Uint8Array;
  stats: Record<string, unknown> = {};

  async init() {
    const t = performance.now();
    this.api = await Barretenberg.new({ backend: BackendType.NativeUnixSocket, threads: cpus().length });
    this.honk = new UltraHonkBackend(this.circuit.bytecode, this.api);
    const t2 = performance.now();
    this.vk = await this.honk.getVerificationKey(TARGET);
    this.verifier = new UltraHonkVerifierBackend(this.api);
    this.stats["initMs"] = ms(t);
    this.stats["vkMs"] = ms(t2);
    this.stats["vkBytes"] = this.vk.length;
    try {
      const s = await this.api.circuitStats({
        circuit: { name: "eligibility_bound", bytecode: gunzipSync(Buffer.from(this.circuit.bytecode, "base64")), verificationKey: new Uint8Array(0) },
        includeGatesPerOpcode: false,
        settings: { ipaAccumulation: false, oracleHashType: "poseidon2", disableZk: false, optimizedSolidityVerifier: false },
      });
      this.stats["gates"] = { numGates: s.numGates, numGatesDyadic: s.numGatesDyadic, numAcirOpcodes: s.numAcirOpcodes };
    } catch (e) { this.stats["gates"] = `取得失敗: ${(e as Error).message}`; }
  }
  async close() { await this.api.destroy().catch(() => undefined); }

  /** 回路と同じ Noir の関数で、ハッシュを計算する（JS で Poseidon2 を再実装しない） */
  async derive(p: { hhSecret: bigint; programId: bigint; zone: bigint; senior: boolean; revictim: boolean; tier: number; salt: bigint; digest: Uint8Array; left?: bigint; right?: bigint }): Promise<Derived> {
    const { returnValue } = await this.fixture.execute({
      hh_secret: F(p.hhSecret), program_id: F(p.programId), zone: F(p.zone), senior: p.senior, revictim: p.revictim, tier: String(p.tier), salt: F(p.salt),
      req_digest: Array.from(p.digest, String), left: F(p.left ?? 0n), right: F(p.right ?? 0n),
    });
    const [hhId, leaf, nullifier, tag, node, hi, lo] = (returnValue as string[]).map((x) => BigInt(x)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    return { hhId, leaf, nullifier, tag, node, hi, lo };
  }
  async node(l: bigint, r: bigint): Promise<bigint> {
    return (await this.derive({ hhSecret: 0n, programId: 0n, zone: 0n, senior: false, revictim: false, tier: 0, salt: 0n, digest: new Uint8Array(32), left: l, right: r })).node;
  }

  /** 回路への入力。tag は世帯側が fixture で計算した値（回路が再計算して一致を確かめる） */
  inputs(s: Statement, w: Witness, digest: Uint8Array, nullifier: bigint, tag: bigint): InputMap {
    const { hi, lo } = digestToFields(digest);
    return {
      root: F(s.root), program_id: F(s.programId), zone_set: s.zoneSet.map(F), need_senior: s.needSenior, need_revictim: s.needRevictim, min_tier: String(s.minTier),
      req_hi: F(hi), req_lo: F(lo), nullifier: F(nullifier), req_tag: F(tag),
      zone: F(w.zone), senior: w.senior, revictim: w.revictim, tier: String(w.tier), hh_secret: F(w.hhSecret), salt: F(w.salt), index: String(w.index), siblings: w.siblings.map(F),
    };
  }

  async execute(inputs: InputMap) { return this.noir.execute(inputs); }

  async prove(inputs: InputMap): Promise<ProofData & { proveMs: number }> {
    const { witness } = await this.noir.execute(inputs);
    const t = performance.now();
    const p = await this.honk.generateProof(witness, TARGET);
    return { ...p, proveMs: ms(t) };
  }
  async verify(p: ProofData): Promise<{ ok: boolean; ms: number }> {
    const t = performance.now();
    const ok = await this.verifier.verifyProof({ proof: p.proof, publicInputs: p.publicInputs, verificationKey: this.vk }, TARGET).catch(() => false);
    return { ok, ms: ms(t) };
  }
}

/** 公開入力の並び（回路の pub 引数の宣言順。配列は展開）。発券側が自分の値から作る */
export function expectedPublicInputs(s: Statement, hi: bigint, lo: bigint, nullifier: bigint, tag: bigint | undefined): (bigint | undefined)[] {
  return [s.root, s.programId, ...s.zoneSet, s.needSenior ? 1n : 0n, s.needRevictim ? 1n : 0n, BigInt(s.minTier), hi, lo, nullifier, tag];
}
export const PUBLIC_NAMES = ["root", "program_id", ...Array.from({ length: ZONES }, (_, i) => `zone_set[${i}]`), "need_senior", "need_revictim", "min_tier", "req_hi", "req_lo", "nullifier", "req_tag"];
