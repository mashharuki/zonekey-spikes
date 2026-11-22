import { Wallet, convertStringToHex, decode, encodeForSigning, verifySignature, xrpToDrops, type Client, type SubmittableTransaction } from "xrpl";
import {
  Abort,
  configureEscrowableIssuer,
  explorerTxUrl,
  isAccountActivated,
  issued,
  loadOrCreatePersistentWallet,
  submitAndLog,
  type Recorder,
} from "xrpl-kit";
import { describePrivyError, privy } from "./privy.js";
import { loadState, saveState } from "./state.js";

export const TOKEN = "ZKV";
const CREDENTIAL_TYPE = convertStringToHex("zonekey-eligible").toUpperCase();

export interface Ctx {
  client: Client;
  r: Recorder;
  jwt: string;
  userId: string;
  walletId: string;
  address: string;
  publicKey: string;
  seedStartDir: string;
}

interface SignOutcome { ok: boolean; blob?: string; error?: string; encoded: string }

/**
 * Privy に署名させる（確認 3 の手順）。
 * 1) client.autofill で Fee / Sequence / LastLedgerSequence を埋め、SigningPubKey に Privy の公開鍵を入れる
 * 2) xrpl.js の encodeForSigning() で「53545800 + 直列化 tx」の 16 進を作る（Privy ドキュメントの指定）
 * 3) wallets().rpc(xrpl_signTransaction) に本人の access token（user_jwts）を付けて呼ぶ
 */
