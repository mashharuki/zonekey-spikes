/**
 * 「券を作ってよいお店」を台帳だけで選ぶ。鍵も .env.local も使わない（読むだけ）
 * 候補 = 自治体 G の owner directory にある Credential の Subject（account_objects(G, type: credential)）。台帳の外のリストは使わない
 * 条件:
 *   a. 発行者が G で、CredentialType が todoke:shop:<地区>
 *   b. 受け取り済み（Flags に lsfAccepted）
 *   c. Expiration が過ぎていない（検証済みレジャーの close_time <= Expiration。rippled checkExpired と同じ向き）
 *   d. お店の account_tx に、Memo "todoke/open" の付いた tesSUCCESS の取引（お店自身が送ったもの）が、有効時間内にある
 * --check で渡したアドレスは「なぜ候補に出ないか」の説明のためだけに読む（選ぶ条件には使わない）
 */
import type { Client } from "xrpl";
import { LSF_ACCEPTED, OPEN_MEMO_TYPE, credType, fromHex, validatedCloseTime } from "./common.js";

export interface SelectInput { district: string; issuer: string; windowSec: number; check?: string[] }
export interface Stats { account_objects: number; account_tx: number; ledger: number; bytes: number; ms: number }
export interface Selected { shop: string; lastNotice: number; lastNoticeTx: string; credExpiration?: number }
export interface Excluded { shop: string; reasons: string[] }
export interface SelectOutput { input: SelectInput; closeTime: number; selected: Selected[]; excluded: Excluded[]; stats: Stats }

type Cred = { Subject: string; Issuer: string; CredentialType: string; Flags: number; Expiration?: number };
type TxEntry = { hash?: string; validated?: boolean; close_time_iso?: string; tx_json?: Record<string, unknown>; tx?: Record<string, unknown>; meta?: { TransactionResult?: string } | string };
const RIPPLE_EPOCH = 946684800;

export async function selectShops(client: Client, input: SelectInput): Promise<SelectOutput> {
  const stats: Stats = { account_objects: 0, account_tx: 0, ledger: 0, bytes: 0, ms: 0 };
  const t0 = performance.now();
  const call = async <T>(kind: "account_objects" | "account_tx", req: Record<string, unknown>): Promise<T> => {
    stats[kind]++;
    const r = await client.request(req as never);
    stats.bytes += JSON.stringify(r).length;
    return (r as { result: T }).result;
  };
  const credsOf = async (account: string): Promise<Cred[]> => {
    const out: Cred[] = [];
    let marker: unknown;
    do {
      const res = await call<{ account_objects: Cred[]; marker?: unknown }>("account_objects", { command: "account_objects", account, type: "credential", ledger_index: "validated", limit: 400, ...(marker ? { marker } : {}) });
      out.push(...res.account_objects);
      marker = res.marker;
    } while (marker);
    return out;
  };

  stats.ledger++;
  const now = await validatedCloseTime(client);
  const since = now - input.windowSec;
  const want = credType(input.district);

  /** d: 有効時間内で最新の届け（新しい順に読み、有効時間より古い取引に達したら止める） */
  const lastNotice = async (shop: string): Promise<{ t: number; hash: string } | undefined> => {
    let marker: unknown;
    do {
      const res = await call<{ transactions: TxEntry[]; marker?: unknown }>("account_tx", { command: "account_tx", account: shop, ledger_index_min: -1, ledger_index_max: -1, forward: false, limit: 20, ...(marker ? { marker } : {}) });
      for (const e of res.transactions) {
        const tx = e.tx_json ?? e.tx ?? {};
        const date = typeof tx["date"] === "number" ? (tx["date"] as number) : e.close_time_iso ? Date.parse(e.close_time_iso) / 1000 - RIPPLE_EPOCH : undefined;
        if (date === undefined) continue;
        if (date < since) return undefined;
        const result = typeof e.meta === "object" ? e.meta.TransactionResult : undefined;
        const memos = (tx["Memos"] as { Memo: { MemoType?: string } }[] | undefined) ?? [];
        if (e.validated !== false && result === "tesSUCCESS" && tx["Account"] === shop && memos.some((m) => m.Memo.MemoType?.toUpperCase() === OPEN_MEMO_TYPE)) return { t: date, hash: e.hash ?? String(tx["hash"] ?? "") };
      }
      marker = res.marker;
    } while (marker);
    return undefined;
  };

  const selected: Selected[] = [];
  const excluded: Excluded[] = [];
  const fromG = (await credsOf(input.issuer)).filter((c) => c.Issuer === input.issuer);
  const subjects = [...new Set(fromG.map((c) => c.Subject))];
  for (const shop of subjects) {
    const mine = fromG.filter((c) => c.Subject === shop);
    const c = mine.find((x) => x.CredentialType.toUpperCase() === want);
    const reasons: string[] = [];
    if (!c) { reasons.push(`a: 地区・種類が違う（${mine.map((x) => fromHex(x.CredentialType)).join(", ")}）`); excluded.push({ shop, reasons }); continue; }
    if ((c.Flags & LSF_ACCEPTED) === 0) reasons.push("b: Credential を受け取っていない（lsfAccepted なし）");
    if (c.Expiration !== undefined && now > c.Expiration) reasons.push(`c: Credential の期限切れ（Expiration ${c.Expiration} < close_time ${now}）`);
    const n = await lastNotice(shop);
    if (!n) reasons.push(`d: 有効時間（${input.windowSec} 秒）内の開店の届けがない`);
    if (reasons.length) excluded.push({ shop, reasons });
    else selected.push({ shop, lastNotice: n!.t, lastNoticeTx: n!.hash, ...(c.Expiration !== undefined ? { credExpiration: c.Expiration } : {}) });
  }
  // 説明用: 候補に出なかったアドレスについて、持っている Credential を読んで理由を書く
  for (const shop of (input.check ?? []).filter((a) => !subjects.includes(a))) {
    const held = await credsOf(shop);
    const other = held.filter((c) => c.Subject === shop);
    excluded.push({ shop, reasons: [other.length ? `a: 発行者が G ではない（${other.map((c) => `${c.Issuer} の ${fromHex(c.CredentialType)}`).join(", ")}）。G の候補に出ない` : "a: Credential がない。G の候補に出ない"] });
  }
  stats.ms = Math.round(performance.now() - t0);
  return { input, closeTime: now, selected, excluded, stats };
}
