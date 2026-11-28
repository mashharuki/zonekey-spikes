# 15-multi-donor-rlusd: 2 ドナーの給付と未使用分の返還を、RLUSD 残高で検算できるか

実施: 2026-11-28 07:05〜07:25 UTC（Testnet、validated ledger 58858〜59036）。spike 13（資格の証明・承認）と spike 14（発券の確定）の入口をそのまま使い、使った券の RLUSD 着金と、未請求券の失効・返還を **同じシナリオで追跡**した。

## 1. 結論

**条件付きで成立**

（AGENTS.md の「合格 / 不合格 / 一部合格」では「一部合格」に近い。依頼書の 4 区分に従う。）

- 主要な問い「同じ合成世帯が異なる 2 制度の支援を使い、店舗が受け取った RLUSD とドナーへ戻った RLUSD を、第三者が取引から再計算できるか」は、今回の Testnet 実測で **できた**。署名鍵なしの検算コマンドが 116 項目すべて期待どおり（未決 Escrow 0・未償還 ZKV 0・説明できない取引 0 件）。
- 「条件付き」の理由（判断を変えうる順）:
  1. **店舗への着金であって、世帯ウォレットへの RLUSD 着金ではない。** 店舗券を介した給付が大会の受益者要件に適合するかは、主催者確認事項として残る（技術判定の外）。
  2. **RLUSD は公式 faucet ではなく AMM（XRP→RLUSD）で入手した。** 発行者は公式に案内された本物（`rpcFL7Mz…`）だが、faucet は GitHub サインインとブラウザウォレットが要り、自動実行できなかった。
  3. **再実行の試験で実装の欠陥を 1 件見つけた**（準備段階が残高で判定し、N が RLUSD を余計に購入した。給付の検算範囲の外・修正済み。8 節）。
  4. 単一の公開ノード・1 回の実行（n=1）。障害（通信断・プロセス停止）は今回の範囲外（依頼書どおり再演していない）。
  5. 「本人が選んだ 2 券が同一世帯であることを監査者に ZK で示す」は未実装（依頼書で必須外）。同一世帯の根拠は合成データの試験ハーネスの照合記録だけ（7 節）。

### 誰が支援を利用したか

- 店頭で支援（券 A・B）を使ったのは **合成世帯 H1**。P（県の基本給付）と N（NGO の高齢者追加給付）の両方で、H1 の同じ世帯秘密から別々の ZK 証明を作り、発券サービスが検証して承認・発券した。H1 の 2 枚は**別々の申請鍵・別々の preimage**。
- 合成世帯 H2 は N の追加給付の券 C を受け取ったが、**一度も店で使わなかった**。
- 対照: 高齢者要件を満たさない H3 は N の証明を作れない（回路が `senior required` で拒否）。

### 誰の RLUSD がいくら増減したか（開始 ledger 58882 → 終了 ledger 59036、`validated`）

| 口座 | 役割 | 開始 | 終了 | 純増減 | 期待 | 内訳 |
|---|---|---|---|---|---|---|
| P | 県（支援元） | 0.10 | 0 | **−0.10** | −0.10 | 拠出 −0.10（券 A は使われ、返還なし） |
| N | NGO（支援元） | 0.10 | 0.05 | **−0.05** | −0.05 | 拠出 −0.10、C の返還・償還 +0.05（B は使われた） |
| S | 店舗 | 0 | 0.15 | **+0.15** | +0.15 | A +0.10、B +0.05（世帯ではなく店舗への着金） |
| V | 受給証の発行・償還 | 0 | 0 | **0** | 0 | 受け +0.20、払い −0.15 −0.05 |
| 合計 | | | | **0** | 0 | |

準備（口座作成・RLUSD の購入・トラストライン）の XRP と RLUSD は上の表に含まない（別計上、4 節）。

### 何が第三者に検算できたか

署名鍵なしで、`manifest.json`（取引 hash の一覧）と公開台帳（validated）だけから、次を再計算できた（`pnpm --filter 15-multi-donor-rlusd verify -- --zk`、116/116）。

