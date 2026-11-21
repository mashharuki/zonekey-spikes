import type { Client } from "xrpl";
import { addRow, emptyResult, type CheckResult } from "./check.js";
import { describeError, json, readOnlyRequest } from "./readonly.js";

const REL = (actual: number, ref: number): number => Math.abs(actual - ref) / ref;

export async function checkReserves(client: Client): Promise<CheckResult> {
  const res = emptyResult();
  try {
    const r = await readOnlyRequest(client, { command: "server_info" });
    const info = r.result.info;
    const v = info.validated_ledger;
    if (!v) {
      addRow(res, "fail", {
        item: "準備金（server_info.validated_ledger）",
        expected: "validated_ledger.reserve_base_xrp / reserve_inc_xrp がある",
        actual: `validated_ledger なし（server_state=${String(info.server_state)}, complete_ledgers=${String(info.complete_ledgers)}）`,
        evidence: "server_info",
      });
      return res;
    }

    const base = v.reserve_base_xrp;
    const inc = v.reserve_inc_xrp;
    // 「10 / 2」系と「1 / 0.2」系のどちらに近いか（相対誤差の合計で比較）
    const dOld = REL(base, 10) + REL(inc, 2);
    const dNew = REL(base, 1) + REL(inc, 0.2);
    const nearest = dNew <= dOld ? "1 XRP / 0.2 XRP" : "10 XRP / 2 XRP";
    const exact = (base === 1 && inc === 0.2) || (base === 10 && inc === 2);

    res.designImpacts.push(
      `Testnet の準備金は ${base} XRP / ${inc} XRP（${nearest} に近い）。06_技術設計のコスト・必要 XRP の見積りがこの値と合っているか確認する`,
    );
    addRow(res, "pass", {
      item: "基礎準備金（reserve_base_xrp）",
      expected: "10 XRP または 1 XRP",
      actual: `${base} XRP`,
      evidence: `server_info.validated_ledger.reserve_base_xrp（ledger seq=${v.seq}）`,
    });
    addRow(res, "pass", {
      item: "1件あたりの準備金（reserve_inc_xrp）",
      expected: "2 XRP または 0.2 XRP",
      actual: `${inc} XRP`,
      evidence: "server_info.validated_ledger.reserve_inc_xrp",
    });
    addRow(res, "pass", {
      item: "準備金はどちらに近いか",
      expected: "「10 / 2」か「1 / 0.2」のどちらか",
      actual: `${nearest} に近い${exact ? "（完全一致）" : "（どちらとも完全一致はしない）"}`,
      evidence: `相対誤差の合計: 10/2 との差=${dOld.toFixed(3)}, 1/0.2 との差=${dNew.toFixed(3)}。validated_ledger=${json(v)}。build_version=${String(info.build_version)}`,
    });
  } catch (e) {
    const d = describeError(e);
    if (d.code) res.errorCodes.push(`server_info → ${d.code}`);
    addRow(res, "fail", {
      item: "準備金（server_info）",
      expected: "server_info が返る",
      actual: `${d.code ?? "error"}: ${d.message}`,
      evidence: "server_info",
    });
  }
  return res;
}
