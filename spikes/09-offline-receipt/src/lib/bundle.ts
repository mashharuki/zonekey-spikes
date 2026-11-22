/** data/<name>/ と data/unl/ のファイルを読む（fetch.ts が保存したもの）。ネットワークは使わない */
import { existsSync, readFileSync } from "node:fs";
import { type Bytes, unhex } from "./bytes.js";
import { type Header, headerFromJson, parseHeader } from "./ledger.js";
import { type Manifest, parseManifestText } from "./unl.js";

const dataUrl = (p: string) => new URL(`../../data/${p}`, import.meta.url);
const json = <T = Record<string, unknown>>(p: string): T => JSON.parse(readFileSync(dataUrl(p), "utf8")) as T;
const has = (p: string) => existsSync(dataUrl(p));

/** API の版によって名前が違うので両方を見る（v2: tx_blob/meta_blob、v1: tx/meta） */
const pickHex = (o: Record<string, unknown>, ...names: string[]): Bytes => {
  for (const n of names) if (typeof o[n] === "string") return unhex(o[n] as string);
  throw new Error(`バイナリのフィールドがない（候補: ${names.join(", ")}、実際: ${Object.keys(o).join(", ")}）`);
};

export interface Bundle {
  name: string; context: Record<string, unknown>;
  target: { tx: Bytes; meta: Bytes }; all: { tx: Bytes; meta: Bytes }[];
  headerFromJson: Header; headerFromBinary?: Header; ledgerHash: Bytes; validated: boolean;
  validations?: Bytes[]; vl?: Record<string, unknown>; manifests: Manifest[]; serverQuorum?: number; serverVersion?: string;
}

export function loadBundle(name: string): Bundle {
  const tx = json(`${name}/tx.json`);
  const h = json<{ ledger: Record<string, unknown>; validated?: boolean }>(`${name}/header.json`);
  const hb = json<{ ledger: Record<string, unknown> }>(`${name}/header-binary.json`);
  const full = json<{ ledger: { transactions: Record<string, unknown>[] } }>(`${name}/ledger-full.json`);
  const ld = typeof hb.ledger["ledger_data"] === "string" ? unhex(hb.ledger["ledger_data"] as string) : undefined;
  const manifests = has("unl/manifests.json")
    ? json<{ manifest?: string }[]>("unl/manifests.json").flatMap((m) => { try { return m.manifest ? [parseManifestText(m.manifest)] : []; } catch { return []; } })
    : [];
  const si = has("server_info.json") ? json<{ info: Record<string, unknown> }>("server_info.json").info : undefined;
  return {
    name, context: has(`${name}/context.json`) ? json(`${name}/context.json`) : {},
    target: { tx: pickHex(tx, "tx_blob", "tx"), meta: pickHex(tx, "meta_blob", "meta") },
    all: full.ledger.transactions.map((t) => ({ tx: pickHex(t, "tx_blob", "tx"), meta: pickHex(t, "meta_blob", "meta") })),
    headerFromJson: headerFromJson(h.ledger), headerFromBinary: ld ? parseHeader(ld.subarray(0, 118)) : undefined,
    ledgerHash: unhex(String(h.ledger["ledger_hash"])), validated: h.validated === true,
    validations: has(`${name}/validations.json`) ? json<{ data?: string }[]>(`${name}/validations.json`).filter((v) => typeof v.data === "string").map((v) => unhex(v.data!)) : undefined,
    vl: has("unl/vl.json") ? json("unl/vl.json") : undefined,
    manifests, serverQuorum: si ? Number(si["validation_quorum"]) : undefined, serverVersion: si ? String(si["build_version"]) : undefined,
  };
}
export const bundleNames = (): string[] => ["s2", "live"].filter((n) => has(`${n}/tx.json`));
