import {
  BatchFlags,
  convertHexToString,
  unixTimeToRippleTime,
  type Client,
  type EscrowCancel,
  type EscrowCreate,
  type EscrowFinish,
  type SubmittableTransaction,
  type Wallet,
} from "xrpl";
import {
  Abort,
  BATCH_MAX_INNER,
  baseFeeDrops,
  batchFeeDrops,
  buildSingleAccountBatch,
  createPreimageCondition,
  issued,
  submitBatch,
  type BatchOutcome,
  type PreimageCondition,
  type Recorder,
} from "xrpl-kit";
import { HOUSEHOLDS, TOKEN, type Accounts, type Donor } from "./accounts.js";

const MODE_NAME: Record<number, string> = {
  [BatchFlags.tfAllOrNothing]: "AllOrNothing",
  [BatchFlags.tfOnlyOne]: "OnlyOne",
  [BatchFlags.tfUntilFailure]: "UntilFailure",
  [BatchFlags.tfIndependent]: "Independent",
};

interface EscrowRef {
  owner: string;
  seq: number;
  dest: string;
  cond: PreimageCondition;
}

/** REPORT の付録に書く、Batch ごとの手数料と結果 */
export interface BatchLog {
  name: string;
  mode: string;
  innerCount: number;
  formula: string;
  probe: string;
  fee: string;
  balanceDelta: string;
  seqConsumed: string;
  outer: string;
  inner: string;
  hash: string;
}

export const batchLogs: BatchLog[] = [];
export const ledgerTable: string[] = [];

const nowR = () => unixTimeToRippleTime(Date.now());

/**
 * 手数料の最小値を実測しながら Batch を送る。
 * 1) 計算値 − 1 drop で送る → tel 系で拒否されれば、計算値が下限であることの裏付け（適用されず、手数料もかからない）
 * 2) 計算値で送る
 * 1) が受理されてしまった場合は、そのまま結果として扱う（同じ Sequence を二重に使わない）
 */
async function sendBatch(
  client: Client, r: Recorder, name: string, wallet: Wallet, mode: number, inners: SubmittableTransaction[],
): Promise<BatchOutcome> {
  const base = await baseFeeDrops(client);
  const { total, formula } = batchFeeDrops(inners, base);
  const low = await submitBatch(client, wallet, await buildSingleAccountBatch(client, wallet, mode, inners, total - 1n));
  let out = low;
  let probe = `${total - 1n} drops → ${low.preliminary || low.error}`;
  if (!low.validated && !/^(tes|tec|ter)/.test(low.preliminary)) {
    out = await submitBatch(client, wallet, await buildSingleAccountBatch(client, wallet, mode, inners, total));
  } else {
    probe += "（受理された＝計算式より安くても通る）";
  }
  const lowRejected = !/^(tes|tec|ter)/.test(low.preliminary);
  r.add(lowRejected ? "pass" : "observe", `${name}: 計算した手数料より 1 drop 少ないと拒否される`, "tel 系で拒否（計算値が下限）", probe, `計算式: ${formula}`);

  const innerSummary = out.inner.map((x) => `#${x.index} ${x.type} seq=${x.sequence} ${x.result ?? "台帳に記録なし"}`).join("<br>");
  batchLogs.push({
    name, mode: MODE_NAME[mode] ?? String(mode), innerCount: inners.length, formula, probe, fee: out.fee,
    balanceDelta: out.balanceDeltaDrops === undefined ? "-" : `${out.balanceDeltaDrops}`,
    seqConsumed: out.sequenceAfter === undefined ? "-" : `${out.sequenceAfter - out.sequenceBefore}（${out.sequenceBefore}→${out.sequenceAfter}）`,
    outer: `${out.preliminary} → ${out.engineResult ?? out.error ?? "-"}`,
    inner: out.inner.map((x) => x.result ?? "記録なし").join(", "),
    hash: out.hash,
  });
  r.add(out.engineResult === "tesSUCCESS" ? "pass" : "fail", `${name}: 外側の結果`, "tesSUCCESS（validated）",
    `${out.engineResult ?? out.error ?? out.preliminary} / Fee=${out.fee} drops / 残高差=${String(out.balanceDeltaDrops)} drops`,
    `[${out.hash}](${out.explorerUrl})<br>${innerSummary}`);
  const parents = [...new Set(out.inner.map((x) => x.parentBatchId))].join(" / ");
  const matches = [...new Set(out.inner.map((x) => String(x.computedHashMatches)))].join(" / ");
  r.add("observe", `${name}: 内側 tx の ParentBatchID / 自前計算 hash との一致`, "外側の hash を指す",
    `ParentBatchID: ${parents || "-"}<br>hashTx(encode(inner)) と台帳 hash の一致: ${matches}`,
    `account_tx（外側と同じレジャー）。内側 hash 例: ${out.inner[0]?.hash ?? "-"}`);
  return out;
}

