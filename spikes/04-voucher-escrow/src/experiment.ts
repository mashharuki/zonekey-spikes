/**
 * 償還 tecKILLED の原因を切り分ける実験。
 * V（受給証の発行者）の設定を 1 段ずつ変え、各段の後に ben の償還を simulate（送信しない）で試す。
 * 実際に送るのは V の設定変更（TrustSet / AccountSet）だけ。RLUSD と受給証は動かない。
 * 最初に simulate が tesSUCCESS になった段が原因。そこで止める。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AccountSetAsfFlags, OfferCreateFlags, TrustSetFlags, type Client, type SubmittableTransaction, type Wallet } from "xrpl";
import { RLUSD_CURRENCY, RLUSD_TESTNET_ISSUER, connectTestnet, explorerTxUrl, loadEnvLocal, submitAndLog, walletFromEnv } from "xrpl-kit";
import { VOUCHER } from "./scenario.js";

const HERE = fileURLToPath(import.meta.url);
const OUT = fileURLToPath(new URL("../EXPERIMENT.md", import.meta.url));
loadEnvLocal(HERE);

const lines: string[] = ["# 04 償還 tecKILLED の切り分け実験", "", "| 段 | 変更（実送信） | 結果 | 償還 simulate（ben, IoC 0.1） |", "| --- | --- | --- | --- |"];

async function simulateRedeem(client: Client, ben: Wallet, V: Wallet): Promise<string> {
  const tx: SubmittableTransaction = {
    TransactionType: "OfferCreate", Account: ben.address,
    TakerGets: { currency: VOUCHER, issuer: V.address, value: "0.1" },
    TakerPays: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: "0.1" },
    Flags: OfferCreateFlags.tfImmediateOrCancel,
  };
  const prepared = await client.autofill(tx);
  const r = (await client.request({ command: "simulate", tx_json: prepared } as never)) as { result: { engine_result: string } };
  return r.result.engine_result;
}

const client = await connectTestnet();
try {
  const V = walletFromEnv("VOUCHER_ISSUER_SEED");
  const ben = walletFromEnv("BENEFICIARY_SEED");
  if (!V || !ben) throw new Error("VOUCHER_ISSUER_SEED / BENEFICIARY_SEED が無い");

  const stages: [string, SubmittableTransaction | undefined][] = [
    ["E0 変更なし（基準）", undefined],
    ["E1 V の RLUSD ラインの NoRipple を解除（TrustSet tfClearNoRipple）", {
      TransactionType: "TrustSet", Account: V.address,
      LimitAmount: { currency: RLUSD_CURRENCY, issuer: RLUSD_TESTNET_ISSUER, value: "1000000000" }, Flags: TrustSetFlags.tfClearNoRipple,
    }],
    ["E2 V に DefaultRipple を設定（AccountSet asfDefaultRipple）", {
      TransactionType: "AccountSet", Account: V.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple,
    }],
    ["E3 V 側の ben の受給証ラインの NoRipple を解除（TrustSet tfClearNoRipple, limit 0）", {
      TransactionType: "TrustSet", Account: V.address,
      LimitAmount: { currency: VOUCHER, issuer: ben.address, value: "0" }, Flags: TrustSetFlags.tfClearNoRipple,
    }],
  ];

  for (const [name, tx] of stages) {
    let change = "-";
    if (tx) {
      const o = await submitAndLog(client, name, tx, V);
      change = `${o.engineResult ?? o.error} [${o.hash.slice(0, 10)}…](${explorerTxUrl(o.hash)})`;
    }
    const sim = await simulateRedeem(client, ben, V);
    lines.push(`| ${name} | ${tx ? tx.TransactionType : "-"} | ${change} | **${sim}** |`);
    console.log(`[04-exp] ${name}: change=${change} → simulate=${sim}`);
    if (sim === "tesSUCCESS") {
      lines.push("", `**結論: 「${name}」の段で償還が通るようになった。**`);
      break;
    }
  }
} finally {
  await client.disconnect();
  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(`[04-exp] wrote ${OUT}`);
}
