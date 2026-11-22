import { Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend } from "@aztec-foundation/bb.js";
import initACVM from "@noir-lang/acvm_js";
import acvmWasm from "@noir-lang/acvm_js/web/acvm_js_bg.wasm?url";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import initNoirC from "@noir-lang/noirc_abi";
import noircWasm from "@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url";
import circuitJson from "../circuits/target/eligibility.json";
import fixtureJson from "../circuits/target/fixture.json";

const out = document.getElementById("out")!;
const log = (s: string) => { out.textContent += `${s}\n`; };
const TARGET = { verifierTarget: "noir-recursive" as const };
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const stats = (xs: number[]) => ({ n: xs.length, avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, min: Math.min(...xs), max: Math.max(...xs) });
const rf = () => `0x${Array.from(crypto.getRandomValues(new Uint8Array(31)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const ZONE_SET = ["13101", "13102", "13103", "13104", "13105", "13106", "13107", "13108"];

async function inputs(fixture: Noir) {
  const priv = { acct: rf(), zone: "13103", senior: true, revictim: false, tier: "3", hh_secret: rf(), salt: rf(), index: "42", siblings: Array.from({ length: 12 }, rf) };
  const { returnValue } = await fixture.execute({ ...priv, program_id: "0x9001" });
  const [root, nullifier] = returnValue as [string, string];
  return { root, program_id: "0x9001", zone_set: ZONE_SET, need_senior: true, need_revictim: false, min_tier: "2", nullifier, ...priv };
}

document.getElementById("run")!.onclick = async () => {
  out.textContent = "";
  const r: Record<string, unknown> = { at: new Date().toISOString(), userAgent: navigator.userAgent, crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency };
  try {
    let t = performance.now();
    await Promise.all([initACVM(fetch(acvmWasm)), initNoirC(fetch(noircWasm))]);
    r["noirWasmInitMs"] = ms(t);
    t = performance.now();
    // SharedArrayBuffer が使える（COOP/COEP が効いている）ときだけマルチスレッド
    const api = await Barretenberg.new({ threads: crossOriginIsolated ? navigator.hardwareConcurrency : 1 });
    r["bbInitMs"] = ms(t);

    // 検証（Node で作った証明と VK）
    const [proof, vk, publicInputs] = await Promise.all([
      fetch("/fixture/proof.bin").then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b)),
      fetch("/fixture/vk.bin").then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b)),
      fetch("/fixture/public_inputs.json").then((x) => x.json() as Promise<string[]>),
    ]);
    const verifier = new UltraHonkVerifierBackend(api);
    const vT: number[] = [];
    let ok = true;
    for (let i = 0; i < 10; i++) { t = performance.now(); ok = (await verifier.verifyProof({ proof, publicInputs, verificationKey: vk }, TARGET)) && ok; vT.push(ms(t)); }
    r["verify"] = { withVk: stats(vT), allTrue: ok, firstMs: vT[0] };
    log(`検証: ${JSON.stringify(r["verify"])}`);

    // 証明（wasm）。1 件目と 2〜3 件目
    const noir = new Noir(circuitJson as CompiledCircuit);
    const fixture = new Noir(fixtureJson as CompiledCircuit);
    const honk = new UltraHonkBackend((circuitJson as CompiledCircuit).bytecode, api);
    const pT: number[] = [], eT: number[] = [];
    for (let i = 0; i < 3; i++) {
      const inp = await inputs(fixture);
      t = performance.now(); const { witness } = await noir.execute(inp); eT.push(ms(t));
      t = performance.now(); const p = await honk.generateProof(witness, TARGET); pT.push(ms(t));
      if (i === 0) r["proofBytes"] = p.proof.length;
      log(`証明 ${i + 1}: execute ${eT[i]} ms / prove ${pT[i]} ms`);
    }
    r["prove"] = { firstExecuteMs: eT[0], firstProveMs: pT[0], warmProve: stats(pT.slice(1)) };
    await api.destroy();
  } catch (e) {
    r["error"] = (e as Error).message;
    log(`失敗: ${(e as Error).message}`);
  }

  // 読み込んだ資源（wasm の合計サイズ）。圧縮後（転送）と展開後の両方
  const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const pick = (f: (x: PerformanceResourceTiming) => boolean) => res.filter(f).map((x) => ({ url: x.name.split("/").slice(-1)[0], transfer: x.transferSize, encoded: x.encodedBodySize, decoded: x.decodedBodySize }));
  const wasm = pick((x) => x.name.includes(".wasm"));
  r["wasm"] = { files: wasm, totalDecodedBytes: wasm.reduce((a, b) => a + b.decoded, 0), totalEncodedBytes: wasm.reduce((a, b) => a + b.encoded, 0) };
  r["bbJs"] = pick((x) => x.name.includes("barretenberg"));
  const crs = pick((x) => x.name.includes("crs"));
  r["crs"] = { files: crs, totalTransferBytes: crs.reduce((a, b) => a + b.transfer, 0) };
  r["allResources"] = { count: res.length, totalDecodedBytes: res.reduce((a, b) => a + b.decodedBodySize, 0) };
  log(`wasm: ${JSON.stringify(r["wasm"])}`);
  await fetch("/__results", { method: "POST", body: JSON.stringify(r, null, 2) });
  log("結果を bench/browser-results.json に保存しました");
};
