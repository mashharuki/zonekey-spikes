/**
 * 発券ワーカー（別プロセスとして起動される）。
 *   node --import tsx src/worker.ts <dbPath> apply <appFile>   申請を受け付けて、確定まで進める
 *   node --import tsx src/worker.ts <dbPath> recover           送信待ち・照会待ちの仕事をすべて進める（再起動後の復旧）
 * 環境変数: FAULT（障害の注入位置。SIGKILL）/ STOP_AFTER_PREPARE=1 / LLS_OFFSET
 * 結果は標準出力の `RESULT {...}` の 1 行。seed は .env.local から読み、出力しない。
 */
import { readFileSync } from "node:fs";
import { Wallet } from "xrpl";
import { connectTestnet, loadEnvLocal } from "xrpl-kit";
import { Zk } from "../../13-zk-bound-voucher/src/zk.js";
import { HERE, type AppFile, proofOf, programsOf, readWorld, reqFromJson } from "./common.js";
import { Service } from "./service.js";

loadEnvLocal(HERE);
const [dbPath, cmd, file] = process.argv.slice(2) as [string, string, string | undefined];
const client = await connectTestnet();
const w = readWorld();
const { programs, roots } = programsOf(w);
const zk = cmd === "apply" ? new Zk() : undefined;
await zk?.init();
const svc = new Service({ dbPath, client, wallet: Wallet.fromSeed(process.env["DISTRIBUTION_SEED"]!), programs, approvedRoots: roots, ...(zk ? { zk } : {}), stopAfterPrepare: process.env["STOP_AFTER_PREPARE"] === "1" });
let result: unknown;
if (cmd === "apply") {
  const a = JSON.parse(readFileSync(file!, "utf8")) as AppFile;
  result = await svc.apply(reqFromJson(a.req), proofOf(a));
} else result = await svc.recoverAll();
console.log(`RESULT ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
await zk?.close();
await client.disconnect();