async function privySign(c: Ctx, tx: SubmittableTransaction): Promise<SignOutcome> {
  const prepared = await c.client.autofill({ ...tx, SigningPubKey: c.publicKey } as SubmittableTransaction);
  const encoded = encodeForSigning(prepared as never);
  try {
    const res = await privy().wallets().rpc(c.walletId, {
      method: "xrpl_signTransaction",
      params: { encoding: "hex", transaction: encoded },
      authorization_context: { user_jwts: [c.jwt] },
    });
    return { ok: true, blob: res.data.signed_transaction, encoded };
  } catch (e) {
    return { ok: false, error: describePrivyError(e), encoded };
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

/** 署名させて、署名済み blob を台帳に送る。期待（署名される / 拒否される）と比べて記録する */
async function signAndMaybeSubmit(c: Ctx, label: string, tx: SubmittableTransaction, expectSigned: boolean): Promise<boolean> {
  const s = await privySign(c, tx);
  if (!s.ok) {
    c.r.add(expectSigned ? "fail" : "pass", `${label}: Privy の署名`, expectSigned ? "署名される" : "ポリシーで拒否される", `拒否: ${s.error}`, `encodeForSigning の先頭 16 桁=${s.encoded.slice(0, 16)}…`);
    if (!expectSigned) c.r.errorCodes.push(`${label}: ${s.error}`);
    return false;
  }
  const d = decode(s.blob!) as Record<string, unknown>;
  const localVerify = (() => { try { return verifySignature(s.blob!) ? "OK" : "NG"; } catch (e) { return `検証不可(${(e as Error).message})`; } })();
  c.r.add(expectSigned ? "pass" : "fail", `${label}: Privy の署名`, expectSigned ? "署名される" : "ポリシーで拒否される",
    `署名された（SigningPubKey=${String(d["SigningPubKey"]).slice(0, 12)}…、xrpl.js verifySignature=${localVerify}）`,
    `encodeForSigning の先頭=${s.encoded.slice(0, 8)}（署名用接頭辞 53545800）`);
  const sub = await submitBlob(c, s.blob!);
  c.r.add(sub.code === "tesSUCCESS" ? "pass" : "fail", `${label}: 署名済み blob を Testnet に送信`, "tesSUCCESS", sub.code,
    sub.hash === "-" ? "-" : `[${sub.hash}](${explorerTxUrl(sub.hash)})`);
  if (sub.code !== "tesSUCCESS") c.r.errorCodes.push(`${label} 送信: ${sub.code}`);
  return sub.code === "tesSUCCESS";
}

async function operatorAndIssuer(c: Ctx): Promise<{ operator: Wallet; issuer: Wallet }> {
  const operator = (await loadOrCreatePersistentWallet(c.client, "OPERATOR_SEED", "operator", c.seedStartDir)).wallet;
  const iss = await loadOrCreatePersistentWallet(c.client, "MOCK_ISSUER_SEED", "mock-issuer", c.seedStartDir);
  if (iss.createdNow || iss.fundedNow) {
    for (const o of await configureEscrowableIssuer(c.client, iss.wallet)) c.r.tx("モック発行者: AccountSet", o, "tesSUCCESS");
  }
  return { operator, issuer: iss.wallet };
}

export async function runSteps(c: Ctx): Promise<void> {
  const { operator, issuer } = await operatorAndIssuer(c);
  c.r.add("observe", "アカウント", "-", `Privy ウォレット=${c.address}（wallet_id=${c.walletId}）<br>運営=${operator.address}<br>モック発行者=${issuer.address}`, "運営・発行者のシードは .env.local");

  // ===== 確認 2: 運営から XRP を送って有効化 =====
  if (!(await isAccountActivated(c.client, c.address))) {
    const o = await submitAndLog(c.client, "operator → privy wallet", { TransactionType: "Payment", Account: operator.address, Destination: c.address, Amount: xrpToDrops("10") }, operator);
    if (!c.r.tx("確認2: 運営から 10 XRP を送って有効化", o, "tesSUCCESS")) throw new Abort("有効化に失敗");
  } else {
    c.r.add("observe", "確認2: 有効化", "未有効なら 10 XRP 送る", "既に有効化済み（再実行）", "account_info");
  }

  // ===== 確認 3: 本人の JWT で TrustSet に署名させ、送信 =====
  const trust = (iss: string, value = "1000"): SubmittableTransaction => ({ TransactionType: "TrustSet", Account: c.address, LimitAmount: issued(TOKEN, iss, value) });
  if (!(await signAndMaybeSubmit(c, "確認3 TrustSet（ポリシーなし）", trust(issuer.address), true))) throw new Abort("確認3 で失敗。以降は実施しない");

  // ===== 確認 4: ポリシー（TrustSet は指定の currency/issuer だけ） =====
  const st = loadState();
  try {
    if (!st.policyId) {
      const pol = await privy().policies().create({
        chain_type: "xrpl", name: "zonekey: TrustSet only for ZKV/mock issuer", version: "1.0",
        rules: [{
          name: "Allow TrustSet to ZKV issued by mock issuer", method: "xrpl_signTransaction", action: "ALLOW",
          conditions: [
            { field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "TrustSet" },
            { field_source: "xrpl_transaction", field: "TrustSet.LimitAmount.currency", operator: "eq", value: TOKEN },
            { field_source: "xrpl_transaction", field: "TrustSet.LimitAmount.issuer", operator: "eq", value: issuer.address },
          ],
        }],
      });
      st.policyId = pol.id;
      saveState(st);
      c.r.add("pass", "確認4: ポリシー作成", "作成できる", `policy_id=${pol.id}`, "policies().create");
    }
    const w = await privy().wallets().update(c.walletId, { policy_ids: [st.policyId], authorization_context: { user_jwts: [c.jwt] } });
    c.r.add(w.policy_ids.includes(st.policyId) ? "pass" : "fail", "確認4: ユーザー所有のウォレットにポリシーを付ける（本人の JWT で更新）", "policy_ids に入る",
      `policy_ids=${JSON.stringify(w.policy_ids)}`, "wallets().update + user_jwts");
  } catch (e) {
    c.r.add("fail", "確認4: ポリシーの作成・付与", "できる", describePrivyError(e), "policies().create / wallets().update");
    throw new Abort("確認4 のポリシー付与に失敗");
  }
  await signAndMaybeSubmit(c, "確認4 許可: TrustSet（ZKV / モック発行者、上限変更）", trust(issuer.address, "2000"), true);
  const other = Wallet.generate().address;
  await signAndMaybeSubmit(c, "確認4 拒否: 別の issuer への TrustSet", trust(other), false);
  await signAndMaybeSubmit(c, "確認4 拒否: 任意の Payment（運営へ 1 drop）",
    { TransactionType: "Payment", Account: c.address, Destination: operator.address, Amount: "1" }, false);

  // ===== 確認 5: CredentialAccept =====
  // 発行者が先に CredentialCreate しておく（受け取る Credential が無いと tecNO_ENTRY になるため）
  const cc = await submitAndLog(c.client, "issuer CredentialCreate", {
    TransactionType: "CredentialCreate", Account: issuer.address, Subject: c.address, CredentialType: CREDENTIAL_TYPE,
  }, issuer);
  const ccCode = cc.engineResult ?? cc.error ?? "-";
  c.r.add(ccCode === "tesSUCCESS" || ccCode === "tecDUPLICATE" ? "pass" : "fail", "確認5 準備: 発行者が CredentialCreate", "tesSUCCESS（再実行なら tecDUPLICATE）", ccCode, `[${cc.hash}](${explorerTxUrl(cc.hash)})`);
  const accept: SubmittableTransaction = { TransactionType: "CredentialAccept", Account: c.address, Issuer: issuer.address, CredentialType: CREDENTIAL_TYPE };

  // 5a: TrustSet だけ許可するポリシーのまま
  const a = await privySign(c, accept);
  c.r.add(a.ok ? "observe" : "pass", "確認5a: CredentialAccept（TrustSet のみ許可のポリシー）", "拒否（ポリシーが評価できない種類は既定で拒否）",
    a.ok ? "署名された" : `拒否: ${a.error}`, "xrpl_signTransaction");
  if (!a.ok) c.r.errorCodes.push(`確認5a CredentialAccept: ${a.error}`);

  // ルール名は Privy の入力制限（50 文字未満）があるので、記録用の説明とは分けて短い英字名にする
  const pol = () => privy().policies();

  // 5b / 5c: TransactionType = CredentialAccept は条件の値として指定できない（前回の実測）。制約として記録する
  for (const [label, name, conditions] of [
    ["確認5b: TransactionType = CredentialAccept を許可するルール", "allow-credential-accept",
      [{ field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "CredentialAccept" }]],
    ["確認5c: 5b + system 時刻条件のルール", "allow-credential-accept-system",
      [{ field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "CredentialAccept" },
       { field_source: "system", field: "current_unix_timestamp", operator: "gt", value: "0" }]],
  ] as const) {
    try {
      const rule = await pol().createRule(st.policyId!, { name, method: "xrpl_signTransaction", action: "ALLOW", conditions: conditions as never });
      await pol().deleteRule(rule.id, { policy_id: st.policyId! }).catch(() => undefined);
      c.r.add("fail", label, "作れない（前回の実測）", "作れてしまった（前回と食い違う）", `policies().createRule（name="${name}"）`);
    } catch (e) {
      const msg = describePrivyError(e);
      const known = msg.includes("supported XRPL transaction type");
      c.r.add(known ? "pass" : "fail", label, "invalid_policy_format（TransactionType に指定できるのは Payment / OfferCreate / OfferCancel / TrustSet だけ）", msg, `policies().createRule（name="${name}"）`);
      c.r.errorCodes.push(`${label}: ${msg}`);
    }
  }

  // 5d: 「Payment を DENY」+「system 条件だけの ALLOW」を足す。CredentialAccept が通るか、何が一緒に通ってしまうかを見る
  const added: string[] = [];
  try {
    added.push((await pol().createRule(st.policyId!, { name: "deny-payment", method: "xrpl_signTransaction", action: "DENY",
      conditions: [{ field_source: "xrpl_transaction", field: "TransactionType", operator: "eq", value: "Payment" }] })).id);
    added.push((await pol().createRule(st.policyId!, { name: "allow-any-by-system-time", method: "xrpl_signTransaction", action: "ALLOW",
      conditions: [{ field_source: "system", field: "current_unix_timestamp", operator: "gt", value: "0" }] })).id);
    c.r.add("pass", "確認5d 準備: DENY Payment + system 条件だけの ALLOW を追加", "追加できる", `rule_ids=${added.join(", ")}`, "policies().createRule");

    const s1 = await privySign(c, accept);
    if (s1.ok) {
      const sub = await submitBlob(c, s1.blob!);
      c.r.add(sub.code === "tesSUCCESS" || sub.code === "tecDUPLICATE" ? "pass" : "fail", "確認5d: CredentialAccept が署名され、送信できる", "署名される → tesSUCCESS",
        `署名された → ${sub.code}`, sub.hash === "-" ? "-" : `[${sub.hash}](${explorerTxUrl(sub.hash)})`);
    } else {
      c.r.add("fail", "確認5d: CredentialAccept が署名され、送信できる", "署名される", `拒否: ${s1.error}`, "xrpl_signTransaction");
      c.r.errorCodes.push(`確認5d CredentialAccept: ${s1.error}`);
    }
    const s2 = await privySign(c, { TransactionType: "Payment", Account: c.address, Destination: operator.address, Amount: "1" });
    c.r.add(s2.ok ? "fail" : "pass", "確認5d: それでも Payment は DENY で止まる", "拒否（DENY が ALLOW より優先）", s2.ok ? "署名されてしまった（送信はしない）" : `拒否: ${s2.error}`, "xrpl_signTransaction");
    const s3 = await privySign(c, trust(Wallet.generate().address));
    c.r.add("observe", "確認5d: 別の issuer への TrustSet も通ってしまうか（送信はしない）", "system 条件の ALLOW は種類を問わず許可するはず",
      s3.ok ? "署名された（= TrustSet の issuer 制限が効かなくなる）" : `拒否: ${s3.error}`, "xrpl_signTransaction");
  } catch (e) {
    c.r.add("fail", "確認5d: ルールの追加", "追加できる", describePrivyError(e), "policies().createRule");
  } finally {
    for (const id of added) await pol().deleteRule(id, { policy_id: st.policyId! }).catch(() => undefined);
    c.r.add("observe", "確認5d 後片付け: 追加したルールを削除", "ポリシーは TrustSet だけ許可に戻る", `削除 ${added.length} 件`, "policies().deleteRule");
  }
}
