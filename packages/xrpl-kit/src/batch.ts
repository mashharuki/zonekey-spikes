import {
  GlobalFlags,
  encode,
  hashes,
  type Batch,
  type Client,
  type SubmittableTransaction,
  type Wallet,
} from "xrpl";
import { explorerTxUrl } from "./testnet.js";

/** Batch の内側にできる最大件数（xrpl.org Batch リファレンス: RawTransactions は 2〜8） */
export const BATCH_MAX_INNER = 8;

export interface InnerResult {
  index: number;
  hash: string;
  /** 自前で計算した内側 hash が台帳上の hash と一致したか（記録されていなければ undefined） */
  computedHashMatches: boolean | undefined;
  type: string;
  sequence: number;
  /** 台帳に記録されていれば tes/tec。記録されていなければ undefined（AllOrNothing で巻き戻った等） */
  result: string | undefined;
  /** tx_json / meta のどこに ParentBatchID があったか */
  parentBatchId: string | undefined;
}

export interface BatchOutcome {
  hash: string;
  explorerUrl: string;
  /** 送信直後の暫定結果（tel/tem/tef/ter を含む） */
  preliminary: string;
  /** 検証済みレジャーでの外側の結果 */
  engineResult: string | undefined;
  validated: boolean;
  ledgerIndex: number | undefined;
  fee: string;
  innerCount: number;
  inner: InnerResult[];
  /** 外側の送信者の Sequence の変化（消費されたシーケンス数） */
  sequenceBefore: number;
  sequenceAfter: number | undefined;
  /** 外側の送信者の XRP 残高の変化（drops、マイナスが支払い） */
  balanceDeltaDrops: bigint | undefined;
  error: string | undefined;
}

export async function baseFeeDrops(client: Client): Promise<bigint> {
  const r = await client.request({ command: "fee" });
  return BigInt(r.result.drops.base_fee);
}

/**
 * 内側のトランザクションが単独で送られた場合の手数料（drops）。
 * xrpl.js の autofill（calculateFeePerTransactionType）と同じ規則:
 * - EscrowFinish（Fulfillment あり）: base × (33 + Fulfillment バイト数 / 16)、切り上げ
 * - それ以外: base
 */
export function standaloneFeeDrops(tx: SubmittableTransaction, base: bigint): bigint {
  if (tx.TransactionType === "EscrowFinish" && tx.Fulfillment) {
    const bytes = Math.ceil(tx.Fulfillment.length / 2);
    return BigInt(Math.ceil(Number(base) * (33 + bytes / 16)));
  }
  return base;
}

/**
 * 外側の手数料（xrpl.js の計算式）: base × 2 + Σ（内側の単独手数料）。単一署名の外側を前提。
 * xrpl.org の記述（20 drops + 外側の署名ごと 10 drops + 内側の手数料の合計）との違いは実測で確かめる。
 */
export function batchFeeDrops(inners: SubmittableTransaction[], base: bigint): { total: bigint; formula: string } {
  const parts = inners.map((t) => standaloneFeeDrops(t, base));
  const total = base * 2n + parts.reduce((a, b) => a + b, 0n);
  return { total, formula: `${base}×2 + Σ内側(${parts.join("+")}) = ${total}` };
}

async function accountSeqAndBalance(client: Client, account: string, ledger: "validated" | "current") {
  const r = await client.request({ command: "account_info", account, ledger_index: ledger });
  return { seq: r.result.account_data.Sequence, balance: BigInt(r.result.account_data.Balance) };
}

/**
 * 同一アカウントの内側トランザクションだけからなる Batch を組み立てて署名する。
 * 外側 Sequence = N、内側 = N+1, N+2, ...（xrpl.js の autofillBatchTxn と同じ割り当て）
 */
export async function buildSingleAccountBatch(
  client: Client,
  wallet: Wallet,
  mode: number,
  inners: SubmittableTransaction[],
  fee: bigint,
): Promise<{ tx: Batch; blob: string; hash: string; innerHashes: string[]; sequence: number }> {
  const { seq } = await accountSeqAndBalance(client, wallet.address, "current");
  const ledger = await client.getLedgerIndex();
  const raw = inners.map((t, i) => {
    const inner = {
      ...t,
      Flags: ((typeof t.Flags === "number" ? t.Flags : 0) | GlobalFlags.tfInnerBatchTxn) >>> 0,
      Fee: "0",
      SigningPubKey: "",
      Sequence: seq + 1 + i,
      ...(client.networkID !== undefined && client.networkID > 1024 ? { NetworkID: client.networkID } : {}),
    } as SubmittableTransaction;
    return { RawTransaction: inner };
  });
  const tx: Batch = {
    TransactionType: "Batch",
    Account: wallet.address,
    Flags: mode,
    RawTransactions: raw,
    Sequence: seq,
    Fee: fee.toString(),
    LastLedgerSequence: ledger + 20,
  };
  const signed = wallet.sign(tx);
  // 内側の hash は、署名なし（SigningPubKey ""）の内側をそのまま直列化した hash
  const innerHashes = raw.map((r) => hashes.hashTx(encode(r.RawTransaction as never)));
  return { tx, blob: signed.tx_blob, hash: signed.hash, innerHashes, sequence: seq };
}

