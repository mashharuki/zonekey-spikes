/**
 * 11a 確認 7（Privy・H2）。spike 07 の署名の手順を流用する:
 * autofill（SigningPubKey に Privy の公開鍵）→ encodeForSigning → wallets().rpc(xrpl_signTransaction, user_jwts) → 署名済み blob をアプリが送る
 * 根拠: docs.privy.io XRPL のページ / XRPL のポリシー例（Supported policy fields、Other transaction types）
 */
import { encodeForSigning, xrpToDrops, type Client, type SubmittableTransaction, type Wallet } from "xrpl";
import { Abort, explorerTxUrl, isAccountActivated, submitAndLog, type Recorder } from "xrpl-kit";
import { VOUCHER, checkEntry, createdCheckId, txMeta, validatedCloseTime, voucherBalance, zkv } from "../common.js";
import { describePrivyError, privy } from "./privy.js";
import { loadState, saveState } from "./state.js";

export interface Ctx { client: Client; r: Recorder; jwt: string; walletId: string; address: string; publicKey: string; policyIds: string[]; S: Wallet; V: Wallet }

const link = (h: string) => `[${h}](${explorerTxUrl(h)})`;

async function privySign(c: Ctx, tx: SubmittableTransaction): Promise<{ ok: boolean; blob?: string; error?: string }> {
  const prepared = await c.client.autofill({ ...tx, SigningPubKey: c.publicKey } as SubmittableTransaction);
  try {
    const res = await privy().wallets().rpc(c.walletId, {
      method: "xrpl_signTransaction",
      params: { encoding: "hex", transaction: encodeForSigning(prepared as never) },
      authorization_context: { user_jwts: [c.jwt] },
    });
    return { ok: true, blob: res.data.signed_transaction };
  } catch (e) {
    return { ok: false, error: describePrivyError(e) };
  }
}

async function submitBlob(c: Ctx, blob: string): Promise<{ code: string; hash: string }> {
  try {
    const res = await c.client.submitAndWait(blob);
    const meta = res.result.meta;
    return { code: typeof meta === "object" ? (meta.TransactionResult ?? "-") : "-", hash: res.result.hash };
  } catch (e) {
    return { code: e instanceof Error ? e.message : String(e), hash: "-" };
  }
}

/** Privy に署名させて送る（署名される・tesSUCCESS が期待） */
async function signAndSubmit(c: Ctx, item: string, tx: SubmittableTransaction): Promise<string | undefined> {
  const s = await privySign(c, tx);
  if (!s.ok) {
    c.r.add("fail", item, "署名される → tesSUCCESS", `署名を拒否: ${s.error}`, "xrpl_signTransaction");
    c.r.errorCodes.push(`${item}: ${s.error}`);
    return undefined;
  }
  const sub = await submitBlob(c, s.blob!);
  c.r.add(sub.code === "tesSUCCESS" ? "pass" : "fail", item, "署名される → tesSUCCESS", `署名された → ${sub.code}`, sub.hash === "-" ? "-" : link(sub.hash));
  if (sub.code !== "tesSUCCESS") c.r.errorCodes.push(`${item}: ${sub.code}`);
  return sub.code === "tesSUCCESS" ? sub.hash : undefined;
}

/** ポリシーで拒否されるかだけを見る（署名されても送らない） */
async function expectDenied(c: Ctx, item: string, tx: SubmittableTransaction) {
  const s = await privySign(c, tx);
  c.r.add(s.ok ? "fail" : "pass", item, "ポリシーで拒否される", s.ok ? "署名されてしまった（送信はしない）" : `拒否: ${s.error}`, "xrpl_signTransaction（送信なし）");
  if (!s.ok) c.r.errorCodes.push(`${item}: ${s.error}`);
}

const setPolicies = (c: Ctx, ids: string[]) => privy().wallets().update(c.walletId, { policy_ids: ids, authorization_context: { user_jwts: [c.jwt] } });

