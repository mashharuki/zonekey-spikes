/**
 * 11a 台帳側: 確認 1〜6 と 8（Privy を使わない部分）。Testnet で実行する（Mac・ネットあり）
 *   pnpm --filter 11a-check-settle ledger
 * 口座: S = 精算口座（SETTLEMENT_SEED、.env.local に保存）/ V = 受給証の発行者（spike 04 の VOUCHER_ISSUER_SEED）
 *       H1・H3〜H10 = 世帯、T = 第三者（毎回新しく作り、S から XRP を送る。seed は保存しない）
 * 確認 6 の世帯は H1・H2 ではなく H3〜H10 の 8 件にした（H1 の残高は確認 4 で 0 にするため。H2 は Privy の署名が要るので確認 7 で扱う）
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { BatchFlags, Wallet, xrpToDrops, type CheckCash, type Client, type SubmittableTransaction } from "xrpl";
import {
  Abort, Recorder, RLUSD_CURRENCY, RLUSD_TESTNET_ISSUER, baseFeeDrops, batchFeeDrops, buildSingleAccountBatch, configureEscrowableIssuer,
  connectTestnet, explorerTxUrl, getRlusdLine, loadEnvLocal, loadOrCreatePersistentWallet, submitAndLog, submitBatch, walletFromEnv, type TxOutcome,
} from "xrpl-kit";
import { VOUCHER, checkEntry, createdCheckId, ownerCount, saveResults, txMeta, validatedCloseTime, voucherBalance, zkv } from "./common.js";

const HERE = fileURLToPath(import.meta.url);
loadEnvLocal(HERE);
const r = new Recorder("11a");
const extra: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const link = (h: string) => `[${h}](${explorerTxUrl(h)})`;

/** 1 件送って、期待するコードと比べて記録する */
async function step(client: Client, item: string, tx: SubmittableTransaction, w: Wallet, expect = "tesSUCCESS", note = ""): Promise<TxOutcome> {
  const o = await submitAndLog(client, item, tx, w);
  r.tx(item, o, expect, note);
  return o;
}

