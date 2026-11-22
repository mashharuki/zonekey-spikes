/**
 * 段階 1: 取得（ネットが必要。Mac で実行する）
 *   pnpm --filter 09-offline-receipt collect [S2 の tx hash]
 *
 * data/s2/   … 指定した EscrowFinish の tx・メタデータ・レジャーヘッダ・レジャー内の全 tx（バイナリ）
 * data/live/ … validations ストリームを先に購読してから、Faucet からの受け取り（Payment）を起こし、
 *              そのレジャーへの検証者の署名を集めたもの（過去のレジャーの検証は後から取れないため）
 * data/unl/  … Testnet の検証者リスト（VL）と、各検証者のマニフェスト（manifest メソッド）
 *
 * 秘密鍵・シードは使わない・保存しない（Faucet の新規アカウントのシードは捨てる）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeNodePublic } from "ripple-address-codec";
import { connectTestnet } from "xrpl-kit";
import { type Client } from "xrpl";
import { TESTNET_VL_PUBLISHER_KEY, TESTNET_VL_SITE } from "./lib/unl.js";

// spike 04「Escrow A: 第三者（keeper）が正しい Fulfillment で完了」（受益者に受給証 0.1 が届いた EscrowFinish）
const DEFAULT_S2_TX = "90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C";
const s2Hash = (process.argv[2] ?? DEFAULT_S2_TX).toUpperCase();
if (!/^[0-9A-F]{64}$/.test(s2Hash)) throw new Error(`tx hash の形式が違う: ${process.argv[2]}`);

const dataDir = (p: string) => new URL(`../data/${p}`, import.meta.url);
const save = (p: string, v: unknown) => { writeFileSync(dataDir(p), JSON.stringify(v, null, 2)); console.log(`[09] saved data/${p}`); };
const req = <T = Record<string, unknown>>(client: Client, r: Record<string, unknown>) => client.request(r as never).then((x) => (x as { result: T }).result);

/** tx 本体とメタデータ、レジャーヘッダ（JSON とバイナリ）、レジャー内の全 tx（バイナリ）を保存 */
async function collect(client: Client, dir: string, hash: string) {
  mkdirSync(dataDir(dir), { recursive: true });
  const tx = await req<{ validated?: boolean; ledger_index?: number }>(client, { command: "tx", transaction: hash, binary: true });
  if (!tx.validated) throw new Error(`${hash} はまだ validated でない`);
  const ledger_index = tx.ledger_index!;
  save(`${dir}/tx.json`, tx);
  save(`${dir}/header.json`, await req(client, { command: "ledger", ledger_index, binary: false }));
  save(`${dir}/header-binary.json`, await req(client, { command: "ledger", ledger_index, binary: true }));
  save(`${dir}/ledger-full.json`, await req(client, { command: "ledger", ledger_index, transactions: true, expand: true, binary: true }));
  return ledger_index;
}

mkdirSync(dataDir("unl"), { recursive: true });
const client = await connectTestnet();
try {
  const serverInfo = await req(client, { command: "server_info" });
  const info = (serverInfo as { info: Record<string, unknown> }).info;
  console.log(`[09] server: ${String(info["build_version"])} / validation_quorum=${String(info["validation_quorum"])} / network_id=${String(info["network_id"])}`);
  save("server_info.json", serverInfo);

  // ── S2（過去の tx）。検証者の署名は後から取れないので、ここでは A・B 用のデータだけ
  console.log(`[09] S2: ${s2Hash}`);
  const s2Ledger = await collect(client, "s2", s2Hash);
  save("s2/context.json", { kind: "s2", tx: s2Hash, ledger_index: s2Ledger, fetched_at: new Date().toISOString(), note: "spike 04 Escrow A の EscrowFinish（既定）" });

  // ── live: 先に validations を購読してから受け取りを起こす
  const validations: Record<string, unknown>[] = [];
  let latestValidated = 0;
  client.on("validationReceived" as never, (v: Record<string, unknown>) => { validations.push(v); });
  client.on("ledgerClosed", (l) => { latestValidated = Math.max(latestValidated, l.ledger_index); });
  await req(client, { command: "subscribe", streams: ["validations", "ledger"] });
  console.log("[09] live: validations を購読中。Faucet から受け取りを起こす…");
  const { wallet } = await client.fundWallet(); // 新規アカウントへの Payment（受け取り）。シードは保存しない
  const atx = await req<{ transactions: { hash?: string; tx_json?: { TransactionType?: string } ; validated?: boolean }[] }>(client, { command: "account_tx", account: wallet.address, limit: 5, forward: true });
  const first = atx.transactions.find((t) => t.tx_json?.TransactionType === "Payment" && t.validated);
  if (!first?.hash) throw new Error("Faucet からの Payment が見つからない");
  const liveLedger = await collect(client, "live", first.hash);
  // 対象レジャーの後に 3 つ確定するまで待ち、遅れて届く検証も拾う
  const until = Date.now() + 60_000;
  while (latestValidated < liveLedger + 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 2000));
  await req(client, { command: "unsubscribe", streams: ["validations", "ledger"] });
  const forLedger = validations.filter((v) => Number(v["ledger_index"]) === liveLedger);
  console.log(`[09] live: tx ${first.hash} / ledger ${liveLedger} / 受信した検証 ${validations.length} 件（うち対象レジャー ${forLedger.length} 件）`);
  save("live/validations.json", forLedger);
  save("live/context.json", { kind: "live", tx: first.hash, ledger_index: liveLedger, receiver: wallet.address, fetched_at: new Date().toISOString(), validationsReceivedTotal: validations.length, note: "Faucet → 新規アカウントの Payment。購読開始後に起こした" });

  // ── 検証者リストとマニフェスト（検証側は「事前に持っておく信頼の起点」として使う）
  const res = await fetch(TESTNET_VL_SITE);
  const vlText = await res.text();
  writeFileSync(dataDir("unl/vl.json"), vlText);
  console.log(`[09] saved data/unl/vl.json (${res.status}, ${vlText.length} bytes)`);
  const vl = JSON.parse(vlText) as Record<string, unknown>;
  if (String(vl["public_key"]).toUpperCase() !== TESTNET_VL_PUBLISHER_KEY) console.log(`[09] 注意: VL の public_key が rippled の設定例と違う: ${String(vl["public_key"])}`);
  const blobs = Array.isArray(vl["blobs_v2"]) ? (vl["blobs_v2"] as { blob: string }[]) : [{ blob: String(vl["blob"]) }];
  const masters = new Set<string>();
  for (const b of blobs) for (const v of (JSON.parse(Buffer.from(b.blob, "base64").toString("utf8")) as { validators: { validation_public_key: string }[] }).validators) masters.add(v.validation_public_key);
  const manifests = [];
  for (const m of masters) manifests.push(await req(client, { command: "manifest", public_key: encodeNodePublic(Buffer.from(m, "hex")) }).catch((e: Error) => ({ error: e.message, requested: m })));
  save("unl/manifests.json", manifests);
} finally {
  await client.disconnect();
}