| 検算できたこと | 方法 |
|---|---|
| 券ごとの資金の流れ（拘束 → Finish/Cancel → 償還）と、各段階の増減 | 取引メタデータの RippleState の増減を十進固定精度で集計 |
| P・N・S・V の RLUSD 純増減 = 期待値（拠出と券の結末だけから計算） | 開始点・終了 ledger の `account_lines`／`gateway_balances` の差 |
| 確定残高の差 = 取引メタデータの合計（**説明できない差額 0**） | 両者の差を口座ごとに計算 |
| 券の Escrow の内容（持ち主・宛先・資産・額面・期限・Condition・鍵ハッシュ・OfferSequence）が承認内容と一致 | EscrowCreate と ledger_entry |
| Finish の Fulfillment が Condition の preimage／Cancel が期限後（ledger の close_time > CancelAfter） | 取引と ledger の close_time |
| C は期限前まで未使用の Escrow が存在し、一度も Finish されていない | ledger 58914 の `ledger_entry` ＋取引一覧 |
| 終了時点の未決 Escrow 0・未償還 ZKV 0・V の RLUSD 準備金 = ZKV 発行残高 | `ledger_entry`／`account_objects`／`gateway_balances` @59036 |
| 開始点より後に P・N・S・V・K に触れた manifest 外の取引 0 件 | `account_tx` を各口座でページ末尾まで |
| （`--zk`）ZK 証明が検証を通り、公開入力の申請ダイジェストが台帳の Escrow の内容と一致 | bb.js の検証と SHA-256 |

**第三者に検算できないこと**: H1 が P と N の両方の資格を持つこと（発券サービスの記録と名簿・証明の検証が必要）。台帳から見える A と B の共通点は宛先の店舗 S だけで、世帯の同一性は分からない（設計どおり）。

## 2. 何を作ったか（再利用と変更）

| 区分 | 内容 |
|---|---|
| 新規 `spikes/15-multi-donor-rlusd/` | `src/run.ts`（シナリオ全体）、`src/verify.ts`（読み取り専用の検算）、`src/track.ts`（署名済み取引を先に保存する送信）、`src/chainio.ts`、`src/deltas.ts`（メタデータから残高増減）、`src/dec.ts`（十進固定精度 10⁻¹⁵ の BigInt。`dec.test.ts`）、`src/config.ts` |
| spike 13 から再利用（変更なし） | 回路 `eligibility_bound`、`Zk`・`Roster`・申請ダイジェスト・名簿、spike 11c の `core.ts`・`shop.ts` |
| spike 14 から再利用 | 発券サービス `Service`（ZK 検証・方針検査・(制度, nullifier) の一意・署名済み取引の先行保存・validated 確認）。券ごとに **P 用・N 用の 2 つの Service**（持ち主＝署名口座が違うため DB も別）。店舗のオフライン受付 `shop-offline.ts`（通信遮断の別プロセス）。台帳照会 `chain.ts` |
| **spike 14 への変更（1 か所）** | `service.ts` の `Program` に任意の `minTtlSec`（期限の最短の余裕、既定 3600 のまま）。券 C の期限を短くするため。spike 14 の挙動は変わらない |
| その他 | ルートの `.gitignore` に `.state-archive-*/`（`--new` の退避先。秘密を含む）、`pnpm-lock.yaml` に 15 の importer を追加（他の差分は含めていない） |

入口の使い方: 発券は `Service.apply(req, proof)` を呼ぶだけ。承認・Escrow の照合・確定は 14 のコードが行い、15 は確定した発券記録（`issuance` の `confirmed_tx`・`offer_sequence`・`escrow_index`）から後続処理を始める。値を手で再入力していない。

## 3. 前提の確認（資産と開始点）

### 公式 Testnet RLUSD（読み取りで確認）

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| 公式に案内された RLUSD の発行者 | 確認できる | `rpcFL7MzZvGYFCihoUx9nrhhgAp4nSDdvG`、通貨コード `524C555344000000000000000000000000000000` | https://tryrlusd.com/addresses の「XRPL Testnet」欄（2026-11-28 取得）。`account_info`: Domain=`https://ripple.com/`、`gateway_balances` 義務 2,000,000,000 |
| リポジトリの旧定数 `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`（`packages/xrpl-kit/src/rlusd.ts`） | 存在 | **存在しない**（`actNotFound`） | 11/25 の Testnet リセットで発行者が替わったとみられる。定数は今回変更していない（9 節） |
| 発行者のフラグ | — | DefaultRipple・**AllowTrustLineLocking**・DepositAuth・DisableMaster・DisallowXRP・**AllowTrustLineClawback** | `account_info` Flags=3248095232（0xC1…）。spike 03 の前提と違う（9 節） |
| RLUSD の入手経路 | faucet | faucet は GitHub サインイン（`/api/mint-xrpl` は `credentials: include`）と接続済みウォレットが要る。**サインインを回避する操作はしていない**。XRP/RLUSD の **AMM**（口座 `rKK1ptBR793sX97BS6Ri1osefpPfwGR3Cf`、プール 1,000,000 XRP : 1,000,000 RLUSD）で XRP から買った | `amm_info`。P の購入に約 0.100001 XRP（準備前後の XRP 残高からの逆算）。**自前発行の同名資産は使っていない** |

