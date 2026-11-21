/**
 * Memos の 1 KB 上限の数え方を実測する（確認2 の追試）。
 * 1 回目の実行で、Memos フィールド全体を直列化して 1,025 バイトでも tesSUCCESS になった。
 * AccountSet（中身なし）に Memo を付け、MemoData を 1 バイトずつ増やして最初に拒否される長さを探す。
 * 拒否（tem/tel）は台帳に入らないので手数料はかからない。受理された分は 12 drops 程度の手数料のみ。
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encode, type Memo } from "xrpl";
import { connectTestnet, createFundedWallet, explorerTxUrl, loadEnvLocal, submitAndLog } from "xrpl-kit";
import { codeOf } from "./encoding.js";

const HERE = fileURLToPath(import.meta.url);
const OUT = fileURLToPath(new URL("../MEMO-LIMIT.md", import.meta.url));
loadEnvLocal(HERE);

/** Memos フィールド全体（フィールド ID と配列終端を含む） */
const fieldBytes = (m: Memo[]) => encode({ Memos: m } as never).length / 2;

const lines = [
  "# Memos の上限の実測（AccountSet + Memo）", "",
  "| MemoData（バイト） | Memos フィールド全体（バイト） | 全体 − 2（フィールド ID と配列終端を除く） | 結果 | tx |",
  "| --- | --- | --- | --- | --- |",
];
const client = await connectTestnet();
let boundary = "見つからず";
try {
  const w = (await createFundedWallet(client, "memo-probe")).wallet;
  for (let n = 1015; n <= 1030; n++) {
    const memos: Memo[] = [{ Memo: { MemoData: randomBytes(n).toString("hex").toUpperCase() } }];
    const size = fieldBytes(memos);
    const o = await submitAndLog(client, `AccountSet memo ${n}B`, { TransactionType: "AccountSet", Account: w.address, Memos: memos }, w);
    const code = codeOf(o);
    lines.push(`| ${n} | ${size} | ${size - 2} | ${code} | ${o.validated ? `[${o.hash.slice(0, 10)}…](${explorerTxUrl(o.hash)})` : "未適用"} |`);
    console.log(`[06-memo] MemoData=${n} field=${size} inner=${size - 2} → ${code}`);
    if (code !== "tesSUCCESS") {
      boundary = `MemoData ${n} バイト（Memos フィールド全体 ${size} / 中身 ${size - 2} バイト）で初めて拒否: ${code}。受理された最大は MemoData ${n - 1} バイト（全体 ${size - 1} / 中身 ${size - 3} バイト）`;
      break;
    }
  }
} finally {
  await client.disconnect();
  lines.push("", `**結果:** ${boundary}`, "");
  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`[06-memo] ${boundary}`);
  console.log(`[06-memo] wrote ${OUT}`);
}