const client = await connectTestnet();
try {
  // ── 準備 ─────────────────────────────────────────────
  const si = await client.request({ command: "server_info" });
  const vl = si.result.info.validated_ledger;
  r.add("observe", "準備: Testnet", "-", `rippled ${si.result.info.build_version} / 準備金 ${vl?.reserve_base_xrp} XRP + ${vl?.reserve_inc_xrp} XRP/件 / 基本手数料 ${vl?.base_fee_xrp} XRP`, "server_info");

  const S = (await loadOrCreatePersistentWallet(client, "SETTLEMENT_SEED", "settlement S", HERE)).wallet;
  const Vp = await loadOrCreatePersistentWallet(client, "VOUCHER_ISSUER_SEED", "voucher issuer V", HERE);
  const V = Vp.wallet;
  const vInfo = await client.request({ command: "account_info", account: V.address, ledger_index: "validated" });
  if ((vInfo.result.account_data.Flags & 0x00800000) === 0) {
    for (const o of await configureEscrowableIssuer(client, V)) r.tx("準備: V の AccountSet（DefaultRipple → AllowTrustLineLocking）", o, "tesSUCCESS");
  }
  if ((await voucherBalance(client, S.address, V.address)) === undefined) await step(client, "準備: S の受給証トラストライン", { TransactionType: "TrustSet", Account: S.address, LimitAmount: zkv(V.address, "1000000") }, S);

  // 世帯と第三者を作る（S から 2 XRP ずつ。準備金 1 XRP + トラストライン 0.2 + Check 0.2 + 手数料）
  const H1 = Wallet.generate(), T = Wallet.generate();
  const HB = Array.from({ length: 8 }, () => Wallet.generate()); // 確認 6 の H3〜H10
  const all = [H1, T, ...HB];
  for (const w of all) {
    const o = await submitAndLog(client, `準備: S → ${w.address} 2 XRP`, { TransactionType: "Payment", Account: S.address, Destination: w.address, Amount: xrpToDrops("2") }, S);
    if (o.engineResult !== "tesSUCCESS") { r.tx("準備: 世帯の口座を作る（S から 2 XRP）", o, "tesSUCCESS"); throw new Abort("世帯の口座を作れない"); }
  }
  const trusts = await Promise.all(all.map((w) => submitAndLog(client, `準備: ${w.address} TrustSet`, { TransactionType: "TrustSet", Account: w.address, LimitAmount: zkv(V.address, "1000") }, w)));
  if (trusts.some((o) => o.engineResult !== "tesSUCCESS")) { trusts.forEach((o) => r.tx("準備: 世帯の受給証トラストライン", o, "tesSUCCESS")); throw new Abort("トラストラインを張れない"); }
  for (const [w, v] of [[H1, "1"], ...HB.map((w) => [w, "0.2"] as const)] as const) {
    const o = await submitAndLog(client, `準備: V → ${w.address} 受給証 ${v}`, { TransactionType: "Payment", Account: V.address, Destination: w.address, Amount: zkv(V.address, v) }, V);
    if (o.engineResult !== "tesSUCCESS") { r.tx("準備: 受給証を配る", o, "tesSUCCESS"); throw new Abort("受給証を配れない"); }
  }
  r.add("observe", "準備: 口座", "-", `S=${S.address}<br>V=${V.address}<br>H1=${H1.address}（受給証 1.0）<br>T（第三者）=${T.address}<br>H3〜H10=${HB.map((w) => w.address).join(", ")}（受給証 0.2 ずつ）`,
    "世帯の受給証は V から直接配った（本番は Escrow の払い出し）。S・V の seed は .env.local");
  extra["accounts"] = { S: S.address, V: V.address, H1: H1.address, T: T.address, H3_H10: HB.map((w) => w.address) };

  const now = async () => validatedCloseTime(client);
  const create = async (item: string, from: Wallet, sendMax: string, expiresIn: number, more: Partial<SubmittableTransaction> = {}) => {
    const o = await step(client, item, { TransactionType: "CheckCreate", Account: from.address, Destination: S.address, SendMax: zkv(V.address, sendMax), Expiration: (await now()) + expiresIn, ...more } as SubmittableTransaction, from);
    return { o, id: o.engineResult === "tesSUCCESS" ? createdCheckId(await txMeta(client, o.hash)) : undefined };
  };
  const cash = (item: string, id: string, f: { Amount?: string; DeliverMin?: string }, expect: string, note = "") =>
    step(client, item, { TransactionType: "CheckCash", Account: S.address, CheckID: id, ...(f.Amount ? { Amount: zkv(V.address, f.Amount) } : {}), ...(f.DeliverMin ? { DeliverMin: zkv(V.address, f.DeliverMin) } : {}) } as CheckCash, S, expect, note);
  const bal = async (w: { address: string }) => (await voucherBalance(client, w.address, V.address)) ?? "（線なし）";

  // ── 確認 1: CheckCreate（上限 0.5・30 分・InvoiceID）──────────
  // 伝票用のテスト鍵（ECDSA P-256）。公開鍵の生バイト（非圧縮 65 バイト）の SHA-256 を InvoiceID にする。秘密鍵は出力しない
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const invoiceId = createHash("sha256").update(pubRaw).digest("hex").toUpperCase();
  const oc0 = await ownerCount(client, H1.address);
  const c1 = await create("確認1: H1 → S CheckCreate（SendMax 受給証 0.5、Expiration 30 分、InvoiceID）", H1, "0.5", 1800, { InvoiceID: invoiceId });
  if (!c1.id) throw new Abort("確認1 の Check を作れない。以降は実施しない");
  const objs = await client.request({ command: "account_objects", account: H1.address, type: "check", ledger_index: "validated" });
  const obj = objs.result.account_objects.find((o) => (o as { index: string }).index === c1.id) as Record<string, unknown> | undefined;
  r.eq("確認1: 台帳の Check に InvoiceID が残る（account_objects）", invoiceId, String(obj?.["InvoiceID"] ?? "（なし）"), `CheckID=${c1.id}<br>伝票の公開鍵（P-256 非圧縮 65 B）=${pubRaw.toString("hex").slice(0, 20)}…`);
  const oc1 = await ownerCount(client, H1.address);
  r.add(oc1 === oc0 + 1 ? "pass" : "fail", "確認1: H1 の OwnerCount", "1 増える", `${oc0} → ${oc1}`, "account_info");
  extra["check1"] = { CheckID: c1.id, SendMax: "0.5", Expiration: obj?.["Expiration"], InvoiceID: invoiceId, slipPublicKeyHex: pubRaw.toString("hex"), currency: VOUCHER, issuer: V.address, destination: S.address, account: H1.address };

  // ── 確認 2: 0.2 で換金 → Check は消える → 同じ CheckID で再換金 ───────
  const b0 = { h1: await bal(H1), s: await bal(S) };
  await cash("確認2: S が CheckCash（Amount 0.2）", c1.id, { Amount: "0.2" }, "tesSUCCESS");
  const gone = !(await checkEntry(client, c1.id));
  r.add(gone ? "pass" : "fail", "確認2: 上限 0.5 のうち 0.2 だけ換金したあと、Check は台帳から消えるか", "消える（rippled CheckCash.cpp: 成功したら額にかかわらず erase）", gone ? "消えた（残りの 0.3 も引けなくなる）" : "残っている", "ledger_entry / account_objects");
  r.add("observe", "確認2: 受給証の残高", "H1 −0.2 / S +0.2", `H1 ${b0.h1} → ${await bal(H1)}<br>S ${b0.s} → ${await bal(S)}`, "account_lines");
  await cash("確認2: 同じ CheckID でもう一度 CheckCash", c1.id, { Amount: "0.1" }, "tecNO_ENTRY");

  // ── 確認 3: 上限を超える額で換金 ─────────────────────────
  const c3 = await create("確認3 準備: 新しい Check（SendMax 0.3）", H1, "0.3", 1800);
  if (c3.id) {
    await cash("確認3: Amount 0.4 で CheckCash（上限 0.3 を超える）", c3.id, { Amount: "0.4" }, "tecPATH_PARTIAL", "期待は rippled 3.4.1 CheckCash.cpp（value > sendMax）による");
    r.add("observe", "確認3: 失敗後も Check は残るか", "残る（xrpl.org: 換金に失敗したら Check は残る）", (await checkEntry(client, c3.id)) ? "残っている" : "消えた", "ledger_entry");
  }

  // ── 確認 4: 資金を移されたら ──────────────────────────────
  const c4 = await create("確認4 準備: 新しい Check（SendMax 0.5）", H1, "0.5", 1800);
  if (c4.id) {
    const before = await bal(H1);
    const move = (Number(before) - 0.1).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    await step(client, `確認4 準備: H1 が受給証 ${move} を T へ移す（残高を 0.1 に）`, { TransactionType: "Payment", Account: H1.address, Destination: T.address, Amount: zkv(V.address, move) }, H1);
    r.add("observe", "確認4: H1 の受給証残高", "0.1", `${before} → ${await bal(H1)}`, "account_lines");
    await cash("確認4: Amount 0.3 で CheckCash（H1 の残高 0.1）", c4.id, { Amount: "0.3" }, "tecPATH_PARTIAL", "期待は rippled CheckCash.cpp（value > 送り手の残高）による");
    r.add("observe", "確認4: 失敗後も Check は残るか", "残る", (await checkEntry(client, c4.id)) ? "残っている（期限まで再試行できる）" : "消えた", "ledger_entry");
    const o = await cash("確認4: DeliverMin 0.05 で CheckCash", c4.id, { DeliverMin: "0.05" }, "tesSUCCESS");
    const m = await txMeta(client, o.hash);
    const delivered = m?.["delivered_amount"] ?? m?.["DeliveredAmount"];
    r.add("observe", "確認4: 届いた額（delivered_amount）", "送り手の残高ぶん（0.1）", JSON.stringify(delivered), `${link(o.hash)}。H1 の残高 ${await bal(H1)}、Check は ${(await checkEntry(client, c4.id)) ? "残っている" : "消えた"}`);
  }

  // ── 確認 5: 期限切れ ─────────────────────────────────────
  const c5 = await create("確認5 準備: Check（Expiration 90 秒後）", H1, "0.1", 90);
  if (c5.id) {
    const exp = Number((await checkEntry(client, c5.id))?.["Expiration"]);
    const until = Date.now() + 240_000;
    while ((await now()) <= exp + 5 && Date.now() < until) await sleep(3000);
    r.add("observe", "確認5: 期限が過ぎるまで待つ", "-", `Expiration=${exp} / 検証済みレジャーの close_time=${await now()}`, "ledger");
    await cash("確認5: 期限後に S が CheckCash", c5.id, { Amount: "0.05" }, "tecEXPIRED");
    await step(client, "確認5: 無関係の第三者 T が CheckCancel", { TransactionType: "CheckCancel", Account: T.address, CheckID: c5.id }, T);
    r.add("observe", "確認5: 取消後の Check", "消える", (await checkEntry(client, c5.id)) ? "残っている" : "消えた", "ledger_entry");
  }

  // ── 確認 6: CheckCash 8 件を Batch（tfIndependent）で ─────────────
  const created = await Promise.all(HB.map(async (w, i) => {
    const o = await submitAndLog(client, `確認6 準備: H${i + 3} → S CheckCreate 0.1`, { TransactionType: "CheckCreate", Account: w.address, Destination: S.address, SendMax: zkv(V.address, "0.1"), Expiration: (await now()) + 1800 }, w);
    return { w, o, id: o.engineResult === "tesSUCCESS" ? createdCheckId(await txMeta(client, o.hash)) : undefined };
  }));
  created.forEach((c, i) => r.tx(`確認6 準備: H${i + 3} → S CheckCreate（SendMax 0.1）`, c.o, "tesSUCCESS"));
  if (created.every((c) => c.id)) {
    const drained = created[2]!; // H5 の資金を先に抜く
    await step(client, "確認6 準備: H5 が受給証 0.2 を T へ移す（5 件目の Check を引けなくする）", { TransactionType: "Payment", Account: drained.w.address, Destination: T.address, Amount: zkv(V.address, "0.2") }, drained.w);
    const inners: SubmittableTransaction[] = created.map((c) => ({ TransactionType: "CheckCash", Account: S.address, CheckID: c.id!, Amount: zkv(V.address, "0.1") }));
    const base = await baseFeeDrops(client);
    const fee = batchFeeDrops(inners, base);
    const sBefore = await bal(S);
    const built = await buildSingleAccountBatch(client, S, BatchFlags.tfIndependent, inners, fee.total);
    const out = await submitBatch(client, S, built);
    extra["batch"] = out;
    r.add(out.engineResult === "tesSUCCESS" ? "pass" : "fail", "確認6: S が CheckCash 8 件を Batch（tfIndependent）で送る: 外側", "tesSUCCESS",
      `${out.engineResult ?? out.preliminary}${out.error ? ` / ${out.error}` : ""} / Fee=${out.fee} drops（計算式 ${fee.formula}）/ XRP 残高差=${out.balanceDeltaDrops ?? "-"} drops`, link(out.hash));
    if (!out.validated) { r.errorCodes.push(`確認6 Batch: ${out.preliminary} ${out.error ?? ""}`); throw new Abort("確認6: Batch が台帳に入らなかった（CheckCash を内側に入れられない可能性）。ここで止める"); }
    const ok = out.inner.filter((x) => x.result === "tesSUCCESS").length;
    const ng = out.inner.filter((x) => x.result !== "tesSUCCESS");
    for (const x of out.inner) r.add("observe", `確認6: 内側 #${x.index}（H${x.index + 2}）`, x.index === 3 ? "失敗（資金を抜いた）" : "tesSUCCESS", x.result ?? "台帳に記録なし", `${link(x.hash)}（ParentBatchID: ${x.parentBatchId}）`);
    for (const x of ng) if (x.result) r.errorCodes.push(`確認6 内側 #${x.index}: ${x.result}`);
    r.add(ok === 7 && ng.length === 1 && ng[0]!.index === 3 ? "pass" : "fail", "確認6: 内側の結果", "7 件成功・1 件（#3 = H5）失敗", `成功 ${ok} 件 / 失敗 ${ng.map((x) => `#${x.index} ${x.result ?? "記録なし"}`).join(", ") || "なし"}`, `S の受給証 ${sBefore} → ${await bal(S)}`);
  }

  // ── 確認 8（任意）: RLUSD の Check ─────────────────────────────
  const donor = walletFromEnv("DONOR_SEED");
  const line = donor ? await getRlusdLine(client, donor.address) : undefined;
  const amt = "0.01";
  if (!donor || !line?.exists || Number(line.balance) < Number(amt)) {
    r.add("observe", "確認8: RLUSD の Check", "（任意）", `未実施: ${!donor ? "DONOR_SEED がない" : `DONOR の RLUSD 残高が ${amt} 未満（${line?.balance ?? "線なし"}）`}`, "spike 02 の DONOR");
    r.unknowns.push("確認8（RLUSD の Check）は未実施");
  } else {
    const sLine0 = await getRlusdLine(client, S.address);
    const rl = { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: amt };
    const o = await step(client, `確認8: DONOR → S RLUSD の CheckCreate（SendMax ${amt}）`, { TransactionType: "CheckCreate", Account: donor.address, Destination: S.address, SendMax: rl, Expiration: (await now()) + 1800 }, donor,
      "tesSUCCESS", `DONOR=${donor.address}（H1 は RLUSD を持たないため spike 02 の DONOR から送った）`);
    const id = o.engineResult === "tesSUCCESS" ? createdCheckId(await txMeta(client, o.hash)) : undefined;
    if (id) {
      const oc = await submitAndLog(client, "確認8: S が RLUSD の CheckCash", { TransactionType: "CheckCash", Account: S.address, CheckID: id, Amount: rl }, S);
      const code = oc.engineResult ?? oc.error ?? "-";
      if (code !== "tesSUCCESS") r.errorCodes.push(`確認8 CheckCash: ${code}`);
      const sLine1 = await getRlusdLine(client, S.address);
      r.add(code === "tesSUCCESS" ? "pass" : "fail", `確認8: S が RLUSD の CheckCash（換金前の S の RLUSD トラストライン: ${sLine0.exists ? "あり" : "なし"}）`,
        "tesSUCCESS（Escrow と違い lsfAllowTrustLineLocking は不要。トラストラインが無ければ CheckCash が作る: rippled CheckCash.cpp）",
        `${code} / 換金後の S の RLUSD: ${sLine1.exists ? `あり（残高 ${sLine1.balance}）` : "線なし"}`, link(oc.hash));
    }
  }
} catch (e) {
  r.add("fail", "実行", "最後まで完了", e instanceof Error ? e.message : String(e), "ログ参照");
  r.unknowns.push(`中断: ${e instanceof Error ? e.message : String(e)}（以降は未検証）`);
} finally {
  saveResults("ledger", r, extra);
  await client.disconnect();
}
