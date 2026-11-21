import { randomBytes } from "node:crypto";
import { combine, split } from "shamir-secret-sharing";
import { xrpToDrops, type Client, type Memo, type OracleSet, type Wallet } from "xrpl";
import { explorerTxUrl, submitAndLog, type Recorder, type TxOutcome } from "xrpl-kit";
import {
  SCALE,
  SCORE_UNIT,
  codeOf,
  currencyToZone,
  hex,
  ledgerCloseUnix,
  memoDataBytesFor,
  memosSerializedBytes,
  priceToScore,
  scoreToPrice,
  shareMemo,
  validatedCloseUnix,
  zoneToCurrency,
} from "./encoding.js";

const ZONE_A = "ZONE-13101-A"; // 分け前を配るゾーン
const ZONE_B = "ZONE-13101-B";
const SCORES: Record<string, [number, number]> = { o1: [82.5, 100], o2: [78, 45.5], o3: [90, 61] };

export interface OracleResult {
  /** OracleSet の Memo で分け前を配って読み戻せたか（確認 2） */
  memoWorks: boolean;
  shareplace: string;
}

const pair = (zone: string, score: number) => ({ PriceData: { BaseAsset: zoneToCurrency(zone), QuoteAsset: SCORE_UNIT, AssetPrice: scoreToPrice(score), Scale: SCALE } });

function oracleSet(o: Wallet, docId: number, lastUpdate: number, pairs: ReturnType<typeof pair>[], memos?: Memo[], create = true): OracleSet {
  return {
    TransactionType: "OracleSet", Account: o.address, OracleDocumentID: docId, LastUpdateTime: lastUpdate, PriceDataSeries: pairs,
    ...(create ? { Provider: hex("zonekey-damage-oracle"), AssetClass: hex("damage") } : {}),
    ...(memos ? { Memos: memos } : {}),
  };
}

interface OracleNode { PriceDataSeries: { PriceData: { BaseAsset: string; QuoteAsset: string; AssetPrice?: string; Scale?: number } }[]; PreviousTxnID: string; LastUpdateTime: number }

async function readOracle(client: Client, account: string, docId: number): Promise<OracleNode> {
  const r = (await client.request({ command: "ledger_entry", oracle: { account, oracle_document_id: docId }, ledger_index: "validated" } as never)) as { result: { node: OracleNode } };
  return r.result.node;
}

/** 台帳だけから分け前を取り出す: Oracle エントリー → PreviousTxnID → その tx の Memos */
async function shareFromLedger(client: Client, account: string, docId: number): Promise<{ shareHex: string | undefined; txHash: string }> {
  const node = await readOracle(client, account, docId);
  const tx = (await client.request({ command: "tx", transaction: node.PreviousTxnID })) as unknown as { result: { tx_json?: { Memos?: Memo[] } } };
  const memo = tx.result.tx_json?.Memos?.find((m) => m.Memo.MemoType === hex("zonekey/share"));
  return { shareHex: memo?.Memo.MemoData, txHash: node.PreviousTxnID };
}

const eqBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

