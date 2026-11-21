import {
  AccountSetAsfFlags,
  OfferCreateFlags,
  unixTimeToRippleTime,
  type Client,
  type Wallet,
} from "xrpl";
import {
  RLUSD_CURRENCY,
  RLUSD_TESTNET_ISSUER,
  createFundedWallet,
  createPreimageCondition,
  ensureRlusdTrustLine,
  explorerAccountUrl,
  isSuccess,
  loadOrCreatePersistentWallet,
  submitAndLog,
  walletFromEnv,
} from "xrpl-kit";
import {
  accountFlags,
  accountOffers,
  fmt,
  iou,
  lineBalance,
  obligations,
  units,
  validatedCloseTime,
  waitUntilLedgerTimeAfter,
} from "./ledger.js";
import { Abort, Recorder } from "./runner.js";

/** 受給証の通貨コード（3 文字。XRP 以外の任意の 3 文字が使える） */
export const VOUCHER = "ZKV";
const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;
const LSF_DEFAULT_RIPPLE = 0x00800000;
/** 常設オファーの上限（発行者自身のトークンは残高に関係なく売れる） */
const BOOK_SIZE = "1000000";
const TRUST_LIMIT = "1000000000";

const MINT = "0.3"; // ドナーが RLUSD で買う受給証
const ESC_A = "0.1"; // keeper が完了 → 受益者が償還
const ESC_B = "0.1"; // 期限切れ → 取消 → ドナーへ返還
const ESC_C = "0.05"; // 受取側が自分で完了（トラストライン自動作成の実測）
const CANCEL_B_SEC = 60;

const hex = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

