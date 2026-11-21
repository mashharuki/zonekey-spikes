import { createHash } from "node:crypto";
import type { Client } from "xrpl";
import { addRow, emptyResult, type CheckResult } from "./check.js";
import { describeError, json, readOnlyRequest } from "./readonly.js";

/** Amendments ledger entry の固定 ID（xrpl.org: Amendments ledger entry） */
const AMENDMENTS_ENTRY_INDEX = "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";

interface Wanted {
  name: string;
  /** xrpl.org Known Amendments に載っている Amendment ID */
  documentedId: string;
}

// 名前・ID は https://xrpl.org/resources/known-amendments で確認（2026-11-21）。
// PermissionDelegation は同ページで「v2.6.1 で無効化され PermissionDelegationV1_1 に置換」と記載。
const WANTED: Wanted[] = [
  { name: "TokenEscrow", documentedId: "138B968F25822EFBF54C00F97031221C47B1EAB8321D93C7C2AEAF85F04EC5DF" },
  { name: "BatchV1_1", documentedId: "9F287AED3CDB50A7BD1ACEC24296A30C9B5230CCD136219317AC790E3B884377" },
  { name: "Credentials", documentedId: "1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF" },
  { name: "PriceOracle", documentedId: "96FD2F293A519AE1DB6F8BED23E4AD9119342DA7CB6BAFD00953D16C54205D8B" },
  { name: "DID", documentedId: "DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109" },
  { name: "PermissionDelegation", documentedId: "AE6AB9028EEB7299EBB03C7CBCC3F2A4F5FBE00EA28B8223AA3118A0B436C1C5" },
  { name: "PermissionDelegationV1_1", documentedId: "0F48FF561C709540328F31F1C97FD512ACC8B4E42138A161CB0E21ECA292540B" },
];

/** Amendment ID = 名前（ASCII）の SHA-512Half */
const amendmentId = (name: string): string =>
  createHash("sha512").update(name, "ascii").digest().subarray(0, 32).toString("hex").toUpperCase();

interface FeatureEntry {
  enabled?: boolean;
  name?: string;
  supported?: boolean;
  vetoed?: boolean | string;
}

export async function checkAmendments(client: Client): Promise<CheckResult> {
  const res = emptyResult();

  // 1) feature コマンド（rippled では管理者専用。公開サーバーでは noPermission になりうる）
  let features: Record<string, FeatureEntry> | undefined;
  let featureError: string | undefined;
  try {
    const r = await readOnlyRequest(client, { command: "feature" });
    features = r.result.features as unknown as Record<string, FeatureEntry>;
  } catch (e) {
    const d = describeError(e);
    featureError = `${d.code ?? "error"}: ${d.message}`;
    if (d.code) res.errorCodes.push(`feature → ${d.code}`);
  }

  // 2) フォールバック: Amendments ledger entry（公開で読める。有効な ID の一覧）
  let enabledIds: Set<string> | undefined;
  let ledgerError: string | undefined;
  try {
    const r = await readOnlyRequest(client, {
      command: "ledger_entry",
      index: AMENDMENTS_ENTRY_INDEX,
      ledger_index: "validated",
    });
    const node = r.result.node as unknown as { Amendments?: string[] } | undefined;
    enabledIds = new Set((node?.Amendments ?? []).map((s) => s.toUpperCase()));
  } catch (e) {
    const d = describeError(e);
    ledgerError = `${d.code ?? "error"}: ${d.message}`;
    if (d.code) res.errorCodes.push(`ledger_entry(Amendments) → ${d.code}`);
  }

  if (featureError) {
    res.unknowns.push(
      `feature コマンドは使えなかった（${featureError}）。有効状態は Amendments ledger entry（フォールバック）で判定した`,
    );
  }

  const enabledByName = new Map<string, boolean | undefined>();

  for (const w of WANTED) {
    const id = amendmentId(w.name);
    const idMatches = id === w.documentedId;
    const f = features?.[id];
    const inLedger = enabledIds?.has(id);

    // feature が使えればそれを優先、無ければ ledger entry
    const enabled: boolean | undefined = features ? (f?.enabled ?? false) : inLedger;
    enabledByName.set(w.name, enabled);

    const actual = [
      `feature: ${features ? (f ? json(f) : "一覧に存在しない") : (featureError ?? "未取得")}`,
      `ledger Amendments: ${enabledIds ? String(inLedger) : (ledgerError ?? "未取得")}`,
    ].join("<br>");
    const disagree = features && enabledIds && (f?.enabled ?? false) !== inLedger;
    const evidence = [
      `ID=${id}`,
      idMatches ? "（xrpl.org 記載の ID と一致）" : `（xrpl.org 記載 ${w.documentedId} と不一致）`,
      disagree ? "feature と ledger entry の結果が食い違う" : "",
    ]
      .filter(Boolean)
      .join(" ");

    // PermissionDelegation は後でまとめて判定するため、ここでは仮登録しない
    if (w.name === "PermissionDelegation") continue;
    const status = enabled === undefined ? "unknown" : enabled ? "pass" : "fail";
    if (status === "fail") res.designImpacts.push(`amendment ${w.name} が Testnet で無効。依存する機能を設計から外すか代替を検討する`);
    addRow(res, status, {
      item: `amendment ${w.name}`,
      expected: "enabled = true",
      actual,
      evidence: `判定: ${enabled === undefined ? "判定不能" : enabled ? "有効" : "無効"}。${evidence}`,
    });
  }

  // PermissionDelegation（旧版）: 新版 V1_1 が有効なら要件を満たす
  const pdOld = WANTED.find((w) => w.name === "PermissionDelegation")!;
  const idOld = amendmentId(pdOld.name);
  const oldEnabled = enabledByName.get("PermissionDelegation");
  const newEnabled = enabledByName.get("PermissionDelegationV1_1");
  const fOld = features?.[idOld];
  const status = oldEnabled || newEnabled ? "pass" : oldEnabled === undefined && newEnabled === undefined ? "unknown" : "fail";
  if (status === "fail") res.designImpacts.push("PermissionDelegation / PermissionDelegationV1_1 がどちらも無効。権限委譲を使う設計を見直す");
  addRow(res, status, {
    item: "amendment PermissionDelegation（旧版）",
    expected: "enabled = true、または置換先 PermissionDelegationV1_1 が enabled",
    actual: [
      `feature: ${features ? (fOld ? json(fOld) : "一覧に存在しない") : (featureError ?? "未取得")}`,
      `ledger Amendments: ${enabledIds ? String(enabledIds.has(idOld)) : (ledgerError ?? "未取得")}`,
    ].join("<br>"),
    evidence: `判定: 旧版=${fmt(oldEnabled)} / V1_1=${fmt(newEnabled)}。xrpl.org は旧版を v2.6.1 で無効化し V1_1 に置換したと記載。ID=${idOld}${idOld === pdOld.documentedId ? "（記載と一致）" : "（記載と不一致）"}`,
  });

  return res;
}

const fmt = (b: boolean | undefined): string => (b === undefined ? "判定不能" : b ? "有効" : "無効");
