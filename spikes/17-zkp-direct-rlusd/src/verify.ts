/**
 * 読み取り専用の検算。署名・送信・世帯秘密・.env.local を一切使わない。
 *   pnpm --filter 17-zkp-direct-rlusd verify                      results/ の manifest・proofs・trust を検算
 *   ... verify -- --manifest <p> --proofs <p> --trust <p> --out <p> --official
 *
 * 外部から信頼する入力（明示）:
 *   (1) trust.json: 承認済みの名簿 root、制度 ID・制度条件、制度とドナーの対応、資産（通貨・発行者）。発券側が選ぶ値
 *   (2) 回路（spike 13 の eligibility_bound、コミット済み）と、そこから計算した検証鍵（SHA-256 を manifest と照合）
 *   (3) 公開 Testnet の validated 履歴（取引・メタデータ・ledger_entry・account_lines）
 * 照合するのは、台帳の実際の EscrowCreate から復元した申請（owner・Destination・Amount の currency/issuer/value・期限・Condition・Memo の鍵ハッシュ）に、
 * 公開入力の制度 ID を組み合わせて v2 ダイジェストを再計算し、本物の証明の公開入力 req_hi/req_lo と一致すること。
 * 申請 JSON（proofs.json の req）は使わない（申請者側の主張にすぎない）。Memo の鍵ハッシュは店頭が検査する項目で、XRPL が署名を検証するものではない。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "xrpl";
import { type Req, digestToFields, hex } from "../../13-zk-bound-voucher/src/lib.js";
import { PUBLIC_NAMES, Zk, expectedPublicInputs } from "../../13-zk-bound-voucher/src/zk.js";
import { fmtDec, fmtSigned, parseDec } from "../../15-multi-donor-rlusd/src/dec.js";
import { escrowNodes, lineDeltas } from "../../15-multi-donor-rlusd/src/deltas.js";
import { OFFICIAL_PAGE } from "./config.js";
import { canonicalCurrency, requestDigestV2 } from "./reqv2.js";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PKG = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const manifestPath = argOf("--manifest") ?? `${PKG}results/manifest.json`;
const dir = manifestPath.replace(/[^/]*$/, "");
const proofsPath = argOf("--proofs") ?? `${dir}proofs.json`;
const trustPath = argOf("--trust") ?? `${dir}trust.json`;
const outPath = argOf("--out") ?? manifestPath.replace(/manifest(\.[^/]*)?\.json$/, "verify$1.json");

interface Tk { id: string; program: "P" | "N"; donor: string; shop: string; value: string; cancelAfter: number; condition: string; pkHash: string; offerSequence: number; escrowIndex: string; createTx: string; nullifier: string; outcome: "used" | "expired"; finalRecipient: "S" | "N"; finishTx: string | null; cancelTx: string | null }
interface Tx { label: string; phase: string; ticket: string | null; account: string; type: string; hash: string; expect: string; ledger: number }
interface Led { ledger: number; hash: string; closeTime: number }
interface M { network: { endpoint: string; network_id: number | null }; official: { issuer: string; currency: string; source: string; fetchedAt: string }; asset: { currency: string; issuer: string }; accounts: Record<"P" | "N" | "S" | "K", string>; baseline: Led & { balances: Record<string, string> }; end: Led; beforeExpiryC: (Led & { cancelAfter: number; escrowExists: boolean; sRlusd: string }) | null; expiryC: Led | null; vkSha256: string; tickets: Tk[]; acceptance: Record<string, J>; transactions: Tx[] }
const m = JSON.parse(readFileSync(manifestPath, "utf8")) as M;
const proofs = JSON.parse(readFileSync(proofsPath, "utf8")) as { vkSha256: string; tickets: Record<string, { proofHex: string; publicInputs: string[] }> };
const trust = JSON.parse(readFileSync(trustPath, "utf8")) as { rosterRoot: string; asset: { currency: string; issuer: string }; programs: Record<"P" | "N", { id: string; owner: string; zoneSet: string[]; needSenior: boolean; needRevictim: boolean; minTier: number }> };
const host = new URL(m.network.endpoint).hostname;
if (!["s.altnet.rippletest.net", "clio.altnet.rippletest.net"].includes(host)) throw new Error(`Testnet 以外には接続しない: ${host}`);
const A = m.accounts;
const nm = (a: string) => Object.entries(A).find(([, v]) => v === a)?.[0] ?? a;

interface Check { section: string; name: string; expected: string; actual: string; ok: boolean; evidence: string }
const checks: Check[] = [];
const add = (section: string, name: string, expected: string, actual: string, evidence: string, ok = expected === actual) => { checks.push({ section, name, expected, actual, ok, evidence }); };
const c = new Client(m.network.endpoint); await c.connect();
const zk = new Zk();
const RL = m.asset;
const led = async (i: number) => { const r = (await c.request({ command: "ledger", ledger_index: i })).result; return { hash: String(r.ledger_hash), close: Number(r.ledger.close_time) }; };
async function lineAt(a: string, l: number) { const r = (await c.request({ command: "account_lines", account: a, peer: RL.issuer, ledger_index: l, limit: 400 } as never)) as unknown as { result: J }; const x = (r.result["lines"] as J[]).find((y) => y["currency"] === RL.currency); return x ? parseDec(x["balance"]) : 0n; }
const escAt = async (idx: string, l: number) => { try { return ((await c.request({ command: "ledger_entry", index: idx, ledger_index: l } as never)) as unknown as { result: J }).result["node"] as J; } catch (e) { if ((e as { data?: { error?: string } }).data?.error === "entryNotFound") return undefined; throw e; } };
try { await main(); } finally { await zk.close().catch(() => undefined); await c.disconnect(); }

async function main() {
  console.log(`# 検算: spike 17 資格→発券→オフライン受付→直接 RLUSD 決済→返還  manifest=${manifestPath}\n  基準 ledger ${m.baseline.ledger} → 終了 ${m.end.ledger}。読み取りのみ。`);
  await zk.init();
  // 0 前提
  const si = (await c.request({ command: "server_info" })).result.info;
  add("0 前提", "ネットワーク（network_id=1）", "1", String(si.network_id ?? "?"), "server_info");
  for (const [n, l] of [["基準", m.baseline], ["期限到来", m.expiryC], ["終了", m.end]] as const) if (l) { const x = await led(l.ledger); add("0 前提", `ledger ${l.ledger}（${n}）の hash・close_time が記録と一致`, `${l.hash} / ${l.closeTime}`, `${x.hash} / ${x.close}`, `ledger ${l.ledger}`); }
  const iss = (await c.request({ command: "account_info", account: RL.issuer, ledger_index: m.end.ledger })).result.account_data as J;
  add("0 前提", "RLUSD の発行者が台帳に実在し Domain がある・TransferRate なし", "実在 / なし", `${iss["Domain"] ? "実在" : "Domain なし"} / ${iss["TransferRate"] ? `あり ${iss["TransferRate"]}` : "なし"}`, RL.issuer, Boolean(iss["Domain"]) && !iss["TransferRate"]);
  add("0 前提", "信頼する設定の資産 = manifest の資産 = 公式ページで確認した組", `${trust.asset.issuer}/${trust.asset.currency}`, `${RL.issuer}/${RL.currency} ; ${m.official.issuer}/${m.official.currency}`, `${m.official.source} 取得 ${m.official.fetchedAt}`, trust.asset.issuer === RL.issuer && trust.asset.currency === RL.currency && m.official.issuer === RL.issuer && canonicalCurrency(m.official.currency) === RL.currency);
  if (args.includes("--official")) {
    const t = (await (await fetch(OFFICIAL_PAGE)).text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const mm = /XRPL Testnet Issued currency Trustline required Explorer RLUSD issuer \S+ (r[1-9A-HJ-NP-Za-km-z]{24,34})/.exec(t);
    add("0 前提", "（--official）今の公式ページの発行者", RL.issuer, mm?.[1] ?? "読み取れない", OFFICIAL_PAGE);
  }
  add("0 前提", "検証鍵（回路から計算）の SHA-256 が manifest・proofs と一致", `${m.vkSha256} / ${proofs.vkSha256}`, `${createHash("sha256").update(zk.vk).digest("hex").toUpperCase()} / ${proofs.vkSha256}`, "eligibility_bound（spike 13）", createHash("sha256").update(zk.vk).digest("hex").toUpperCase() === m.vkSha256 && m.vkSha256 === proofs.vkSha256);

  // 1 取引
  const T: Record<string, { tx: J; meta: J; ledger: number; close: number; hash: string }> = {};
  for (const t of m.transactions) {
    const r = ((await c.request({ command: "tx", transaction: t.hash } as never)) as unknown as { result: J }).result;
    const tj = (r["tx_json"] ?? r) as J, l = await led(r["ledger_index"]);
    T[t.hash] = { tx: tj, meta: r["meta"], ledger: r["ledger_index"], close: l.close, hash: l.hash };
    add("1 取引の確定", t.label, `${t.expect} / validated / ledger ${t.ledger} / ${t.account}`, `${r["meta"]["TransactionResult"]} / ${r["validated"] ? "validated" : "未validated"} / ledger ${r["ledger_index"]} / ${tj["Account"]}`, `${t.hash}（ledger hash ${l.hash}）`, r["meta"]["TransactionResult"] === t.expect && r["validated"] === true && r["ledger_index"] === t.ledger && tj["Account"] === t.account);
  }
  const sc = m.transactions.filter((t) => t.phase === "scenario");
  const cnt = (ty: string) => sc.filter((t) => t.type === ty).length;
  add("1 取引の確定", "給付区間の取引: EscrowCreate 3・EscrowFinish 2・EscrowCancel 1（ZKV・交換注文・Payment なし）", "3/2/1/その他0", `${cnt("EscrowCreate")}/${cnt("EscrowFinish")}/${cnt("EscrowCancel")}/その他${sc.length - cnt("EscrowCreate") - cnt("EscrowFinish") - cnt("EscrowCancel")}`, "manifest");

  // 2 券ごと: 台帳 → 申請の復元 → v2 ダイジェスト → 証明
  const expectDelta: Record<string, bigint> = { P: 0n, N: 0n, S: 0n };
  const nulls: string[] = [];
  for (const k of m.tickets) {
    const S_ = `2 券 ${k.id}（${k.value} RLUSD）`;
    const miss = [k.createTx, k.finishTx, k.cancelTx].filter((h): h is string => Boolean(h)).filter((h) => !T[h]);
    if (miss.length) { add(S_, "券の取引がすべて manifest に含まれる", "全部", `欠落 ${miss.join(",")}`, "manifest", false); continue; }
    if (k.outcome === "used" ? !k.finishTx : !k.cancelTx) { add(S_, "券の結末に必要な取引が manifest にある", "あり", "なし", "manifest", false); continue; }
    const cr = T[k.createTx]!, v = parseDec(k.value);
    const amt = cr.tx["Amount"] as J;
    const node = escrowNodes(cr.meta).find((e) => e.kind === "created");
    add(S_, "EscrowCreate: 資産は公式 RLUSD（Amount の currency・issuer）で、額面・持ち主・宛先（≠持ち主）が記録どおり", "一致", amt.currency === RL.currency && amt.issuer === RL.issuer && parseDec(amt.value) === v && cr.tx["Account"] === k.donor && cr.tx["Destination"] === A.S && k.donor !== A.S ? "一致" : "不一致", k.createTx);
    add(S_, "Escrow の生成（CreatedNode = 記録した ID）・Sequence・CancelAfter・Condition", "一致", node?.index === k.escrowIndex && cr.tx["Sequence"] === k.offerSequence && cr.tx["CancelAfter"] === k.cancelAfter && String(cr.tx["Condition"]).toUpperCase() === k.condition.toUpperCase() ? "一致" : "不一致", `Escrow ${k.escrowIndex}`);
    const lockD = lineDeltas(cr.meta).filter((d) => d.currency === RL.currency && d.account === k.donor && d.counterparty === RL.issuer).reduce((a, d) => a + d.delta, 0n);
    add(S_, "ロック: ドナーの RLUSD が額面ぶん減る・店舗は動かない", `${fmtSigned(-v)} / 0`, `${fmtSigned(lockD)} / ${fmtDec((await lineAt(A.S, cr.ledger)) - (await lineAt(A.S, cr.ledger - 1)))}`, k.createTx, lockD === -v && (await lineAt(A.S, cr.ledger)) === (await lineAt(A.S, cr.ledger - 1)));
    // 台帳から申請を復元して v2 ダイジェストを再計算し、証明の公開入力と照合
    const pr = proofs.tickets[k.id];
    if (!pr) { add(S_, "証明が proofs にある", "あり", "なし", proofsPath, false); continue; }
    const pi = pr.publicInputs.map((x) => BigInt(x));
    const progKey = (["P", "N"] as const).find((p) => BigInt(trust.programs[p].id) === pi[PUBLIC_NAMES.indexOf("program_id")]);
    add(S_, "公開入力の制度 ID が信頼する制度のどれか・その制度の owner = 台帳の EscrowCreate の持ち主（ドナーとの対応）", `${k.program} / ${k.donor}`, `${progKey ?? "不明"} / ${progKey ? trust.programs[progKey].owner : "-"}`, "trust.json と公開入力", progKey === k.program && trust.programs[progKey]!.owner === cr.tx["Account"]);
    const mc = /^A0258020([0-9A-F]{64})810120$/.exec(String(cr.tx["Condition"]).toUpperCase());
    const memo = ((cr.tx["Memos"] ?? []) as J[]).map((x) => x["Memo"] as J)[0];
    const units = parseDec(amt.value) % 1_000_000_000n === 0n ? parseDec(amt.value) / 1_000_000_000n : -1n;
    let digestOk = false, ledgerReq = "復元できない";
    if (mc && memo && units > 0n && progKey) {
      const req: Req = { programId: pi[PUBLIC_NAMES.indexOf("program_id")]!, owner: cr.tx["Account"], shop: cr.tx["Destination"], currency: canonicalCurrency(amt.currency), issuer: amt.issuer, valueUnits: units, cancelAfter: cr.tx["CancelAfter"], pkHash: String(memo["MemoData"]).toUpperCase(), conditionHash: mc[1]! };
      const { hi, lo } = digestToFields(await requestDigestV2(req));
      digestOk = pi[PUBLIC_NAMES.indexOf("req_hi")] === hi && pi[PUBLIC_NAMES.indexOf("req_lo")] === lo;
      ledgerReq = `台帳由来: owner・shop・currency・issuer・value=${units}・cancelAfter・Condition・Memo 鍵ハッシュ ／ 事前設定由来: 制度 ID（公開入力 + trust.json）`;
      const stm = trust.programs[progKey];
      const exp = expectedPublicInputs({ root: BigInt(trust.rosterRoot), programId: BigInt(stm.id), zoneSet: stm.zoneSet.map(BigInt), needSenior: stm.needSenior, needRevictim: stm.needRevictim, minTier: stm.minTier }, pi[PUBLIC_NAMES.indexOf("req_hi")]!, pi[PUBLIC_NAMES.indexOf("req_lo")]!, pi[PUBLIC_NAMES.indexOf("nullifier")]!, pi[PUBLIC_NAMES.indexOf("req_tag")]);
      add(S_, "公開入力（名簿 root・制度 ID・制度条件）が信頼する設定と完全一致", "一致", exp.every((e, i) => pi[i] === e) && pi.length === PUBLIC_NAMES.length ? "一致" : "不一致", "expectedPublicInputs（spike 13）");
    }
    add(S_, "【台帳の EscrowCreate から復元した申請の v2 ダイジェスト = 証明の req_hi/req_lo】", "一致", digestOk ? "一致" : "不一致", ledgerReq, digestOk);
    add(S_, "本物の ZK 証明の検証（bb.js、検証鍵は回路から）", "true", String((await zk.verify({ proof: Uint8Array.from(Buffer.from(pr.proofHex, "hex")), publicInputs: pr.publicInputs })).ok), "UltraHonk verify");
    const nul = String(pi[PUBLIC_NAMES.indexOf("nullifier")]);
    add(S_, "nullifier が manifest と一致", k.nullifier, nul, "公開入力"); nulls.push(`${progKey}:${nul}`);
    expectDelta[k.donor === A.P ? "P" : "N"]! -= v;
    // Finish / Cancel が対応する Create を消費したか
    if (k.outcome === "used") {
      const f = T[k.finishTx!]!, ok = f.meta["TransactionResult"] === "tesSUCCESS";
      add(S_, "EscrowFinish: 送信者 S・Owner・OfferSequence が Create に対応し、消した Escrow がその券のもの", "S / 一致", `${nm(f.tx["Account"])} / ${f.tx["Owner"] === k.donor && f.tx["OfferSequence"] === k.offerSequence && escrowNodes(f.meta).find((e) => e.kind === "deleted")?.index === k.escrowIndex ? "一致" : "不一致"}`, k.finishTx!, ok && f.tx["Account"] === A.S);
      const ful = String(f.tx["Fulfillment"]);
      add(S_, "Fulfillment の SHA-256 が Condition と一致（72 桁）", "一致", ful.length === 72 && ful.startsWith("A0228020") && `A0258020${createHash("sha256").update(Buffer.from(ful.slice(8), "hex")).digest("hex").toUpperCase()}810120` === k.condition.toUpperCase() ? "一致" : "不一致", k.finishTx!);
      add(S_, "期限前に Finish（close_time < CancelAfter）", "true", String(f.close < k.cancelAfter), `close_time=${f.close} CancelAfter=${k.cancelAfter}`);
      const sd = (await lineAt(A.S, f.ledger)) - (await lineAt(A.S, f.ledger - 1));
      add(S_, "【店舗着金】S の RLUSD の増加（確定残高の差）が額面どおり", fmtSigned(v), fmtSigned(sd), k.finishTx!);
      expectDelta["S"]! += sd;
      const ac = m.acceptance[k.id];
      add(S_, "店頭受付の記録: 通信の試み 0・「使える」・同期データに当該 Escrow・精算の Fulfillment が受付時に保存した値と一致", "0 / 使える / true / true", ac ? `${ac["netAttempts"]} / ${ac["reason"]} / ${ac["syncIncludesTicket"]} / ${ac["fulfillmentSha256"] === createHash("sha256").update(Buffer.from(ful.slice(8), "hex")).digest("hex").toUpperCase()}` : "記録なし", "manifest.acceptance（オフライン受付は第三者が再現できない記録。同期データの SHA-256 のみ公開）", Boolean(ac) && ac!["netAttempts"] === 0 && ac!["reason"] === "使える" && ac!["syncIncludesTicket"] === true && ac!["fulfillmentSha256"] === createHash("sha256").update(Buffer.from(ful.slice(8), "hex")).digest("hex").toUpperCase());
    } else {
      const k2 = T[k.cancelTx!]!, ok = k2.meta["TransactionResult"] === "tesSUCCESS";
      add(S_, "EscrowCancel: 送信者 keeper K（ドナー・店舗以外）・Owner・OfferSequence・消えた Escrow", "K / 一致", `${nm(k2.tx["Account"])} / ${k2.tx["Owner"] === k.donor && k2.tx["OfferSequence"] === k.offerSequence && escrowNodes(k2.meta).find((e) => e.kind === "deleted")?.index === k.escrowIndex ? "一致" : "不一致"}`, k.cancelTx!, ok && k2.tx["Account"] === A.K);
      add(S_, "【期限到来】記録した ledger（close_time > CancelAfter）が取消 ledger 以前", "true", String(!!m.expiryC && m.expiryC.closeTime > k.cancelAfter && m.expiryC.ledger <= k2.ledger), m.expiryC ? `ledger ${m.expiryC.ledger} close_time=${m.expiryC.closeTime} CancelAfter=${k.cancelAfter}` : "なし");
      add(S_, "【返還取引の確定】取消 ledger の close_time > CancelAfter", "true", String(k2.close > k.cancelAfter), `ledger ${k2.ledger} close_time=${k2.close}`);
      const dd = (await lineAt(k.donor, k2.ledger)) - (await lineAt(k.donor, k2.ledger - 1)), ss = (await lineAt(A.S, k2.ledger)) - (await lineAt(A.S, k2.ledger - 1));
      add(S_, "【ドナー返還】取消前後の N の RLUSD 差 / 同取引での S の差", `${fmtSigned(v)} / 0`, `${fmtSigned(dd)} / ${fmtDec(ss)}`, k.cancelTx!, dd === v && ss === 0n);
      expectDelta[k.donor === A.P ? "P" : "N"]! += dd;
      add(S_, "この券に EscrowFinish は一度も送られていない", "0 件", `${sc.filter((t) => t.type === "EscrowFinish" && T[t.hash]!.tx["Owner"] === k.donor && T[t.hash]!.tx["OfferSequence"] === k.offerSequence).length} 件`, "manifest + 取引");
    }
  }
  const c0 = m.tickets.find((t) => t.id === "C");
  if (c0 && m.beforeExpiryC) {
    const b = m.beforeExpiryC, x = await led(b.ledger), e = await escAt(c0.escrowIndex, b.ledger);
    add("2 券 C", `期限前（ledger ${b.ledger}）に C の Escrow が存在し、C 由来の S 着金なし（S は A・B の合計のまま）`, "存在 / true / 0.15", `${e ? "存在" : "なし"} / ${x.close < c0.cancelAfter} / ${fmtDec(await lineAt(A.S, b.ledger))}`, `ledger hash ${x.hash}`, Boolean(e) && x.close < c0.cancelAfter && (await lineAt(A.S, b.ledger)) === parseDec("0.15"));
  }
  add("2 券", "制度ごとの nullifier の一意（同じ制度内で重複なし）と、A（P）と B（N）の nullifier が異なる", "重複なし / 異なる", `${new Set(nulls).size === nulls.length ? "重複なし" : "重複あり"} / ${m.tickets.find((t) => t.id === "A")?.nullifier !== m.tickets.find((t) => t.id === "B")?.nullifier ? "異なる" : "同じ"}`, "公開入力");

  // 3 最終
  const net: Record<string, bigint> = {};
  for (const k of ["P", "N", "S"] as const) {
    const [b0, b1] = [await lineAt(A[k], m.baseline.ledger), await lineAt(A[k], m.end.ledger)];
    net[k] = b1 - b0;
    add("3 最終検算", `${k}: RLUSD の純増減（基準 ${m.baseline.ledger} → 終了 ${m.end.ledger}）。期待は券の結末から計算`, fmtSigned(expectDelta[k]!), fmtSigned(b1 - b0), "account_lines（validated ledger 指定）");
    let sm = 0n; for (const t of sc) for (const d of lineDeltas(T[t.hash]!.meta)) if (d.currency === RL.currency && d.counterparty === RL.issuer && d.account === A[k]) sm += d.delta;
    add("3 最終検算", `${k}: 確定残高の差 − 取引メタデータの合計（説明できない差額）`, "0", fmtDec(b1 - b0 - sm), "独立した 2 つの集計");
  }
  add("3 最終検算", "P+N+S の純増減の合計（TransferRate なし・額面どおり）", "0.1 + 0.05 に対し S が +0.15 で相殺 = 0", fmtDec(net["P"]! + net["N"]! + net["S"]!), "P −0.10 / N −0.05 / S +0.15", net["P"]! + net["N"]! + net["S"]! === 0n);
  let open = 0; for (const k of ["P", "N", "S"] as const) { const o = (await c.request({ command: "account_objects", account: A[k], type: "escrow", ledger_index: m.end.ledger } as never)) as unknown as { result: J }; open += (o.result["account_objects"] as J[]).length; }
  add("3 最終検算", "未決 Escrow（P・N・S のオブジェクト。対象 3 券すべて解消）", "0", String(open), `account_objects @${m.end.ledger}`);
  const known = new Set(m.transactions.map((t) => t.hash)), unk = new Set<string>();
  for (const k of ["P", "N", "S", "K"] as const) { let marker: unknown; do { const r = (await c.request({ command: "account_tx", account: A[k], ledger_index_min: m.baseline.ledger + 1, ledger_index_max: m.end.ledger, forward: true, limit: 400, ...(marker ? { marker } : {}) } as never)) as unknown as { result: J }; for (const t of r.result["transactions"] as J[]) { const h = String(t["hash"] ?? t["tx_json"]?.["hash"]); if (!known.has(h)) unk.add(h); } marker = r.result["marker"]; } while (marker); }
  add("3 最終検算", "基準より後に P・N・S・K に触れた manifest 外の取引", "0 件", `${unk.size} 件`, "account_tx");
  const fees: Record<string, bigint> = {};
  for (const t of sc) fees[nm(t.account)] = (fees[nm(t.account)] ?? 0n) + BigInt(String(T[t.hash]!.tx["Fee"]));
  const feeInfo = Object.fromEntries(Object.entries(fees).map(([k, x]) => [k, `${x} drops`]));

  let sec = "";
  for (const x of checks) { if (x.section !== sec) { sec = x.section; console.log(`\n■ ${sec}`); } console.log(`  ${x.ok ? "✓" : "✗"} ${x.name}\n      期待=${x.expected}  実際=${x.actual}  根拠=${x.evidence}`); }
  const bad = checks.filter((x) => !x.ok);
  console.log(`\n■ XRP 手数料（別表・給付区間）: ${JSON.stringify(feeInfo)}`);
  console.log(`\n結果: ${checks.length - bad.length}/${checks.length} 項目が期待どおり。 P ${fmtSigned(net["P"]!)} / N ${fmtSigned(net["N"]!)} / S ${fmtSigned(net["S"]!)} / 未決 Escrow ${open} / manifest 外の取引 ${unk.size} 件`);
  writeFileSync(outPath, JSON.stringify({ schema: "todoke-spike17-verify/1", verifiedAt: new Date().toISOString(), manifest: manifestPath, passed: bad.length === 0, total: checks.length, failed: bad.length, 純増減: { P: fmtSigned(net["P"]!), N: fmtSigned(net["N"]!), S: fmtSigned(net["S"]!) }, 未決Escrow: open, XRP手数料: feeInfo, checks }, null, 1));
  if (bad.length) { console.error(`期待と違う項目: ${bad.length}`); process.exitCode = 1; }
}
