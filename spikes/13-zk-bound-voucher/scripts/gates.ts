import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { BackendType, Barretenberg } from "@aztec-foundation/bb.js";
const api = await Barretenberg.new({ backend: BackendType.NativeUnixSocket, threads: 4 });
for (const n of process.argv.slice(2)) {
  const c = JSON.parse(readFileSync(`circuits/target/${n}.json`, "utf8"));
  const s = await api.circuitStats({ circuit: { name: n, bytecode: gunzipSync(Buffer.from(c.bytecode, "base64")), verificationKey: new Uint8Array(0) }, includeGatesPerOpcode: false, settings: { ipaAccumulation: false, oracleHashType: "poseidon2", disableZk: false, optimizedSolidityVerifier: false } });
  console.log(n, s.numGates, s.numGatesDyadic, s.numAcirOpcodes);
}
await api.destroy();
