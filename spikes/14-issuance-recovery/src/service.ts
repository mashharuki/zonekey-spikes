/**
 * 発券サービス（復旧つき）。spike 13 の検証（方針・公開入力の完全一致・ZK 検証・(制度,nullifier) の一意）を再利用し、
 * XRPL への送信を「署名済み取引を先に永続化 → 送信 → validated を照会して確定」の手順にする。
 * DB は SQLite ファイル（複数プロセスから開く）。確定は validated の結果を見てからだけ。
 */
import { DatabaseSync } from "node:sqlite";
import type { ProofData } from "@aztec-foundation/bb.js";
import { type Client, Wallet } from "xrpl";
import { PK_MEMO_TYPE } from "../../11c-voucher-escrow/src/voucher/core.js";
import { type Req, digestToFields, fmtUnits, hex, requestDigest } from "../../13-zk-bound-voucher/src/lib.js";
import { PUBLIC_NAMES, type Statement, type Zk, expectedPublicInputs } from "../../13-zk-bound-voucher/src/zk.js";
import { type J, accountHistory, chainInfo, coversRange, flat, queryTx, waitMs } from "./chain.js";

export interface Program { id: bigint; owner: string; currency: string; issuer: string; allowedValues: bigint[]; allowedShops: string[]; stmt: Omit<Statement, "root" | "programId">;
  /** 期限（CancelAfter）の最短の余裕（秒）。既定 3600。spike 15 が未請求券の失効試験のために短くする（既定値は spike 14 のまま） */ minTtlSec?: number }
