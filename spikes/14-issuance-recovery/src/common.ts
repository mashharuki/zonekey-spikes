import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProofData } from "@aztec-foundation/bb.js";
import type { Req } from "../../13-zk-bound-voucher/src/lib.js";
import type { Program } from "./service.js";

export const HERE = fileURLToPath(import.meta.url);
export const STATE = fileURLToPath(new URL("../.state/", import.meta.url));
export const PKG = fileURLToPath(new URL("../", import.meta.url));

export interface World { programId: string; owner: string; issuer: string; shop: string; root: string }
export const pad8 = (zs: number[]) => Array.from({ length: 8 }, (_, i) => BigInt(zs[i] ?? zs[0]!));
export function programsOf(w: World): { programs: Program[]; roots: bigint[] } {
  return {
    programs: [{ id: BigInt(w.programId), owner: w.owner, currency: "ZKV", issuer: w.issuer, allowedValues: [5_000_000n], allowedShops: [w.shop], stmt: { zoneSet: pad8([13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108]), needSenior: true, needRevictim: false, minTier: 2 } }],
    roots: [BigInt(w.root)],
  };
}
export const readWorld = () => JSON.parse(readFileSync(`${STATE}world.json`, "utf8")) as World;

export interface AppFile { req: Record<string, string | number>; proofHex: string; publicInputs: string[] }
export const reqToJson = (r: Req): AppFile["req"] => ({ ...r, programId: r.programId.toString(), valueUnits: r.valueUnits.toString() });
export const reqFromJson = (j: AppFile["req"]): Req => ({ ...(j as unknown as Req), programId: BigInt(j["programId"]!), valueUnits: BigInt(j["valueUnits"]!) });
export const proofOf = (a: AppFile): ProofData => ({ proof: Uint8Array.from(Buffer.from(a.proofHex, "hex")), publicInputs: a.publicInputs });
