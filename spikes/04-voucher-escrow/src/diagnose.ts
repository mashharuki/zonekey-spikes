/**
 * 読み取り専用の診断。取引は送らない（simulate は送信も適用もしない）。
 * 償還（受給証 → RLUSD）が tecKILLED になる原因を、板・資金・経路・代替の償還方法で切り分ける。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OfferCreateFlags, type Client, type SubmittableTransaction } from "xrpl";
import { RLUSD_CURRENCY, RLUSD_TESTNET_ISSUER, connectTestnet, loadEnvLocal, walletFromEnv } from "xrpl-kit";
import { VOUCHER } from "./scenario.js";

const HERE = fileURLToPath(import.meta.url);
const OUT = fileURLToPath(new URL("../DIAGNOSE.md", import.meta.url));
const KILLED_TX = process.argv[2] ?? "1C0356BAFAD55D0BB0FBCAE59B209BE8118B934E3E9B633B7469FFC262D55DA7";
loadEnvLocal(HERE);

const out: string[] = ["# 04 償還 tecKILLED の診断（読み取り専用）", ""];
const sec = (t: string, v: unknown) => {
  out.push(`## ${t}`, "", "```json", JSON.stringify(v, null, 2), "```", "");
  console.log(`\n== ${t}\n${JSON.stringify(v, null, 2).slice(0, 1500)}`);
};
const req = async (c: Client, r: Record<string, unknown>): Promise<unknown> => {
  try {
    const res = (await c.request(r as never)) as { result: unknown };
    return res.result;
  } catch (e) {
    return { error: (e as { data?: unknown }).data ?? String(e) };
  }
};

/** simulate の結果から、残高変化（RippleState）とオファー変化だけを抜き出す */
function summarize(sim: unknown): unknown {
  const r = sim as { engine_result?: string; engine_result_message?: string; meta?: { AffectedNodes?: unknown[] }; error?: unknown };
  if (r.error) return r;
  const nodes = (r.meta?.AffectedNodes ?? []).map((n) => {
    const [kind, body] = Object.entries(n as Record<string, Record<string, unknown>>)[0]!;
    const f = (body["FinalFields"] ?? body["NewFields"] ?? {}) as Record<string, unknown>;
    const p = (body["PreviousFields"] ?? {}) as Record<string, unknown>;
    return { kind, type: body["LedgerEntryType"], Balance: f["Balance"], PrevBalance: p["Balance"], Account: f["Account"], TakerGets: f["TakerGets"], PrevTakerGets: p["TakerGets"] };
  });
  return { engine_result: r.engine_result, message: r.engine_result_message, nodes };
}

const client = await connectTestnet();
try {
  const V = walletFromEnv("VOUCHER_ISSUER_SEED");
  const ben = walletFromEnv("BENEFICIARY_SEED");
  const donor = walletFromEnv("DONOR_SEED");
  if (!V || !ben || !donor) throw new Error("VOUCHER_ISSUER_SEED / BENEFICIARY_SEED / DONOR_SEED のどれかが無い");
  const rl = (v: string) => ({ currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: v });
  const zk = (v: string) => ({ currency: VOUCHER, issuer: V.address, value: v });

  sec("1. RLUSD 発行者 account_info（TransferRate / TickSize / Flags）", await req(client, { command: "account_info", account: RLUSD_TESTNET_ISSUER, ledger_index: "validated" }));
  sec("2. V account_info", await req(client, { command: "account_info", account: V.address, ledger_index: "validated" }));
  sec("3. V の RLUSD トラストライン（no_ripple / freeze など）", await req(client, { command: "account_lines", account: V.address, ledger_index: "validated" }));
  sec("4. ben のトラストライン", await req(client, { command: "account_lines", account: ben.address, ledger_index: "validated" }));
  sec("5. V の account_offers", await req(client, { command: "account_offers", account: V.address, ledger_index: "validated" }));
  sec("6. 板: RLUSD を売り ZKV を買うオファー（taker=ben から見た owner_funds / funded）", await req(client, {
    command: "book_offers", taker: ben.address, ledger_index: "validated",
    taker_gets: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER }, taker_pays: { currency: VOUCHER, issuer: V.address },
  }));
  sec("7. 逆向きの板: ZKV を売り RLUSD を買うオファー（発行オファー）", await req(client, {
    command: "book_offers", taker: ben.address, ledger_index: "validated",
    taker_gets: { currency: VOUCHER, issuer: V.address }, taker_pays: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER },
  }));
  sec(`8. tecKILLED になった tx ${KILLED_TX}`, await req(client, { command: "tx", transaction: KILLED_TX }));
  sec("9. ripple_path_find（ben→ben、ZKV で RLUSD 0.1 を受け取る経路）", await req(client, {
    command: "ripple_path_find", source_account: ben.address, destination_account: ben.address,
    destination_amount: rl("0.1"), source_currencies: [{ currency: VOUCHER, issuer: V.address }], ledger_index: "validated",
  }));

  const variants: [string, SubmittableTransaction][] = [
    ["S1 元と同じ: OfferCreate IoC（ZKV 0.1 → RLUSD 0.1）", { TransactionType: "OfferCreate", Account: ben.address, TakerGets: zk("0.1"), TakerPays: rl("0.1"), Flags: OfferCreateFlags.tfImmediateOrCancel }],
    ["S2 IoC + tfSell、希望額を少し下げる（RLUSD 0.099）", { TransactionType: "OfferCreate", Account: ben.address, TakerGets: zk("0.1"), TakerPays: rl("0.099"), Flags: OfferCreateFlags.tfImmediateOrCancel | OfferCreateFlags.tfSell }],
    ["S3 フラグなし（板に残るか、交差するか）", { TransactionType: "OfferCreate", Account: ben.address, TakerGets: zk("0.1"), TakerPays: rl("0.1") }],
    ["S4 Payment ben→ben（Amount RLUSD 0.1、SendMax ZKV 0.1）", { TransactionType: "Payment", Account: ben.address, Destination: ben.address, Amount: rl("0.1"), SendMax: zk("0.1") }],
    ["S5 donor で S1 と同じ償還", { TransactionType: "OfferCreate", Account: donor.address, TakerGets: zk("0.1"), TakerPays: rl("0.1"), Flags: OfferCreateFlags.tfImmediateOrCancel }],
    ["S6 比較: donor が RLUSD 0.01 で受給証を買う（発行方向）", { TransactionType: "OfferCreate", Account: donor.address, TakerGets: rl("0.01"), TakerPays: zk("0.01"), Flags: OfferCreateFlags.tfImmediateOrCancel }],
  ];
  for (const [name, tx] of variants) {
    let prepared: SubmittableTransaction;
    try {
      prepared = await client.autofill(tx);
    } catch (e) {
      sec(`10. simulate ${name}`, { autofill_error: String(e) });
      continue;
    }
    sec(`10. simulate ${name}`, summarize(await req(client, { command: "simulate", tx_json: prepared })));
  }
} finally {
  await client.disconnect();
  writeFileSync(OUT, out.join("\n"), "utf8");
  console.log(`\n[04-diagnose] wrote ${OUT}`);
}
