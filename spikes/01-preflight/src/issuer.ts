import { isValidClassicAddress, type Client } from "xrpl";
import { addRow, emptyResult, type CheckResult } from "./check.js";
import { describeError, json, readOnlyRequest } from "./readonly.js";

export const RLUSD_TESTNET_ISSUER = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";

/** AccountRoot フラグ（xrpl.org: AccountRoot ledger entry） */
const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;
const ACCOUNT_ROOT_FLAGS: Record<string, number> = {
  lsfAllowTrustLineClawback: 0x80000000,
  lsfAllowTrustLineLocking: 0x40000000,
  lsfDisallowIncomingTrustline: 0x20000000,
  lsfDisallowIncomingPayChan: 0x10000000,
  lsfDisallowIncomingCheck: 0x08000000,
  lsfDisallowIncomingNFTokenOffer: 0x04000000,
  lsfDepositAuth: 0x01000000,
  lsfDefaultRipple: 0x00800000,
  lsfGlobalFreeze: 0x00400000,
  lsfNoFreeze: 0x00200000,
  lsfDisableMaster: 0x00100000,
  lsfDisallowXRP: 0x00080000,
  lsfRequireAuth: 0x00040000,
  lsfRequireDestTag: 0x00020000,
  lsfPasswordSpent: 0x00010000,
};

const hex32 = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

export async function checkIssuer(client: Client): Promise<CheckResult> {
  const res = emptyResult();
  const item = "RLUSD 発行者の lsfAllowTrustLineLocking";
  const expected = "Flags に 0x40000000 が立っている";

  if (!isValidClassicAddress(RLUSD_TESTNET_ISSUER)) {
    addRow(res, "fail", {
      item,
      expected,
      actual: `アドレスが不正: ${RLUSD_TESTNET_ISSUER}`,
      evidence: "xrpl.isValidClassicAddress",
    });
    return res;
  }

  try {
    const r = await readOnlyRequest(client, {
      command: "account_info",
      account: RLUSD_TESTNET_ISSUER,
      ledger_index: "validated",
    });
    const data = r.result.account_data;
    const flags = data.Flags >>> 0;
    const isSet = (flags & LSF_ALLOW_TRUSTLINE_LOCKING) !== 0;
    const setNames = Object.entries(ACCOUNT_ROOT_FLAGS)
      .filter(([, v]) => (flags & v) !== 0)
      .map(([k]) => k);

    if (!isSet) {
      res.designImpacts.push(
        `RLUSD 発行者 ${RLUSD_TESTNET_ISSUER} は lsfAllowTrustLineLocking（${hex32(LSF_ALLOW_TRUSTLINE_LOCKING)}）が未設定（Flags=${hex32(flags)}）。この Testnet RLUSD は Token Escrow の対象にできない。06_技術設計の「RLUSD で Escrow」前提を見直す（自前の検証用トークン発行者でフラグを立てる／MPT を使う等の代替を別スパイクで検証）。発行者はマスターキー無効のため、こちらからフラグは変更できない`,
      );
    }
    addRow(res, isSet ? "pass" : "fail", {
      item,
      expected,
      actual: `Flags=${flags}（${hex32(flags)}）`,
      evidence: `判定: ${isSet ? "立っている" : "立っていない"}。立っているフラグ: ${setNames.join(", ") || "なし"}。account_flags(返却値)=${json(r.result.account_flags ?? null)}。validated=${String(r.result.validated)} ledger=${String(r.result.ledger_index)}`,
    });
    addRow(res, "pass", {
      item: "RLUSD 発行者アカウントの存在",
      expected: "account_info が返る",
      actual: `${data.Account}（Sequence=${data.Sequence}, Balance=${data.Balance} drops, Domain=${data.Domain ?? "なし"}）`,
      evidence: "account_info（ledger_index=validated）",
    });
  } catch (e) {
    const d = describeError(e);
    if (d.code) res.errorCodes.push(`account_info(${RLUSD_TESTNET_ISSUER}) → ${d.code}`);
    addRow(res, "fail", {
      item,
      expected,
      actual: `${d.code ?? "error"}: ${d.message}`,
      evidence: "account_info",
    });
    res.designImpacts.push("RLUSD 発行者の Flags を取得できず、Token Escrow の前提が未確認");
    res.unknowns.push("発行者の Flags を取得できなかったため、TrustLine Locking の可否は未確認");
  }
  return res;
}
