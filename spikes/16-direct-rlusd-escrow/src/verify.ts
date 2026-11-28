/**
 * 読み取り専用の検算。署名鍵・シード・.env.local を一切読まない。送信（submit）もしない。
 *   pnpm --filter 16-direct-rlusd-escrow verify                     results/manifest.json を検算
 *   pnpm --filter 16-direct-rlusd-escrow verify -- --official        加えて公式ページ（tryrlusd.com/addresses）を再取得して発行者を照合
 * 公開 Testnet の validated 履歴から、tx 結果・Escrow の生成と消滅・資金の差額を十進固定精度（10^-15 刻みの BigInt）で再計算する。
 * 終了コード: すべて期待どおりなら 0、1 つでも違えば 1。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "xrpl";
import { fmtDec, fmtSigned, parseDec } from "../../15-multi-donor-rlusd/src/dec.js";
import { escrowNodes, lineDeltas } from "../../15-multi-donor-rlusd/src/deltas.js";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PKG = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const manifestPath = argOf("--manifest") ?? `${PKG}results/manifest.json`;
const outPath = argOf("--out") ?? manifestPath.replace(/manifest(\.[^/]*)?\.json$/, "verify$1.json");

interface Esc { id: string; value: string; cancelAfter: number; condition: string; owner: string; destination: string; escrowIndex: string | null; sequence: number | null; createTx: string; createResult: string; finishTx: string | null; cancelTx: string | null }
interface Tx { label: string; phase: string; account: string; type: string; hash: string; ledger: number; observedResult: string }
interface Led { ledger: number; hash: string; closeTime: number }
interface M { network: { endpoint: string; network_id: number | null; build_version: string }; official: { issuer: string; currency: string; source: string; fetchedAt: string }; asset: { currency: string; issuer: string }; accounts: { D: string; S: string; K: string }; baseline: Led; lock: (Led & { lockedTotal: string }) | null; expiry: Led | null; beforeExpiry: (Led & { cancelAfter: number; bExists: boolean; sRlusd: string }) | null; end: Led; escrows: Esc[]; transactions: Tx[] }
const m = JSON.parse(readFileSync(manifestPath, "utf8")) as M;
const host = new URL(m.network.endpoint).hostname;
if (!["s.altnet.rippletest.net", "clio.altnet.rippletest.net"].includes(host)) throw new Error(`Testnet 以外には接続しない: ${host}`);
const { D, S, K } = m.accounts, RL = m.asset;
const nm = (a: string) => (a === D ? "D" : a === S ? "S" : a === K ? "K" : a);

interface Check { section: string; name: string; expected: string; actual: string; ok: boolean; evidence: string }
const checks: Check[] = [];
const add = (section: string, name: string, expected: string, actual: string, evidence: string, ok = expected === actual) => { checks.push({ section, name, expected, actual, ok, evidence }); };

const c = new Client(m.network.endpoint);
await c.connect();
async function lineAt(a: string, ledger: number) {
  const r = (await c.request({ command: "account_lines", account: a, peer: RL.issuer, ledger_index: ledger, limit: 400 } as never)) as unknown as { result: J };
  const l = (r.result["lines"] as J[]).find((x) => x["currency"] === RL.currency);
  return l ? parseDec(l["balance"]) : 0n;
}
const led = async (i: number) => { const r = (await c.request({ command: "ledger", ledger_index: i })).result; return { hash: String(r.ledger_hash), close: Number(r.ledger.close_time), index: Number(r.ledger_index) }; };
const escAt = async (idx: string, l: number) => { try { return ((await c.request({ command: "ledger_entry", index: idx, ledger_index: l } as never)) as unknown as { result: J }).result["node"] as J; } catch (e) { if ((e as { data?: { error?: string } }).data?.error === "entryNotFound") return undefined; throw e; } };
try { await main(); } finally { await c.disconnect(); }

async function main() {
  console.log(`# 検算: spike 16 直接 RLUSD Escrow  manifest=${manifestPath}\n  開始 ledger ${m.baseline.ledger} → 終了 ${m.end.ledger}。読み取りのみ。`);
  const si = (await c.request({ command: "server_info" })).result.info;
  add("0 前提", "ネットワーク（network_id=1）", "1", String(si.network_id ?? "?"), `rippled ${si.build_version}（実行時は ${m.network.build_version}）`);
  add("0 前提", "履歴が開始〜終了で連続", "true", String(String(si.complete_ledgers).split(",").some((p) => { const [a, b] = p.split("-").map(Number); return a! <= m.baseline.ledger && m.end.ledger <= b!; })), `complete_ledgers=${si.complete_ledgers}`);
  for (const [name, l] of [["開始", m.baseline], ["ロック中", m.lock], ["期限到来", m.expiry], ["終了", m.end]] as const) {
    if (!l) continue;
    const x = await led(l.ledger);
    add("0 前提", `ledger ${l.ledger}（${name}）の hash・close_time が記録と一致`, `${l.hash} / ${l.closeTime}`, `${x.hash} / ${x.close}`, `ledger ${l.ledger}`);
  }
  const iss = (await c.request({ command: "account_info", account: RL.issuer, ledger_index: m.end.ledger })).result.account_data as J;
  add("0 前提", "RLUSD の発行者（公式に案内された組）が台帳に実在・Domain あり", "実在", iss["Domain"] ? `実在 Domain=${Buffer.from(String(iss["Domain"]), "hex").toString()}` : "Domain なし", RL.issuer, Boolean(iss["Domain"]));
  add("0 前提", "実行時に公式ページで確認した発行者 = 資産の発行者", RL.issuer, m.official.issuer, `${m.official.source} 取得 ${m.official.fetchedAt}`);
  if (args.includes("--official")) {
    const t = (await (await fetch("https://tryrlusd.com/addresses")).text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const mm = /XRPL Testnet Issued currency Trustline required Explorer RLUSD issuer \S+ (r[1-9A-HJ-NP-Za-km-z]{24,34})/.exec(t);
    add("0 前提", "（--official）今の公式ページの発行者", RL.issuer, mm?.[1] ?? "読み取れない", "tryrlusd.com/addresses");
  }
  add("0 前提", "TransferRate（手数料）", "なし", iss["TransferRate"] ? `あり ${iss["TransferRate"]}` : "なし", `account_info @${m.end.ledger}`);

  // 1. 取引
  const T: Record<string, { tx: J; meta: J; ledger: number; close: number; hash: string }> = {};
  for (const t of m.transactions) {
    const r = ((await c.request({ command: "tx", transaction: t.hash } as never)) as unknown as { result: J }).result;
    const tj = (r["tx_json"] ?? r) as J, l = await led(r["ledger_index"]);
    T[t.hash] = { tx: tj, meta: r["meta"], ledger: r["ledger_index"], close: l.close, hash: l.hash };
    add("1 取引の確定", t.label, `${t.observedResult} / validated / ledger ${t.ledger}`, `${r["meta"]["TransactionResult"]} / ${r["validated"] ? "validated" : "未validated"} / ledger ${r["ledger_index"]}`, `${t.hash}（ledger hash ${l.hash}）`, r["meta"]["TransactionResult"] === t.observedResult && r["validated"] === true && r["ledger_index"] === t.ledger);
  }
  const resultOf = (h: string | null) => (h && T[h] ? String(T[h]!.meta["TransactionResult"]) : null);

  // 2〜4. Escrow ごと
  let expectS = 0n, expectD = 0n, lockedSum = 0n;
  for (const e of m.escrows) {
    const S_ = `2 券 ${e.id}（${e.value} RLUSD）`;
    const need = [e.createTx, e.finishTx, e.cancelTx].filter((h): h is string => Boolean(h));
    const miss = need.filter((h) => !T[h]);
    if (miss.length) { add(S_, "券の取引がすべて manifest の取引に含まれる", `${need.length} 件`, `${need.length - miss.length} 件（欠落 ${miss.join(",")}）`, "manifest", false); continue; }
    const v = parseDec(e.value), cr = T[e.createTx]!;
    add(S_, "EscrowCreate の結果（直接ロックの可否）", "tesSUCCESS なら成立", `${e.createResult}`, e.createTx, true);
    if (e.createResult !== "tesSUCCESS") { add(S_, "不成立のとき: Escrow が作られていない・D の残高が動かない（手数料を除く）", "なし / 0", `${escrowNodes(cr.meta).length} 件 / ${fmtSigned((await lineAt(D, cr.ledger)) - (await lineAt(D, cr.ledger - 1)))}`, e.createTx, escrowNodes(cr.meta).length === 0 && (await lineAt(D, cr.ledger)) === (await lineAt(D, cr.ledger - 1))); continue; }
    const node = escrowNodes(cr.meta).find((x) => x.kind === "created");
    const amt = cr.tx["Amount"] as J;
    add(S_, "Owner・Destination（D ≠ S）・Amount(currency/issuer/value)・Condition・CancelAfter", "一致", cr.tx["Account"] === e.owner && e.owner === D && cr.tx["Destination"] === S && D !== S && amt.currency === RL.currency && amt.issuer === RL.issuer && parseDec(amt.value) === v && String(cr.tx["Condition"]).toUpperCase() === e.condition.toUpperCase() && cr.tx["CancelAfter"] === e.cancelAfter && cr.tx["Sequence"] === e.sequence ? "一致" : "不一致", `Sequence ${e.sequence}`);
    add(S_, "Escrow オブジェクトの生成（メタデータの CreatedNode = 記録した ID）", String(e.escrowIndex), String(node?.index), `Escrow ${e.escrowIndex}`);
    const dd = lineDeltas(cr.meta).filter((d) => d.currency === RL.currency && d.account === D && d.counterparty === RL.issuer).reduce((a, d) => a + d.delta, 0n);
    add(S_, "作成で D の RLUSD 利用可能残高が額面ぶん減る（ロック。S には動かない）", fmtSigned(-v), `${fmtSigned(dd)} / S ${fmtSigned((await lineAt(S, cr.ledger)) - (await lineAt(S, cr.ledger - 1)))}`, e.createTx, dd === -v && (await lineAt(S, cr.ledger)) === (await lineAt(S, cr.ledger - 1)));
    if (m.lock) { const ob = await escAt(String(e.escrowIndex), m.lock.ledger); add(S_, `ロック中の ledger ${m.lock.ledger} に Escrow が存在`, "存在", ob ? "存在" : "なし", String(e.escrowIndex), Boolean(ob)); if (ob) lockedSum += parseDec(ob["Amount"].value); }
    expectD -= v;
    if (e.finishTx) {
      const f = T[e.finishTx]!;
      const ok = resultOf(e.finishTx) === "tesSUCCESS";
      add(S_, "EscrowFinish: 結果・送信者 S・Owner・OfferSequence", "tesSUCCESS / S / D / Sequence", `${resultOf(e.finishTx)} / ${nm(f.tx["Account"])} / ${nm(f.tx["Owner"])} / ${f.tx["OfferSequence"]}`, e.finishTx, ok && f.tx["Account"] === S && f.tx["Owner"] === D && f.tx["OfferSequence"] === e.sequence);
      if (ok) {
        const ful = String(f.tx["Fulfillment"]);
        add(S_, "Fulfillment の SHA-256 が Condition と一致（72 桁）", "一致", ful.length === 72 && ful.startsWith("A0228020") && `A0258020${createHash("sha256").update(Buffer.from(ful.slice(8), "hex")).digest("hex").toUpperCase()}810120` === e.condition.toUpperCase() ? "一致" : "不一致", e.finishTx);
        add(S_, "期限前に Finish（Finish ledger の close_time < CancelAfter）", "true", String(f.close < e.cancelAfter), `close_time=${f.close} CancelAfter=${e.cancelAfter}`);
        const sd = (await lineAt(S, f.ledger)) - (await lineAt(S, f.ledger - 1));
        const sm = lineDeltas(f.meta).filter((d) => d.currency === RL.currency && d.account === S && d.counterparty === RL.issuer).reduce((a, d) => a + d.delta, 0n);
        add(S_, "【店舗着金】S の RLUSD の実際の増加（確定残高の差 / メタデータ）。額面どおりか", `${fmtSigned(v)} / ${fmtSigned(v)}`, `${fmtSigned(sd)} / ${fmtSigned(sm)}`, e.finishTx, sd === v && sm === v);
        add(S_, "Finish で Escrow が消える（DeletedNode = 記録した ID）", String(e.escrowIndex), String(escrowNodes(f.meta).find((x) => x.kind === "deleted")?.index), e.finishTx);
        expectS += sd; expectD += 0n;
      }
    }
    if (e.cancelTx) {
      const k = T[e.cancelTx]!;
      const ok = resultOf(e.cancelTx) === "tesSUCCESS";
      add(S_, "EscrowCancel: 結果・送信者 K（D・S 以外）・Owner・OfferSequence", "tesSUCCESS / K / D / Sequence", `${resultOf(e.cancelTx)} / ${nm(k.tx["Account"])} / ${nm(k.tx["Owner"])} / ${k.tx["OfferSequence"]}`, e.cancelTx, ok && k.tx["Account"] === K && k.tx["Owner"] === D && k.tx["OfferSequence"] === e.sequence);
      if (ok) {
        add(S_, "【期限到来】記録した期限到来 ledger（close_time > CancelAfter）が取消 ledger 以前", "true", String(!!m.expiry && m.expiry.closeTime > e.cancelAfter && m.expiry.ledger <= k.ledger), m.expiry ? `ledger ${m.expiry.ledger} close_time=${m.expiry.closeTime} CancelAfter=${e.cancelAfter}` : "なし");
        add(S_, "【返還取引の確定】取消 ledger の close_time > CancelAfter", "true", String(k.close > e.cancelAfter), `ledger ${k.ledger} close_time=${k.close}`);
        const dd2 = (await lineAt(D, k.ledger)) - (await lineAt(D, k.ledger - 1));
        const ss = (await lineAt(S, k.ledger)) - (await lineAt(S, k.ledger - 1));
        add(S_, "【ドナー返還】取消前後の D の RLUSD 差 / S の差", `${fmtSigned(v)} / 0`, `${fmtSigned(dd2)} / ${fmtDec(ss)}`, e.cancelTx, dd2 === v && ss === 0n);
        add(S_, "取消で Escrow が消える", String(e.escrowIndex), String(escrowNodes(k.meta).find((x) => x.kind === "deleted")?.index), e.cancelTx);
        expectD += dd2;
      }
    }
  }
  if (m.lock) add("3 ロック中", "ロック中の Escrow 合計（ledger_entry の Amount の和）", m.lock.lockedTotal, fmtDec(lockedSum), `ledger ${m.lock.ledger}`);

  if (m.beforeExpiry) {
    const be = m.beforeExpiry, eb = m.escrows.find((x) => x.id === "B");
    const live = eb?.escrowIndex ? await escAt(eb.escrowIndex, be.ledger) : undefined;
    const x = await led(be.ledger);
    add("4 未使用・返還", `期限前（ledger ${be.ledger}、close_time < CancelAfter）に B が存在し、B 由来の S 着金がない（S は A の 0.1 のまま）`, "存在 / true / 0.1", `${live ? "存在" : "なし"} / ${x.close < be.cancelAfter} / ${fmtDec(await lineAt(S, be.ledger))}`, `ledger hash ${x.hash}`, Boolean(live) && x.close < be.cancelAfter && (await lineAt(S, be.ledger)) === parseDec(be.sRlusd));
  }
  // 5. 最終
  const [d0, d1, s0, s1] = [await lineAt(D, m.baseline.ledger), await lineAt(D, m.end.ledger), await lineAt(S, m.baseline.ledger), await lineAt(S, m.end.ledger)];
  add("5 最終検算", "D の RLUSD 純増減（開始 → 終了）", fmtSigned(expectD), fmtSigned(d1 - d0), `ledger ${m.baseline.ledger}→${m.end.ledger}`);
  add("5 最終検算", "S の RLUSD 純増減", fmtSigned(expectS), fmtSigned(s1 - s0), "同上");
  let sumD = 0n, sumS = 0n;
  for (const t of m.transactions.filter((x) => x.phase === "scenario")) for (const d of lineDeltas(T[t.hash]!.meta)) if (d.currency === RL.currency && d.counterparty === RL.issuer) { if (d.account === D) sumD += d.delta; if (d.account === S) sumS += d.delta; }
  add("5 最終検算", "確定残高の差 − 取引メタデータの合計（D / S の説明できない差額）", "0 / 0", `${fmtDec(d1 - d0 - sumD)} / ${fmtDec(s1 - s0 - sumS)}`, "独立した 2 つの集計");
  add("5 最終検算", "D+S の純増減（RLUSD 移転手数料なしなら −額 + 額 = 返還分を除いて 0）", "0", fmtDec(d1 - d0 + s1 - s0), "TransferRate なし");
  const objs = (await c.request({ command: "account_objects", account: D, type: "escrow", ledger_index: m.end.ledger } as never)) as unknown as { result: J };
  add("5 最終検算", "未決 Escrow（D のオブジェクト）", "0", String((objs.result["account_objects"] as J[]).length), `account_objects @${m.end.ledger}`);
  const known = new Set(m.transactions.map((t) => t.hash)), unk: string[] = [];
  for (const a of [D, S, K]) { let marker: unknown; do { const r = (await c.request({ command: "account_tx", account: a, ledger_index_min: m.baseline.ledger + 1, ledger_index_max: m.end.ledger, forward: true, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J }; for (const t of r.result["transactions"] as J[]) { const h = String(t["hash"] ?? t["tx_json"]?.["hash"]); if (!known.has(h)) unk.push(h); } marker = r.result["marker"]; } while (marker); }
  add("5 最終検算", "開始後に D・S・K に触れた manifest 外の取引", "0 件", `${new Set(unk).size} 件`, "account_tx");
  const fees: Record<string, bigint> = {};
  for (const t of m.transactions.filter((x) => x.phase === "scenario")) fees[nm(t.account)] = (fees[nm(t.account)] ?? 0n) + BigInt(String(T[t.hash]!.tx["Fee"]));
  const feeInfo = Object.fromEntries(Object.entries(fees).map(([k, x]) => [k, `${x} drops`]));

  let sec = "";
  for (const x of checks) { if (x.section !== sec) { sec = x.section; console.log(`\n■ ${sec}`); } console.log(`  ${x.ok ? "✓" : "✗"} ${x.name}\n      期待=${x.expected}  実際=${x.actual}  根拠=${x.evidence}`); }
  const bad = checks.filter((x) => !x.ok);
  console.log(`\n■ XRP 手数料（別表・今回分）: ${JSON.stringify(feeInfo)}`);
  console.log(`\n結果: ${checks.length - bad.length}/${checks.length} 項目が期待どおり。 D ${fmtSigned(d1 - d0)} / S ${fmtSigned(s1 - s0)} / 未決 Escrow ${(objs.result["account_objects"] as J[]).length}`);
  writeFileSync(outPath, JSON.stringify({ schema: "todoke-spike16-verify/1", verifiedAt: new Date().toISOString(), manifest: manifestPath, passed: bad.length === 0, total: checks.length, failed: bad.length, 純増減: { D: fmtSigned(d1 - d0), S: fmtSigned(s1 - s0) }, XRP手数料: feeInfo, checks }, null, 1));
  if (bad.length) { console.error(`期待と違う項目: ${bad.length}`); process.exitCode = 1; }
}
