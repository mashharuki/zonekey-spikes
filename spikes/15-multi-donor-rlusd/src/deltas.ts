/** 取引メタデータ（AffectedNodes）から、口座ごとのトラストライン残高の増減を読む。秘密鍵は要らない */
import { parseDec } from "./dec.js";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface LineDelta { account: string; counterparty: string; currency: string; delta: bigint }

/** RippleState の Balance は「low 側の残高」。増減は low が +d、high が −d */
export function lineDeltas(meta: J | undefined): LineDelta[] {
  const out: LineDelta[] = [];
  for (const n of (meta?.["AffectedNodes"] ?? []) as J[]) {
    const kind = (["CreatedNode", "ModifiedNode", "DeletedNode"] as const).find((k) => n[k]);
    if (!kind) continue;
    const node = n[kind] as J;
    if (node["LedgerEntryType"] !== "RippleState") continue;
    const fin = (node["FinalFields"] ?? node["NewFields"] ?? {}) as J;
    const prevF = (node["PreviousFields"] ?? {}) as J;
    const finBal = fin["Balance"] as J | undefined;
    if (!finBal) continue;
    const cur = String(finBal["currency"]);
    const low = String(fin["LowLimit"]["issuer"]), high = String(fin["HighLimit"]["issuer"]);
    const after = parseDec(finBal["value"]);
    const before = kind === "CreatedNode" ? 0n : prevF["Balance"] ? parseDec(prevF["Balance"]["value"]) : after;
    const d = after - before;
    if (d === 0n) continue;
    out.push({ account: low, counterparty: high, currency: cur, delta: d });
    out.push({ account: high, counterparty: low, currency: cur, delta: -d });
  }
  return out;
}

/** 取引が消費・作成した Escrow ノード */
export function escrowNodes(meta: J | undefined): { kind: "created" | "deleted" | "modified"; index: string; fields: J }[] {
  const out: { kind: "created" | "deleted" | "modified"; index: string; fields: J }[] = [];
  for (const n of (meta?.["AffectedNodes"] ?? []) as J[]) {
    for (const [k, kind] of [["CreatedNode", "created"], ["DeletedNode", "deleted"], ["ModifiedNode", "modified"]] as const) {
      const node = n[k] as J | undefined;
      if (node?.["LedgerEntryType"] === "Escrow") out.push({ kind, index: String(node["LedgerIndex"]), fields: (node["FinalFields"] ?? node["NewFields"] ?? {}) as J });
    }
  }
  return out;
}