### 口座と開始点

| 記号 | アドレス | 備考 |
|---|---|---|
| P（県） | `rhHyqndMmQC5S48wjzBySgUt379t9iviS1` | 新規。Faucet で XRP 100 |
| N（NGO） | `rKeVTjcGHucD3k5nsH1i7gmz6gUfaysup` | 新規。同上 |
| S（店舗） | `rQDnLqPzrH9yuyFWVdxfBuopn8xS7u4fBY` | 既存の `SETTLEMENT_SEED`（リセットで消えていたため Faucet で再作成） |
| V（ZKV 発行・償還） | `rMUYGTwRFpztm4BBbvr2N5Q99Q7HUJ1fxF` | **この試験用に新規**。理由: 既存の V（`rEhTGPAG…`）は spike 13/14 の合成 ZKV 15 が RLUSD の裏付けなしで発行されたままで、ZKV の Escrow も 41 件残っている（V の `account_objects` で確認）。第三者が「V の RLUSD 準備金 = ZKV の発行残高」を検算するとき、試験外の残高が混ざるのを避けた |
| K（keeper） | `rBmN9jQyLe1YD8ETY8s1yqGvvf5qMQSZwq` | 新規。EscrowCancel の送信だけ |

- **開始点**: 準備の最後の取引の ledger **58882**（close_time 07:15:32 UTC）。この時点の RLUSD は P 0.10・N 0.10・S 0・V 0、ZKV はすべて 0。V の ZKV 発行設定は DefaultRipple と AllowTrustLineLocking が立っている（V の `account_info` Flags=0x40800000、取引は下表）。他の取引が混ざったかは検算の「説明できない取引」で 0 件。
- 準備の取引（給付と別計上。表の `expect` は結果コード）:

| 取引 | hash | ledger | 結果 |
|---|---|---|---|
| V: AccountSet asfDefaultRipple | `C2FD2747C854872A0958652E3CA0997D84B9A3D0FACDB77EFB6793AA3ED50FC2` | 58858 | tesSUCCESS |
| V: AccountSet asfAllowTrustLineLocking | `215B723AF43B4A2C78D2AAF99952BE42B565A17E1FB42E12A9A7B725BC7BE1FD` | 58860 | tesSUCCESS |
| P: TrustSet RLUSD | `9C5FDB5AAF46C2D5671D4BFA3BA928C9076F3E8CA7DA57136FB50CDCD7A1CC83` | 58862 | tesSUCCESS |
| N: TrustSet RLUSD | `25BB54B7483131E66CF82DC413E3E2638E60EDB2BF63FF8C5FEFD88CACA3E6C4` | 58864 | tesSUCCESS |
| S: TrustSet RLUSD | `AD9D1D263AB022EB9CA8357A7BD8CC19721C5B1B2C5CD331B9AB576628B7A329` | 58866 | tesSUCCESS |
| V: TrustSet RLUSD | `650731740242C1A7864401AA74D78C2A4B46689BDFC32C0A79F76D7276971194` | 58868 | tesSUCCESS |
| P: TrustSet ZKV | `6B013BF34E479F8D44C046092D29ACB0B1EB9938B2DC70F455800A3AF3141998` | 58870 | tesSUCCESS |
| N: TrustSet ZKV | `0DB87EF2E25173A360960FCD6BBE1EECE81EE0C4B37EC9A1A63269B07A84A9D0` | 58872 | tesSUCCESS |
| S: TrustSet ZKV | `D2BC4A9C4E04C83A3A8D5AC93D947CB0FF9F6F9615BE31A77A54C708FF127105` | 58874 | tesSUCCESS |
| P: AMM で RLUSD 0.1 を購入 | `92C0CF051F98D74788019C865C1742F6701C23B84A377488F947B2B493855082` | 58876 | tesSUCCESS |
| N: AMM で RLUSD 0.1 を購入 | `4B1DE69F233C8F74113F5B485B3197D2985274632DA1A0DF4A59EAF30980F92F` | 58878 | tesSUCCESS |
| V: 発行注文（V が ZKV を売り RLUSD を受ける、1:1） | `4C8E491664F1E44431A767648CAC6BB088E1D6D31A226D851F3CCBCEFE0EABBD` | 58880 | tesSUCCESS |
| V: 償還注文を **RLUSD 0 のうちに**置こうとした | `ED04B3F681027F4681B1FD461C6DB2C828A310B424DFDD72CC4880139B911FD4` | 58882 | **tecUNFUNDED_OFFER**（失敗の記録。下記） |

