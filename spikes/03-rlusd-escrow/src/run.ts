import { unixTimeToRippleTime, type Client, type EscrowCreate } from "xrpl";
import {
  RLUSD_CURRENCY,
  RLUSD_TESTNET_ISSUER,
  createPreimageCondition,
  ensureRlusdTrustLine,
  explorerTxUrl,
  getRlusdLine,
  isSuccess,
  loadOrCreatePersistentWallet,
  submitAndLog,
  walletFromEnv,
  type ReportRow,
} from "xrpl-kit";

/** Escrow に入れる RLUSD。失敗が見込まれる検証なので少額 */
export const ESCROW_AMOUNT = "0.1";
/** 条件付き Escrow は CancelAfter が必須（xrpl.org EscrowCreate）。成功した場合に長く固定しないよう短めにする */
const CANCEL_AFTER_MS = 10 * 60 * 1000;

export interface SpikeResult {
  rows: ReportRow[];
  errorCodes: string[];
  unknowns: string[];
  impacts: string[];
  failure: string | undefined;
  verdict: "合格" | "不合格";
}

/** 検証本体。client を受け取るので偽クライアントでもテストできる。seedStartDir は固定ウォレットの seed を保存する .env.local を探す起点 */
export async function runEscrowSpike(client: Client, seedStartDir: string): Promise<SpikeResult> {
  const rows: ReportRow[] = [];
  const errorCodes: string[] = [];
  const unknowns: string[] = [];
  const impacts: string[] = [];
  let failure: string | undefined;
  let verdict: "合格" | "不合格" = "不合格";

  try {
    const donor = walletFromEnv("DONOR_SEED");
    if (!donor) throw new Error("DONOR_SEED が未設定。先に `pnpm --filter 02-rlusd-wallet start` を実行する");

    // 1) 送り手の RLUSD 残高（読み取り）
    const before = await getRlusdLine(client, donor.address);
    rows.push({
      item: "送り手（donor）の RLUSD 残高",
      expected: `>= ${ESCROW_AMOUNT} RLUSD`,
      actual: before.exists ? `${before.balance} RLUSD` : "トラストラインなし",
      evidence: `account_lines（${donor.address}）`,
    });
    if (!before.exists || Number(before.balance) < Number(ESCROW_AMOUNT)) {
      throw new Error(`RLUSD 残高が足りない（${before.balance ?? "トラストラインなし"}）。検証できない`);
    }

    // 2) 受取側（beneficiary）を用意し RLUSD のトラストラインを張る
    //    → 失敗しても「受取側のトラストライン不足」が原因ではないと言えるようにする
    const ben = await loadOrCreatePersistentWallet(client, "BENEFICIARY_SEED", "beneficiary", seedStartDir);
    const trust = await ensureRlusdTrustLine(client, ben.wallet);
    if (trust && !isSuccess(trust)) throw new Error(`beneficiary の TrustSet が失敗: ${trust.engineResult ?? trust.error ?? "不明"}`);
    const benLine = await getRlusdLine(client, ben.wallet.address);
    rows.push({
      item: "受取側（beneficiary）の RLUSD トラストライン",
      expected: "あり（Escrow の失敗要因から受取側を除外するため）",
      actual: benLine.exists ? `あり（limit=${benLine.limit}）` : "なし",
      evidence: trust ? `TrustSet [${trust.hash}](${explorerTxUrl(trust.hash)})` : `既存。${ben.wallet.address}`,
    });
    if (!benLine.exists) throw new Error("beneficiary のトラストラインを確認できない");

    // 3) 条件付き EscrowCreate（設計と同じ PREIMAGE-SHA-256 + CancelAfter）
    const cond = createPreimageCondition();
    const cancelAfter = unixTimeToRippleTime(Date.now() + CANCEL_AFTER_MS);
    const tx: EscrowCreate = {
      TransactionType: "EscrowCreate",
      Account: donor.address,
      Destination: ben.wallet.address,
      Amount: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: ESCROW_AMOUNT },
      Condition: cond.conditionHex,
      CancelAfter: cancelAfter,
    };
    const outcome = await submitAndLog(client, "EscrowCreate RLUSD", tx, donor);

    const ok = isSuccess(outcome);
    rows.push({
      item: `RLUSD ${ESCROW_AMOUNT} の条件付き EscrowCreate`,
      expected: "tesSUCCESS かつ validated（Token Escrow で RLUSD をロックできる）",
      actual: `${outcome.engineResult ?? "(結果なし)"} / validated=${String(outcome.validated)}${outcome.error ? ` / error=${outcome.error}` : ""}`,
      evidence: `[${outcome.hash}](${explorerTxUrl(outcome.hash)})。Condition=${cond.conditionHex}、CancelAfter(Ripple epoch)=${cancelAfter}`,
    });
    if (outcome.engineResult && outcome.engineResult !== "tesSUCCESS") errorCodes.push(outcome.engineResult);
    if (outcome.error) errorCodes.push(outcome.error);

    const after = await getRlusdLine(client, donor.address);
    rows.push({
      item: "送り手の RLUSD 残高の変化",
      expected: ok ? `${ESCROW_AMOUNT} 減る` : "変化なし",
      actual: `${before.balance} → ${after.balance}`,
      evidence: "account_lines（validated）",
    });

    if (ok) {
      verdict = "合格";
      impacts.push("なし。Testnet の RLUSD で Token Escrow を作成できた。次は EscrowFinish（Fulfillment）と EscrowCancel（期限切れ返還）を RLUSD で検証する");
      unknowns.push(
        `${ESCROW_AMOUNT} RLUSD は CancelAfter（約 10 分後）までロックされる。返還には EscrowCancel が別途必要（このスパイクでは送らない）`,
      );
    } else if (outcome.engineResult === "tecNO_PERMISSION") {
      impacts.push(
        "RLUSD の Testnet 発行者では Token Escrow を作成できなかった（tecNO_PERMISSION）。01-preflight の「発行者に lsfAllowTrustLineLocking が無い」と整合する。06_技術設計の『RLUSD を Escrow に入れる』前提を見直す必要がある。発行者側の設定変更が無い限り、RLUSD でのロックは設計に使えない",
      );
      unknowns.push("tecNO_PERMISSION の原因がフラグ未設定のみかは、この 1 回の結果だけでは断定できない（発行者が設定すれば変わるかを見るのが確実）");
    } else {
      impacts.push(
        `想定外の結果（${outcome.engineResult ?? outcome.error ?? "不明"}）。xrpl.org の EscrowCreate のエラー表で意味を確認してから設計への影響を判断する`,
      );
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
    console.error(`[03-rlusd-escrow] FAILED: ${failure}`);
  }
  return { rows, errorCodes, unknowns, impacts, failure, verdict };
}
