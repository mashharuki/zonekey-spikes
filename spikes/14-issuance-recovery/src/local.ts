/**
 * ローカル試験（Testnet なし・模擬ノード）: 「判定不能なら保留し、二重発券しない」を確かめる。
 * 本物のノードでは再現しにくい状況（履歴の欠落・searched_all=false）を、模擬の XRPL クライアントで作る。同じ Service を使う。
 *   pnpm --filter 14-issuance-recovery local
 */
import { rmSync, writeFileSync } from "node:fs";
import { Wallet, decode } from "xrpl";
import { Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { type Req, hex, requestDigest, sha256, syntheticAccount, syntheticField, toUnits } from "../../13-zk-bound-voucher/src/lib.js";
import { Roster } from "../../13-zk-bound-voucher/src/roster.js";
import { STATE, pad8 } from "./common.js";
import { Service } from "./service.js";

const D = Wallet.generate();
const owner = D.address;
const shop = await syntheticAccount("14-local-shop"), issuer = await syntheticAccount("14-local-issuer");

/** 模擬ノード: 送られた取引を、指定した条件のときだけ validated にする */
const node = {
  validated: 1000, seqValidated: 500, complete: "1-100000", searchedAll: true as boolean | undefined,
  includeOnSubmit: false, // true にすると、次の submit の取引が次の ledger で validated になる
  applied: new Map<string, Record<string, unknown>>(), submits: [] as string[], validatedHashes: [] as string[],
};
const client = {
  autofill: async () => ({ Fee: "12" }),
  request: async (r: Record<string, unknown>) => {
    switch (r["command"]) {
      case "ledger": return { result: { ledger_index: node.validated, ledger: { close_time: Math.floor(Date.now() / 1000) - 946684800 } } };
      case "account_info": return { result: { account_data: { Sequence: node.seqValidated } } };
      case "server_info": return { result: { info: { complete_ledgers: node.complete } } };
      case "submit": {
        const dec = decode(r["tx_blob"] as string) as Record<string, unknown>;
        const hash = (await import("xrpl")).hashes.hashSignedTx(r["tx_blob"] as string);
        node.submits.push(hash);
        if (node.includeOnSubmit) { node.applied.set(hash, dec); node.validated++; node.seqValidated = Number(dec["Sequence"]) + 1; node.validatedHashes.push(hash); node.includeOnSubmit = false; }
        return { result: { engine_result: "tesSUCCESS", applied: true, accepted: true } };
      }
      case "tx": {
        const d = node.applied.get(r["transaction"] as string);
        if (d) return { result: { validated: true, ledger_index: node.validated, tx_json: d, meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Escrow", LedgerIndex: "AA".repeat(32) } }] } } };
        throw Object.assign(new Error("Transaction not found."), { data: { error: "txnNotFound", ...(node.searchedAll === undefined ? {} : { searched_all: node.searchedAll }) } });
      }
      case "account_tx": return { result: { transactions: [] } };
      default: throw new Error(`模擬ノードが知らないコマンド: ${String(r["command"])}`);
    }
  },
};

const zk = new Zk(); await zk.init();
const h = { id: "L", secret: await syntheticField("14|local|secret"), salt: await syntheticField("14|local|salt"), zone: 13101n, senior: true, revictim: true, tier: 3, profile: { name: "合成", address: "架空" } };
const roster = await new Roster([h]).build(zk);
const programId = await syntheticField("14|local|program");
const stmt = { zoneSet: pad8([13101]), needSenior: true, needRevictim: false, minTier: 2, root: roster.root, programId };
const pre = globalThis.crypto.getRandomValues(new Uint8Array(32));
const req: Req = { programId, owner, shop, currency: "ZKV", issuer, valueUnits: toUnits("5"), cancelAfter: Math.floor(Date.now() / 1000) - 946684800 + 7200, pkHash: "AB".repeat(32), conditionHash: hex(await sha256(pre)) };
const digest = await requestDigest(req);
const d = await zk.derive({ hhSecret: h.secret, programId, zone: h.zone, senior: true, revictim: true, tier: 3, salt: h.salt, digest });
const proof = await zk.prove(zk.inputs(stmt, { zone: h.zone, senior: true, revictim: true, tier: 3, hhSecret: h.secret, salt: h.salt, index: 0, siblings: roster.path(0) }, digest, d.nullifier, d.tag));

const dbPath = `${STATE}local.sqlite`;
for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
const mkSvc = () => new Service({ dbPath, client: client as never, wallet: D, programs: [{ id: programId, owner, currency: "ZKV", issuer, allowedValues: [5_000_000n], allowedShops: [shop], stmt: { zoneSet: stmt.zoneSet, needSenior: true, needRevictim: false, minTier: 2 } }], approvedRoots: [roster.root], zk, llsOffset: 2, pollMs: 10, waitTimeoutMs: 3000 });
const rows: { step: string; expected: string; actual: string; ok: boolean }[] = [];
const row = (step: string, expected: string, actual: string) => { rows.push({ step, expected, actual, ok: expected === actual }); console.log(`${expected === actual ? "OK  " : "FAIL"} ${step}: 期待=${expected} 実際=${actual}`); };
const snap = (s: Service) => s.snapshot();

let svc = mkSvc();
// 1. 準備のみ（送信しない）。LastLedgerSequence を越えさせ、ノードは searched_all=false で「見つからない」と答える
const o1 = await new Service({ ...{ dbPath, client: client as never, wallet: D, programs: (svc as unknown as { o: { programs: never[] } }).o.programs, approvedRoots: [roster.root], zk, llsOffset: 2 }, stopAfterPrepare: true }).apply(req, proof);
row("申請を受け付け、署名済み取引を保存して停止", "stopped", o1.status);
const lls = Number(snap(svc).attempts[0]!["last_ledger_sequence"]);
node.validated = lls + 3; node.searchedAll = false;
const o2 = await mkSvc().recoverAll();
row("searched_all=false（検索範囲を最後まで見られない）: 保留", "held", o2[1]!.status);
row("保留中に新しい試行を作っていない", "1", String(snap(svc).attempts.length));
row("保留中に送信していない", "0", String(node.submits.length));
// 2. 履歴の連続性が足りない（complete_ledgers に穴）: searched_all=true でも保留
node.searchedAll = true; node.complete = "1-1002,1004-100000";
const o3 = await mkSvc().recoverAll();
row("complete_ledgers に穴（範囲が連続していない）: 保留", "held", o3[1]!.status);
row("やはり新しい試行を作っていない", "1", String(snap(svc).attempts.length));
// 3. 履歴が連続し searched_all=true になったので、不成立を確定して新しい試行 → 確定
node.complete = "1-100000"; node.includeOnSubmit = true;
const o4 = await mkSvc().recoverAll();
row("履歴が連続し searched_all=true: 旧取引の不成立を確定して再試行 → 確定", "confirmed", o4[1]!.status);
const fin = snap(svc);
row("試行は 2 つ（旧 failed_final・新 validated_success）", "failed_final,validated_success", fin.attempts.map((a) => String(a["state"])).join(","));
row("旧 hash と新 hash は別", "true", String(fin.attempts[0]!["tx_hash"] !== fin.attempts[1]!["tx_hash"]));
row("模擬ノードで validated になった取引は 1 件", "1", String(node.validatedHashes.length));
row("発券記録は 1 件", "1", String(fin.issuance.length));
writeFileSync(new URL("../results/local.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), kind: "ローカル試験（模擬ノード。Testnet ではない）", failed: rows.filter((r) => !r.ok).length, rows, evidenceOfHold: fin.events.filter((e) => e["event"] === "held").map((e) => e["detail"]), failedFinalEvidence: fin.attempts[0]!["evidence"] }, null, 2));
await zk.close();
if (rows.some((r) => !r.ok)) process.exitCode = 1;
