import { fileURLToPath } from "node:url";
import type { Wallet } from "xrpl";
import { Recorder, connectTestnet, createFundedWallet, loadEnvLocal, writeReport } from "xrpl-kit";
import { runDid } from "./did.js";
import { runOracle, type OracleResult } from "./oracle.js";

const HERE = fileURLToPath(import.meta.url);
const REPORT_PATH = process.env["SPIKE_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));
loadEnvLocal(HERE);

const r = new Recorder("06");
let oracleResult: OracleResult | undefined;
try {
  const client = await connectTestnet();
  try {
    const oracles = {
      o1: (await createFundedWallet(client, "oracle-1")).wallet,
      o2: (await createFundedWallet(client, "oracle-2")).wallet,
      o3: (await createFundedWallet(client, "oracle-3")).wallet,
    };
    let board: Wallet | undefined;
    const getBoard = async () => (board ??= (await createFundedWallet(client, "public-board")).wallet);
    r.add("observe", "アカウント", "-", Object.entries(oracles).map(([k, w]) => `${k}=${w.address}`).join("<br>"), "使い捨て（シードは保存しない）");
    oracleResult = await runOracle(client, r, oracles, getBoard);
    const registry = (await createFundedWallet(client, "did-registry")).wallet;
    await runDid(client, r, registry);
  } finally {
    await client.disconnect();
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[06] 中断: ${msg}`);
  r.add("fail", "実行全体", "最後まで完了", msg, "コンソールログ参照");
  r.unknowns.push("中断した段階より後は未検証");
}

if (oracleResult) {
  r.impacts.push(
    oracleResult.memoWorks
      ? "**分け前の置き場所: OracleSet の Memo。** スコアの書き込みと分け前の公開が 1 つの tx で原子的に起きる。収集側は Oracle エントリーの PreviousTxnID からその tx を引けば台帳だけで集められる。別の取引（Payment）は不要"
      : "**分け前の置き場所: 別の取引（Payment）の Memo。** OracleSet の Memo では配れなかった（確認2）",
    "分け前は 33 バイト（秘密 32 + x 座標 1）。Memo は直列化 1 KB までなので余裕がある",
    "注意: Memo は公開される。分け前を出すのは『ゾーンのスコアが閾値を超えた』と判断したオラクルだけにする（2 つ出た時点で誰でも鍵＝Fulfillment を復元できる。これは EscrowFinish で Fulfillment が公開されるのと同じ扱い）",
    "注意: Oracle エントリーの PreviousTxnID は最新の更新 tx を指す。分け前を出した後にスコアだけ更新すると PreviousTxnID が変わるので、収集は account_tx で Memo 付きの OracleSet を探す方が確実",
    "ゾーン ID は BaseAsset に非標準通貨コード（ASCII 最大 20 バイト）、スコアは QuoteAsset=SCR・Scale=1・AssetPrice=スコア×10 で表す。3 オラクルが同じペアを書けば get_aggregate_price で台帳上の集計が取れる",
  );
}
r.unknowns.push("11/25 の Testnet リセットで本検証の tx は消える");

writeReport(REPORT_PATH, {
  title: "06-oracle-share: OracleSet でスコアと分け前を配り、DIDSet に Merkle ルートを置く",
  verdict: r.verdict(),
  rows: r.rows,
  errorCodes: r.errorCodes,
  designImpact: r.impacts.length ? r.impacts.map((s) => `- ${s}`).join("\n") : "なし",
  unknowns: r.unknowns,
});
console.log(`[06] verdict=${r.verdict()}`);
if (r.verdict() !== "合格") process.exitCode = 1;
