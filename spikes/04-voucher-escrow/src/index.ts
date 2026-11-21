import { fileURLToPath } from "node:url";
import { connectTestnet, loadEnvLocal, writeReport, type Verdict } from "xrpl-kit";
import { Abort, Recorder } from "./runner.js";
import { runScenario } from "./scenario.js";

const HERE = fileURLToPath(import.meta.url);
const REPORT_PATH = process.env["SPIKE_REPORT_PATH"] ?? fileURLToPath(new URL("../REPORT.md", import.meta.url));
loadEnvLocal(HERE);

const r = new Recorder();
let aborted: string | undefined;
try {
  const client = await connectTestnet();
  try {
    await runScenario(client, r, HERE);
  } finally {
    await client.disconnect();
  }
} catch (e) {
  aborted = e instanceof Error ? e.message : String(e);
  console.error(`[04] ${e instanceof Abort ? "ABORT" : "ERROR"}: ${aborted}`);
  r.add("fail", "実行全体", "最後まで完了", aborted, "コンソールログ参照");
  r.unknowns.push("中断した段階より後は未検証");
}

const fails = r.statuses.filter((s) => s === "fail").length;
const passes = r.statuses.filter((s) => s === "pass").length;
const verdict: Verdict = fails === 0 && passes > 0 ? "合格" : passes > 0 ? "一部合格" : "不合格";
if (verdict === "合格") {
  r.impacts.push(
    "RLUSD 発行者のフラグに依存せず、RLUSD 裏付けの受給証（自前発行・lsfAllowTrustLineLocking あり）でネイティブ Escrow の条件付き支給・期限切れ返還ができ、DEX の常設オファーで RLUSD と 1:1 に交換できた。06_技術設計の Escrow 資産を「RLUSD 直接」から「受給証（RLUSD 1:1 裏付け）」に置き換える案が成立する",
  );
}
r.unknowns.push(
  "発行者 V の運営者は常設オファーを取り消せる（マスターキー無効＋マルチシグでの緩和は未検証）",
  "1 回目の実機検証で作った旧発行者（rEhTGPAG…）には RLUSD 0.3 の準備金と未償還の受給証が残る（11/25 のリセットで消える）",
  "11/25 の Testnet リセットで本検証のアカウント・残高・tx はすべて消える。tx hash の確認はリセット前に行う",
);

writeReport(REPORT_PATH, {
  title: "04-voucher-escrow: RLUSD 裏付けの受給証で Escrow（条件付き・期限切れ返還）と 1:1 償還",
  verdict,
  rows: r.rows,
  errorCodes: r.errorCodes,
  designImpact: r.impacts.length ? r.impacts.map((s) => `- ${s}`).join("\n") : "なし",
  unknowns: r.unknowns,
});
console.log(`[04] verdict=${verdict}（pass=${passes}, fail=${fails}）`);
if (verdict !== "合格") process.exitCode = 1;