V の償還注文（V が RLUSD を売り ZKV を受ける、`tfPassive`）は、V が RLUSD を持つまで置けなかった（`tecUNFUNDED_OFFER`）。P の拠出のあとに置く順序に直した（5 節の 2 行目）。spike 04 と同じ順序。

## 4. ケース別の結果

取引の hash はすべて Testnet の確定済み（`validated`）。https://testnet.xrpl.org/transactions/<hash> で確認できる。`残高差` は、その取引の ledger L−1 → L の `account_lines`／`gateway_balances` の差で、取引メタデータの増減とも一致した（`results/run.json` の `steps`）。

### 4.1 拠出と発券（P・N → ZKV → 券 3 枚）

| 段階 | hash | ledger | close (UTC) | 結果 | 期待 | 実測（残高差） |
|---|---|---|---|---|---|---|
| P 拠出（RLUSD 0.10 → ZKV 0.10、V の発行注文と交差・IoC） | `FCBED258B27B9BD04CE34C809190234267DFB9AF3EC7F5481769383F1CC0A31C` | 58894 | 07:16:11 | tesSUCCESS | P RLUSD −0.10・ZKV +0.10、V RLUSD +0.10 | P RLUSD −0.1・ZKV +0.1、V RLUSD +0.1・ZKV 発行残高 +0.1 |
| V の償還注文を設置（P の拠出後） | `B38D969C681B350D59B852D5CFE483E29E0E0400CC71C54B4783C4C76D7227B9` | 58896 | 07:16:21 | tesSUCCESS | 残高変化なし | 変化なし |
| N 拠出（RLUSD 0.10 → ZKV 0.10） | `5AC1AA89F04B3931BA0B7183E8FC4FE729EAD6F40B0EB3D25D1553097F399576` | 58898 | 07:16:30 | tesSUCCESS | N RLUSD −0.10・ZKV +0.10、V RLUSD +0.10 | 同じ |
| **券 A** 発券（P → S、ZKV 0.10、期限 +2h） | `319CB3571497A3D318A2F3D87BD0E829F6E9144AAAAF4D1E37E860B1D9064B7D` | 58900 | 07:16:32 | tesSUCCESS | P ZKV −0.10（Escrow に拘束） | P ZKV −0.1 |
| **券 B** 発券（N → S、ZKV 0.05、期限 +2h） | `3F6E0EBD90EA378728885282A9B5E2D9A1BF32C3E41B42F57C6A95543FD4663B` | 58903 | 07:16:42 | tesSUCCESS | N ZKV −0.05 | N ZKV −0.05 |
| **券 C** 発券（N → S、ZKV 0.05、期限 **7 分**） | `C8119D49494525DE01BBFD58637439C75C949097B9F5D2210B2D0CB9E137D5D6` | 58905 | 07:16:51 | tesSUCCESS | N ZKV −0.05 | N ZKV −0.05 |

発券の照合（承認内容 ↔ 確定 Escrow、券ごとに 9 項目すべて一致、`results/run.json` の `escrowChecks`）: 持ち主・宛先 S・資産 ZKV(V)・額面・CancelAfter・Condition・Memo の鍵ハッシュ（申請の pkHash）・OfferSequence（= 台帳の Sequence）・制度の公開入力。各券の発券は **1 試行・1 取引**（`attempts`=1）。Memo は鍵ハッシュ 1 件だけで、氏名・住所・世帯識別子は台帳にも Memo にも入れていない。

