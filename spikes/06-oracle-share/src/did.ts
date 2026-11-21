import { createHash, randomBytes } from "node:crypto";
import type { Client, Wallet } from "xrpl";
import { explorerTxUrl, submitAndLog, type Recorder } from "xrpl-kit";
import { codeOf } from "./encoding.js";

async function readDidData(client: Client, account: string): Promise<string | undefined> {
  try {
    const r = (await client.request({ command: "ledger_entry", did: account, ledger_index: "validated" } as never)) as { result: { node: { Data?: string } } };
    return r.result.node.Data;
  } catch (e) {
    return `(${(e as { data?: { error?: string } }).data?.error ?? "error"})`;
  }
}

export async function runDid(client: Client, r: Recorder, registry: Wallet): Promise<void> {
  // Merkle ルート（32 バイト）+ バージョン（4 バイト、ビッグエンディアン）
  const root = createHash("sha256").update("zonekey merkle root (synthetic)").digest();
  const version = Buffer.alloc(4);
  version.writeUInt32BE(1);
  const cases: [string, Buffer, string][] = [
    ["Merkle ルート 32B + バージョン 4B = 36 バイト", Buffer.concat([root, version]), "tesSUCCESS"],
    ["上限ちょうど 256 バイト", randomBytes(256), "tesSUCCESS"],
    ["上限超過 257 バイト", randomBytes(257), "拒否"],
  ];
  let last = "";
  for (const [label, data, expect] of cases) {
    const hex = data.toString("hex").toUpperCase();
    const o = await submitAndLog(client, `DIDSet ${data.length}B`, { TransactionType: "DIDSet", Account: registry.address, Data: hex }, registry);
    const code = codeOf(o);
    const ok = expect === "tesSUCCESS" ? code === "tesSUCCESS" : code !== "tesSUCCESS";
    r.add(ok ? "pass" : "fail", `確認5: DIDSet Data = ${label}`, expect, code, o.validated ? `[${o.hash}](${explorerTxUrl(o.hash)})` : `未適用。${o.error ?? ""}`);
    if (code !== "tesSUCCESS") r.errorCodes.push(`DIDSet Data ${data.length} バイト: ${code}`);

    const back = await readDidData(client, registry.address);
    if (code === "tesSUCCESS") {
      last = hex;
      const parsed = data.length === 36 ? `<br>root=${back?.slice(0, 64)}<br>version=${back ? parseInt(back.slice(64, 72), 16) : "-"}` : "";
      r.add(back === hex ? "pass" : "fail", `確認5: ${label} を ledger_entry で読み戻す`, "送った Data と一致", back === hex ? `一致${parsed}` : `不一致: ${back}`, "ledger_entry { did: account }");
    } else {
      r.add(back === last ? "pass" : "fail", `確認5: ${label} 拒否後の DID`, "直前の Data のまま", back === last ? "変わっていない" : `変わった: ${back?.slice(0, 20)}…`, "ledger_entry { did: account }");
    }
  }
}
