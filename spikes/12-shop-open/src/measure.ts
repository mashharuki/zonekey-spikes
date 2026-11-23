/**
 * 12 確認 9: 地区のお店を 5・15・30 件に増やし、select の時間・呼び出し回数・データ量を測る（Testnet、5〜10 分）
 *   pnpm --filter 12-shop-open measure
 * 口座: G（自治体・模擬）と F（資金を配る）は Faucet で毎回作る。お店は F から 1.5 XRP ずつ（Batch で 8 件ずつ）。seed は保存しない
 * Credential の発行は G の Batch（8 件ずつ）。受け取りと届けは、お店ごとに 1 件ずつ（各お店の署名が要るので並列で送る）
 */
import { BatchFlags, Wallet, xrpToDrops, type SubmittableTransaction } from "xrpl";
import { Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, connectTestnet, createFundedWallet, loadEnvLocal, submitAndLog, submitBatch } from "xrpl-kit";
import { fileURLToPath } from "node:url";
import { credType, openMemo, saveResults, validatedCloseTime } from "./common.js";
import { selectShops } from "./select.js";

loadEnvLocal(fileURLToPath(import.meta.url));
const r = new Recorder("12");
const STEPS = [5, 15, 30], WINDOW = 3600, DISTRICT = "z13";
const client = await connectTestnet();
const table: Record<string, unknown>[] = [];
try {
  const G = (await createFundedWallet(client, "G（計測）")).wallet;
  const F = (await createFundedWallet(client, "F（資金）")).wallet;
  const base = await baseFeeDrops(client);
  const batch = async (w: Wallet, inners: SubmittableTransaction[], what: string) => {
    for (let i = 0; i < inners.length; i += 8) {
      const part = inners.slice(i, i + 8);
      const out = await submitBatch(client, w, await buildSingleAccountBatch(client, w, BatchFlags.tfAllOrNothing, part, batchFeeDrops(part, base).total));
      if (out.engineResult !== "tesSUCCESS" || !out.inner.every((x) => x.result === "tesSUCCESS")) {
        r.add("fail", `準備: ${what}（Batch）`, "すべて tesSUCCESS", `外側 ${out.engineResult ?? out.error} / 内側 [${out.inner.map((x) => x.result ?? "未記録").join(", ")}]`, out.hash);
        throw new Error(`${what} に失敗`);
      }
    }
  };
  const shops: Wallet[] = [];
  for (const n of STEPS) {
    const add = Array.from({ length: n - shops.length }, () => Wallet.generate());
    await batch(F, add.map((s) => ({ TransactionType: "Payment", Account: F.address, Destination: s.address, Amount: xrpToDrops("1.5") }) as SubmittableTransaction), "お店の口座を作る");
    await batch(G, add.map((s) => ({ TransactionType: "CredentialCreate", Account: G.address, Subject: s.address, CredentialType: credType(DISTRICT) }) as SubmittableTransaction), "Credential を出す");
    const res = await Promise.all(add.map(async (s) => {
      const a = await submitAndLog(client, "CredentialAccept", { TransactionType: "CredentialAccept", Account: s.address, Issuer: G.address, CredentialType: credType(DISTRICT) }, s);
      const o = await submitAndLog(client, "開店の届け", { TransactionType: "AccountSet", Account: s.address, Memos: openMemo(DISTRICT, await validatedCloseTime(client)) }, s);
      return [a.engineResult, o.engineResult];
    }));
    const bad = res.filter(([a, o]) => a !== "tesSUCCESS" || o !== "tesSUCCESS").length;
    if (bad) r.add("fail", `準備: ${add.length} 件の受け取りと届け`, "すべて tesSUCCESS", `${bad} 件失敗`, "submitAndLog");
    shops.push(...add);
    const out = await selectShops(client, { district: DISTRICT, issuer: G.address, windowSec: WINDOW });
    r.eq(`確認9: お店 ${n} 件のとき、全件が選ばれる`, `${n}`, `${out.selected.length}`, `${out.stats.ms} ms / account_objects ${out.stats.account_objects} 回・account_tx ${out.stats.account_tx} 回・ledger ${out.stats.ledger} 回 / 受け取り ${out.stats.bytes} B`);
    table.push({ shops: n, ...out.stats, selected: out.selected.length });
  }
  r.add("observe", "確認9: 件数と選ぶ時間", "-", table.map((t) => `${t["shops"]} 件: ${t["ms"]} ms・account_tx ${t["account_tx"]} 回・account_objects ${t["account_objects"]} 回・${t["bytes"]} B`).join("<br>"), `G=${G.address}。有効時間 ${WINDOW} 秒。Mac から公開 Testnet サーバーへ、お店を 1 件ずつ順に読む`);
} finally {
  saveResults("measure", r, { table });
  await client.disconnect();
}