| 券 | 制度 | 世帯 | Escrow の持ち主 | OfferSequence | Escrow index | CancelAfter (UTC) |
|---|---|---|---|---|---|---|
| A | P（基本給付） | H1 | P | 58852 | `15E2764ACC6E07309DAB51C25026A1807C3EFF43B313F31AE566FCCE08E5B495` | 09:16:30 |
| B | N（高齢者追加） | H1 | N | 58854 | `AC41716BC4E33CFA6702E18FC5C54494696FBD32DFC57C39BE3F052817DEF672` | 09:16:32 |
| C | N（高齢者追加） | H2 | N | 58855 | `3E14F7BDCD1F796DFBAD5612F74ED93C463669AE2BB64F311F6EC69A064D36D0` | 07:23:42 |

### 4.2 券 A・B: オフライン受付 → EscrowFinish → 償還（1 枚ずつ順に）

オフライン受付: 店の端末が台帳から作った同期データ（A のとき 3 件・B のとき 2 件）と、世帯の QR（元鍵の署名つき）だけで確認。別プロセスで fetch・ソケット・DNS・TLS を遮断。結果は A・B とも「**使える**」、通信の試み **0 回**。

| 段階 | hash | ledger | close (UTC) | 期待 | 実測（残高差） |
|---|---|---|---|---|---|
| A: S が EscrowFinish | `CBA5F45AA6EDE505DE885AC27067FBD6CF1C0414F709DB9C8A85E42771F82BFD` | 58908 | 07:17:00 | S の **ZKV** +0.10 | S ZKV +0.1（S の RLUSD は変化なし） |
| A: S が ZKV を償還（IoC） | `1C2C9B2B98B5E01D0D2AC30425B239309F6B92C4E57A264955599792CC01F303` | 58910 | 07:17:02 | S の **RLUSD** +0.10（満額約定）、V RLUSD −0.10 | S RLUSD +0.1・ZKV −0.1、V RLUSD −0.1 |
| B: S が EscrowFinish | `9607C0FB88D6AEDE7E4272560AC9743119281CBB016272089D4FD10D4D4C3DD9` | 58912 | 07:17:11 | S ZKV +0.05 | S ZKV +0.05 |
| B: S が ZKV を償還（IoC） | `7E5A5805BF2B87148F70F0671C86EBACBB926537DA5910F2DFAAB538513B0A5C` | 58914 | 07:17:21 | S RLUSD +0.05、V RLUSD −0.05 | S RLUSD +0.05・ZKV −0.05、V RLUSD −0.05 |

最終着金: **S に RLUSD 0.15**（A 0.10 ＋ B 0.05）。注文の作成・成功だけで満額約定とみなさず、各段階の実際の残高差で確認した（部分約定は起きなかった）。

### 4.3 券 C: 期限前の存在確認 → 期限後に keeper が取消 → N が償還

| 段階 | hash | ledger | close (UTC) | 期待 | 実測 |
|---|---|---|---|---|---|
| 期限前の確認（validated） | —（`ledger_entry`） | 58914 | 07:17:21（close_time 849165441 < CancelAfter 849165822） | 期限までは未使用の Escrow が存在 | **存在** |
| 期限後に keeper K が EscrowCancel | `9127E80EA4EA683AD8D4A5DE1AEB99FBB85F67208394A375118B6DE0F182C7FD` | 59034 | 07:24:00（close_time 849165840 > CancelAfter） | 【**C の ZKV 返還**】N の ZKV +0.05（S には何も届かない） | N ZKV +0.05、V の ZKV 発行残高 +0.05 |
| N が ZKV を償還（IoC） | `A39F8FAD59830BFE136C5FED96C4E36E1900B5C45C17327C3164C8ED73177456` | 59036 | 07:24:02 | 【**C の RLUSD 償還**】N の RLUSD +0.05、V RLUSD −0.05 | N RLUSD +0.05・ZKV −0.05、V RLUSD −0.05 |
| 【**N の純負担**】 | — | 58882→59036 | — | −0.10（拠出）+0.05（返還） = **−0.05** | **−0.05** |

時計の早送りや手作業の相殺は使っていない。validated ledger の close_time が CancelAfter+5 秒を超えるまで待ち（約 6 分）、そのあとに取消を送った。券 C に対する EscrowFinish は一度も送られていない。

