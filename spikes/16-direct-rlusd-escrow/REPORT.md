# 16-direct-rlusd-escrow: Testnet RLUSD を直接ロックし、使った分を店舗へ・未使用分をドナーへ戻せるか

実施: 2026-11-28 08:03〜08:12 UTC（Testnet、validated ledger 59777〜59896）。spike 15 の ZKV 発行・1:1 交換注文・償還を使わず、**公式 Testnet RLUSD そのもの**を条件付き Escrow にした。

## 1. 結論

| 段階 | 判定 |
|---|---|
| 直接ロック（RLUSD を ZKV なしで EscrowCreate） | **成立**（A 0.10・B 0.05 とも tesSUCCESS、ロック合計 0.15） |
| 店舗着金（A を期限前に Finish） | **成立**（S の RLUSD が額面どおり +0.10。券の額面どおりの精算も達成） |
| 期限後のドナー返還（B を期限後に K が Cancel） | **成立**（D +0.05、S 差額 0、B 消滅） |

**総合: 成立。** 3 段階が通ったので、店舗券の決済部分で直接方式を採用する候補になる（置換は今回しない）。
読み取り専用の検算コマンドは 45/45 項目が期待どおり（未決 Escrow 0・説明できない差額 0・manifest 外の取引 0 件）。

RLUSD の最終増減（開始 ledger 59781 → 終了 ledger 59896）: **D −0.10、S +0.10**、返還分 +0.05 は D の中に含まれる（D は 0.15 → ロックで 0 → 返還で 0.05）。TransferRate はなく、移転手数料は 0（額面と実着金の差なし）。XRP 建て費用は別表（7 節）。

判定は今回の Testnet 実測（1 回、単一の公開ノード）に限る。合成世帯の資格・オフライン受付との統合、世帯自身のウォレットへの着金、大会要件への適合は対象外。

## 2. 前提の確認（実行時）

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| 公式の Testnet RLUSD 発行者 | 公式出典で確認 | `rpcFL7MzZvGYFCihoUx9nrhhgAp4nSDdvG`、通貨コード `524C555344000000000000000000000000000000` | https://tryrlusd.com/addresses の「XRPL Testnet」欄を実行時に取得（HTTP 200）。初回実行 08:05 UTC 頃、再照合時 2026-11-28T08:13:38Z も同一。spike 15 の観測値と**同じ** |
| 台帳上の発行者 | 実在 | 実在。Domain=`https://ripple.com/` | `account_info` |
| ネットワーク | Testnet | network_id=1、rippled **3.5.0-rc6**、`complete_ledgers` 16111-59911 | `server_info`（公式出典以外の資産では代替していない） |
| TokenEscrow | 有効 | `enabled=true`（`feature` RPC が応答） | 取得できた |
| 発行者フラグ | — | Flags=`0xC19A0000`: DefaultRipple・**AllowTrustLineLocking**・**AllowTrustLineClawback**・DepositAuth（RequireAuth・GlobalFreeze なし） | `account_info`。03 の旧発行者は AllowTrustLineLocking なしで tecNO_PERMISSION だった |
| TransferRate | — | **なし**（手数料なし） | `account_info` |
| D・S の trust line | 枠あり・凍結なし・認可不要 | 両方 limit 1,000,000、freeze/freeze_peer なし、RequireAuth なしで認可不要 | `account_lines` @59781 |
| D の利用可能 RLUSD | ≥ 0.15 | 0.15 | 開始 ledger 59781 |
| XRP | 手数料・準備金 | D 99.849975、S 99.999988、K 100（準備金は base 1 + inc 0.2/オブジェクト。Escrow 1 件で 0.2 XRP 拘束） | `account_info` |
| D・S・K | 3 アカウントが別 | 別（下表） | 検算で D ≠ S を確認 |

| 記号 | アドレス |
|---|---|
| D（ドナー） | `rEYjZHYxPjnpEEYyFQfkBg7T47W1XYzWFv` |
| S（店舗） | `rnEvvTu2nHbRbCGpWLms4L2wuShkHLgeQs` |
| K（keeper） | `rHLE2TtnbKcLErtgJmtSvmcH2sepjaeNYK` |

