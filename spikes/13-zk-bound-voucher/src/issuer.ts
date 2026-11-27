/**
 * 発券サービス。ZK 証明を検証し、承認した内容から発券記録を 1 件だけ作る。
 * 記録は SQLite（node:sqlite）。重複防止は UNIQUE(program_id, nullifier) で DB に強制させる。
 * 台帳（XRPL）は模擬: mock_escrow 表。実際の EscrowCreate は送らない（REPORT に「ローカル検証」と明記）。
 */
import { DatabaseSync } from "node:sqlite";
import type { ProofData } from "@aztec-foundation/bb.js";
import { sha256 } from "../../11c-voucher-escrow/src/voucher/core.js";
import type { SyncedEscrow } from "../../11c-voucher-escrow/src/voucher/shop.js";
import { type Req, digestToFields, enc, fmtUnits, hex, requestDigest } from "./lib.js";
import { PUBLIC_NAMES, type Statement, type Zk, expectedPublicInputs } from "./zk.js";

export interface Program {
  id: bigint;
  name: string;
  owner: string; // 支援元の配布用アカウント D
  currency: string;
  issuer: string;
  allowedValues: bigint[];
  allowedShops: Set<string>;
  stmt: Omit<Statement, "root" | "programId">;
}
export interface IssuedRecord {
  programId: string; reqDigest: string; owner: string; offerSequence: number; shop: string;
  amount: { currency: string; issuer: string; value: string }; condition: string; cancelAfter: number; pkHash: string;
}
export type IssueOut =
  | { ok: true; status: "created" | "replayed"; record: IssuedRecord }
  | { ok: false; stage: "policy" | "public_input" | "root" | "proof" | "duplicate"; reason: string };

export class Issuer {
  readonly db = new DatabaseSync(":memory:");
  /** 試験用: コミット後に応答を返せなかったことにする回数 */
  dropResponseAfterCommit = 0;
  /** 試験用: 台帳への送信を途中で落とす（before = 何も書く前 / afterInsert = 台帳に書いた後・状態更新の前） */
  crashSubmit: "before" | "afterInsert" | undefined;
  verifyCalls = 0;
  /** OfferSequence の採番の起点（既定 1000）。Testnet では配布用アカウントの実際の Sequence − 1 にする */
  seqBase = 1000;
  constructor(private zk: Zk, private programs: Map<bigint, Program>, private approvedRoots: Set<bigint>, private nowRipple: () => number) {
    this.db.exec(`
      CREATE TABLE issued (
        id INTEGER PRIMARY KEY AUTOINCREMENT, program_id TEXT NOT NULL, nullifier TEXT NOT NULL, req_digest TEXT NOT NULL,
        owner TEXT NOT NULL, offer_sequence INTEGER NOT NULL, shop TEXT NOT NULL, currency TEXT NOT NULL, issuer TEXT NOT NULL,
        value TEXT NOT NULL, cancel_after INTEGER NOT NULL, pk_hash TEXT NOT NULL, condition_hex TEXT NOT NULL, state TEXT NOT NULL,
        UNIQUE (program_id, nullifier), UNIQUE (owner, offer_sequence)
      );
      CREATE TABLE mock_escrow (owner TEXT NOT NULL, offer_sequence INTEGER NOT NULL, ledger_index TEXT NOT NULL, create_tx TEXT NOT NULL, PRIMARY KEY (owner, offer_sequence));
    `);
  }

  count(programId?: bigint, nullifier?: bigint) {
    if (programId === undefined) return (this.db.prepare("SELECT COUNT(*) c FROM issued").get() as { c: number }).c;
    return (this.db.prepare("SELECT COUNT(*) c FROM issued WHERE program_id=? AND nullifier=?").get(programId.toString(), nullifier!.toString()) as { c: number }).c;
  }
  mockEscrowCount = () => (this.db.prepare("SELECT COUNT(*) c FROM mock_escrow").get() as { c: number }).c;

  private toRecord(r: Record<string, unknown>): IssuedRecord {
    return {
      programId: r["program_id"] as string, reqDigest: r["req_digest"] as string, owner: r["owner"] as string, offerSequence: r["offer_sequence"] as number,
      shop: r["shop"] as string, amount: { currency: r["currency"] as string, issuer: r["issuer"] as string, value: r["value"] as string },
      condition: r["condition_hex"] as string, cancelAfter: r["cancel_after"] as number, pkHash: r["pk_hash"] as string,
    };
  }

