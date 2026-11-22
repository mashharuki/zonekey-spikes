/**
 * Node.js での計測（noir_js 1.0.0 + @aztec-foundation/bb.js 6.0.0、UltraHonk）。
 * 使い方: pnpm --filter 08-noir bench [件数=100]
 * 結果は bench/node-results.json。ブラウザの検証用に、証明 1 件と VK を web/public/fixture/ に書き出す。
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { BackendType, Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend, type ProofData } from "@aztec-foundation/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { loadCircuit, makeInputs } from "./inputs.js";

const N = Number(process.argv[2] ?? 100);
if (!Number.isInteger(N) || N < 1) throw new Error(`件数は 1 以上の整数で指定してください（受け取った値: ${process.argv[2]}）`);
const TARGET = { verifierTarget: "noir-recursive" as const }; // ZK あり・Poseidon2（台帳外で検証するので EVM 形式は不要）
const here = (p: string) => new URL(p, import.meta.url);
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const pkgVersion = (name: string) => (JSON.parse(readFileSync(here(`../node_modules/${name}/package.json`), "utf8")) as { version: string }).version;

/** Node 本体 + 子プロセス（ネイティブ bb）の RSS を 200ms ごとに測り、最大値を返す */
function memSampler() {
  let peakNode = 0, peakChildren = 0;
  const tick = () => {
    peakNode = Math.max(peakNode, process.memoryUsage().rss);
    try {
      const pids = execSync(`pgrep -P ${process.pid}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      if (pids.length) {
        const kb = execSync(`ps -o rss= -p ${pids.join(",")}`, { encoding: "utf8" }).trim().split("\n").reduce((a, b) => a + Number(b || 0), 0);
        peakChildren = Math.max(peakChildren, kb * 1024);
      }
    } catch { /* 子プロセスなし */ }
  };
  const id = setInterval(tick, 200);
  tick();
  return { stop: () => { clearInterval(id); tick(); return { peakNodeMB: Math.round(peakNode / 2 ** 20), peakChildrenMB: Math.round(peakChildren / 2 ** 20) }; } };
}

const stats = (xs: number[]) => ({ n: xs.length, avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, min: Math.min(...xs), max: Math.max(...xs) });

async function runMode(label: string, backend: BackendType, circuit: Awaited<ReturnType<typeof loadCircuit>>, fixture: Noir, inputs: Awaited<ReturnType<typeof makeInputs>>[]) {
  const mem = memSampler();
  const out: Record<string, unknown> = { label, backend };
  let t = performance.now();
  let api: Barretenberg | undefined;
  try {
    api = await Barretenberg.new({ backend, threads: cpus().length });
    out["initMs"] = ms(t);
    const noir = new Noir(circuit);
    const honk = new UltraHonkBackend(circuit.bytecode, api);

    // 回路の大きさ（bb の circuit_size 相当）
    try {
      const s = await api.circuitStats({
        circuit: { name: "eligibility", bytecode: gunzipSync(Buffer.from(circuit.bytecode, "base64")), verificationKey: new Uint8Array(0) },
        includeGatesPerOpcode: false,
        settings: { ipaAccumulation: false, oracleHashType: "poseidon2", disableZk: false, optimizedSolidityVerifier: false },
      });
      out["gates"] = { numGates: s.numGates, numGatesDyadic: s.numGatesDyadic, numAcirOpcodes: s.numAcirOpcodes };
    } catch (e) { out["gates"] = `取得失敗: ${(e as Error).message}`; }

    t = performance.now();
    const vk = await honk.getVerificationKey(TARGET);
    out["vk"] = { ms: ms(t), bytes: vk.length };

    // 1 件目（初回）と 2〜6 件目（2 回目以降）
    const execT: number[] = [], proveT: number[] = [];
    let first: ProofData | undefined;
    for (let i = 0; i < 6; i++) {
      t = performance.now();
      const { witness } = await noir.execute(inputs[i]!);
      execT.push(ms(t));
      t = performance.now();
      const p = await honk.generateProof(witness, TARGET);
      proveT.push(ms(t));
      first ??= p;
    }
    out["single"] = { firstExecuteMs: execT[0], firstProveMs: proveT[0], warmExecute: stats(execT.slice(1)), warmProve: stats(proveT.slice(1)) };
    out["sizes"] = { proofBytes: first!.proof.length, publicInputs: first!.publicInputs.length, publicInputsBytes: first!.publicInputs.length * 32, vkBytes: vk.length };

    // 検証: VK を先に渡す（keeper の想定）と、毎回 VK を作り直す UltraHonkBackend.verifyProof
    const verifier = new UltraHonkVerifierBackend(api);
    const vT: number[] = [];
    let allOk = true;
    for (let i = 0; i < 10; i++) {
      t = performance.now();
      allOk = (await verifier.verifyProof({ ...first!, verificationKey: vk }, TARGET)) && allOk;
      vT.push(ms(t));
    }
    const vT2: number[] = [];
    for (let i = 0; i < 3; i++) { t = performance.now(); await honk.verifyProof(first!, TARGET); vT2.push(ms(t)); }
    const tampered = { ...first!, publicInputs: [...first!.publicInputs] };
    tampered.publicInputs[1] = `0x${"00".repeat(31)}01`; // acct を書き換える
    const rejectTampered = !(await verifier.verifyProof({ ...tampered, verificationKey: vk }, TARGET).catch(() => false));
    out["verify"] = { withVk: stats(vT), withVkAllTrue: allOk, recomputeVk: stats(vT2), rejectsTamperedPublicInput: rejectTampered };

    // N 件を順に（execute + prove）
    t = performance.now();
    for (let i = 0; i < N; i++) {
      const { witness } = await noir.execute(inputs[i]!);
      await honk.generateProof(witness, TARGET);
      if ((i + 1) % 10 === 0) process.stdout.write(`\r[08] ${label}: ${i + 1}/${N}`);
    }
    const total = ms(t);
    process.stdout.write("\n");
    out["batch"] = { n: N, totalMs: total, perProofMs: Math.round((total / N) * 10) / 10 };

    if (label === "native") {
      const dir = here("../web/public/fixture/");
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL("proof.bin", dir), first!.proof);
      writeFileSync(new URL("vk.bin", dir), vk);
      writeFileSync(new URL("public_inputs.json", dir), JSON.stringify(first!.publicInputs));
    }
  } catch (e) {
    out["error"] = `${(e as Error).message}${(e as Error).cause ? ` / cause: ${String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).cause)}` : ""}`;
  } finally {
    await api?.destroy().catch(() => undefined);
    out["memory"] = mem.stop();
  }
  console.log(`[08] ${label}:`, JSON.stringify(out));
  return out;
}

async function negativeChecks(circuit: Awaited<ReturnType<typeof loadCircuit>>, fixture: Noir, base: Awaited<ReturnType<typeof makeInputs>>) {
  const noir = new Noir(circuit);
  // 葉に入る属性を変えるケースは、fixture で根と nullifier を作り直して「その制約だけ」が破れるようにする
  const relabel = async (attr: Record<string, unknown>) => {
    const b = base as Record<string, unknown>;
    const { returnValue } = await fixture.execute({
      acct: b.acct, zone: b.zone, senior: b.senior, revictim: b.revictim, tier: b.tier,
      hh_secret: b.hh_secret, salt: b.salt, index: b.index, siblings: b.siblings, program_id: b.program_id, ...attr,
    } as never);
    const [root, nullifier] = returnValue as [string, string];
    return { ...attr, root, nullifier };
  };
  const cases: [string, Record<string, unknown>, string][] = [
    ["根が違う", { root: "0x01" }, "merkle root mismatch"],
    ["別アカウント（acct だけ差し替え）", { acct: "0x02" }, "merkle root mismatch"],
    ["ゾーンが対象外", { zone_set: ["1", "2", "3", "4", "5", "6", "7", "8"] }, "zone not in zone_set"],
    ["高齢者が必要なのに senior=false（根は作り直し）", { need_senior: true, ...(await relabel({ senior: false })) }, "senior required"],
    ["再被災が必要なのに revictim=false（根は作り直し）", { need_revictim: true, ...(await relabel({ revictim: false })) }, "revictim required"],
    ["区分が足りない", { min_tier: "9" }, "tier below min_tier"],
    ["nullifier が違う", { nullifier: "0x03" }, "nullifier mismatch"],
    ["別プログラムの nullifier", { program_id: "0x9002" }, "nullifier mismatch"],
  ];
  const rows = [];
  for (const [name, patch, expected] of cases) {
    const msg = await noir.execute({ ...base, ...patch } as never).then(() => "execute が通ってしまった（問題）").catch((e: Error) => e.message);
    // 証明が作れないだけでなく、狙った制約で止まったかを見る
    rows.push({ case: name, expected, result: msg.slice(0, 120), blocked: msg.includes(expected) });
  }
  return rows;
}

const circuit = await loadCircuit("eligibility");
const fixture = new Noir(await loadCircuit("fixture"));
console.log(`[08] 入力 ${N} 件を作成中…`);
const inputs = [];
for (let i = 0; i < Math.max(N, 6); i++) inputs.push(await makeInputs(fixture, i));

/** bb.js のブラウザ版 wasm は JS 内に gzip+base64 の data: URL で埋め込まれている。JS の大きさと展開後の wasm の大きさを測る */
function bbBrowserWasm() {
  const dir = here("../node_modules/@aztec-foundation/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/");
  return ["barretenberg-threads.js", "barretenberg.js"].map((file) => {
    const js = readFileSync(new URL(file, dir), "utf8");
    const i = js.indexOf("base64,") + 7;
    const gz = Buffer.from(js.slice(i, js.indexOf('"', i)), "base64");
    return { file, jsBytes: Buffer.byteLength(js), jsGzipBytes: gzipSync(js).length, wasmGzipBytes: gz.length, wasmBytes: gunzipSync(gz).length };
  });
}

/** Node の CRS キャッシュ（~/.bb-crs）の中身 */
function crsCache() {
  const dir = join(homedir(), ".bb-crs");
  try { return readdirSync(dir).map((f) => ({ file: f, bytes: statSync(join(dir, f)).size })); } catch { return []; }
}

const results = {
  at: new Date().toISOString(),
  machine: { platform: process.platform, arch: process.arch, cpus: cpus().length, cpuModel: cpus()[0]?.model, memGB: Math.round(totalmem() / 2 ** 30), node: process.version },
  versions: {
    noir_compiler: (circuit as unknown as { noir_version?: string }).noir_version,
    noir_js: pkgVersion("@noir-lang/noir_js"),
    bb_js: pkgVersion("@aztec-foundation/bb.js"),
  },
  verifierTarget: TARGET.verifierTarget,
  bbBrowserWasm: bbBrowserWasm(),
  negative: await negativeChecks(circuit, fixture, inputs[0]!),
  modes: [
    await runMode("native", BackendType.NativeUnixSocket, circuit, fixture, inputs),
    await runMode("wasm", BackendType.WasmWorker, circuit, fixture, inputs),
  ],
};
(results as Record<string, unknown>)["crsCache"] = crsCache();
writeFileSync(here("node-results.json"), JSON.stringify(results, null, 2));
console.log("[08] wrote bench/node-results.json");
