/**
 * 比較実験: 「申請ダイジェストを公開入力に足しただけ」の回路（mutant_nobind）と、本番の回路（eligibility_bound）を同じ攻撃で比べる。
 *   pnpm --filter 13-zk-bound-voucher mutant
 * 問い: 制約に入れない公開入力は、何を防ぎ、何を防がないのか。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BackendType, Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend } from "@aztec-foundation/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Roster } from "./roster.js";
import { digestToFields, fieldHex, requestDigest, syntheticAccount, syntheticField } from "./lib.js";
import { TARGET, Zk } from "./zk.js";

const zk = new Zk(); await zk.init();
const mut = JSON.parse(readFileSync(new URL("../circuits/target/mutant_nobind.json", import.meta.url), "utf8")) as CompiledCircuit;
const api = zk.api;
const honk = new UltraHonkBackend(mut.bytecode, api);
const vk = await honk.getVerificationKey(TARGET);
const ver = new UltraHonkVerifierBackend(api);
const noir = new Noir(mut);
const h = { secret: await syntheticField("hh-secret|M"), salt: await syntheticField("salt|M"), zone: 13101n, senior: true, revictim: true, tier: 3 };
const roster = await new Roster([{ id: "M", ...h, profile: { name: "合成", address: "架空" } }]).build(zk);
const prog = await syntheticField("program|mutant");
const zoneSet = Array.from({ length: 8 }, () => 13101n);
const mkReq = async (pk: string) => ({ programId: prog, owner: await syntheticAccount("o"), shop: await syntheticAccount("s"), currency: "ZKV", issuer: await syntheticAccount("i"), valueUnits: 5_000_000n, cancelAfter: 900_000_000, pkHash: pk, conditionHash: "22".repeat(32) });
const dA = await requestDigest(await mkReq("11".repeat(32))), dB = await requestDigest(await mkReq("33".repeat(32)));
const d = await zk.derive({ hhSecret: h.secret, programId: prog, zone: h.zone, senior: true, revictim: true, tier: 3, salt: h.salt, digest: dA });
const st = { root: roster.root, programId: prog, zoneSet, needSenior: true, needRevictim: false, minTier: 2 };
const w = { ...h, hhSecret: h.secret, index: 0, siblings: roster.path(0) };
const out: Record<string, unknown> = {};

// 変異体: 申請 A に対する証明を作り、公開入力の req_hi/req_lo を申請 B のものに書き換える
const inputsA = zk.inputs(st, w, dA, d.nullifier, d.tag);
const { witness } = await noir.execute(inputsA);
const proofA = await honk.generateProof(witness, TARGET);
const piB = [...proofA.publicInputs]; // 並び: ... req_hi(13), req_lo(14)
const fB = digestToFields(dB);
piB[13] = fieldHex(fB.hi); piB[14] = fieldHex(fB.lo);
out["変異体: 元の証明は有効"] = await ver.verifyProof({ ...proofA, verificationKey: vk }, TARGET);
out["変異体: 公開入力を申請 B に書き換えた証明（秘密なし・再証明なし）"] = await ver.verifyProof({ proof: proofA.proof, publicInputs: piB, verificationKey: vk }, TARGET).catch(() => false);
// 変異体: 秘密を持つ世帯は、任意の申請内容を公開入力に入れて証明できる（制約が無いので、tag なしでも通る。= 世帯自身が申請を選ぶのは当然）
const inputsB = zk.inputs(st, w, dB, d.nullifier, 0n);
const { witness: wB } = await noir.execute(inputsB);
const proofB = await honk.generateProof(wB, TARGET);
out["変異体: 秘密を持つ世帯が申請 B で作った証明は有効"] = await ver.verifyProof({ ...proofB, verificationKey: vk }, TARGET);
out["変異体: 秘密を持たない者が証明を作れるか（hh_secret を知らない値で execute）"] = await noir.execute(zk.inputs(st, { ...w, hhSecret: await syntheticField("attacker") }, dB, d.nullifier, 0n)).then(() => "作れた", (e: Error) => `作れない: ${e.message.split("\n")[0]}`);
const g = (n: Record<string, unknown>) => n;
out["回路の大きさ（変異体）"] = g(await api.circuitStats({ circuit: { name: "m", bytecode: Buffer.from(mut.bytecode, "base64").length ? (await import("node:zlib")).gunzipSync(Buffer.from(mut.bytecode, "base64")) : new Uint8Array(), verificationKey: new Uint8Array(0) }, includeGatesPerOpcode: false, settings: { ipaAccumulation: false, oracleHashType: "poseidon2", disableZk: false, optimizedSolidityVerifier: false } }).then((s) => ({ numGates: s.numGates, numGatesDyadic: s.numGatesDyadic, numAcirOpcodes: s.numAcirOpcodes })));
out["回路の大きさ（本番）"] = zk.stats["gates"];
for (const [k, v] of Object.entries(out)) console.log(`${k}: ${JSON.stringify(v)}`);
writeFileSync(new URL("../results/mutant.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
await zk.close();