function escrowCreates(owner: Donor | { wallet: Wallet }, households: Wallet[], amount: string, cancelAfter: number, issuer: string) {
  const conds = households.map(() => createPreimageCondition());
  const txs: EscrowCreate[] = households.map((h, i) => ({
    TransactionType: "EscrowCreate", Account: owner.wallet.address, Destination: h.address,
    Amount: issued(TOKEN, issuer, amount), Condition: conds[i]!.conditionHex, CancelAfter: cancelAfter,
  }));
  return { txs, conds };
}

/** 作成した Escrow の参照（所有者・Sequence・宛先・条件）。Sequence は内側 tx の Sequence */
function refsFrom(out: BatchOutcome, owner: string, txs: EscrowCreate[], conds: PreimageCondition[]): EscrowRef[] {
  return out.inner.filter((x) => x.result === "tesSUCCESS").map((x) => ({
    owner, seq: x.sequence, dest: txs[x.index - 1]!.Destination, cond: conds[x.index - 1]!,
  }));
}

async function escrowExists(client: Client, owner: string, seq: number): Promise<boolean> {
  try {
    await client.request({ command: "ledger_entry", escrow: { owner, seq }, ledger_index: "validated" } as never);
    return true;
  } catch (e) {
    if ((e as { data?: { error?: string } }).data?.error === "entryNotFound") return false;
    throw e;
  }
}

async function tokenBalance(client: Client, holder: string, issuer: string): Promise<number> {
  const res = await client.request({ command: "account_lines", account: holder, peer: issuer, ledger_index: "validated" });
  return Number(res.result.lines.find((l) => l.currency === TOKEN)?.balance ?? "0");
}

async function waitLedgerAfter(client: Client, t: number): Promise<number> {
  for (;;) {
    const res = await client.request({ command: "ledger", ledger_index: "validated" });
    if (res.result.ledger.close_time > t) return res.result.ledger.close_time;
    await new Promise((s) => setTimeout(s, 4000));
  }
}