async function waitValidated(client: Client, hash: string, lastLedger: number) {
  for (;;) {
    try {
      const r = await client.request({ command: "tx", transaction: hash });
      if (r.result.validated) return r.result as unknown as { meta: { TransactionResult: string }; ledger_index: number };
    } catch {
      // まだ見つからない
    }
    if ((await client.getLedgerIndex()) > lastLedger + 1) return undefined;
    await new Promise((res) => setTimeout(res, 1500));
  }
}

/**
 * 内側の結果を取得する（外側は内側が失敗しても tesSUCCESS を返すため 1 件ずつ見る）。
 * 外側と同じレジャーの account_tx から、送信者 + Sequence で内側 tx を突き合わせる。
 * 自前で計算した内側 hash（hashTx(encode(inner))）は実機で txnNotFound になったので使わず、一致したかを記録するだけにする。
 */
async function innerResults(client: Client, tx: Batch, innerHashes: string[], outerHash: string, ledgerIndex: number): Promise<InnerResult[]> {
  type Entry = { hash?: string; tx_json?: { Account?: string; Sequence?: number; ParentBatchID?: string; TransactionType?: string }; meta?: { TransactionResult?: string; ParentBatchID?: string } };
  const byAccount = new Map<string, Entry[]>();
  for (const acct of new Set(tx.RawTransactions.map((r) => r.RawTransaction.Account))) {
    const res = (await client.request({ command: "account_tx", account: acct, ledger_index_min: ledgerIndex, ledger_index_max: ledgerIndex, limit: 50 } as never)) as { result: { transactions?: Entry[] } };
    byAccount.set(acct, res.result.transactions ?? []);
  }
  return tx.RawTransactions.map((r, i) => {
    const inner = r.RawTransaction;
    const found = (byAccount.get(inner.Account) ?? []).find((e) => e.hash !== outerHash && e.tx_json?.Account === inner.Account && e.tx_json?.Sequence === inner.Sequence && e.tx_json?.TransactionType === inner.TransactionType);
    const p = found?.tx_json?.ParentBatchID ?? found?.meta?.ParentBatchID;
    return {
      index: i + 1,
      hash: found?.hash ?? innerHashes[i]!,
      computedHashMatches: found?.hash ? found.hash === innerHashes[i] : undefined,
      type: inner.TransactionType,
      sequence: inner.Sequence ?? -1,
      result: found?.meta?.TransactionResult,
      parentBatchId: found ? (p ? (p === outerHash ? "外側と一致" : `外側と不一致(${p})`) : "なし") : "台帳に記録なし",
    };
  });
}

/** 署名済み Batch を送り、検証を待ち、内側の結果・シーケンス消費・実際の手数料を集める */
export async function submitBatch(
  client: Client,
  wallet: Wallet,
  built: { tx: Batch; blob: string; hash: string; innerHashes: string[]; sequence: number },
): Promise<BatchOutcome> {
  const before = await accountSeqAndBalance(client, wallet.address, "validated");
  const base: BatchOutcome = {
    hash: built.hash, explorerUrl: explorerTxUrl(built.hash), preliminary: "", engineResult: undefined, validated: false,
    ledgerIndex: undefined, fee: built.tx.Fee ?? "", innerCount: built.tx.RawTransactions.length, inner: [],
    sequenceBefore: before.seq, sequenceAfter: undefined, balanceDeltaDrops: undefined, error: undefined,
  };
  try {
    const sub = await client.submit(built.blob);
    base.preliminary = sub.result.engine_result;
    console.log(`[xrpl-kit] Batch ${built.hash}: preliminary=${base.preliminary} fee=${base.fee} inner=${base.innerCount}`);
    if (!/^(tes|tec|ter)/.test(base.preliminary)) return base; // tel/tem/tef は台帳に入らない
    const v = await waitValidated(client, built.hash, built.tx.LastLedgerSequence!);
    if (!v) {
      base.error = "LastLedgerSequence までに検証されなかった";
      return base;
    }
    base.validated = true;
    base.engineResult = v.meta.TransactionResult;
    base.ledgerIndex = v.ledger_index;
    base.inner = await innerResults(client, built.tx, built.innerHashes, built.hash, v.ledger_index);
    const after = await accountSeqAndBalance(client, wallet.address, "validated");
    base.sequenceAfter = after.seq;
    base.balanceDeltaDrops = after.balance - before.balance;
    console.log(`[xrpl-kit] Batch ${built.hash}: result=${base.engineResult} inner=[${base.inner.map((x) => x.result ?? "未記録").join(",")}] ${base.explorerUrl}`);
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}
