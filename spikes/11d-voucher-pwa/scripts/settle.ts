/**
 * 11d 精算（Mac・オンライン）: お店の画面が書き出した claims-….json を、お店 S 自身の EscrowFinish でまとめて精算する
 *   pnpm --filter 11d-voucher-pwa settle ~/Downloads/claims-XXXXXXXX.json
 * 注: 本番ではお店の端末が自分の鍵で出す。この検証ではお店の seed を Mac の .state/shop.json に置いた
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BatchFlags, Wallet, type EscrowFinish } from "xrpl";
import { BATCH_MAX_INNER, Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, connectTestnet, explorerTxUrl, loadEnvLocal, submitBatch } from "xrpl-kit";
import type { ClaimsFile, ShopSyncFile } from "../src/lib/exchange.js";
import { SHOP_STATE, here, readJson, saveResults, voucherBalance } from "./common.js";

loadEnvLocal(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg || !existsSync(resolve(arg))) throw new Error("お店が書き出した claims-….json のパスを渡す");
const claims = readJson<ClaimsFile>(resolve(arg));
const shop = readJson<{ shop: string; seed: string }>(fileURLToPath(here(SHOP_STATE)));
const sync = readJson<ShopSyncFile>(fileURLToPath(here("exchange/shop-sync.json")));
if (claims.kind !== "todoke-11d-claims" || claims.shop !== shop.shop) throw new Error("このお店の claims ではない");
const S = Wallet.fromSeed(shop.seed);
const issuer = sync.list[0]!.amount.issuer;

const r = new Recorder("11d");
const extra: Record<string, unknown> = {};
const client = await connectTestnet();
try {
  r.add("observe", "精算: お店が受け付けた券", "-", `${claims.claims.length} 枚（${claims.claims.map((c) => `番号 ${c.offerSequence}・${c.value}`).join(" / ")}）`, "お店の画面で受け付けた時点の確認時間: " + claims.claims.map((c) => `${c.verifyMs} ms`).join(", "));
  const before = (await voucherBalance(client, S.address, issuer)) ?? "（線なし）";
  const batches = [];
  for (let i = 0; i < claims.claims.length; i += BATCH_MAX_INNER) {
    const part = claims.claims.slice(i, i + BATCH_MAX_INNER);
    const inners = part.map((c) => ({ TransactionType: "EscrowFinish", Account: S.address, Owner: c.owner, OfferSequence: c.offerSequence, Condition: sync.list.find((e) => e.index === c.index)!.condition, Fulfillment: c.fulfillmentHex }) as EscrowFinish);
    const fee = batchFeeDrops(inners, await baseFeeDrops(client));
    const out = await submitBatch(client, S, await buildSingleAccountBatch(client, S, BatchFlags.tfIndependent, inners, fee.total));
    const got = out.inner.map((x) => x.result ?? "未記録");
    r.eq(`精算: お店 S が EscrowFinish ${inners.length} 件を Batch（tfIndependent）で送る`, inners.map(() => "tesSUCCESS").join(", "), got.join(", "), `外側 ${out.engineResult ?? out.error}・[${out.hash}](${explorerTxUrl(out.hash)})<br>手数料 ${out.fee} drops（${fee.formula}）`);
    batches.push({ hash: out.hash, fee: out.fee, inner: out.inner });
  }
  const want = claims.claims.reduce((s, c) => s + Number(c.value), 0);
  r.eq("精算: お店 S の受給証残高", `${want}`, (await voucherBalance(client, S.address, issuer)) ?? "（線なし）", `精算前 ${before}。トラストラインはお店自身の Finish で自動で作られる`);
  extra["settle"] = { shop: S.address, batches };
} finally {
  saveResults("settle", r, extra);
  await client.disconnect();
}