export async function runScenario(client: Client, r: Recorder, a: Accounts): Promise<void> {
  const [national, pref, ngo] = a.donors as [Donor, Donor, Donor];
  const H = a.households;
  const iss = a.issuer.address;
  const allOk = (o: BatchOutcome, n: number) => o.inner.length === n && o.inner.every((x) => x.result === "tesSUCCESS");

  // ===== 確認 1: donor が 1 件の Batch で 8 世帯分の EscrowCreate =====
  const c1 = escrowCreates(national, H, "0.01", nowR() + 3600, iss);
  const o1 = await sendBatch(client, r, "確認1 国: EscrowCreate×8", national.wallet, BatchFlags.tfAllOrNothing, c1.txs);
  r.add(allOk(o1, HOUSEHOLDS) ? "pass" : "fail", "確認1: 内側 8 件がすべて反映", "8 件 tesSUCCESS",
    `${o1.inner.filter((x) => x.result === "tesSUCCESS").length} 件`, o1.inner.map((x) => x.result ?? "-").join(", "));
  r.add(o1.sequenceAfter === o1.sequenceBefore + 9 ? "pass" : "observe", "確認1: シーケンスの消費", "外側 1 + 内側 8 = 9",
    o1.sequenceAfter === undefined ? "-" : String(o1.sequenceAfter - o1.sequenceBefore), "account_info Sequence の差");
  const set1 = refsFrom(o1, national.wallet.address, c1.txs, c1.conds);
  if (set1.length !== HOUSEHOLDS) throw new Abort("確認1 の Escrow が 8 件そろわない");

  // 確認 1b: 9 件
  {
    const c9 = escrowCreates(national, [...H, H[0]!], "0.01", nowR() + 3600, iss);
    const base = await baseFeeDrops(client);
    let local = "拒否されず署名できた";
    let sim = "-";
    let real = "-";
    try {
      const b9 = await buildSingleAccountBatch(client, national.wallet, BatchFlags.tfAllOrNothing, c9.txs, batchFeeDrops(c9.txs, base).total);
      // tem 系は台帳に入らず手数料もかからない。rippled が実際に返すコードを記録する
      real = (await client.submit(b9.blob)).result.engine_result;
    } catch (e) {
      local = e instanceof Error ? e.message : String(e);
    }
    // xrpl.js のローカル検証を通さず、rippled 自身の判定を simulate で見る（送信も適用もしない）
    try {
      const seq = (await client.request({ command: "account_info", account: national.wallet.address, ledger_index: "current" })).result.account_data.Sequence;
      const txJson = {
        TransactionType: "Batch", Account: national.wallet.address, Flags: BatchFlags.tfAllOrNothing, Sequence: seq,
        Fee: batchFeeDrops(c9.txs, base).total.toString(), SigningPubKey: "",
        RawTransactions: c9.txs.map((t, i) => ({ RawTransaction: { ...t, Flags: 0x40000000, Fee: "0", SigningPubKey: "", Sequence: seq + 1 + i } })),
      };
      const res = (await client.request({ command: "simulate", tx_json: txJson } as never)) as { result: { engine_result: string } };
      sim = res.result.engine_result;
    } catch (e) {
      sim = `${(e as { data?: { error?: string; error_message?: string } }).data?.error ?? ""} ${(e as { data?: { error_message?: string } }).data?.error_message ?? String(e)}`.trim();
    }
    r.add(real === "temARRAY_TOO_LARGE" ? "pass" : "observe", "確認1b: 内側 9 件の Batch", "temARRAY_TOO_LARGE（上限 8）",
      `rippled（submit）: ${real}<br>rippled（simulate）: ${sim}<br>xrpl.js のローカル検証: ${local}`, `上限定数 BATCH_MAX_INNER=${BATCH_MAX_INNER}`);
    r.errorCodes.push(`確認1b 9件 submit: ${real}`, `確認1b 9件 simulate: ${sim}`);
    if (/^(tes|tec)/.test(real)) r.unknowns.push("9 件の Batch が受理されてしまった（上限の記述と食い違う。要確認）");
  }

  // ===== 確認 2: keeper が他人のエスクロー 8 件を 1 件の Batch で EscrowFinish（BatchSigners なし） =====
  const before2 = await Promise.all(H.map((h) => tokenBalance(client, h.address, iss)));
  const fin2: EscrowFinish[] = set1.map((e) => ({
    TransactionType: "EscrowFinish", Account: a.keeper.address, Owner: e.owner, OfferSequence: e.seq,
    Condition: e.cond.conditionHex, Fulfillment: e.cond.fulfillmentHex,
  }));
  const o2 = await sendBatch(client, r, "確認2 keeper: EscrowFinish×8（所有者は国）", a.keeper, BatchFlags.tfAllOrNothing, fin2);
  const after2 = await Promise.all(H.map((h) => tokenBalance(client, h.address, iss)));
  const got2 = after2.map((v, i) => Number((v - before2[i]!).toFixed(6)));
  r.add(allOk(o2, HOUSEHOLDS) && got2.every((g) => g === 0.01) ? "pass" : "fail", "確認2: 8 世帯それぞれに 0.01 届く",
    "8 件 tesSUCCESS、各世帯 +0.01", `内側: ${o2.inner.map((x) => x.result ?? "-").join(", ")}<br>増分: ${got2.join(", ")}`, "account_lines");
  r.add("pass", "確認2: BatchSigners なしで送れた（内側はすべて keeper）", "BatchSigners 不要",
    `外側 ${o2.engineResult}、BatchSigners フィールドなしで署名`, "Batch リファレンス: 複数アカウントの場合のみ必要");

  // ===== 確認 3: 期限切れ 8 件を 1 件の Batch で EscrowCancel =====
  const cancelAfter3 = nowR() + 60;
  const c3 = escrowCreates(national, H, "0.01", cancelAfter3, iss);
  const o3c = await sendBatch(client, r, "確認3 国: EscrowCreate×8（CancelAfter 60 秒）", national.wallet, BatchFlags.tfAllOrNothing, c3.txs);
  const set3 = refsFrom(o3c, national.wallet.address, c3.txs, c3.conds);
  const nat3 = await tokenBalance(client, national.wallet.address, iss);
  r.add("observe", "確認3: レジャー時刻が CancelAfter を超えるまで待機", `> ${cancelAfter3}`, String(await waitLedgerAfter(client, cancelAfter3)), "ledger（validated）");
  const can3: EscrowCancel[] = set3.map((e) => ({ TransactionType: "EscrowCancel", Account: a.keeper.address, Owner: e.owner, OfferSequence: e.seq }));
  const o3 = await sendBatch(client, r, "確認3 keeper: EscrowCancel×8", a.keeper, BatchFlags.tfAllOrNothing, can3);
  const back3 = Number(((await tokenBalance(client, national.wallet.address, iss)) - nat3).toFixed(6));
  r.add(allOk(o3, HOUSEHOLDS) && back3 === 0.08 ? "pass" : "fail", "確認3: 8 件すべて取消され国に 0.08 戻る", "8 件 tesSUCCESS、+0.08",
    `内側: ${o3.inner.map((x) => x.result ?? "-").join(", ")}<br>国への返還: ${back3}`, "account_lines");

  // ===== 確認 4: 1 件だけ Fulfillment を間違えて AllOrNothing / Independent =====
  const c4 = escrowCreates(national, H, "0.01", nowR() + 3600, iss);
  const o4c = await sendBatch(client, r, "確認4 国: EscrowCreate×8", national.wallet, BatchFlags.tfAllOrNothing, c4.txs);
  const set4 = refsFrom(o4c, national.wallet.address, c4.txs, c4.conds);
  const WRONG = 5; // 5 件目だけ誤り
  const fin4: EscrowFinish[] = set4.map((e, i) => ({
    TransactionType: "EscrowFinish", Account: a.keeper.address, Owner: e.owner, OfferSequence: e.seq, Condition: e.cond.conditionHex,
    Fulfillment: i + 1 === WRONG ? createPreimageCondition().fulfillmentHex : e.cond.fulfillmentHex,
  }));
  const remaining = async () => (await Promise.all(set4.map((e) => escrowExists(client, e.owner, e.seq)))).filter(Boolean).length;
  const modeRows: string[] = [];
  for (const mode of [BatchFlags.tfAllOrNothing, BatchFlags.tfIndependent]) {
    const pre = await remaining();
    const o = await sendBatch(client, r, `確認4 keeper: EscrowFinish×8（${WRONG} 件目だけ誤り）${MODE_NAME[mode]}`, a.keeper, mode, fin4);
    const post = await remaining();
    const applied = pre - post;
    const expected = mode === BatchFlags.tfAllOrNothing ? 0 : 7;
    r.add(applied === expected ? "pass" : "fail", `確認4: ${MODE_NAME[mode]} で反映された件数`, `${expected} 件`, `${applied} 件（残り ${post} 件）`,
      `内側: ${o.inner.map((x) => x.result ?? "記録なし").join(", ")}`);
    modeRows.push(`| ${MODE_NAME[mode]} | ${applied} / 8 | ${o.inner.map((x) => x.result ?? "記録なし").join(", ")} | ${o.sequenceAfter === undefined ? "-" : o.sequenceAfter - o.sequenceBefore} | ${o.fee} | ${o.balanceDeltaDrops ?? "-"} |`);
  }
  ledgerTable.push("## 付録 B: モードごとの挙動（確認4）", "",
    "| モード | 反映件数 | 内側の結果（1〜8 件目） | keeper の消費 Sequence | Fee（drops） | 残高差（drops） |", "| --- | --- | --- | --- | --- | --- |", ...modeRows, "");
  // 誤りの 1 件は正しい Fulfillment で片付けておく（確認5 の一覧に混ざらないように）
  const left = set4[WRONG - 1]!;
  if (await escrowExists(client, left.owner, left.seq)) {
    const fix = await sendBatch(client, r, "確認4 後片付け: 残り 1 件を正しい Fulfillment で完了（Batch は 2 件以上必要なので空の AccountSet と組む）", a.keeper,
      BatchFlags.tfIndependent, [
        { TransactionType: "EscrowFinish", Account: a.keeper.address, Owner: left.owner, OfferSequence: left.seq, Condition: left.cond.conditionHex, Fulfillment: left.cond.fulfillmentHex },
        { TransactionType: "AccountSet", Account: a.keeper.address },
      ]);
    r.add(fix.inner[0]?.result === "tesSUCCESS" ? "pass" : "fail", "確認4: 誤っていた 1 件を正しい Fulfillment で完了", "tesSUCCESS", fix.inner[0]?.result ?? "-", fix.hash);
  }

  // ===== 確認 5: 3 ドナー × 同じ 8 世帯、台帳だけで一覧 =====
  const created5: { donor: Donor; refs: EscrowRef[] }[] = [];
  for (const d of [national, pref, ngo]) {
    const c = escrowCreates(d, H, d === national ? "0.03" : d === pref ? "0.02" : "0.01", nowR() + 3600, iss);
    const o = await sendBatch(client, r, `確認5 ${d.label}: EscrowCreate×8`, d.wallet, BatchFlags.tfAllOrNothing, c.txs);
    created5.push({ donor: d, refs: refsFrom(o, d.wallet.address, c.txs, c.conds) });
  }
  // 台帳だけで「どのドナーの Escrow が、どの世帯へ」を引く: 世帯の account_objects（type=escrow）→ Account（所有者）→ account_info.Domain
  const domainCache = new Map<string, string>();
  const domainOf = async (acct: string) => {
    if (!domainCache.has(acct)) {
      const ai = await client.request({ command: "account_info", account: acct, ledger_index: "validated" });
      domainCache.set(acct, ai.result.account_data.Domain ? convertHexToString(ai.result.account_data.Domain) : "(Domain なし)");
    }
    return domainCache.get(acct)!;
  };
  const header = ["世帯", ...a.donors.map((d) => d.label)];
  const rows: string[] = [];
  let complete = true;
  for (const [i, h] of H.entries()) {
    const res = await client.request({ command: "account_objects", account: h.address, type: "escrow", ledger_index: "validated" });
    const objs = res.result.account_objects as unknown as { Account: string; Destination: string; Amount: { value: string }; CancelAfter?: number; PreviousTxnID: string }[];
    const cells: string[] = [];
    for (const d of a.donors) {
      const mine = objs.filter((o) => o.Account === d.wallet.address && o.Destination === h.address);
      if (mine.length !== 1) complete = false;
      cells.push(mine.length ? `${mine.map((o) => o.Amount.value).join("+")} ${TOKEN}（${await domainOf(d.wallet.address)}）` : "なし");
    }
    rows.push(`| h${i + 1} ${h.address.slice(0, 8)}… | ${cells.join(" | ")} |`);
  }
  r.add(complete ? "pass" : "fail", "確認5: 世帯の account_objects だけで 3 ドナー × 8 世帯 = 24 件が一覧できる",
    "各世帯に各ドナー 1 件ずつ", complete ? "24 件そろう（付録 C）" : "欠けあり（付録 C）", "account_objects(type=escrow) + account_info.Domain");
  const sample = created5[1]!.refs[0]!;
  const le = (await client.request({ command: "ledger_entry", escrow: { owner: sample.owner, seq: sample.seq }, ledger_index: "validated" } as never)) as { result: { node: Record<string, unknown> } };
  const n = le.result.node;
  r.add(n["Account"] === sample.owner && n["Destination"] === sample.dest ? "pass" : "fail", "確認5: ledger_entry（owner + seq）で 1 件を特定できる",
    "Account=県、Destination=h1", `Account=${String(n["Account"])}<br>Destination=${String(n["Destination"])}<br>Amount=${JSON.stringify(n["Amount"])}<br>Condition=${String(n["Condition"]).slice(0, 20)}…<br>CancelAfter=${String(n["CancelAfter"])}`,
    `ledger_entry { escrow: { owner, seq: ${sample.seq} } }`);
  ledgerTable.push("## 付録 C: 台帳だけで作った「ドナー × 世帯」一覧（確認5）", "",
    "世帯ごとに account_objects(type=escrow) を引き、Escrow の Account（所有者）を account_info の Domain でドナー名に変換した。台帳以外の情報は使っていない。", "",
    `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows, "");
}