export async function runScenario(client: Client, r: Recorder, seedStartDir: string): Promise<void> {
  const rl = (v: string) => iou(RLUSD_CURRENCY, RLUSD_TESTNET_ISSUER, v);

  // ---------- 0. アカウント ----------
  const donor = walletFromEnv("DONOR_SEED");
  if (!donor) throw new Abort("DONOR_SEED が未設定（先に 02-rlusd-wallet を実行）");
  const donorRl0 = await lineBalance(client, donor.address, RLUSD_TESTNET_ISSUER, RLUSD_CURRENCY);
  r.add(
    units(donorRl0) >= units(MINT) ? "pass" : "fail",
    "ドナーの RLUSD 残高",
    `>= ${MINT}`,
    donorRl0 ?? "トラストラインなし",
    explorerAccountUrl(donor.address),
  );
  if (units(donorRl0) < units(MINT)) throw new Abort("ドナーの RLUSD が足りない（11/25 の Testnet リセット後なら 02 からやり直し）");

  // 発行者は実行ごとに新規作成する（過去の設定・トラストラインが結果に混ざらないように）
  const V = (await createFundedWallet(client, "voucher-issuer(新規)")).wallet;
  const ben = (await loadOrCreatePersistentWallet(client, "BENEFICIARY_SEED", "beneficiary", seedStartDir)).wallet;
  const keeper = (await createFundedWallet(client, "keeper")).wallet;
  const ben2 = (await createFundedWallet(client, "beneficiary2(トラストラインなし)")).wallet;
  const voucher = (v: string) => iou(VOUCHER, V.address, v);
  const vb = (w: Wallet | string) => lineBalance(client, typeof w === "string" ? w : w.address, V.address, VOUCHER);
  const rb = (w: Wallet | string) => lineBalance(client, typeof w === "string" ? w : w.address, RLUSD_TESTNET_ISSUER, RLUSD_CURRENCY);
  r.add("observe", "アカウント", "-", `V(発行者)=${V.address}<br>donor=${donor.address}<br>ben=${ben.address}<br>ben2=${ben2.address}<br>keeper=${keeper.address}`, "シードは .env.local（V, ben）または使い捨て（keeper, ben2）");

  // ---------- 1. 発行者 V の設定（保有者がトラストラインを張る前に行う） ----------
  // 前回の実機検証で、保有者ラインの発行者側に NoRipple が付いていると償還が tecKILLED になった（EXPERIMENT.md）。
  // DefaultRipple を先に立てれば、以後に作られる保有者ラインの発行者側は NoRipple にならない。
  for (const [label, flag] of [
    ["asfDefaultRipple（8）", AccountSetAsfFlags.asfDefaultRipple],
    ["asfAllowTrustLineLocking（17）", AccountSetAsfFlags.asfAllowTrustLineLocking],
  ] as const) {
    const o = await submitAndLog(client, `V AccountSet ${label}`, { TransactionType: "AccountSet", Account: V.address, SetFlag: flag }, V);
    if (!r.tx(`V: AccountSet ${label}`, o, "tesSUCCESS")) throw new Abort(`V の ${label} に失敗`);
  }
  const flags = await accountFlags(client, V.address);
  const lockOn = (flags & LSF_ALLOW_TRUSTLINE_LOCKING) !== 0;
  const rippleOn = (flags & LSF_DEFAULT_RIPPLE) !== 0;
  r.add(lockOn && rippleOn ? "pass" : "fail", "V に lsfDefaultRipple と lsfAllowTrustLineLocking が立つ", "Flags & 0x40800000 = 0x40800000", `Flags=${flags}（${hex(flags)}）`, "account_info（validated）");
  if (!lockOn || !rippleOn) throw new Abort("V のフラグが立たない");

  // V の RLUSD ラインは NoRipple のまま（前回の実験 E1 が不要かどうかを確かめる）
  const tV = await ensureRlusdTrustLine(client, V);
  if (tV && !r.tx("V: RLUSD TrustSet", tV, "tesSUCCESS")) throw new Abort("V の RLUSD トラストライン失敗");

  // ---------- 2. 発行オファー（受給証を売り RLUSD を受け取る, 1:1） ----------
  let offers = await accountOffers(client, V.address);
  const isMint = (o: { takerGets: string; takerPays: string }) => o.takerGets.endsWith(VOUCHER) && o.takerPays.endsWith(RLUSD_CURRENCY);
  const isRedeem = (o: { takerGets: string; takerPays: string }) => o.takerGets.endsWith(RLUSD_CURRENCY) && o.takerPays.endsWith(VOUCHER);
  if (!offers.some(isMint)) {
    const o = await submitAndLog(client, "V mint offer", {
      TransactionType: "OfferCreate", Account: V.address, TakerGets: voucher(BOOK_SIZE), TakerPays: rl(BOOK_SIZE),
    }, V);
    if (!r.tx("V: 発行オファー（受給証→RLUSD 1:1、残高 0 の発行者）", o, "tesSUCCESS")) throw new Abort("発行オファーを置けない");
  }

  // ---------- 3. ドナーが RLUSD で受給証を買う ----------
  const tD = await submitAndLog(client, "donor TrustSet ZKV", {
    TransactionType: "TrustSet", Account: donor.address, LimitAmount: voucher(TRUST_LIMIT),
  }, donor);
  r.tx("donor: 受給証のトラストライン", tD, "tesSUCCESS");
  const vRl0 = await rb(V);
  const donorV0 = await vb(donor);
  const buy = await submitAndLog(client, "donor buys voucher", {
    TransactionType: "OfferCreate", Account: donor.address, TakerGets: rl(MINT), TakerPays: voucher(MINT),
    Flags: OfferCreateFlags.tfImmediateOrCancel,
  }, donor);
  r.tx(`donor: RLUSD ${MINT} で受給証を購入（IoC）`, buy, "tesSUCCESS");
  const [donorRl1, donorV1, vRl1] = [await rb(donor), await vb(donor), await rb(V)];
  r.eq("ドナー RLUSD の減少", MINT, fmt(units(donorRl0) - units(donorRl1)), `${donorRl0} → ${donorRl1}`);
  r.eq("ドナー受給証の増加", MINT, fmt(units(donorV1) - units(donorV0)), `${donorV0 ?? "0"} → ${donorV1}`);
  r.eq("V の RLUSD 準備金の増加", MINT, fmt(units(vRl1) - units(vRl0)), `${vRl0 ?? "0"} → ${vRl1}`);
  if (units(donorV1) - units(donorV0) !== units(MINT)) throw new Abort("受給証の発行が 1:1 にならない");

  // ---------- 4. 償還オファー（RLUSD を売り受給証を受け取る, 1:1, tfPassive） ----------
  offers = await accountOffers(client, V.address);
  if (!offers.some(isRedeem)) {
    const o = await submitAndLog(client, "V redeem offer", {
      TransactionType: "OfferCreate", Account: V.address, TakerGets: rl(BOOK_SIZE), TakerPays: voucher(BOOK_SIZE),
      Flags: OfferCreateFlags.tfPassive,
    }, V);
    r.tx("V: 償還オファー（RLUSD→受給証 1:1、tfPassive）", o, "tesSUCCESS");
  }
  offers = await accountOffers(client, V.address);
  const both = offers.some(isMint) && offers.some(isRedeem);
  r.add(both ? "pass" : "fail", "発行・償還オファーが両方板に残る（自己交差しない）", "両方あり",
    offers.map((o) => `seq=${o.seq} gets=${o.takerGets} pays=${o.takerPays} flags=${hex(o.flags)}`).join("<br>") || "なし",
    "account_offers（validated）");
  if (!offers.some(isRedeem)) throw new Abort("償還オファーが板に無い");

  const reserveCheck = async (label: string, escrowed: bigint) => {
    const [vr, ob] = [await rb(V), await obligations(client, V.address)];
    const holders = [await vb(donor), await vb(ben), await vb(ben2)].reduce((a, b) => a + units(b), 0n);
    r.add(units(vr) === holders + escrowed ? "pass" : "fail", `準備金の一致（${label}）`,
      "V の RLUSD = 保有者の受給証 + Escrow 中の受給証",
      `V RLUSD=${vr}<br>保有者合計=${fmt(holders)} / Escrow 中=${fmt(escrowed)}`,
      `gateway_balances.obligations=${JSON.stringify(ob)}`);
    r.add("observe", `gateway_balances に Escrow 中の受給証が含まれるか（${label}）`, "仕様に記載なし（実測）",
      `obligations.${VOUCHER}=${ob[VOUCHER] ?? "なし"} / 保有者合計=${fmt(holders)} / 保有者+Escrow=${fmt(holders + escrowed)}`,
      "gateway_balances（validated）");
  };
  await reserveCheck("購入直後", 0n);

  // ---------- 5. 受益者のトラストライン ----------
  const tB = await submitAndLog(client, "ben TrustSet ZKV", { TransactionType: "TrustSet", Account: ben.address, LimitAmount: voucher(TRUST_LIMIT) }, ben);
  r.tx("ben: 受給証のトラストライン", tB, "tesSUCCESS");
  {
    const lr = await client.request({ command: "account_lines", account: ben.address, peer: V.address, ledger_index: "validated" });
    const l = lr.result.lines.find((x) => x.currency === VOUCHER);
    r.add(l && !l.no_ripple_peer ? "pass" : "fail", "ben の受給証ラインの発行者側に NoRipple が付かない", "no_ripple_peer = false/なし",
      `no_ripple_peer=${String(l?.no_ripple_peer)} / no_ripple=${String(l?.no_ripple)}`, "account_lines（validated）");
  }
  const tBr = await ensureRlusdTrustLine(client, ben);
  if (tBr) r.tx("ben: RLUSD のトラストライン", tBr, "tesSUCCESS");

  // ---------- 6. Escrow A: 条件付き → keeper が完了 ----------
  const nowR = () => unixTimeToRippleTime(Date.now());
  const condA = createPreimageCondition();
  const cA = await submitAndLog(client, "EscrowCreate A", {
    TransactionType: "EscrowCreate", Account: donor.address, Destination: ben.address, Amount: voucher(ESC_A),
    Condition: condA.conditionHex, CancelAfter: nowR() + 3600,
  }, donor);
  if (!r.tx(`Escrow A 作成（受給証 ${ESC_A}、PREIMAGE-SHA-256、CancelAfter 1 時間）`, cA, "tesSUCCESS")) throw new Abort("受給証の Escrow を作れない");
  await reserveCheck("Escrow A ロック中", units(ESC_A));

  const wrongA = await submitAndLog(client, "EscrowFinish A wrong", {
    TransactionType: "EscrowFinish", Account: keeper.address, Owner: donor.address, OfferSequence: cA.sequence!,
    Condition: condA.conditionHex, Fulfillment: createPreimageCondition().fulfillmentHex,
  }, keeper);
  r.tx("Escrow A: 誤った Fulfillment では完了できない", wrongA, "tecCRYPTOCONDITION_ERROR");

  const benV0 = await vb(ben);
  const fA = await submitAndLog(client, "EscrowFinish A", {
    TransactionType: "EscrowFinish", Account: keeper.address, Owner: donor.address, OfferSequence: cA.sequence!,
    Condition: condA.conditionHex, Fulfillment: condA.fulfillmentHex,
  }, keeper);
  r.tx("Escrow A: 第三者（keeper）が正しい Fulfillment で完了", fA, "tesSUCCESS");
  const benV1 = await vb(ben);
  r.eq("ben の受給証の増加", ESC_A, fmt(units(benV1) - units(benV0)), `${benV0} → ${benV1}`);

  // ---------- 7. 受益者が償還 ----------
  const benRl0 = await rb(ben);
  const red = await submitAndLog(client, "ben redeem", {
    TransactionType: "OfferCreate", Account: ben.address, TakerGets: voucher(ESC_A), TakerPays: rl(ESC_A),
    Flags: OfferCreateFlags.tfImmediateOrCancel,
  }, ben);
  r.tx(`ben: 受給証 ${ESC_A} を RLUSD に償還（IoC）`, red, "tesSUCCESS");
  const [benRl1, benV2] = [await rb(ben), await vb(ben)];
  r.eq("ben の RLUSD 増加（償還額）", ESC_A, fmt(units(benRl1) - units(benRl0)), `${benRl0} → ${benRl1}`);
  r.eq("ben の受給証残高", "0", fmt(units(benV2)), `${benV1} → ${benV2}`);
  await reserveCheck("A 償還後", 0n);

  // ---------- 8. Escrow B: 期限切れ → 取消で返還 ----------
  const condB = createPreimageCondition();
  const cancelB = nowR() + CANCEL_B_SEC;
  const cB = await submitAndLog(client, "EscrowCreate B", {
    TransactionType: "EscrowCreate", Account: donor.address, Destination: ben.address, Amount: voucher(ESC_B),
    Condition: condB.conditionHex, CancelAfter: cancelB,
  }, donor);
  if (r.tx(`Escrow B 作成（CancelAfter ${CANCEL_B_SEC} 秒後）`, cB, "tesSUCCESS")) {
    const early = await submitAndLog(client, "EscrowCancel B early", {
      TransactionType: "EscrowCancel", Account: keeper.address, Owner: donor.address, OfferSequence: cB.sequence!,
    }, keeper);
    r.tx("Escrow B: 期限前の取消は拒否される", early, "tecNO_PERMISSION");

    console.log(`[04] CancelAfter(${cancelB}) までレジャー時刻を待つ...`);
    const t = await waitUntilLedgerTimeAfter(client, cancelB);
    r.add("observe", "レジャー時刻が CancelAfter を超えた", `> ${cancelB}`, String(t), "ledger（validated）.close_time");

    const late = await submitAndLog(client, "EscrowFinish B late", {
      TransactionType: "EscrowFinish", Account: keeper.address, Owner: donor.address, OfferSequence: cB.sequence!,
      Condition: condB.conditionHex, Fulfillment: condB.fulfillmentHex,
    }, keeper);
    r.tx("Escrow B: 期限後は正しい Fulfillment でも完了できない", late, "tecNO_PERMISSION");

    const dV0 = await vb(donor);
    const cl = await submitAndLog(client, "EscrowCancel B", {
      TransactionType: "EscrowCancel", Account: keeper.address, Owner: donor.address, OfferSequence: cB.sequence!,
    }, keeper);
    r.tx("Escrow B: 期限後に第三者（keeper）が取消", cl, "tesSUCCESS");
    const dV1 = await vb(donor);
    r.eq("ドナーへの返還（受給証）", ESC_B, fmt(units(dV1) - units(dV0)), `${dV0} → ${dV1}`);
  }

  // ---------- 9. Escrow C: トラストラインの無い受取側が自分で完了 ----------
  const condC = createPreimageCondition();
  const cC = await submitAndLog(client, "EscrowCreate C", {
    TransactionType: "EscrowCreate", Account: donor.address, Destination: ben2.address, Amount: voucher(ESC_C),
    Condition: condC.conditionHex, CancelAfter: nowR() + 3600,
  }, donor);
  if (r.tx(`Escrow C 作成（ben2 はトラストラインなし、受給証 ${ESC_C}）`, cC, "tesSUCCESS")) {
    const fC = await submitAndLog(client, "EscrowFinish C by ben2", {
      TransactionType: "EscrowFinish", Account: ben2.address, Owner: donor.address, OfferSequence: cC.sequence!,
      Condition: condC.conditionHex, Fulfillment: condC.fulfillmentHex,
    }, ben2);
    const ok = isSuccess(fC);
    r.add(ok ? "pass" : "observe", "Escrow C: 受取側が自分で完了するとトラストラインが自動作成されるか", "XLS-85 は可能と記述（実測）",
      `${fC.engineResult ?? fC.error} / ben2 受給証=${(await vb(ben2)) ?? "トラストラインなし"}`, `[${fC.hash}](https://testnet.xrpl.org/transactions/${fC.hash})`);
    if (fC.engineResult && fC.engineResult !== "tesSUCCESS") r.errorCodes.push(`Escrow C finish by ben2: ${fC.engineResult}`);
    if (ok) {
      const t2 = await ensureRlusdTrustLine(client, ben2);
      if (t2) r.tx("ben2: RLUSD のトラストライン", t2, "tesSUCCESS");
      const red2 = await submitAndLog(client, "ben2 redeem", {
        TransactionType: "OfferCreate", Account: ben2.address, TakerGets: voucher(ESC_C), TakerPays: rl(ESC_C),
        Flags: OfferCreateFlags.tfImmediateOrCancel,
      }, ben2);
      r.tx(`ben2: 受給証 ${ESC_C} を償還`, red2, "tesSUCCESS");
      r.eq("ben2 の RLUSD", ESC_C, fmt(units(await rb(ben2))), "account_lines");
    }
  }

  // ---------- 10. ドナーが残りを償還し、準備金を確認 ----------
  const dRest = await vb(donor);
  if (units(dRest) > 0n) {
    const dRl0 = await rb(donor);
    const red3 = await submitAndLog(client, "donor redeem rest", {
      TransactionType: "OfferCreate", Account: donor.address, TakerGets: voucher(dRest!), TakerPays: rl(dRest!),
      Flags: OfferCreateFlags.tfImmediateOrCancel,
    }, donor);
    r.tx(`donor: 残りの受給証 ${dRest} を RLUSD に戻す（返還分を含む）`, red3, "tesSUCCESS");
    r.eq("ドナーの RLUSD 増加", fmt(units(dRest)), fmt(units(await rb(donor)) - units(dRl0)), "account_lines");
  }
  await reserveCheck("全償還後", 0n);

  offers = await accountOffers(client, V.address);
  r.add("observe", "V の RLUSD が 0 になったあと償還オファーは板に残るか", "仕様では未資金のオファーは処理中に見つかると削除（実測）",
    offers.map((o) => `seq=${o.seq} gets=${o.takerGets} pays=${o.takerPays}`).join("<br>") || "オファーなし",
    `account_offers。V RLUSD=${await rb(V)}`);
  r.add("observe", "検証終了時のレジャー時刻", "-", String(await validatedCloseTime(client)), "ledger（validated）");
}