### 準備（開始残高の前・給付区間と別計上）

| 取引 | hash | ledger |
|---|---|---|
| D: TrustSet RLUSD | `B373BF4C06D3F8380C4F191F1D24FC4A912B0B00A1F0C3C6A4A0316C161025F1` | 59777 |
| S: TrustSet RLUSD | `13AC9E3C66A7ADA22D5A39C005048823E480BC52E0E3FB8302801442419172D6` | 59779 |
| D: AMM（XRP→RLUSD）で 0.15 RLUSD を購入（投入上限 SendMax 1 XRP） | `7E84D4524CF17300510DC618430A4F5EB2225451BC710C19FCD7805A1A4A5FA1` | 59781 |

RLUSD の入手は spike 15 と同じく AMM（faucet は GitHub サインインが要る）。0.15 RLUSD に約 0.150001 XRP（準備前後の XRP 残高と手数料からの逆算）。**開始点は準備の最後の ledger 59781**（hash `E2B8ED4F12C91C8EA7A487C757FF42015942201A2F520B1CAFF17AA0D58DCC60`、close 08:05:22 UTC）で固定した。ZKV 発行・交換注文・「支払いや返還を模す Payment」は給付区間に入れていない。

## 3. 実測（各段階を確定取引と RLUSD 残高差で判定）

残高差は、取引の ledger L−1 → L の `account_lines`。取引メタデータ（RippleState の増減）とも一致した。

| 段階 | hash | ledger（hash）／close UTC | 結果 | 期待 | 実測 |
|---|---|---|---|---|---|
| 直接ロック A（0.10、期限 +2h = 10:05:22） | `F8E5C4CEC8FF0C5F8CCE6BE99AEF4391BCC83BCA7928329DC6E5F502CF2C6A83` | 59783 `F4BA1FF1…EDE5F`／08:05:31 | **tesSUCCESS** | D −0.10（ロック）、S 0 | D −0.1、S 0。Escrow `D96D7E6FFACD5AA352B2F09B367D2071C5513DAE94ED0C004B59816A3E072957` が生成 |
| 直接ロック B（0.05、期限 +6 分 = 08:11:31） | `ACB1D09DCF551EAFB59C9FD6E1C820DA177C889B158A230D0EA835E57981A970` | 59785 `4E50B80F23924F99378182795B470F303598B1089D0EF9207BB1E1D159960EE7`／08:05:40 | **tesSUCCESS** | D −0.05、S 0 | D −0.05、S 0。Escrow `152258C764F121D104F5FC96A25197DBECBDAD61A2DFEDE049A984819A9A2576` |
| ロック中の確認 | —（`ledger_entry`） | 59785 | — | 合計 0.15、D の利用可能 0 | A・B とも存在し、Owner・Destination・Amount(currency/issuer/value)・Condition・CancelAfter・Sequence（59773 / 59774）が一致。**ロック合計 0.15**、D の利用可能 0、S 0 |
| 使用: A を S が Finish（期限前） | `3FDC113428F0F2E2BAFDA312530DBA3743BC3246632D86B719756F610860B482` | 59787 `8DB21828…176F6`／08:05:42（< CancelAfter 10:05:22） | **tesSUCCESS** | S +0.10 | **S 0 → 0.1（+0.1）**、D 0。A の Escrow は消滅。B は未使用のまま残る |
| 期限前の確認（B） | —（`ledger_entry`） | 59787（close_time 849168342 < CancelAfter 849168691） | — | B 存在、S に B 由来の着金なし | B 存在、S は A の 0.1 のまま |
| **期限到来**（別記録） | —（ledger 時刻） | **59894** `15ED9A8391BF531A9729AF3CE0F717FA848A02D356F47781D39BFB316249E495`／08:11:40（close_time 849168700 > CancelAfter 849168691） | — | close_time が期限を越えた最初の観測 ledger | 確認 |
| **返還取引の確定**: K が B を Cancel | `C34A1B60643BE3E335A4E66167896D3C3DA7751DF11A40875FF50C27CF996BB1` | 59896 `CBF5301E6EE493295EA172BD09D2D306E34EF6368C692AEB3B0E70FD52700224`／08:11:42（> CancelAfter） | **tesSUCCESS** | D +0.05、S 差額 0、B 消滅 | **D 0 → 0.05（+0.05）、S 差 0**、B の Escrow は消滅 |