## 5. 検算コマンドの確認項目（`results/verify.txt`／`verify.json`）

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| 全取引 25 件（準備 13・今回分 12）の確定結果・署名口座・ledger | manifest の `expect` と一致 | 一致（準備の 1 件は `tecUNFUNDED_OFFER` が期待どおり） | `tx` |
| 券ごとの Escrow の内容・Finish/Cancel・償還の増減 | 4.1〜4.3 の期待 | 一致 | 取引メタデータ |
| P/N/S/V の RLUSD 純増減（開始 58882 → 終了 59036） | −0.10 / −0.05 / +0.15 / 0 | 同じ | 両 ledger の `account_lines`・`gateway_balances` |
| 確定残高の差 − 取引メタデータの合計（口座ごと・RLUSD と ZKV） | 0 | 0 | 同上 |
| 終了時点の未決 Escrow（券 A・B・C）／P・N・S に関わる Escrow オブジェクト | 0 | 0／0 | `ledger_entry`・`account_objects` @59036 |
| 未償還 ZKV（V の発行残高の増減） | 0 | 0 | `gateway_balances` |
| V の RLUSD 準備金 − ZKV 発行残高 | 0 | 0 | V の残高 |
| 開始点より後の manifest 外の取引 | 0 | 0 | `account_tx`（P・N・S・V・K） |
| `--zk`: 公開 ZK 証明の検証・申請ダイジェスト一致 | 通る | 3 券とも通る・一致 | bb.js |
| 合計 | 116/116 | **116/116**（`--zk` なしは 110/110） | |

**検算コマンドが間違いを落とすことの確認**（manifest を改ざんして実行、いずれも終了コード 1）: 券 B の額面を 0.06 に（8 項目不一致）／券 C を「使用済み・S が受取人」と偽装（7 項目不一致）／券 A の償還取引を manifest から削除（S の差額 +0.10・V の差額 −0.10 が「説明できない差額」として検出、manifest 外の取引 1 件）。

## 6. 実際に返ってきたエラーコード

| 場面 | コード | 内容 |
|---|---|---|
| V の償還注文を RLUSD 0 のときに置いた | **tecUNFUNDED_OFFER**（`ED04B3F6…B911FD4`、ledger 58882） | 売るもの（RLUSD）を V が持っていない。拠出のあとに置けば tesSUCCESS（58896） |
| 検算の不具合（コード側） | — | 検算の初回実装は Fulfillment の桁数を 68 としていて、台帳が正しいのに 2 項目が不一致になった（正しくは 72 桁 = `A0228020` + 32 バイト）。台帳の Fulfillment を取得して確認し、検算側を直した。台帳側の問題ではない |
| tem/tef | なし | 今回の送信では出ていない |

## 7. 同じ世帯であることの根拠（区別して示す）

| 区分 | 内容 |
|---|---|
| 合成データの試験ハーネスで照合した | H1 が P と N の両方で**実際に**証明を作った（A: P、B: N）。A と B で nullifier（制度ごとに別）・鍵ハッシュ（申請鍵）・Condition はすべて異なる。C は別世帯 H2。H3（高齢者でない）は N の証明を作れない（`Circuit execution failed: senior required`）。`results/harness-links.json` |
| 公開台帳から検算できる | 券ごとの資金の流れ。A と B で共通する台帳上の項目は宛先の店舗 S だけ（持ち主 P と N、鍵ハッシュ、Condition は別）。世帯の同一性は台帳から**分からない** |
| 発券サービスの記録または本人の協力が必要 | H1 が両制度の対象であること（名簿の root、制度ごとの検証、(制度, nullifier) の一意）。「本人が選んだ 2 券の同一世帯性を監査者に ZK で示す」は未実装 |

## 8. 再実行（重複させない）と、見つけた不具合

