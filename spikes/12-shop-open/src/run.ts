/**
 * 12: 開店の届け・お店の Credential・券を作るお店の選び方（確認 1〜8）。Testnet で実行する（Mac・ネットあり、全体で 8 分ほど）
 *   pnpm --filter 12-shop-open spike
 * 口座: V（VOUCHER_ISSUER_SEED）/ D（DISTRIBUTION_SEED）は 11c と同じ。G・G2・お店 A・B・C・E・X は毎回 Faucet で作る（seed は保存しない）
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { BatchFlags, type Client, type EscrowCreate, type SubmittableTransaction, type Wallet } from "xrpl";
import {
  Abort, Recorder, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, connectTestnet, createFundedWallet, explorerTxUrl,
  loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog, submitBatch, type TxOutcome,
} from "xrpl-kit";
import { LSF_ACCEPTED, credType, fromHex, openMemo, saveResults, validatedCloseTime } from "./common.js";
import { selectShops, type SelectOutput } from "./select.js";

const HERE = fileURLToPath(import.meta.url);
loadEnvLocal(HERE);
const r = new Recorder("12");
const extra: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const WINDOW = 600, B_EXPIRES_IN = 180, GAP = 180;
const step = async (client: Client, item: string, tx: SubmittableTransaction, w: Wallet, expect = "tesSUCCESS", note = ""): Promise<TxOutcome> => { const o = await submitAndLog(client, item, tx, w); r.tx(item, o, expect, note); return o; };
const waitUntil = async (client: Client, t: number) => { const until = Date.now() + 600_000; while ((await validatedCloseTime(client)) <= t && Date.now() < until) await sleep(4000); };

const client = await connectTestnet();
try {
  const si = await client.request({ command: "server_info" });
  r.add("observe", "準備: Testnet", "-", `rippled ${si.result.info.build_version}`, "server_info");
  const V = (await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE)).wallet;
  const D = (await loadOrCreatePersistentWallet(client, "DISTRIBUTION_SEED", "distribution D", HERE)).wallet;
  const names = ["G", "G2", "A", "B", "C", "E", "X"] as const;
  const W = {} as Record<(typeof names)[number], Wallet>;
  for (const n of names) W[n] = (await createFundedWallet(client, n)).wallet;
  const { G, G2, A, B, C, E, X } = W;
  const label = new Map(names.map((n) => [W[n].address, n]));
  const nameOf = (a: string) => label.get(a) ?? a;
  r.add("observe", "準備: 口座（Faucet）", "-", names.map((n) => `${n}=${W[n].address}`).join("<br>"), "G = 自治体（模擬）、G2 = 第三者、A・B・C = 地区13、E = 地区14、X = Credential を G から受けていない");
  extra["accounts"] = Object.fromEntries(names.map((n) => [n, W[n].address]));

  // ── 確認 1: G が Credential を出し、A・B・E が受け取る（C は受け取らない）─────────
  const z13 = credType("z13"), z14 = credType("z14");
  r.add("observe", "確認1: CredentialType", "64 バイト以内", `todoke:shop:z13 → ${z13}（${z13.length / 2} B）`, "rippled Protocol.h kMaxCredentialTypeLength = 64");
  const now1 = await validatedCloseTime(client);
  const bExp = now1 + B_EXPIRES_IN;
  for (const [s, t, exp] of [[A, z13], [B, z13, bExp], [C, z13], [E, z14]] as const) {
    await step(client, `確認1: G → ${nameOf(s.address)} CredentialCreate（${fromHex(t)}${exp ? `、Expiration ${B_EXPIRES_IN} 秒後` : ""}）`, { TransactionType: "CredentialCreate", Account: G.address, Subject: s.address, CredentialType: t, ...(exp ? { Expiration: exp } : {}) }, G);
  }
  for (const [s, t] of [[A, z13], [B, z13], [E, z14]] as const) await step(client, `確認1: ${nameOf(s.address)} が CredentialAccept`, { TransactionType: "CredentialAccept", Account: s.address, Issuer: G.address, CredentialType: t }, s);
  const gObjs = (await client.request({ command: "account_objects", account: G.address, type: "credential", ledger_index: "validated" })).result.account_objects as unknown as { Subject: string; Flags: number; Expiration?: number; CredentialType: string }[];
  for (const s of [A, B, C, E]) {
    const c = gObjs.find((o) => o.Subject === s.address);
    const accepted = c ? (c.Flags & LSF_ACCEPTED) !== 0 : undefined;
    const want = s === C ? false : true;
    r.add(accepted === want ? "pass" : "fail", `確認1: ${nameOf(s.address)} の Credential（G の account_objects）`, `lsfAccepted=${want}`, c ? `Flags=0x${c.Flags.toString(16)}（lsfAccepted=${accepted}）/ Expiration=${c.Expiration ?? "なし"} / ${fromHex(c.CredentialType)}` : "見つからない", "lsfAccepted = 0x00010000（rippled LedgerFormats.h）。未受け取りでも発行者とお店の両方の owner directory に入る");
  }

  // ── 確認 2: G2 → X ──────────────────────────
  await step(client, "確認2: G2 → X CredentialCreate（todoke:shop:z13）", { TransactionType: "CredentialCreate", Account: G2.address, Subject: X.address, CredentialType: z13 }, G2);
  await step(client, "確認2: X が CredentialAccept（発行者 G2）", { TransactionType: "CredentialAccept", Account: X.address, Issuer: G2.address, CredentialType: z13 }, X);

  // ── 確認 3: 開店の届け（設定を変えない AccountSet + Memo）──────────────
  const STATIC = ["Balance", "Sequence", "PreviousTxnID", "PreviousTxnLgrSeq", "OwnerCount", "index"];
  const snapshot = async (a: string) => { const d = (await client.request({ command: "account_info", account: a, ledger_index: "validated" })).result.account_data as unknown as Record<string, unknown>; return JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !STATIC.includes(k)).sort())); };
  const notice = async (s: Wallet, district: string, item: string) => {
    const before = await snapshot(s.address);
    const o = await step(client, item, { TransactionType: "AccountSet", Account: s.address, Memos: openMemo(district, await validatedCloseTime(client)) }, s);
    const after = await snapshot(s.address);
    r.add(before === after ? "pass" : "fail", `${item}: 設定が変わっていない`, "account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ", before === after ? "同じ" : `違う<br>前 ${before}<br>後 ${after}`, "account_info");
    return o;
  };
  const firstA = await notice(A, "z13", "確認3: A が開店の届け（AccountSet・設定なし・Memo todoke/open）");
  if (firstA.engineResult !== "tesSUCCESS") {
    // 依頼どおり、止めて記録し、代わりに D 宛て 1 drop の Payment + Memo を試す（以降の確認は行わない）
    await step(client, "確認3（代わり）: A → D 1 drop の Payment + Memo todoke/open", { TransactionType: "Payment", Account: A.address, Destination: D.address, Amount: "1", Memos: openMemo("z13", await validatedCloseTime(client)) }, A);
    throw new Abort("AccountSet で届けを送れなかったので、確認 4 以降は行わない");
  }
  for (const [s, d] of [[B, "z13"], [C, "z13"], [E, "z14"], [X, "z13"]] as const) await notice(s, d, `確認3: ${nameOf(s.address)} が開店の届け`);

  // ── 確認 4: A の 2 回目の届け（数分あけて）─────────────────
  const t1 = await validatedCloseTime(client);
  console.log(`[12] A の 2 回目の届けまで ${GAP} 秒待つ`);
  await waitUntil(client, t1 + GAP);
  const secondA = await notice(A, "z13", "確認4: A が 2 回目の開店の届け");

  // ── 確認 5: 選ぶ（B の Expiration を過ぎてから）──────────────
  await waitUntil(client, bExp + 2);
  const check = [A, B, C, E, X].map((w) => w.address);
  const expectReason: Record<string, string> = { B: "c:", C: "b:", E: "a:", X: "a:" };
  const judge = (item: string, out: SelectOutput, wantSelected: string[], reasons: Record<string, string>) => {
    r.eq(`${item}: 選ばれたお店`, wantSelected.join("・") || "なし", out.selected.map((s) => nameOf(s.shop)).join("・") || "なし", `close_time ${out.closeTime} / 有効時間 ${WINDOW} 秒 / 呼び出し account_objects ${out.stats.account_objects}・account_tx ${out.stats.account_tx}・${out.stats.bytes} B・${out.stats.ms} ms`);
    for (const [n, prefix] of Object.entries(reasons)) {
      const ex = out.excluded.find((x) => nameOf(x.shop) === n);
      const ok = !!ex && ex.reasons.some((x) => x.startsWith(prefix));
      r.add(ok ? "pass" : "fail", `${item}: ${n} が外れた理由`, `${prefix} で外れる`, ex ? ex.reasons.join("<br>") : "外れていない", "select.ts");
    }
  };
  const sel5 = await selectShops(client, { district: "z13", issuer: G.address, windowSec: WINDOW, check });
  judge("確認5", sel5, ["A"], expectReason);
  const latest = sel5.selected.find((s) => s.shop === A.address);
  r.eq("確認4: 選ぶときに A の最新の届けを取れる", secondA.hash, latest?.lastNoticeTx ?? "（なし）", `1 回目 ${firstA.hash.slice(0, 16)}… / 2 回目 ${secondA.hash.slice(0, 16)}…（account_tx を新しい順に読む）`);
  extra["select5"] = sel5;

  // ── 確認 6: A の Credential を取り消す → 外れる → 出し直す ────────────
  await step(client, "確認6: G が A の Credential を CredentialDelete", { TransactionType: "CredentialDelete", Account: G.address, Subject: A.address, CredentialType: z13 }, G);
  const sel6 = await selectShops(client, { district: "z13", issuer: G.address, windowSec: WINDOW, check });
  judge("確認6（取り消し後）", sel6, [], { A: "a:" });
  await step(client, "確認6: G が A に Credential を出し直す", { TransactionType: "CredentialCreate", Account: G.address, Subject: A.address, CredentialType: z13 }, G);
  await step(client, "確認6: A が受け取る", { TransactionType: "CredentialAccept", Account: A.address, Issuer: G.address, CredentialType: z13 }, A);
  await notice(A, "z13", "確認6: A が届けを出し直す");
  const sel6b = await selectShops(client, { district: "z13", issuer: G.address, windowSec: WINDOW, check });
  judge("確認6（出し直し後）", sel6b, ["A"], expectReason);
  extra["select6"] = { afterDelete: sel6, afterRestore: sel6b };

  // ── 確認 7: 選ばれたお店にだけ券を作る ───────────────────
  const now7 = await validatedCloseTime(client);
  const targets = sel6b.selected.map((s) => s.shop);
  const inners: SubmittableTransaction[] = targets.flatMap((shop) => ["5", "10"].map((value) => {
    // 世帯の Condition の代わりに乱数の preimage から作る（券の作り方を確かめるだけ。preimage は保存しない）
    const cond = `A0258020${createHash("sha256").update(randomBytes(32)).digest("hex")}810120`.toUpperCase();
    return { TransactionType: "EscrowCreate", Account: D.address, Destination: shop, Amount: { currency: "ZKV", issuer: V.address, value }, Condition: cond, CancelAfter: now7 + 900 } as EscrowCreate;
  }));
  if (inners.length) {
    const fee = batchFeeDrops(inners, await baseFeeDrops(client));
    const out = await submitBatch(client, D, await buildSingleAccountBatch(client, D, BatchFlags.tfAllOrNothing, inners, fee.total));
    const ok = out.engineResult === "tesSUCCESS" && out.inner.every((i) => i.result === "tesSUCCESS");
    r.add(ok ? "pass" : "fail", `確認7: D が選ばれたお店（${targets.map(nameOf).join("・")}）宛ての券 ${inners.length} 枚を Batch で作る`, "外側・内側すべて tesSUCCESS", `外側 ${out.engineResult ?? out.error} / 内側 [${out.inner.map((i) => i.result ?? "未記録").join(", ")}]`, `[${out.hash}](${explorerTxUrl(out.hash)})。CancelAfter 15 分（D が後で回収できる）`);
  }
  for (const s of [A, B, C, E, X]) {
    const esc = (await client.request({ command: "account_objects", account: s.address, type: "escrow", ledger_index: "validated" })).result.account_objects as unknown as { Account: string; Destination: string }[];
    const n = esc.filter((e) => e.Account === D.address && e.Destination === s.address).length;
    const want = targets.includes(s.address) ? 2 : 0;
    r.eq(`確認7: ${nameOf(s.address)} 宛ての券の枚数`, `${want}`, `${n}`, "account_objects（type: escrow）");
  }

  // ── 確認 8: 鍵も .env.local も使わずに、公開の Testnet サーバーだけで選ぶ ────────
  const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" }; // 秘密を含む環境変数は渡さない
  const outPath = "results/select-public.json";
  const child = spawnSync("npx", ["tsx", "src/select-shops.ts", "--district", "z13", "--issuer", G.address, "--window", String(WINDOW), "--check", check.join(","), "--out", outPath], { cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8" });
  if (child.status !== 0) {
    r.add("fail", "確認8: 公開サーバーだけで select-shops を実行", "終了コード 0", `終了コード ${child.status}<br>${(child.stderr ?? "").slice(0, 300)}`, "spawnSync");
  } else {
    const pub = JSON.parse(child.stdout) as SelectOutput & { server: string };
    const norm = (o: SelectOutput) => JSON.stringify({ s: o.selected.map((x) => x.shop).sort(), e: o.excluded.map((x) => [x.shop, x.reasons.map((y) => y.slice(0, 2))]).sort() });
    r.eq("確認8: 鍵・.env.local なしで、確認6（出し直し後）と同じ判定になる", "同じ", norm(sel6b) === norm(pub) ? "同じ" : "違う",
      `接続先 ${pub.server}。環境変数は PATH・HOME だけ。選ばれた ${pub.selected.map((x) => nameOf(x.shop)).join("・") || "なし"}（close_time ${pub.closeTime}）。results/select-public.json`);
  }
} catch (e) {
  if (!(e instanceof Abort)) throw e;
  r.unknowns.push(`中断: ${e.message}`);
} finally {
  saveResults("run", r, extra);
  await client.disconnect();
}
