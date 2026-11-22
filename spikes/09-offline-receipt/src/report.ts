/**
 * results/verify.json と results/pack.json から REPORT.md を作る（ネット不要）
 *   pnpm --filter 09-offline-receipt report
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => new URL(`../${p}`, import.meta.url);
const load = (p: string): Any => (existsSync(here(p)) ? JSON.parse(readFileSync(here(p), "utf8")) : undefined);
const verify: Any = load("results/verify.json");
const pack: Any[] = load("results/pack.json") ?? [];
if (!verify?.bundles?.length) throw new Error("results/verify.json に検証結果がない。collect → receipt → verify の順に実行する");
const pkg = (n: string) => (JSON.parse(readFileSync(here(`node_modules/${n}/package.json`), "utf8")) as { version: string }).version;

const R = "https://github.com/XRPLF/rippled/blob/3.4.1";
const ox = (b: unknown) => (b === true ? "✅" : b === false ? "❌" : "—");
const tx = (h: string) => `[${h.slice(0, 10)}…](https://testnet.xrpl.org/transactions/${h})`;
const B = (name: string) => verify.bundles.find((b: Any) => b.name === name);
const P = (name: string) => pack.find((p: Any) => p.name === name);
const levelOf = (b: Any) => (!b ? "未取得（data がない）" : b.A?.ok && b?.B?.ok && b?.C?.ok ? "検証Cまでできた" : b?.A?.ok && b?.B?.ok ? "検証Bまで" : b?.A?.ok ? "検証Aまで" : "検証Aもできなかった");
const s2 = B("s2"), live = B("live");

const rows: string[] = [];
const row = (...c: unknown[]) => rows.push(`| ${c.map((x) => String(x ?? "—").replace(/\|/g, "\\|")).join(" | ")} |`);
for (const b of verify.bundles as Any[]) {
  const n = b.name;
  row(`${n}: 対象 tx`, "validated", `${b.A.target.TransactionType} / ${b.A.target.TransactionResult} / 受取 ${b.A.target.Destination ?? "—"} / 額 ${typeof b.A.target.delivered_amount === "object" ? `${b.A.target.delivered_amount.value} ${b.A.target.delivered_amount.currency}` : b.A.target.delivered_amount ? `${b.A.target.delivered_amount} drops` : "—"}`, `${tx(b.context.tx)}（ledger ${b.context.ledger_index}）`);
  row(`${n}: A 木の根を再計算`, "ヘッダの transaction_hash と一致", `${ox(b.A.rootMatches)} ${b.A.computedRoot}（tx ${b.A.txCount} 件）`, `ヘッダ: ${b.A.headerTxHash}`);
  row(`${n}: A 対象 tx が木に入っている`, "true", `${ox(b.A.targetIncluded)} txid ${b.A.targetTxId}`, "tx と meta から葉を作り、同じ鍵・同じ葉があるか");
  row(`${n}: A 枝だけで根を再計算`, "一致", `${ox(b.A.proofRootMatches)}（${b.A.proofLevels} 段）`, "対象までの兄弟ハッシュだけを使う");
  row(`${n}: B ledger_hash を再計算`, "API の ledger_hash と一致", `${ox(b.B.ok)} ${b.B.computedLedgerHash}`, `API: ${b.B.expectedLedgerHash}`);
  row(`${n}: B バイナリのヘッダ（ledger_data）`, "JSON と同じ hash", ox(b.B.headerBinaryMatchesJson), "ledger（binary: true）の ledger_data 先頭 118 バイト");
  if (b.C.vl) row(`${n}: C 検証者リスト（VL）`, "発行者・署名・期間 OK", `${ox(b.C.vl.publisherOk && b.C.vl.blobSignatureValid && b.C.vl.inForceAtClose)} sequence ${b.C.vl.sequence} / UNL ${b.C.vl.unlSize} 人 / 署名鍵を解決 ${b.C.vl.manifestsResolved} 人 / 期限 ${b.C.vl.expirationIso}`, "vl.altnet.rippletest.net、発行者鍵 ED2648…5860");
  for (const [k, r] of Object.entries(b.receipts ?? {}) as [string, Any][]) {
    row(`${n}: パック ${k === "ab" ? "A・B" : "A・B・C"} だけで検証（${r.bytes} B）`, "A・B" + (k === "abc" ? "・C" : "") + " が通る", `A ${ox(r.A.ok)} / B ${ox(r.B.ok)}${k === "abc" ? ` / C ${ox(r.C.ok)}（${r.C.trustedSigners} / ${r.C.quorum} 人）` : ""}`, "receipts/*.bin と事前に持つ VL・マニフェストだけ");
  }
  row(`${n}: C 定足数の署名`, `定足数 ${b.C.quorum ?? "—"} 以上`, `${ox(b.C.ok)} ${b.C.trustedSigners ?? 0} 人${b.C.validations ? `（受信 ${b.C.validations.total} 件・署名が正しい ${b.C.validations.signatureValid} 件・このレジャー宛て ${b.C.validations.forThisLedger} 件・リスト外 ${b.C.validations.untrustedOrUnknownKey} 件）` : ""}`, b.C.reason ?? `サーバーの validation_quorum: ${b.serverQuorum}`);
}

const tamperRows = (verify.bundles as Any[]).map((b) => `| ${b.name} | ${ox(!b.tamper.metaFlipped_A)} | ${ox(!b.tamper.closeTimePlus1_B)} | ${ox(!b.tamper.accountHashFlipped_B)} | ${b.tamper.firstValidationFlipped_C_signersAfter === undefined ? "—" : `${b.C.trustedSigners} → ${b.tamper.firstValidationFlipped_C_signersAfter} 人`} |`);

const sizeRows = pack.map((p: Any) => [
  `| ${p.name}: 全部（ヘッダ + 全 tx ${p.txCount} 件 + 集めた全検証 + VL + マニフェスト） | ${p.full.bytes} | — | — |`,
  `| ${p.name}: パック A・B（ヘッダ + 対象 tx + meta + 枝 ${p.proofLevels} 段） | ${p.ab.bytes} | ${p.ab.qr.L} | 圧縮後 ${p.ab.deflated} B: ${p.ab.qrDeflated.L} |`,
  ...(p.abc ? [
    `| ${p.name}: パック A・B・C（＋検証 ${p.abc.validations} 件、1 件 ${Math.min(...p.abc.validationBytes)}〜${Math.max(...p.abc.validationBytes)} B） | ${p.abc.bytes} | ${p.abc.qr.L} | 圧縮後 ${p.abc.deflated} B: ${p.abc.qrDeflated.L} |`,
    `| ${p.name}: 上に VL とマニフェストも入れた場合 | ${p.abc.withUnl.bytes} | — | — |`,
  ] : []),
  ...(p.abcEstimate ? [`| ${p.name}: **見積もり** A・B・C（${p.abcEstimate.note}） | ${p.abcEstimate.bytes} | ${p.abcEstimate.qr.L} | 圧縮後 ${p.abcEstimate.deflated} B: ${p.abcEstimate.qrDeflated.L} |`] : []),
].join("\n")).join("\n");
const partsRows = pack.map((p: Any) => `| ${p.name} | ${p.parts.header} | ${p.parts.tx} | ${p.parts.meta} | ${p.parts.proof} | ${p.abc ? p.abc.validationBytes.reduce((a: number, b: number) => a + b, 0) : "—"} | ${p.parts.vlJson} | ${p.parts.manifests} |`).join("\n");

const lp = P("live");
const fitsC = lp?.abc && String(lp.abc.qr.L).startsWith("入る");
const fitsCz = lp?.abc && String(lp.abc.qrDeflated.L).startsWith("入る");

const md = `# 09-offline-receipt: 受け取り取引の確定をネットなしで検証できるか

計測: ${verify.at}（取得は ${s2?.context?.fetched_at ?? "—"}）/ Testnet サーバー: ${s2?.serverVersion ?? live?.serverVersion ?? "—"}
実装: 根拠に使った rippled のソースは **3.4.1**（タグ）。xrpl ${pkg("xrpl")}（取得のみ）、ripple-binary-codec ${pkg("ripple-binary-codec")}（表示用のデコードのみ）、@noble/curves ${pkg("@noble/curves")}（secp256k1 / Ed25519）、ハッシュは Node の SHA-512
対象: S2 = spike 04「Escrow A: 第三者（keeper）が正しい Fulfillment で完了」の EscrowFinish（リポジトリに「S2」の表記がないため、受益者に受給証が届いた EscrowFinish をこれと判断した）

## 1. 結論

- **S2 の EscrowFinish: ${levelOf(s2)}**${s2?.C?.reason ? `（C は不可能: ${s2.C.reason}）` : ""}
- **その場で署名を集めた受け取り（live）: ${levelOf(live)}**
- オフライン検証（verify）中のネットワーク利用の試み: **${verify.networkAttempts} 回**（fetch・ソケット・DNS・TLS を遮断して実行）

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
${rows.join("\n")}

### 改ざんしたら落ちるか（1 ビット変更）

| 対象 | meta を変える → A が落ちる | close_time +1 → B が落ちる | account_hash を変える → B が落ちる | 検証 1 件を変える → 数えられる人数 |
|---|---|---|---|---|
${tamperRows.join("\n")}

### 実装の自己確認（ネット不要）

- 木の再計算: xrpl.js のテスト用データ（Mainnet ledger 7501326 の全 17 tx、38129、40000）で、根がヘッダの transaction_hash と一致し、全 tx の枝からも同じ根になった
- ledger_hash: xrpl.js の \`hashLedgerHeader\` と同じ値になった（テスト用データのヘッダ自体は編集されていて元の hash と一致しないため、実データでの一致は上の B で確認）
- 検証 C: \`pnpm --filter 09-offline-receipt selftest\` で、合成した鍵・マニフェスト・VL・検証の 10 ケース（定足数ちょうど / 不足 / 重複 / 別レジャー / 部分検証 / リスト外 / 発行者違い / blob 改ざん / 鍵の入れ替えあり・なし）がすべて期待どおり

### 段階 5: 持ち運び（大きさと QR コード）

QR コードはバイトモード、誤り訂正 L（型番 40 の上限 2953 バイト）で実際に符号化して試した（qrcode ${pkg("qrcode")}）。

| データ | バイト数 | QR 1 つ（L） | 圧縮（deflate）した場合 |
|---|---|---|---|
${sizeRows}

内訳（バイト）:

| 対象 | ヘッダ | tx | meta | 枝 | 検証（定足数分） | VL（JSON） | マニフェスト |
|---|---|---|---|---|---|---|---|
${partsRows}

パックの形式（この検証で決めたもの）: \`"ZKR1" ‖ ヘッダ 118 B ‖ VL(tx) ‖ VL(meta) ‖ 枝（段ごとに 16 ビットの表 + 空でない兄弟のハッシュ）‖ 検証の数 ‖ VL(検証)…\`。
ledger_hash はヘッダから再計算できるので入れない。検証者リスト（VL）とマニフェストは検証アプリに事前に入れておく前提で入れない。

## 3. エラー（そのまま）

${(verify.bundles as Any[]).flatMap((b) => (b.C.reason ? [`- ${b.name} / C: ${b.C.reason}`] : [])).join("\n") || "なし"}

## 4. 設計への影響

- **確定の証明は、取引の直後にしか作れない。** レジャーへの検証者の署名は validations ストリームで流れた時点のものしかなく、後から取る公開 API がない。S2 のような過去の tx は B（台帳のヘッダに入っている）までしか示せない。keeper は EscrowFinish を送る前から validations を購読し、確定したら定足数分の署名をその場で保存して受け取りパックを作る。
- **A・B だけなら QR 1 つに入る**（S2 ${P("s2")?.ab?.bytes ?? "—"} B / live ${lp?.ab?.bytes ?? "—"} B）。ただし A・B は「このヘッダのレジャーに入っている」までで、そのヘッダが本物の確定レジャーかは C がないと分からない（誰でも同じ形のヘッダは作れる）。
- **C まで入れると: ${!lp?.abc ? "未計測（live の検証がない）" : fitsC ? `QR 1 つに入る（live の Payment で ${lp.abc.bytes} B、型番 ${String(lp.abc.qr.L).match(/\d+/)?.[0]}）` : fitsCz ? "そのままでは入らないが、圧縮すれば入る" : "QR 1 つには入らない"}。** 大きさの大半は meta と検証（1 件 約 ${lp?.abc ? Math.round(lp.abc.validationBytes.reduce((a: number, b: number) => a + b, 0) / lp.abc.validations) : "—"} B × 定足数 ${lp?.abc?.validations ?? "—"}）。tx・meta は葉のハッシュの計算に全バイトが要り、検証は定足数より減らせないので、どちらも削れない。
${P("s2")?.abcEstimate ? `- **実際の受け取り（EscrowFinish）は meta が大きい**（S2 で ${P("s2").parts.meta} B。受給証のトラストラインの変化が入るため）。C を付けた見積もりは ${P("s2").abcEstimate.bytes} B で、**そのままでは QR 1 つ（L: 2953 B）を少し超える**。deflate で圧縮すると ${P("s2").abcEstimate.deflated} B（${P("s2").abcEstimate.qrDeflated.L}）。→ 受け取りパックは圧縮して QR にする（圧縮しても検証の手順は同じ。展開してから検証する）。それでも足りない場合は QR を 2 枚に分ける（1 枚目 A・B、2 枚目 検証）。
` : ""}- **信頼の起点は「Testnet の VL 発行者の鍵」1 つ。** 検証アプリに発行者鍵（ED2648…5860）を埋め込み、VL とマニフェストは事前に（ネットがあるときに）入れておく。VL には期限（expiration）があり、検証は「レジャーの close_time の時点で有効だったリスト」で行う（今の時刻ではない）。検証者が鍵を入れ替えると古いマニフェストでは数えられないので、VL を取るときに manifest メソッドの最新も一緒に入れておく。
- **定足数は厳しい側で数えている。** rippled は「有効 UNL（Negative UNL を除いた数）の 80%（ただし UNL の 60% 以上）」。オフラインでは Negative UNL が分からないので UNL 全体の 80% で数える。Negative UNL が効いているときに足りなく見えることはあるが、甘くなることはない。
- 受け取りの意味（誰が・いくら受け取ったか）は meta の \`TransactionResult\`・\`DeliveredAmount\` と tx の \`Destination\` から読む。A で meta ごと葉のハッシュに入っているので、改ざんできない。

## 5. 分からなかったこと

- Testnet の Negative UNL の状態（取得していない）。定足数は UNL 全体の 80% で数えた。
- validations ストリームに流れる \`data\`（署名付きの生バイト）は xrpl.org の subscribe のページには載っていない。rippled の実装（NetworkOPs.cpp）にはある。今回 data 付きで届いた検証: ${live?.C?.validations?.total ?? 0} 件。
- 公開サーバー（s.altnet）が全検証者の検証を中継する保証はない。今回足りたかは上の表のとおり。
- 第三者が過去の検証を保存しているサービス（Testnet 向け）があるかは調べていない。
- Testnet は 2026-11-25 にリセットされる。tx・レジャーは消えるが、data/ に保存した生データで verify はいつでも再実行できる。

## 根拠

xrpl.org:
- Ledger Header: https://xrpl.org/docs/references/protocol/ledger-data/ledger-header
- Ledger Structure（Transaction Tree）: https://xrpl.org/docs/concepts/ledgers/ledger-structure
- Binary Format（フィールド ID・長さ接頭辞）: https://xrpl.org/docs/references/protocol/binary-format
- subscribe（validations ストリーム）: https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/subscription-methods/subscribe
- Validator List Method（VL とマニフェストの形式）: https://xrpl.org/docs/references/http-websocket-apis/peer-port-methods/validator-list
- manifest メソッド: https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/server-info-methods/manifest
- ledger / tx メソッド: https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/ledger-methods/ledger , https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/transaction-methods/tx
- UNL: https://xrpl.org/docs/concepts/consensus-protocol/unl
- XLS-45（VL version 2）: https://xls.xrpl.org/xls/XLS-0045-prepublish-validator-lists.html

xrpl.org には、ハッシュの接頭辞・ヘッダの並び・木のノードのハッシュの作り方がバイト単位で書かれていない（Ledger Header のページも「SHA-512Half」までで、手順は rippled のソースを指している）。バイト単位の手順は rippled 3.4.1 のソースに拠った:
- ハッシュの接頭辞（TXN / SND / MIN / LWR / VAL / MAN）: ${R}/include/xrpl/protocol/HashPrefix.h#L39-L84
- ledger_hash: ${R}/src/libxrpl/protocol/LedgerHeader.cpp#L59-L74 （並び: ${R}/src/libxrpl/protocol/LedgerHeader.cpp#L13-L28）
- tx の葉: ${R}/include/xrpl/shamap/SHAMapTxPlusMetaLeafNode.h#L51-L55 / 葉の中身 VL(tx)‖VL(meta): ${R}/src/libxrpl/ledger/Ledger.cpp#L527-L540
- 内部ノード: ${R}/src/libxrpl/shamap/SHAMapInnerNode.cpp#L193-L206 / 空の子は 0: ${R}/include/xrpl/shamap/detail/TaggedPointer.ipp#L142-L172
- 枝の選び方: ${R}/src/libxrpl/shamap/SHAMapNodeID.cpp#L146-L167
- txid: ${R}/src/libxrpl/protocol/STTx.cpp#L74
- 長さ接頭辞: ${R}/src/libxrpl/protocol/Serializer.cpp#L210-L243
- 検証の署名ハッシュ: ${R}/src/libxrpl/protocol/STValidation.cpp#L70-L74 、${R}/src/libxrpl/protocol/STObject.cpp#L383-L390
- 検証の署名検証（full canonical の扱い）: ${R}/src/libxrpl/protocol/STValidation.cpp#L100-L134 、${R}/src/libxrpl/protocol/PublicKey.cpp#L223-L290
- 署名対象外のフィールド: ${R}/include/xrpl/protocol/detail/sfields.macro#L282 、${R}/include/xrpl/protocol/detail/sfields.macro#L295
- validations ストリームの data: ${R}/src/xrpld/app/misc/NetworkOPs.cpp#L2595-L2602
- マニフェスト: ${R}/src/libxrpl/server/Manifest.cpp#L57-L91 、${R}/src/libxrpl/server/Manifest.cpp#L196-L214 、${R}/src/libxrpl/protocol/Sign.cpp#L89-L99
- VL の検証: ${R}/src/xrpld/app/misc/detail/ValidatorList.cpp#L1241-L1300
- 定足数: ${R}/src/xrpld/app/misc/detail/ValidatorList.cpp#L1707-L1797
- Testnet の VL の入手元と発行者鍵: ${R}/cfg/validators-example.txt#L64-L72
`;
writeFileSync(here("REPORT.md"), md);
console.log("[09] wrote REPORT.md");