- 仕組み: 署名済みの取引は**送信より先に** `.state/journal.json` に保存する。再実行では validated になった取引は再送しない。未確定は同じバイト列を再送（同一 hash）。LastLedgerSequence を越え、履歴が連続し `searched_all` のときだけ不成立と確定して再署名する。判定できないときは hash を残して止まる（今回は一度も起きていない）。発券は spike 14 の `Service` が記録（確定済みなら再度 apply しない）。
- **新しい独立試験と既存 run の再照合を区別**: 既定は前回の続き（完了済みなら再照合のみ）。`-- --new` で `.state` と `results` を退避して新規。
- **再実行の試験で見つけた不具合（修正済み）**: 初版は、準備段階が「現在の RLUSD 残高 < 必要額」で購入の要否を決めていた。使い終わった後の再実行で N が AMM から **0.05 RLUSD を余計に購入**した（hash `1D5ECEAD8652F0342523B0A1FF4993B2896D4CC3BE791ED5632FB467A05C98BC`、ledger 59102）。給付の検算範囲（58882〜59036）の外で、拠出・発券・精算・償還の取引は重複していない。修正: 購入済みかは journal の記録で判定し、開始点を `baseline.json` に固定して、確定後は準備を一切やり直さない。余計な取引は消さず manifest の `outsideWindow` に記録した（検算の範囲外。N の**現在**の RLUSD は 0.10 で、終了 ledger の 0.05 と違う。検算は ledger 指定で読むので影響しない）。
- **再実行で見つけた不具合 その 2（修正済み）**: 期限切れの券 C を、再実行で `Service.apply` に通すと方針検査（`cancelAfter` の余裕）で拒否され、発券記録が確定済みでも停止した。発券記録が確定済み（`state='confirmed'`）なら再度 apply せず、記録から続ける（既存 run の再照合）ようにした。
- 修正後の再実行 4 回（うち 1 回はこの不具合で途中停止し、修正後に完了）: 新しい取引 0 件、journal 26 件（今回分 25 ＋ 範囲外 1）のまま、manifest の取引 hash 25 件が初回と同一。なお `baseline.json` は初回実行の後に導入したため、journal の準備の取引から同じ ledger 58882 で再構成した（初回実行の開始点と同じ値）。
- 判定できない取引の保存・確定結果の照合は実装したが、今回は発動していない（通信障害を起こしていない）。

## 9. 設計への影響（06_技術設計）

1. **Testnet RLUSD の発行者は 11/25 のリセットで替わった**（`rQhWct2f…` → `rpcFL7Mz…`）。`packages/xrpl-kit/src/rlusd.ts` の `RLUSD_TESTNET_ISSUER` は古いまま（今回は変更していない。spike 02〜04 のコードはそのままでは動かない）。発行者はハードコードせず、公式の案内（tryrlusd.com/addresses）から設定にし、起動時に `account_info` で実在確認する。
2. **新しい RLUSD 発行者には `lsfAllowTrustLineLocking` が立っている**（フラグ 0xC1…）。spike 03 の前提「Testnet の RLUSD は直接エスクローに入れられない」は、今の Testnet では**再測定が要る**（今回は測っていない。RLUSD→ZKV の 1:1 交換を通す設計は引き続き動くが、直接 Escrow の方が単純になる可能性）。同じ発行者は **`lsfAllowTrustLineClawback`** も持つ。発行者が V や店舗の RLUSD を回収できるため、V の準備金・店舗の着金の説明に影響しうる。
3. **RLUSD の入手は faucet に頼れない**（GitHub サインイン＋ブラウザウォレット）。自動試験では AMM（XRP→RLUSD、約 1 XRP = 1 RLUSD）が使えた。デモ前の準備手順に入れる。
4. **V の償還注文の運用**: (a) V が RLUSD を持つまで置けない（`tecUNFUNDED_OFFER`）。(b) **V の RLUSD が 0 になった瞬間に、償還注文（`tfPassive`）が板から消えた**（ledger 59036 で消滅。58914・59034 では残っていた）。次の拠出のあと、V（または運用ジョブ）が償還注文を置き直さないと、店舗は償還できない。給付の支払い（Finish → 償還）の前に「償還注文が板にあるか」を確認する工程が要る。
5. **検算では ZKV が Escrow 中のとき `gateway_balances` の義務に入らない**（発券直後の V の義務が減る。spike 04 の観測と一致）。第三者が準備金の一致を見るときは「V の RLUSD = 義務 + Escrow 中の ZKV」。今回の検算は Escrow が 0 の終了時点で見ている。
6. **EscrowFinish（Fulfillment あり）の手数料は 423 drops**（他は 12 drops）。keeper の手数料予算は Finish の件数で見積もる（Batch は今回使っていない）。
7. **再実行の冪等性は残高ではなく、送信記録（hash）で守る**（8 節の不具合）。keeper・発券サービスにも同じ原則。
8. 検算の入口: `manifest.json`（取引 hash・口座・券の内容、秘密なし）と `verify` を成果物の標準にできる。第三者の検算に必要なのは公開ノードだけ。