export async function runOracle(client: Client, r: Recorder, oracles: Record<"o1" | "o2" | "o3", Wallet>, board: () => Promise<Wallet>): Promise<OracleResult> {
  const names = ["o1", "o2", "o3"] as const;

  // ===== 確認 3 の準備: 32 バイトの鍵を 2-of-3 に分割 =====
  const key = new Uint8Array(randomBytes(32));
  const shares = await split(key, 3, 2);
  r.add("observe", "Shamir 2-of-3 の分け前の長さ", "32 バイト（依頼の想定）", `${shares.map((s) => s.length).join(", ")} バイト`,
    "shamir-secret-sharing 0.0.4: 秘密と同じ長さ + x 座標 1 バイト。以降は 33 バイトの分け前を扱う");
  const shareHex = shares.map((s) => Buffer.from(s).toString("hex").toUpperCase());

  // ===== 確認 1 + 2: 3 オラクルがスコアを書き、同じ tx の Memo に分け前を入れる =====
  const t0 = Math.floor(await validatedCloseUnix(client));
  const set1: Record<string, TxOutcome> = {};
  for (const [i, n] of names.entries()) {
    const [a, b] = SCORES[n]!;
    const memos = [shareMemo(shareHex[i]!, ZONE_A)];
    const o = await submitAndLog(client, `${n} OracleSet`, oracleSet(oracles[n], 1, t0, [pair(ZONE_A, a), pair(ZONE_B, b)], memos), oracles[n]);
    set1[n] = o;
    r.tx(`確認1/2 ${n}: OracleSet（2 ゾーンのスコア + Memo に分け前 ${shares[i]!.length} バイト）`, o, "tesSUCCESS",
      `Memos の直列化サイズ=${memosSerializedBytes(memos)} バイト`);
  }

  for (const n of names) {
    try {
      const node = await readOracle(client, oracles[n].address, 1);
      const got = node.PriceDataSeries.map((p) => `${currencyToZone(p.PriceData.BaseAsset)}/${p.PriceData.QuoteAsset}=${p.PriceData.AssetPrice ? priceToScore(p.PriceData.AssetPrice, p.PriceData.Scale ?? 0) : "なし"}`);
      const want = [`${ZONE_A}/${SCORE_UNIT}=${SCORES[n]![0]}`, `${ZONE_B}/${SCORE_UNIT}=${SCORES[n]![1]}`];
      r.add(want.every((w) => got.includes(w)) ? "pass" : "fail", `確認1 ${n}: 台帳から読み戻したスコア`, want.join("<br>"), got.join("<br>"),
        `ledger_entry { oracle: { account, oracle_document_id: 1 } }。AssetPrice は 16 進で返る（例 ${node.PriceDataSeries[0]?.PriceData.AssetPrice}）`);
    } catch (e) {
      r.add("fail", `確認1 ${n}: 台帳から読み戻したスコア`, "読める", String((e as { data?: { error?: string } }).data?.error ?? e), "ledger_entry");
    }
  }

  // 台帳上の集計（3 オラクルの同じペア）
  try {
    const agg = await client.request({
      command: "get_aggregate_price", base_asset: zoneToCurrency(ZONE_A), quote_asset: SCORE_UNIT,
      oracles: names.map((n) => ({ account: oracles[n].address, oracle_document_id: 1 })),
    });
    const res = agg.result as unknown as { entire_set: { mean: string; size: number }; median?: string };
    r.add("observe", `確認1 補足: get_aggregate_price で ${ZONE_A} の 3 オラクル集計`, "中央値は 82.5（Scale 適用済み）か 825（未適用）のどちらか（実測）",
      `median=${res.median ?? "-"}<br>mean=${res.entire_set.mean}<br>size=${res.entire_set.size}`, "get_aggregate_price（台帳上で計算）");
  } catch (e) {
    r.add("observe", "確認1 補足: get_aggregate_price", "集計できる", String((e as { data?: { error?: string } }).data?.error ?? e), "get_aggregate_price");
  }

  // スコア 0（AssetPrice=0）
  {
    const t = Math.floor(await validatedCloseUnix(client));
    const o = await submitAndLog(client, "o1 OracleSet score 0", oracleSet(oracles.o1, 9, t, [pair("ZONE-ZERO", 0)]), oracles.o1);
    r.add(codeOf(o) === "tesSUCCESS" ? "pass" : "observe", "確認1 補足: スコア 0（AssetPrice=0）を書けるか", "リファレンスに記載なし（実測）", codeOf(o),
      `[${o.hash}](${explorerTxUrl(o.hash)})`);
    if (codeOf(o) !== "tesSUCCESS") r.errorCodes.push(`スコア 0: ${codeOf(o)}`);
  }

  // ===== 確認 1b: LastUpdateTime の許容範囲（±300 秒） =====
  const timeRows: string[] = [];
  for (const [docId, offset] of [[11, -330], [12, -270], [13, 270], [14, 330]] as const) {
    const base = Math.floor(await validatedCloseUnix(client));
    const o = await submitAndLog(client, `o2 OracleSet offset ${offset}`, oracleSet(oracles.o2, docId, base + offset, [pair(ZONE_A, 50)]), oracles.o2);
    const code = codeOf(o);
    const applied = o.ledgerIndex ? await ledgerCloseUnix(client, o.ledgerIndex) : undefined;
    const delta = applied === undefined ? "-" : String(base + offset - applied);
    const expect = Math.abs(offset) > 300 ? "tecINVALID_UPDATE_TIME" : "tesSUCCESS";
    r.add(code === expect ? "pass" : "fail", `確認1b: LastUpdateTime を検証済みレジャー時刻 ${offset > 0 ? "+" : ""}${offset} 秒`, expect, code,
      `適用レジャーの close time との差=${delta} 秒。[${o.hash}](${explorerTxUrl(o.hash)})`);
    if (code !== "tesSUCCESS") r.errorCodes.push(`LastUpdateTime ${offset > 0 ? "+" : ""}${offset}s: ${code}`);
    timeRows.push(`${offset > 0 ? "+" : ""}${offset}s → ${code}（差 ${delta}s）`);
  }
  {
    const prev = (await readOracle(client, oracles.o2.address, 1)).LastUpdateTime;
    const o = await submitAndLog(client, "o2 OracleSet same time", oracleSet(oracles.o2, 1, prev, [pair(ZONE_A, 79), pair(ZONE_B, 45.5)], undefined, false), oracles.o2);
    r.add(codeOf(o) === "tecINVALID_UPDATE_TIME" ? "pass" : "fail", "確認1b: 更新時に LastUpdateTime が前回と同じ", "tecINVALID_UPDATE_TIME（前回より大きい必要）", codeOf(o),
      `前回=${prev}。[${o.hash}](${explorerTxUrl(o.hash)})`);
    if (codeOf(o) !== "tesSUCCESS") r.errorCodes.push(`LastUpdateTime 前回と同じ: ${codeOf(o)}`);
  }

  // ===== 確認 2: Memo を台帳から読み戻す =====
  const fromLedger: Record<string, string | undefined> = {};
  let memoWorks = true;
  for (const [i, n] of names.entries()) {
    const { shareHex: got, txHash } = await shareFromLedger(client, oracles[n].address, 1);
    fromLedger[n] = got;
    const ok = got === shareHex[i];
    if (!ok) memoWorks = false;
    r.add(ok ? "pass" : "fail", `確認2 ${n}: OracleSet の Memo から分け前を読み戻す`, "送った分け前と一致", ok ? "一致" : `不一致: ${got ?? "Memo なし"}`,
      `Oracle エントリー → PreviousTxnID [${txHash.slice(0, 10)}…](${explorerTxUrl(txHash)}) → tx_json.Memos`);
  }

  // Memo の上限（直列化 1 KB）
  // rippled は Memos 配列の中身（フィールド ID と配列終端の 2 バイトを除く）で 1,024 バイトまでを数える（MEMO-LIMIT.md で実測）
  for (const [docId, target] of [[20, 1026], [21, 1027]] as const) {
    const n = memoDataBytesFor(target);
    const memos = [{ Memo: { MemoData: randomBytes(n).toString("hex").toUpperCase() } }];
    const size = memosSerializedBytes(memos);
    const t = Math.floor(await validatedCloseUnix(client));
    const o = await submitAndLog(client, `o3 OracleSet memo ${size}B`, oracleSet(oracles.o3, docId, t, [pair(ZONE_A, 90)], memos), oracles.o3);
    const code = codeOf(o);
    r.add(size - 2 <= 1024 ? (code === "tesSUCCESS" ? "pass" : "fail") : (code !== "tesSUCCESS" ? "pass" : "fail"),
      `確認2: Memos の中身 ${size - 2} バイト（フィールド全体 ${size}、MemoData ${n} バイト）`, size - 2 <= 1024 ? "tesSUCCESS（1 KB 以内）" : "拒否（1 KB 超過）", code,
      `${o.validated ? `[${o.hash}](${explorerTxUrl(o.hash)})` : `未適用（台帳に入らない）。${o.error ?? ""}`}`);
    if (code !== "tesSUCCESS") r.errorCodes.push(`Memos ${size} バイト: ${code}`);
  }

  // ===== 確認 3: 2 つの分け前で復元、1 つでは不可 =====
  const fromChain = names.map((n) => fromLedger[n]).map((h) => (h ? new Uint8Array(Buffer.from(h, "hex")) : undefined));
  if (fromChain.every(Boolean)) {
    const [s1, s2, s3] = fromChain as [Uint8Array, Uint8Array, Uint8Array];
    for (const [label, pairShares] of [["o1 + o2", [s1, s2]], ["o1 + o3", [s1, s3]], ["o2 + o3", [s2, s3]]] as const) {
      const k = await combine([...pairShares]);
      r.add(eqBytes(k, key) ? "pass" : "fail", `確認3: 台帳の Memo から集めた ${label} で鍵を復元`, "元の 32 バイト鍵と一致", eqBytes(k, key) ? "一致" : "不一致", "combine()");
    }
    const one = await combine([s1]).then(() => "復元できてしまった").catch((e: Error) => `例外: ${e.message}`);
    r.add(one.startsWith("例外") ? "pass" : "fail", "確認3: 分け前 1 つでは復元できない", "復元不可", one, "combine([o1])");
    const fake = new Uint8Array(randomBytes(33));
    fake[32] = s2[32]!; // 本物と同じ x 座標を持つ偽の分け前
    const k2 = await combine([s1, fake]).catch(() => undefined);
    r.add(k2 && !eqBytes(k2, key) ? "pass" : "observe", "確認3: 分け前 1 つ + 偽の分け前では元の鍵にならない", "元の鍵と不一致", k2 ? (eqBytes(k2, key) ? "一致（問題）" : "不一致") : "例外", "combine([o1, 偽])");
  } else {
    r.add("fail", "確認3: 台帳から分け前を 3 つ集める", "3 つそろう", names.map((n) => `${n}=${fromLedger[n] ? "あり" : "なし"}`).join(", "), "確認2 の結果");
  }

  // ===== 確認 4: 代替（Payment の Memo）。確認 2 が成立しない場合のみ =====
  if (!memoWorks) {
    const b = await board();
    const viaPayment: (string | undefined)[] = [];
    for (const [i, n] of names.entries()) {
      const o = await submitAndLog(client, `${n} Payment memo`, {
        TransactionType: "Payment", Account: oracles[n].address, Destination: b.address, Amount: xrpToDrops("0.000001"), Memos: [shareMemo(shareHex[i]!, ZONE_A)],
      }, oracles[n]);
      r.tx(`確認4 ${n}: 公開アカウント宛て 1 drop の Payment の Memo に分け前`, o, "tesSUCCESS");
      const tx = (await client.request({ command: "tx", transaction: o.hash })) as unknown as { result: { tx_json?: { Memos?: Memo[] } } };
      viaPayment.push(tx.result.tx_json?.Memos?.[0]?.Memo.MemoData);
    }
    const k = await combine([new Uint8Array(Buffer.from(viaPayment[0]!, "hex")), new Uint8Array(Buffer.from(viaPayment[2]!, "hex"))]);
    r.add(eqBytes(k, key) ? "pass" : "fail", "確認4: Payment の Memo から集めた 2 つで復元", "一致", eqBytes(k, key) ? "一致" : "不一致", "combine()");
  } else {
    r.add("observe", "確認4: 代替（Payment の Memo）", "確認2 が不可の場合のみ実施", "確認2 が成立したため実施せず", "-");
  }

  r.add("observe", "確認1b まとめ", "-", timeRows.join("<br>"), "-");
  return { memoWorks, shareplace: memoWorks ? "OracleSet の Memo" : "別取引（Payment）の Memo" };
}