- **Finish の送信者は S（宛先）**、資金の着金先も S。Cancel の送信者は **K（D でも S でもない第三者）**。
- 時計の早送りや相殺は使っていない。close_time が期限を越えるまで待ってから Cancel を送った（約 6 分）。
- 返せない場合に備えた再開・Finish 失敗時の回収分岐は実装したが、今回は発動していない（全取引が初回で tesSUCCESS）。

### 最終検算（開始 59781 → 終了 59896）

| 項目 | 期待 | 実際 |
|---|---|---|
| D の純増減 | −0.10（−0.15 のロック＋0.05 の返還） | −0.1 |
| S の純増減 | +0.10 | +0.1 |
| 確定残高の差 − 取引メタデータの合計（説明できない差額） | 0 / 0 | 0 / 0 |
| 未決 Escrow（D のオブジェクト） | 0 | 0 |
| manifest 外の取引（D・S・K、開始後） | 0 | 0 |

## 4. 返ってきたエラーコード

なし（tec/tem/tef は一度も出ていない。全取引が初回で tesSUCCESS）。03 の旧発行者で出た `tecNO_PERMISSION` は、今回の発行者では再現しなかった。ただし**原因がフラグだけとは断定しない**: 発行者の違い（03 は旧 Testnet・旧発行者、今回は別発行者・別リセット後・別 rippled）が複数同時に変わっているため。今回言えるのは「この発行者・この条件では通った」まで。

## 5. 検算コマンド（署名鍵なし）

```bash
pnpm --filter 16-direct-rlusd-escrow verify -- --official   # 読み取り専用。.env.local・署名鍵は読まない。--official は公式ページを再取得して発行者を照合
```

公開 Testnet の validated 履歴から、tx 結果・Escrow の生成と消滅・資金の差額を十進固定精度（BigInt、10⁻¹⁵）で再計算する。ledger hash・取引 hash・Escrow の ID も記録と照合する（45 項目）。
manifest を 3 通りに改ざんして実行し、いずれも終了コード 1: 券 A の額面を 0.11 に／B の結末を A の Finish にすり替え／A の Finish 取引を manifest から削除（欠落・ロック合計・D の差額が不一致）。

再実行の確認: `run:scenario` を 3 回再実行（journal 7 件のまま、新しい取引 0 件、manifest の取引 hash は同一）。再実行で `run.json` の「期限前の確認」が上書きされる不具合を 1 件見つけ（初回の証拠は `run1.log` から復元）、期限前の確認は一度だけ保存する形に直した。

## 6. spike 15 との比較

| 観点 | spike 15（ZKV 経由） | spike 16（直接） |
|---|---|---|
| 発行者 V の設定（DefaultRipple・AllowTrustLineLocking） | 要（V が AccountSet 2 回） | **不要**（RLUSD 発行者側に既にある。発行者の設定変更を前提にしない） |
| ZKV の trust line | 全員要 | **不要** |
| V の 1:1 発行・償還注文（OfferCreate 2 本、償還注文は RLUSD 0 で消える） | 要。運用ジョブも要 | **不要**（V という役割自体が要らない） |
| ドナーの拠出（RLUSD→ZKV の交換 1 取引） | 要 | **不要**（RLUSD をそのままロック） |
| 店舗の償還（Finish 後の交換 1 取引） | 要（満額約定を残高で確認） | **不要**（Finish で RLUSD がそのまま着金） |
| 未使用分の返還（Cancel のあと償還 1 取引） | 要 | **Cancel だけで RLUSD が戻る** |
| 給付区間の取引数（使用 1 券＋返還 1 券） | spike 15 の構成では、拠出（交換）・V の償還注文・発券・Finish・償還・Cancel・償還が別取引 | 作成 2＋Finish 1＋Cancel 1 の **4 取引** |
| 店舗が必要な trust line | ZKV と RLUSD | **RLUSD のみ**（今回は S が事前に TrustSet 済み。無い場合は未測定） |
| EscrowFinish の手数料 | 423 drops | 423 drops（同じ） |
| まだ必要なもの | trust line・発券サービス・keeper・V の運用 | **RLUSD の trust line（D・S）、発券サービス（Condition・CancelAfter・Sequence の管理）、keeper（期限後の Cancel）** |