export interface Opts {
  dbPath: string; client: Client; wallet: Wallet; programs: Program[]; approvedRoots: bigint[]; zk?: Zk;
  /** LastLedgerSequence = 署名時の validated + この値（既定 20。XRPL の autofill と同じ） */
  llsOffset?: number;
  /** 障害の注入位置（環境変数 FAULT でも指定できる）。該当位置で process を SIGKILL する */
  fault?: string;
  /** 準備（署名済み取引の永続化）まで行って、送信せずに止まる（プロセスは正常終了） */
  stopAfterPrepare?: boolean;
  /** 申請の期限が近いとき発券しない余裕（秒） */
  marginSec?: number;
  pollMs?: number;
  waitTimeoutMs?: number;
  /** 申請ダイジェストの計算（既定は spike 13 の v1）。spike 17 が資産を 20 B で拘束する v2 を渡す */
  digest?: (r: Req) => Promise<Uint8Array>;
}
export type Outcome =
  | { status: "confirmed"; offerSequence: number; txHash: string; escrowIndex: string; attempts: number }
  | { status: "pending" | "held" | "aborted" | "in_progress" | "stopped"; reason: string }
  | { status: "rejected"; stage: string; reason: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS issuance (
  id INTEGER PRIMARY KEY AUTOINCREMENT, program_id TEXT NOT NULL, nullifier TEXT NOT NULL, req_digest TEXT NOT NULL,
  owner TEXT NOT NULL, shop TEXT NOT NULL, currency TEXT NOT NULL, issuer TEXT NOT NULL, value TEXT NOT NULL, cancel_after INTEGER NOT NULL,
  pk_hash TEXT NOT NULL, condition_hex TEXT NOT NULL, state TEXT NOT NULL, state_reason TEXT, offer_sequence INTEGER, escrow_index TEXT, confirmed_tx TEXT,
  UNIQUE (program_id, nullifier)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, issuance_id INTEGER NOT NULL, attempt_no INTEGER NOT NULL, sequence INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE,
  last_ledger_sequence INTEGER NOT NULL, first_ledger INTEGER NOT NULL, signed_blob TEXT NOT NULL, state TEXT NOT NULL,
  submit_count INTEGER NOT NULL DEFAULT 0, last_engine_result TEXT, validated_ledger INTEGER, validated_result TEXT, evidence TEXT,
  UNIQUE (issuance_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS seq_alloc (owner TEXT NOT NULL, sequence INTEGER NOT NULL, attempt_id INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (owner, sequence, attempt_id));
CREATE UNIQUE INDEX IF NOT EXISTS seq_one_holder ON seq_alloc (owner, sequence) WHERE state IN ('active', 'consumed');
CREATE TABLE IF NOT EXISTS lease (issuance_id INTEGER PRIMARY KEY, pid INTEGER NOT NULL, until_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, pid INTEGER NOT NULL, issuance_id INTEGER, attempt_id INTEGER, event TEXT NOT NULL, detail TEXT);
`;

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=10000;");
  // 観測された事実: 複数プロセスが同時に新しい DB を開くと、journal_mode=WAL への切り替えやスキーマ作成が "database is locked"（errcode 5）で失敗する
  // （busy_timeout が効かない）。開くときだけ再試行する。
  for (let i = 0; ; i++) {
    try { db.exec("PRAGMA journal_mode=WAL;"); db.exec(SCHEMA); return db; } catch (e) {
      if (i >= 100 || (e as { errcode?: number }).errcode !== 5) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export class Service {
  readonly db: DatabaseSync;
  private programs: Map<bigint, Program>;
  private fault: string | undefined;
  constructor(private o: Opts) {
    this.db = openDb(o.dbPath);
    this.programs = new Map(o.programs.map((p) => [p.id, p]));
    this.fault = o.fault ?? process.env["FAULT"];
  }

  private ev(event: string, detail: unknown, iid?: number, aid?: number) {
    this.db.prepare("INSERT INTO events (at, pid, issuance_id, attempt_id, event, detail) VALUES (?,?,?,?,?,?)").run(new Date().toISOString(), process.pid, iid ?? null, aid ?? null, event, JSON.stringify(detail));
  }
  /** 障害の注入: 該当位置なら、記録を残してから自分を SIGKILL する（実際のプロセス停止） */
  private hit(point: string, iid?: number, aid?: number) {
    if (this.fault !== point) return;
    this.ev("FAULT_KILL", { point }, iid, aid);
    process.kill(process.pid, "SIGKILL");
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  // ───────────── 申請の受付 ─────────────
  async apply(req: Req, proof: ProofData): Promise<Outcome> {
    const prog = this.programs.get(req.programId);
    if (!prog) return { status: "rejected", stage: "policy", reason: "unknown program" };
    const info0 = await chainInfo(this.o.client, this.o.wallet.address);
    const now = info0.closeTime;
    const bad = req.owner !== prog.owner ? "owner" : req.currency !== prog.currency || req.issuer !== prog.issuer ? "asset" : !prog.allowedValues.includes(req.valueUnits) ? "value" : !prog.allowedShops.includes(req.shop) ? "shop" : !(req.cancelAfter > now + (prog.minTtlSec ?? 3600) && req.cancelAfter <= now + 30 * 86400) ? "cancelAfter" : undefined;
    if (bad) return { status: "rejected", stage: "policy", reason: `policy:${bad}` };
    const pi = proof.publicInputs.map((x) => BigInt(x));
    if (pi.length !== PUBLIC_NAMES.length) return { status: "rejected", stage: "public_input", reason: "count" };
    if (!this.o.approvedRoots.includes(pi[0]!)) return { status: "rejected", stage: "root", reason: "root not approved" };
    const digest = await (this.o.digest ?? requestDigest)(req);
    const { hi, lo } = digestToFields(digest);
    const nIdx = PUBLIC_NAMES.indexOf("nullifier"), tIdx = PUBLIC_NAMES.indexOf("req_tag");
    const exp = expectedPublicInputs({ ...prog.stmt, root: pi[0]!, programId: prog.id }, hi, lo, pi[nIdx]!, pi[tIdx]!);
    for (const [i, e] of exp.entries()) if (pi[i] !== e) return { status: "rejected", stage: "public_input", reason: `public input mismatch: ${PUBLIC_NAMES[i]}` };
    if (!this.o.zk || !(await this.o.zk.verify(proof)).ok) return { status: "rejected", stage: "proof", reason: "proof invalid" };

    // 発券記録と送信待ちの仕事（署名済み取引）を 1 つの DB トランザクションで保存する。ここまで XRPL には何も送っていない
    const nullifier = pi[nIdx]!.toString(), digestHex = hex(digest);
    const info = await chainInfo(this.o.client, this.o.wallet.address);
    const created = this.tx(() => {
      const ex = this.db.prepare("SELECT id, req_digest FROM issuance WHERE program_id=? AND nullifier=?").get(req.programId.toString(), nullifier) as { id: number; req_digest: string } | undefined;
      if (ex) return ex.req_digest === digestHex ? { kind: "existing" as const, iid: ex.id } : { kind: "duplicate" as const };
      const r = this.db.prepare("INSERT INTO issuance (program_id,nullifier,req_digest,owner,shop,currency,issuer,value,cancel_after,pk_hash,condition_hex,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,'approved')")
        .run(req.programId.toString(), nullifier, digestHex, req.owner, req.shop, req.currency, req.issuer, fmtUnits(req.valueUnits), req.cancelAfter, req.pkHash.toUpperCase(), `A0258020${req.conditionHash.toUpperCase()}810120`);
      const iid = Number(r.lastInsertRowid);
      this.ev("approved", { programId: req.programId.toString(), reqDigest: digestHex }, iid);
      this.prepareAttempt(iid, 1, info);
      return { kind: "created" as const, iid };
    });
    if (created.kind === "duplicate") return { status: "rejected", stage: "duplicate", reason: "same program and nullifier, different request" };
    this.ev(created.kind === "created" ? "apply_created" : "apply_replay", {}, created.iid);
    if (created.kind === "created") {
      this.hit("after_prepare", created.iid);
      if (this.o.stopAfterPrepare) return { status: "stopped", reason: "prepared, not submitted" };
    }
    return this.drive(created.iid);
  }

  /** トランザクションの中で呼ぶ: Sequence を採番し、署名して attempts に保存する（送信はしない） */
  private prepareAttempt(iid: number, no: number, info: Awaited<ReturnType<typeof chainInfo>>) {
    const row = this.db.prepare("SELECT * FROM issuance WHERE id=?").get(iid) as J;
    let seq = info.seqCurrent;
    const taken = this.db.prepare("SELECT 1 FROM seq_alloc WHERE owner=? AND sequence=? AND state IN ('active','consumed')");
    while (taken.get(row["owner"], seq)) seq++;
    const lls = info.validatedIndex + (this.o.llsOffset ?? Number(process.env["LLS_OFFSET"] ?? 20));
    const tx = {
      TransactionType: "EscrowCreate", Account: row["owner"], Destination: row["shop"], Amount: { currency: row["currency"], issuer: row["issuer"], value: row["value"] },
      Condition: row["condition_hex"], CancelAfter: row["cancel_after"], Memos: [{ Memo: { MemoType: PK_MEMO_TYPE, MemoData: row["pk_hash"] } }],
      Fee: info.fee, Sequence: seq, LastLedgerSequence: lls,
    };
    const signed = this.o.wallet.sign(tx as never);
    const r = this.db.prepare("INSERT INTO attempts (issuance_id, attempt_no, sequence, tx_hash, last_ledger_sequence, first_ledger, signed_blob, state) VALUES (?,?,?,?,?,?,?, 'prepared')")
      .run(iid, no, seq, signed.hash, lls, info.validatedIndex, signed.tx_blob);
    const aid = Number(r.lastInsertRowid);
    this.db.prepare("INSERT INTO seq_alloc (owner, sequence, attempt_id, state) VALUES (?,?,?, 'active')").run(row["owner"], seq, aid);
    this.ev("attempt_prepared", { attemptNo: no, sequence: seq, lastLedgerSequence: lls, txHash: signed.hash, firstLedger: info.validatedIndex }, iid, aid);
    return aid;
  }

  private outcomeOf(iid: number): Outcome {
    const r = this.db.prepare("SELECT * FROM issuance WHERE id=?").get(iid) as J;
    const n = (this.db.prepare("SELECT COUNT(*) c FROM attempts WHERE issuance_id=?").get(iid) as { c: number }).c;
    if (r["state"] === "confirmed") return { status: "confirmed", offerSequence: r["offer_sequence"], txHash: r["confirmed_tx"], escrowIndex: r["escrow_index"], attempts: n };
    return { status: r["state"] === "held" ? "held" : r["state"] === "aborted" ? "aborted" : "pending", reason: String(r["state_reason"] ?? "") };
  }

  // ───────────── 送信・照会・確定 ─────────────
  private claim(iid: number): boolean {
    return this.tx(() => {
      const l = this.db.prepare("SELECT pid, until_ms FROM lease WHERE issuance_id=?").get(iid) as { pid: number; until_ms: number } | undefined;
      if (l && l.pid !== process.pid && alive(l.pid) && l.until_ms > Date.now()) return false;
      this.db.prepare("INSERT INTO lease (issuance_id, pid, until_ms) VALUES (?,?,?) ON CONFLICT(issuance_id) DO UPDATE SET pid=excluded.pid, until_ms=excluded.until_ms").run(iid, process.pid, Date.now() + 120_000);
      if (l && l.pid !== process.pid) this.ev("lease_taken_over", { from: l.pid, fromAlive: alive(l.pid) }, iid);
      return true;
    });
  }

  async drive(iid: number): Promise<Outcome> {
    const st0 = (this.db.prepare("SELECT state FROM issuance WHERE id=?").get(iid) as { state: string }).state;
    if (st0 === "held") { this.tx(() => { this.db.prepare("UPDATE issuance SET state='approved' WHERE id=?").run(iid); this.ev("held_reevaluate", {}, iid); }); }
    else if (st0 !== "approved") return this.outcomeOf(iid);
    if (!this.claim(iid)) return { status: "in_progress", reason: "別のワーカーが処理中（lease）" };
    try {
      const deadline = Date.now() + (this.o.waitTimeoutMs ?? 150_000);
      for (let guard = 0; guard < 40 && Date.now() < deadline; guard++) {
        const iss = this.db.prepare("SELECT * FROM issuance WHERE id=?").get(iid) as J;
        if (iss["state"] !== "approved") break;
        const att = this.db.prepare("SELECT * FROM attempts WHERE issuance_id=? ORDER BY attempt_no DESC LIMIT 1").get(iid) as J;
        if (att["state"] === "prepared") {
          const cur = await chainInfo(this.o.client, this.o.wallet.address);
          if (cur.validatedIndex > Number(att["last_ledger_sequence"])) {
            // 送信前に LastLedgerSequence を越えた取引は送らない（送っても tefMAX_LEDGER）。照会して不成立を確定する手順へ進む
            this.db.prepare("UPDATE attempts SET state='submitting' WHERE id=?").run(att["id"]);
            this.ev("skip_submit_lls_passed", { validated: cur.validatedIndex, lastLedgerSequence: att["last_ledger_sequence"] }, iid, Number(att["id"]));
          } else await this.submit(att);
          continue;
        }
        if (att["state"] === "submitting") {
          const k = await this.reconcile(iss, att);
          if (k === "pending") { await waitMs(this.o.pollMs ?? 2500); continue; }
          if (k === "held") break;
          continue;
        }
        // validated_failed / failed_final: 元の取引は成立しないと確定している。新しい試行を作れるか
        const info = await chainInfo(this.o.client, this.o.wallet.address);
        if (Number(iss["cancel_after"]) - (this.o.marginSec ?? 120) <= info.closeTime) {
          this.tx(() => { this.db.prepare("UPDATE issuance SET state='aborted', state_reason='申請の期限（CancelAfter）が近い・過ぎた' WHERE id=?").run(iid); this.ev("aborted_expired", { closeTime: info.closeTime, cancelAfter: iss["cancel_after"] }, iid); });
          break;
        }
        this.tx(() => { this.prepareAttempt(iid, Number(att["attempt_no"]) + 1, info); });
      }
    } finally {
      this.db.prepare("DELETE FROM lease WHERE issuance_id=? AND pid=?").run(iid, process.pid);
    }
    return this.outcomeOf(iid);
  }

  private async submit(att: J) {
    const iid = Number(att["issuance_id"]), aid = Number(att["id"]);
    this.db.prepare("UPDATE attempts SET state='submitting', submit_count=submit_count+1 WHERE id=?").run(aid);
    this.ev("submit_start", { txHash: att["tx_hash"], count: Number(att["submit_count"]) + 1 }, iid, aid);
    let res: J | undefined, err: string | undefined;
    try { res = ((await this.o.client.request({ command: "submit", tx_blob: att["signed_blob"] } as never)) as unknown as { result: J }).result; } catch (e) { err = (e as Error).message; }
    this.hit("after_submit_response", iid, aid); // 応答はソケットに届いたが、DB に書く前に止まる
    this.db.prepare("UPDATE attempts SET last_engine_result=? WHERE id=?").run(res ? String(res["engine_result"]) : `error:${err}`, aid);
    this.ev("submit_response", res ? { engine_result: res["engine_result"], applied: res["applied"], accepted: res["accepted"], validated_ledger_index: res["validated_ledger_index"] } : { error: err }, iid, aid);
  }

  /** 1 回の照会で decide する。tx が見つからないことだけでは失敗にしない */
  private async reconcile(iss: J, att: J): Promise<"confirmed" | "failed" | "pending" | "held"> {
    const iid = Number(iss["id"]), aid = Number(att["id"]);
    const info = await chainInfo(this.o.client, this.o.wallet.address);
    const q = await queryTx(this.o.client, att["tx_hash"], Number(att["first_ledger"]), info.validatedIndex);
    this.ev("tx_query", q.found ? { found: true, validated: q.validated, result: q.result, ledger: q.ledgerIndex } : { found: false, searchedAll: q.searchedAll, error: q.error, range: [att["first_ledger"], info.validatedIndex], validated: info.validatedIndex }, iid, aid);
    if (q.found && q.validated) {
      if (q.result === "tesSUCCESS") {
        this.hit("after_validated_before_confirm", iid, aid);
        const mism = this.verifyOnChain(iss, att, q.tx, q.meta);
        if (mism.length) { this.tx(() => { this.db.prepare("UPDATE issuance SET state='held', state_reason=? WHERE id=?").run(`台帳の内容が承認内容と違う: ${mism.join(",")}`, iid); this.ev("MISMATCH", mism, iid, aid); }); return "held"; }
        const created = ((q.meta?.["AffectedNodes"] ?? []) as J[]).map((n) => n["CreatedNode"] as J | undefined).find((n) => n?.["LedgerEntryType"] === "Escrow");
        this.tx(() => {
          this.db.prepare("UPDATE attempts SET state='validated_success', validated_ledger=?, validated_result='tesSUCCESS' WHERE id=?").run(q.ledgerIndex ?? null, aid);
          this.db.prepare("UPDATE seq_alloc SET state='consumed' WHERE owner=? AND sequence=? AND attempt_id=?").run(iss["owner"], att["sequence"], aid);
          this.db.prepare("UPDATE issuance SET state='confirmed', offer_sequence=?, escrow_index=?, confirmed_tx=?, state_reason=NULL WHERE id=?").run(att["sequence"], String(created?.["LedgerIndex"]), att["tx_hash"], iid);
          this.ev("confirmed", { txHash: att["tx_hash"], ledger: q.ledgerIndex, sequence: att["sequence"] }, iid, aid);
        });
        return "confirmed";
      }
      // validated だが tec: 取引は台帳に入り、Sequence を消費した（成功ではない）
      this.tx(() => {
        this.db.prepare("UPDATE attempts SET state='validated_failed', validated_ledger=?, validated_result=? WHERE id=?").run(q.ledgerIndex ?? null, q.result ?? null, aid);
        this.db.prepare("UPDATE seq_alloc SET state='consumed' WHERE owner=? AND sequence=? AND attempt_id=?").run(iss["owner"], att["sequence"], aid);
        this.ev("validated_failure", { result: q.result }, iid, aid);
      });
      return "failed";
    }
    // 観測された事実: 送信を拒否された取引（tefPAST_SEQ など）でも、ノードは tx を「found, validated=false」で返し続ける。
    // よって「found かつ未 validated」は成功の兆しでも失敗の確定でもない。validated な履歴に現れるかで判断する
    const first = Number(att["first_ledger"]), last = Number(att["last_ledger_sequence"]), seq = Number(att["sequence"]);
    const covered = coversRange(info.completeLedgers, first, info.validatedIndex);
    const pastLls = info.validatedIndex > last;
    let histTxs: ReturnType<typeof flat>[] | undefined, histPages = 0;
    if (covered && (q.found || info.seqValidated > seq)) {
      const h = await accountHistory(this.o.client, this.o.wallet.address, first, info.validatedIndex);
      histPages = h.pages;
      if (h.complete) histTxs = h.txs.map(flat).filter((t) => t.validated);
    }
    if (histTxs?.some((t) => t.hash === att["tx_hash"])) return "pending"; // validated 履歴にある（次の照会で確定する）
    // 元の hash が [first, validated] の validated 台帳に無いと言えるか
    const absentBy = q.found ? (histTxs ? "account_tx 履歴（tx は未 validated の記録だけ返した）" : undefined) : (q.searchedAll === true && covered ? "tx の searched_all" : undefined);
    const consumed = info.seqValidated > seq;
    const hit = consumed && absentBy ? histTxs?.find((t) => t.tx["Account"] === iss["owner"] && t.tx["Sequence"] === seq) : undefined;
    const consumer: J | undefined = hit ? { hash: hit.hash, type: hit.tx["TransactionType"], result: hit.meta?.["TransactionResult"], ledger: hit.ledger, historyPages: histPages } : undefined;
    if (!consumer) {
      if (!pastLls) {
        // 元の取引はまだ成立し得る（Sequence を他が消費したと確認できていない）。同じ署名済みバイト列を再送して待つ（同一 hash なので二重にならない）
        const polls = (this.db.prepare("SELECT COUNT(*) c FROM events WHERE attempt_id=? AND event='tx_query'").get(aid) as { c: number }).c;
        if (polls % 4 === 0) { this.ev("resubmit_same_blob", { txHash: att["tx_hash"] }, iid, aid); this.db.prepare("UPDATE attempts SET submit_count=submit_count+1 WHERE id=?").run(aid); const r = ((await (this.o.client.request({ command: "submit", tx_blob: att["signed_blob"] } as never) as unknown as Promise<{ result: J }>).catch((e: Error) => ({ result: { engine_result: `error:${e.message}` } as J }))).result); this.db.prepare("UPDATE attempts SET last_engine_result=? WHERE id=?").run(String(r["engine_result"]), aid); this.ev("submit_response", { engine_result: r["engine_result"] }, iid, aid); }
        return "pending";
      }
      // LastLedgerSequence を越えた。validated 履歴に無いと言え、履歴が連続しているときだけ「成立しない」と確定する
      if (!absentBy || consumed) {
        const why = consumed && absentBy ? `Sequence ${seq} は消費済み（validated Sequence=${info.seqValidated}）だが、消費した取引を履歴から特定できない` : `判定不能: searched_all=${q.found ? "（found）" : q.searchedAll} complete_ledgers=${info.completeLedgers} 範囲=${first}〜${info.validatedIndex} 履歴を読めた=${!!histTxs}`;
        this.tx(() => { this.db.prepare("UPDATE issuance SET state='held', state_reason=? WHERE id=?").run(why, iid); this.ev("held", { why }, iid, aid); });
        return "held";
      }
    }
    const evidence = { reason: consumer ? "sequence_consumed_by_other" : "last_ledger_sequence_passed", decidedAtValidated: info.validatedIndex, lastLedgerSequence: att["last_ledger_sequence"], queryRange: [att["first_ledger"], info.validatedIndex], absentBy, completeLedgers: info.completeLedgers, accountSequenceValidated: info.seqValidated, sequenceConsumedBy: consumer ?? null };
    this.tx(() => {
      this.db.prepare("UPDATE attempts SET state='failed_final', evidence=? WHERE id=?").run(JSON.stringify(evidence), aid);
      this.db.prepare("UPDATE seq_alloc SET state=? WHERE owner=? AND sequence=? AND attempt_id=?").run(consumer ? "consumed" : "released", iss["owner"], att["sequence"], aid);
      this.ev("failed_final", evidence, iid, aid);
    });
    return "failed";
  }

  /** 台帳の取引・Escrow が、承認内容（発券記録）と一致するか。違う項目の名前を返す */
  private verifyOnChain(iss: J, att: J, tx: J, meta: J | undefined): string[] {
    const bad: string[] = [];
    const amt = tx["Amount"] as J;
    const memo = ((tx["Memos"] as J[] | undefined) ?? []).find((m) => String(m["Memo"]?.["MemoType"]).toUpperCase() === PK_MEMO_TYPE)?.["Memo"]?.["MemoData"];
    const chk = (name: string, a: unknown, b: unknown) => { if (a !== b) bad.push(name); };
    chk("TransactionType", tx["TransactionType"], "EscrowCreate");
    chk("Account", tx["Account"], iss["owner"]); chk("Destination", tx["Destination"], iss["shop"]);
    chk("currency", amt?.["currency"], iss["currency"]); chk("issuer", amt?.["issuer"], iss["issuer"]); chk("value", amt?.["value"], iss["value"]);
    chk("CancelAfter", tx["CancelAfter"], iss["cancel_after"]); chk("Condition", String(tx["Condition"]).toUpperCase(), iss["condition_hex"]);
    chk("Memo pkHash", String(memo).toUpperCase(), iss["pk_hash"]); chk("Sequence", tx["Sequence"], att["sequence"]);
    const esc = ((meta?.["AffectedNodes"] ?? []) as J[]).map((n) => n["CreatedNode"] as J | undefined).find((n) => n?.["LedgerEntryType"] === "Escrow");
    if (!esc) bad.push("Escrow が作られていない");
    return bad;
  }

  /** 再起動後の復旧: 送信待ち・照会待ちの仕事をすべて進める */
  async recoverAll(): Promise<Record<number, Outcome>> {
    const out: Record<number, Outcome> = {};
    for (const r of this.db.prepare("SELECT id FROM issuance WHERE state IN ('approved','held') ORDER BY id").all() as { id: number }[]) out[r.id] = await this.drive(r.id);
    return out;
  }

  snapshot() { return snapshotOf(this.db); }
}
export { Wallet };

export function snapshotOf(db: DatabaseSync) {
  const q = (s: string) => db.prepare(s).all() as J[];
  return {
    issuance: q("SELECT id, program_id, state, state_reason, offer_sequence, escrow_index, confirmed_tx, shop, cancel_after FROM issuance"),
    // 署名済みバイト列（signed_blob）は送信可能なので、結果に出さない
    attempts: q("SELECT id, attempt_no, sequence, tx_hash, last_ledger_sequence, first_ledger, state, submit_count, last_engine_result, validated_ledger, validated_result, evidence FROM attempts ORDER BY id"),
    seq_alloc: q("SELECT owner, sequence, attempt_id, state FROM seq_alloc ORDER BY attempt_id"),
    events: q("SELECT at, pid, attempt_id, event, detail FROM events ORDER BY id"),
  };
}