## 10. 分からなかったこと

- 主催者の受益者要件に、**店舗券（店舗への着金）が適合するか**。技術判定の対象外。
- AMM 口座（`rKK1ptBR…`）が公式の運営かは確認していない（RLUSD そのものは公式発行者のもの）。faucet 経由の入手は未実施。
- 直接の RLUSD Escrow（`lsfAllowTrustLineLocking`）が今の Testnet で通るか（9 節 2）。
- 障害時の挙動（通信断・プロセス停止・Sequence 競合）。依頼書どおり spike 14 の再演はしていない。
- 部分約定・丸め: 0.10 と 0.05 の満額約定だけを確認。さらに細かい額・大きな額・複数店舗の同時償還は未確認。
- 単一の公開 Testnet ノードの履歴だけを根拠にしている。別ノードとの突き合わせは未実施。1 回の実行（n=1）。
- Batch での複数 EscrowFinish（1 回最大 8 件）は使っていない。店舗は 1 枚ずつ Finish した。
- ZK で「2 券が同一世帯」と監査者に示す仕組み（未実装）。
- Node は v24.20.0 で実行（AGENTS.md は 26 以上）。xrpl 5.3.0、rippled 3.5.0-rc6。

## 11. 再現・成果物

```bash
pnpm --filter 15-multi-donor-rlusd unit                      # 十進固定精度の単体試験
pnpm --filter 15-multi-donor-rlusd typecheck
pnpm --filter 15-multi-donor-rlusd run:scenario              # 前回の続き。完了済みなら既存 run の再照合のみ（.env.local に V・P・N・S・K の seed が必要）
pnpm --filter 15-multi-donor-rlusd run:scenario -- --new     # 新しい独立試験（前回の状態を .state-archive-* へ退避。約 10 分）
pnpm --filter 15-multi-donor-rlusd verify -- --zk            # 読み取り専用の検算（署名鍵・.env.local は読まない）
```

| ファイル | 内容 | 秘密 |
|---|---|---|
| `results/manifest.json` | 取引 hash・口座・券の内容（検算の入力）。`outsideWindow` に範囲外の取引 | なし |
| `results/run.json` | 実測（各段階の残高差・メタデータの増減・ledger・close_time・オフライン受付） | なし |
| `results/verify.json`／`verify.txt` | 検算の結果（116 項目） | なし |
| `results/proofs.json` | ZK 証明と公開入力（`--zk` の入力） | なし（公開してよい） |
| `results/harness-links.json` | 世帯の同一性の照合記録（合成データのハーネス） | なし（世帯の秘密・券の鍵・preimage は含まない） |
| `.state/`（gitignore） | 署名済みバイト列・世帯の秘密・券の preimage と端末鍵 | **あり**（コミット・共有しない） |

秘密の混入確認: `results/` 配下に、`.env.local` の seed・世帯の秘密と salt・券の preimage・端末の秘密鍵が含まれていないことを文字列照合で確認した。

### 3〜5 分のデモで見せる取引の順

1. （30 秒）`verify -- --zk` を実行して「116/116・未決 0・説明できない差額 0」と、P −0.10／N −0.05／S +0.15／V 0 の表を見せる。
2. （40 秒）P 拠出 `FCBED258…`: P の RLUSD が減り、V の準備金と ZKV の発行残高が同額増える（1:1）。
3. （40 秒）券 3 枚の発券 `319CB357…`（A）・`3F6E0EBD…`（B）・`C8119D49…`（C）: 持ち主が P と N、Memo は鍵ハッシュだけ、世帯の識別子なし。
4. （60 秒）A: オフライン受付（通信 0 回）→ `CBA5F45A…`（Finish、S の ZKV +0.10）→ `1C2C9B2B…`（償還、S の RLUSD +0.10）。
5. （60 秒）C: ledger 58914 時点で未使用の Escrow が存在 → 期限後 `9127E80E…`（取消、N の ZKV +0.05）→ `A39F8FAD…`（償還、N の RLUSD +0.05）。「N の純負担は −0.05」。
6. 結び: 着金先は店舗 S（世帯ウォレットではない）。受益者要件の適合は主催者確認事項。

C の期限待ちは今回 約 6 分。ライブで見せる場合は、結果を事前に実行しておくか、期限を短くして再実行する（発券側の方針の下限は 120 秒に設定してあるが、その短さでの実測はしていない）。