### 発行者権限・店舗運用への影響

- **発行者の権限が直接見える**: この RLUSD 発行者は **AllowTrustLineClawback** を持つ。発行者は D・S の RLUSD を回収できる（Escrow 中の分を含めて回収が及ぶかは今回測っていない）。ZKV 方式でも V が RLUSD を保有するので同じリスクはあるが、直接方式では「V 運営者の償還注文の取り消し」という別のリスクが消える。
- **Escrow 中の RLUSD は D の利用可能残高から外れる**（ロック中 D=0）。ドナーは未使用分を期限まで自分で使えない。ZKV 方式と同じ。
- **店舗は RLUSD の trust line が必要**（TrustSet 1 回）。店舗が trust line を持たない場合の Finish の挙動は今回測っていない（spike 11c の ZKV では宛先自身の Finish で自動作成されたが、RLUSD の発行者側設定による違いは未確認）。
- 券の額面と実着金は一致（TransferRate なし）。TransferRate が将来設定されると差が出うる。発行者はこの設定を変えられる（ハッカソン時点の再確認が必要）。

## 7. XRP 建て費用（別表・今回分の給付区間）

| 口座 | 内訳 | 費用 |
|---|---|---|
| D | EscrowCreate 2 本 | 24 drops |
| S | EscrowFinish 1 本（Fulfillment あり） | 423 drops |
| K | EscrowCancel 1 本 | 12 drops |
| 準備 | TrustSet×2・AMM 購入 36 drops 前後＋RLUSD 購入の XRP | 別計上 |

Escrow の保有中は Owner 準備金 0.2 XRP/件（D）が拘束される（残高からは引かれず、使えない枠）。

## 8. 分からなかったこと

- 03 の `tecNO_PERMISSION` の原因（フラグか、発行者・環境の他の違いか）。今回の成功は発行者側の AllowTrustLineLocking の観測と整合するが、因果は断定しない。
- 発行者の **clawback が Escrow 中の RLUSD に及ぶか**、**DepositAuth の影響**（宛先が発行者のとき等）は未測定。
- 店舗が RLUSD の trust line を持たない場合の Finish の結果（tecNO_LINE か自動作成か）。
- 期限前の Cancel の拒否（tecNO_PERMISSION）・期限後の Finish の拒否は今回の対象外（spike 04 の ZKV で測定済み）。
- 凍結・RequireAuth の発行者での挙動（今回の発行者にはない）。
- 単一の公開ノードの履歴だけを根拠にした。1 回の実行（n=1）。障害（通信断・Sequence 競合）は対象外。
- 大きな額・多数件・Batch での Finish は未確認。
- Node は v24.20.0（AGENTS.md は 26 以上）。xrpl 5.3.0。

## 9. 成果物

| ファイル | 内容 | 秘密 |
|---|---|---|
| `results/manifest.json` | 取引 hash・ledger（hash 付き）・Escrow の ID・口座・公式出典（検算の入力） | なし |
| `results/run.json` | 実測（preflight・ロック確認・期限前確認・期限到来・各段階の残高差とメタデータ） | なし |
| `results/verify.json`／`verify.txt` | 検算結果（45 項目） | なし |
| `.state/`（gitignore） | 署名済みバイト列・A/B の preimage | **あり**（共有しない） |

`results/` に seed・preimage が含まれないことを文字列照合で確認した。コミット・既存設計の置換は行っていない。

再実行: `pnpm --filter 16-direct-rlusd-escrow run:scenario`（前回の続き）／`-- --new`（新しい独立試験、約 8 分）。