  async issue(req: Req, proof: ProofData): Promise<IssueOut> {
    // ---- 1. 発券側の方針（回路では見ない項目）----
    const prog = this.programs.get(req.programId);
    if (!prog) return { ok: false, stage: "policy", reason: "unknown program" };
    const now = this.nowRipple();
    const bad =
      req.owner !== prog.owner ? "owner" :
      req.currency !== prog.currency || req.issuer !== prog.issuer ? "asset" :
      !prog.allowedValues.includes(req.valueUnits) ? "value" :
      !prog.allowedShops.has(req.shop) ? "shop" :
      !(req.cancelAfter > now + 3600 && req.cancelAfter <= now + 30 * 86400) ? "cancelAfter" : undefined;
    if (bad) return { ok: false, stage: "policy", reason: `policy:${bad}` };

    // ---- 2. 公開入力を、発券側が自分で持つ値から作り直して 1 つずつ照合 ----
    const pi = proof.publicInputs.map((x) => BigInt(x));
    if (pi.length !== PUBLIC_NAMES.length) return { ok: false, stage: "public_input", reason: `public input count ${pi.length}` };
    if (!this.approvedRoots.has(pi[0]!)) return { ok: false, stage: "root", reason: "root not approved" };
    const { hi, lo } = digestToFields(await requestDigest(req));
    const exp = expectedPublicInputs({ ...prog.stmt, root: pi[0]!, programId: prog.id }, hi, lo, pi[PUBLIC_NAMES.indexOf("nullifier")]!, pi[PUBLIC_NAMES.indexOf("req_tag")]!);
    for (const [i, e] of exp.entries()) if (pi[i] !== e) return { ok: false, stage: "public_input", reason: `public input mismatch: ${PUBLIC_NAMES[i]}` };

    // ---- 3. ZK 証明の検証 ----
    this.verifyCalls++;
    if (!(await this.zk.verify(proof)).ok) return { ok: false, stage: "proof", reason: "proof invalid" };

    // ---- 4. 発券記録を 1 件だけ作る（制度×nullifier の UNIQUE が最後の砦）----
    const nullifier = pi[PUBLIC_NAMES.indexOf("nullifier")]!.toString();
    const digestHex = hex(await requestDigest(req));
    const condition = `A0258020${req.conditionHash.toUpperCase()}810120`;
    const insert = () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const seq = ((this.db.prepare("SELECT COALESCE(MAX(offer_sequence), ?) m FROM issued WHERE owner=?").get(this.seqBase, req.owner) as { m: number }).m) + 1;
        this.db.prepare(
          "INSERT INTO issued (program_id,nullifier,req_digest,owner,offer_sequence,shop,currency,issuer,value,cancel_after,pk_hash,condition_hex,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'approved')",
        ).run(req.programId.toString(), nullifier, digestHex, req.owner, seq, req.shop, req.currency, req.issuer, fmtUnits(req.valueUnits), req.cancelAfter, req.pkHash.toUpperCase(), condition);
        this.db.exec("COMMIT");
        return "created" as const;
      } catch (e) {
        this.db.exec("ROLLBACK");
        if (/UNIQUE constraint failed: issued\.program_id, issued\.nullifier/.test((e as Error).message)) return "exists" as const;
        throw e;
      }
    };
    const status = insert();
    const row = this.db.prepare("SELECT * FROM issued WHERE program_id=? AND nullifier=?").get(req.programId.toString(), nullifier) as Record<string, unknown>;
    if (status === "exists") {
      // 同じ申請内容の再試行（応答を受け取れなかった等）なら、最初の結果をそのまま返す。別の申請内容なら発券しない
      if (row["req_digest"] === digestHex) return { ok: true, status: "replayed", record: this.toRecord(row) };
      return { ok: false, stage: "duplicate", reason: "this household already has a voucher for this program" };
    }
    if (this.dropResponseAfterCommit > 0) { this.dropResponseAfterCommit--; throw new Error("response lost（コミット済み・応答なし）"); }
    return { ok: true, status: "created", record: this.toRecord(row) };
  }

  /** 台帳（模擬）へ送る。(owner, offer_sequence) で冪等。実際の XRPL では Sequence / Ticket の確保と tx hash の確定が別途必要（REPORT） */
  async submitPending(): Promise<number> {
    const rows = this.db.prepare("SELECT * FROM issued WHERE state='approved' ORDER BY id").all() as Record<string, unknown>[];
    let n = 0;
    for (const r of rows) {
      if (this.crashSubmit === "before") { this.crashSubmit = undefined; throw new Error("crash before submit"); }
      const idx = hex(await sha256(enc.encode(`mock-ledger-index|${r["owner"]}|${r["offer_sequence"]}`)));
      const tx = hex(await sha256(enc.encode(`mock-create-tx|${r["owner"]}|${r["offer_sequence"]}|${r["condition_hex"]}`)));
      this.db.prepare("INSERT OR IGNORE INTO mock_escrow VALUES (?,?,?,?)").run(r["owner"] as string, r["offer_sequence"] as number, idx, tx);
      if (this.crashSubmit === "afterInsert") { this.crashSubmit = undefined; throw new Error("crash after ledger insert, before state update"); }
      this.db.prepare("UPDATE issued SET state='submitted' WHERE id=?").run(r["id"] as number);
      n++;
    }
    return n;
  }

  /** 店舗の端末が同期する「自店宛ての Escrow 一覧」。11c の SyncedEscrow と同じ形 */
  syncFor(shop: string): SyncedEscrow[] {
    const rows = this.db.prepare("SELECT i.*, m.ledger_index, m.create_tx FROM issued i JOIN mock_escrow m ON m.owner=i.owner AND m.offer_sequence=i.offer_sequence WHERE i.shop=? ORDER BY i.id").all(shop) as Record<string, unknown>[];
    return rows.map((r) => ({
      index: r["ledger_index"] as string, owner: r["owner"] as string, offerSequence: r["offer_sequence"] as number, destination: r["shop"] as string,
      amount: { currency: r["currency"] as string, issuer: r["issuer"] as string, value: r["value"] as string },
      condition: r["condition_hex"] as string, cancelAfter: r["cancel_after"] as number, pkHash: r["pk_hash"] as string, createTx: r["create_tx"] as string,
    }));
  }
  dump() { return { issued: this.db.prepare("SELECT * FROM issued ORDER BY id").all(), mock_escrow: this.db.prepare("SELECT * FROM mock_escrow").all() }; }
}