export async function runStep7(c: Ctx): Promise<Record<string, unknown>> {
  const { r, S, V } = c;
  const extra: Record<string, unknown> = { H2: c.address, walletId: c.walletId, originalPolicyIds: c.policyIds };
  r.add("observe", "確認7: 口座", "-", `H2（Privy のユーザー所有）=${c.address}（wallet_id=${c.walletId}）<br>S=${S.address} / V=${V.address}<br>付いていたポリシー=${JSON.stringify(c.policyIds)}`, "wallets().list");

  // 準備: ポリシーを外す（7a は「ポリシーなし」で試す）・有効化・トラストライン・受給証
  if (c.policyIds.length) {
    const w = await setPolicies(c, []);
    r.add(w.policy_ids.length === 0 ? "pass" : "fail", "確認7 準備: H2 のポリシーを外す（本人の JWT で）", "policy_ids=[]", `policy_ids=${JSON.stringify(w.policy_ids)}`, "wallets().update + user_jwts");
  }
  if (!(await isAccountActivated(c.client, c.address))) r.tx("確認7 準備: S → H2 3 XRP（有効化）", await submitAndLog(c.client, "S → H2", { TransactionType: "Payment", Account: S.address, Destination: c.address, Amount: xrpToDrops("3") }, S), "tesSUCCESS");
  if ((await voucherBalance(c.client, c.address, V.address)) === undefined) {
    if (!(await signAndSubmit(c, "確認7 準備: H2 の受給証トラストライン（Privy で署名）", { TransactionType: "TrustSet", Account: c.address, LimitAmount: zkv(V.address, "1000") }))) throw new Abort("H2 のトラストラインを張れない");
  }
  if (Number(await voucherBalance(c.client, c.address, V.address)) < 0.5) {
    r.tx("確認7 準備: V → H2 受給証 1.0", await submitAndLog(c.client, "V → H2", { TransactionType: "Payment", Account: V.address, Destination: c.address, Amount: zkv(V.address, "1") }, V), "tesSUCCESS");
  }

  // 7a: ポリシーなしで CheckCreate を署名して送る
  const h = await signAndSubmit(c, "確認7a: H2 → S CheckCreate（SendMax 0.5）を xrpl_signTransaction で署名して送る（ポリシーなし）",
    { TransactionType: "CheckCreate", Account: c.address, Destination: S.address, SendMax: zkv(V.address, "0.5"), Expiration: (await validatedCloseTime(c.client)) + 1800 });
  const checkId = h ? createdCheckId(await txMeta(c.client, h)) : undefined;
  extra["check7a"] = checkId;

  // 7b: 「ゆるいロック」のポリシー（受給証の Payment を DENY、TrustSet は ZKV/V だけ ALLOW）を作り、CheckCreate を ALLOW するルールを足せるか試す
  const st = loadState();
  const pol = () => privy().policies();
  if (!st.looseLockPolicyId) {
    const p = await pol().create({
      chain_type: "xrpl", name: "11a loose lock (deny ZKV payment)", version: "1.0",
      rules: [
        { name: "Deny ZKV payments", method: "xrpl_signTransaction", action: "DENY", conditions: [
          { field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "Payment" },
          { field_source: "xrpl_transaction", field: "Payment.Amount.currency", operator: "eq", value: VOUCHER },
        ] },
        { name: "Allow TrustSet ZKV from V", method: "xrpl_signTransaction", action: "ALLOW", conditions: [
          { field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "TrustSet" },
          { field_source: "xrpl_transaction", field: "TrustSet.LimitAmount.currency", operator: "eq", value: VOUCHER },
          { field_source: "xrpl_transaction", field: "TrustSet.LimitAmount.issuer", operator: "eq", value: V.address },
        ] },
      ],
    } as never);
    st.looseLockPolicyId = (p as { id: string }).id;
    saveState(st);
  }
  r.add("observe", "確認7 準備: ゆるいロックのポリシー", "-", `policy_id=${st.looseLockPolicyId}<br>DENY: Payment かつ Payment.Amount.currency=${VOUCHER}<br>ALLOW: TrustSet（${VOUCHER} / V）だけ。それ以外は既定で拒否`, "policies().create");
  try {
    const rule = await pol().createRule(st.looseLockPolicyId, { name: "allow-checkcreate", method: "xrpl_signTransaction", action: "ALLOW",
      conditions: [{ field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "CheckCreate" }] } as never);
    await pol().deleteRule((rule as { id: string }).id, { policy_id: st.looseLockPolicyId }).catch(() => undefined);
    r.add("observe", "確認7b: TransactionType = CheckCreate の ALLOW ルール", "作れる？（spike 07 では 4 種類以外は invalid_policy_format。今のドキュメントは作れるように読める）", "作れた（spike 07 と食い違う。作ったルールはすぐ削除）", "policies().createRule");
    extra["checkCreateRule"] = "created";
  } catch (e) {
    const msg = describePrivyError(e);
    r.add("observe", "確認7b: TransactionType = CheckCreate の ALLOW ルール", "作れる？（spike 07 では 4 種類以外は invalid_policy_format。今のドキュメントは作れるように読める）", `作れない: ${msg}`, "policies().createRule");
    r.errorCodes.push(`確認7b: ${msg}`);
    extra["checkCreateRule"] = msg;
  }

  // 7c: ポリシーを付けて、持ち出しにつながる 3 種類が拒否されるか（送信しない）
  const w = await setPolicies(c, [st.looseLockPolicyId]);
  r.add(w.policy_ids.includes(st.looseLockPolicyId) ? "pass" : "fail", "確認7c 準備: ゆるいロックを H2 に付ける（本人の JWT で）", "policy_ids に入る", `policy_ids=${JSON.stringify(w.policy_ids)}`, "wallets().update + user_jwts");
  await expectDenied(c, "確認7c(1): 受給証の Payment（H2 → S 0.1）", { TransactionType: "Payment", Account: c.address, Destination: S.address, Amount: zkv(V.address, "0.1") });
  if (checkId) await expectDenied(c, "確認7c(2): CheckCancel（7a の Check）", { TransactionType: "CheckCancel", Account: c.address, CheckID: checkId });
  await expectDenied(c, "確認7c(3): OfferCreate（受給証 0.1 を XRP に）", { TransactionType: "OfferCreate", Account: c.address, TakerGets: zkv(V.address, "0.1"), TakerPays: "1000" });
  await expectDenied(c, "確認7c(参考): 新しい CheckCreate（S 以外の宛先へ）", { TransactionType: "CheckCreate", Account: c.address, Destination: V.address, SendMax: zkv(V.address, "0.1") });

  // 7d: ポリシーを付けたまま、S が H2 の Check を換金できるか（S の取引なので Privy は関係しないはず）
  if (checkId) {
    const o = await submitAndLog(c.client, "確認7d: S が H2 の Check を CheckCash（0.2）", { TransactionType: "CheckCash", Account: S.address, CheckID: checkId, Amount: zkv(V.address, "0.2") }, S);
    r.tx("確認7d: ポリシーを付けたまま、S が H2 の Check を CheckCash（Amount 0.2）", o, "tesSUCCESS", `Check は ${(await checkEntry(c.client, checkId)) ? "残っている" : "消えた"}`);
  }

  // 後片付け: もとのポリシーに戻す
  const back = await setPolicies(c, c.policyIds);
  r.add("observe", "確認7 後片付け: H2 のポリシーを元に戻す", JSON.stringify(c.policyIds), JSON.stringify(back.policy_ids), "wallets().update + user_jwts");
  return extra;
}
