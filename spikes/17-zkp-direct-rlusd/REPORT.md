# 17-zkp-direct-rlusd: 資格を証明した店舗券を、同じ資産・額面の RLUSD で支払い、未使用分を返す統合検証

実施: 2026-11-28 09:10〜09:25 UTC（Testnet、validated ledger 61024〜61164）。spike 13（ZK 証明・申請ダイジェスト）、14（`Service.apply` から発券確定）、15（合成世帯・2 制度・オフライン受付・読み取り専用検算）、16（直接 RLUSD Escrow）をつなぎ、**世帯が ZKP で申請した券・発券サービスが承認した券・店舗が通信なしで受け付けた券・XRPL で実際に動いた RLUSD を、同じ 1 件として第三者が照合できるか**を確かめた。ZKV・償還注文・中継発行者 V は使っていない。

## 1. 判定

| 項目 | 判定 | 根拠（要約） |
|---|---|---|
| v1 互換 | **成立**（ローカル） | v1 の既知ベクトル（191 B・SHA-256・req_hi/lo）を再現。v1 の既存経路で v1 の証明は今も受理・検証される。v1 の証明を v2 として受理しない |
| v2 の資産拘束 | **成立**（ローカル） | 通貨 20 B・issuer 20 B を拘束。通貨だけ／issuer だけ／額面だけ違う申請は、方針が通る設定でも回路の拘束（`req_hi`）で拒否され、発券記録・試行・送信は増えない。依存版 XRPL codec と照合。Noir 回路は変更なし |
| 資格から店頭受付 | **成立**（Testnet） | A・B・C の本物の ZK 証明 → `Service.apply` で発券 → 通信遮断の店頭受付で A・B が「使える」（通信の試み 0 回）→ 受付データから Finish |
| 直接支払いと期限後返還 | **成立**（Testnet） | A 0.10・B 0.05 が S へ額面どおり着金。C は期限前まで存在・未使用、期限後に keeper K が Cancel して N に +0.05、S 差額 0 |
| 第三者検算 | **成立**（条件つき） | 署名鍵・世帯秘密・`.env.local` なしで 70/70 項目。**台帳の EscrowCreate から復元した申請**の v2 ダイジェスト = 本物の証明の `req_hi/lo`。5 通りの改ざんを検出 |

**総合: 成立。** 支援を利用したのは **H1**（A・B）、RLUSD の着金先は**店舗 S**（世帯ウォレットではない）。

**最大の未確認事項**: 検算が外部から信頼する **名簿 root・制度設定・ドナーとの対応（`trust.json`）が正当に承認されたものか**は、検算では確かめられない（発券側が選ぶ値）。また**店頭のオフライン受付は第三者が再現できない**（manifest に残るのは通信 0 回・同期データの SHA-256・Fulfillment の SHA-256 という記録だけ）。ほかに、同一世帯性の第三者証明（未実装・必須外）、店舗券方式が大会の受益者要件を満たすか（技術判定とは別・主催者確認事項）。

### 誰の RLUSD がいくら増減したか（基準 ledger 61032 → 終了 ledger 61164、validated）

| 口座 | 役割 | 基準 | 終了 | 純増減 | 期待 |
|---|---|---|---|---|---|
| P | 県（ドナー） | 0.10 | 0 | **−0.10** | −0.10（A は使われた） |
| N | NGO（ドナー） | 0.10 | 0.05 | **−0.05** | −0.05（−0.10 を拘束、C の返還 +0.05） |
| S | 店舗 | 0 | 0.15 | **+0.15** | +0.15（A 0.10 + B 0.05） |
| 合計 | | | | **0** | 0（TransferRate なし、額面どおり） |

給付区間の取引は **EscrowCreate 3・EscrowFinish 2・EscrowCancel 1**（ZKV・交換注文・Payment は 0）。未決 Escrow 0、manifest 外の取引 0 件、確定残高の差と取引メタデータの合計の差（説明できない差額）0。XRP 手数料・準備金は別計上（7 節）。

## 2. 作ったもの・変更

| 区分 | 内容 |
|---|---|
| 新規 `src/reqv2.ts` | 申請形式 v2。タグ `todoke-17-request-v2`、208 B。通貨は XRPL の 20 B（40 桁 hex の大小文字は同じ値、3 文字 ISO は標準形式の 20 B に符号化、`XRP`・全ゼロ・標準形式の崩れ・非 hex・不正長は拒否）、issuer は AccountID 20 B |
| 新規 `src/local.ts` | 固定ベクトル・ローカル試験（53 項目）。`vectors/request-v2.json` を出力 |
| 新規 `src/run.ts`／`src/shop-offline.ts`／`src/verify.ts` | Testnet シナリオ／通信遮断の店頭受付（受け付けた券のデータを返す）／読み取り専用検算 |
| 再利用（変更なし） | Noir 回路 `eligibility_bound`・`Zk`・`Roster`（13）、`Service` の検証・発券確定・復旧（14）、`track`・`chainio`・`dec`・`deltas`（15）、直接 RLUSD の Escrow 構成（16）、11c の Condition・QR・`verifyVoucher` |
| **spike 14 への変更（1 か所）** | `Service` の `Opts` に任意の `digest`（申請ダイジェストの計算関数。既定は 13 の v1）。v2 を承認・発券の通常入口に通すための接続のみ。既定の挙動は変わらない |
| Noir 回路 | **変更なし**。ダイジェスト上位・下位（128 ビット × 2）をそのまま公開入力に取るため、v2 の 32 B ダイジェストも同じ回路で扱える（Noir の fixture が TS と同じ `req_hi/lo` を返すことを確認） |

資産の表現を「承認 → 発券 → 検算」の全経路で一貫させた点: ①承認（`Service.apply`）は v2 ダイジェストで公開入力を再計算して照合、②発券（EscrowCreate）の Amount は承認した資産そのもの、③検算は台帳の Amount から v2 ダイジェストを再計算して証明と照合。

## 3. ローカル検証（Testnet なし・53/53）

`results/local.json`。同じ `Service` を模擬ノードに繋いで確認。

| 確認 | 期待 | 実際 |
|---|---|---|
| v1 既知ベクトル（191 B・SHA-256・req_hi/lo） | spike 13 の `vectors/bytes-field.json` と一致 | 一致 |
| v1 のコードは 40 桁の通貨を受け付けない（変更していない） | 拒否 | 拒否 |
| v2 の正規バイト列（208 B）の各項目（タグ・制度 32 B・owner・shop・通貨 20 B・issuer 20 B・額面 8 B BE（10⁻⁶ 単位、0.1 → `00000000000186A0`）・期限 4 B・鍵ハッシュ・Condition） | 設計どおり | 一致。`vectors/request-v2.json` に正規バイト列・SHA-256・req_hi/lo・桁順・単位を記録 |
| 依存版 XRPL codec（ripple-binary-codec）が直列化した Amount に「通貨 20 B ‖ issuer 20 B」が現れる（RLUSD の 40 桁・`USD`） | 一致 | 一致（直前 8 B が Amount の値、その前がフィールド ID 0x61） |
| hex の大小文字違い | 同じバイト列・同じダイジェスト | 同じ |
| 異なる通貨／issuer／額面／制度／owner／店／期限／鍵ハッシュ／Condition | ダイジェストが異なる | すべて異なる |
| 不正入力（通貨 39・41 桁、4 文字、空、非 hex、`XRP`、全ゼロ、標準形式の崩れ、不正文字、鍵ハッシュ 63 桁、非 hex の Condition、不正なアドレス、額面 0、8 B 超過） | 拒否 | すべて拒否 |
| 対応入力（3 文字 ISO、40 桁 hex の大文字・小文字） | 受理 | 受理 |
| v2 の正常な申請・証明 | 発券記録 1・試行 1・台帳への一意な送信取引 1（stopAfterPrepare で送信前に停止） | 一致。同じ申請の再送は新しい発券記録・取引を作らない |
| 元の有効証明に対し **通貨だけ／issuer だけ／額面だけ**違う申請（方針が通る設定にして、回路・ダイジェストの拘束そのものを見る） | `public input mismatch: req_hi` で拒否。記録・試行・送信は 0 のまま | 3 件とも一致 |
| 同じ 3 件を通常の方針で | `policy` で拒否 | 一致 |
| v1 の証明を v2 として受理するか | 受理しない | `public_input` で拒否 |
| v1 の証明（既存の経路） | 受理・bb.js の検証も通る | 受理 |
| 版をまたいだ再発券（同じ世帯・同じ制度で v1 → v2） | 拒否（nullifier は制度単位） | `duplicate`、記録は 1 件のまま |
| 別の世帯・同じ制度 | 別の nullifier で発券できる | 発券できた |

（ローカル試験の初版で 3 項目が不一致になったのは、模擬ノードの送信カウンタが試験をまたいで累積し、同じ署名済み取引の再送も数えていた**試験側の数え方の誤り**。一意な取引数に直した。発券記録・試行はいずれも 1 件で、二重発券は起きていなかった。）

## 4. Testnet シナリオ

### 4.1 前提（実行時の確認）

| 項目 | 実際 | 根拠 |
|---|---|---|
| 公式の Testnet RLUSD | 発行者 `rpcFL7MzZvGYFCihoUx9nrhhgAp4nSDdvG`、通貨コード `524C555344000000000000000000000000000000` | https://tryrlusd.com/addresses の「XRPL Testnet」欄を実行時に取得（2026-11-28T09:24:30.705Z 取得、HTTP 200）。spike 15・16 の値と同じ |
| ネットワーク | network_id=1、rippled 3.5.0-rc6 | `server_info` |
| TokenEscrow | `enabled=true` | `feature` |
| 発行者 | Flags `0xC19A0000`（DefaultRipple・**AllowTrustLineLocking**・**AllowTrustLineClawback**・DepositAuth）、**TransferRate なし**、Domain `https://ripple.com/` | `account_info` |
| P・N・S の trust line | limit 1,000,000、freeze なし、RequireAuth なし | `account_lines` @61032 |
| 基準点 | ledger 61032（hash `52EC87A25ED1F9F008577E37012253266C610429DEB69D89F9841482A711E3BB`、close 09:15:22 UTC）。RLUSD は P 0.10・N 0.10・S 0 | 準備の最後の取引の ledger |
| 口座 | P `rMz8Si2Me8aVZxS7CZBFUQH9qJHJwY3DL2` ／ N `r4Vr8uZR6L7uRRN5rC5x2qdTFxukEMdo8b` ／ S `r9nESGetj4J6jH5vpBAo43QddGHqUFjXEk` ／ K（keeper）`rLCpEm6HwS3AEg1VDqEfyviM5QWX9UhTFt`。いずれも新規（Faucet で XRP 100）、4 者すべて別 | manifest |

RLUSD は spike 15・16 と同じく AMM（XRP → RLUSD、1 人あたり XRP の投入上限 1 XRP）で入手した（faucet は GitHub サインインが要るため）。準備の取引（給付と別計上）:

| 取引 | hash | ledger |
|---|---|---|
| prep:P:TrustSet RLUSD | `3FC30F56F1751C66F21415B45BF04C7A9E2C917992AE4B67D3462E48DB76E02F` | 61024 |
| prep:N:TrustSet RLUSD | `821197A0E2EBDD6D637A41B0E9EEB19B7C59D475091F3FF08D781E52D639C91F` | 61026 |
| prep:S:TrustSet RLUSD | `C76B62D0D0435AF1060340B9079F2B4E1CAC812D53DE1BC01503BA24AF29B037` | 61028 |
| prep:P:buy RLUSD 0.1 via AMM | `9A30FD975F8D97DA79177099949A0EA44D3A92BF789B882BC1C5A735405275F3` | 61030 |
| prep:N:buy RLUSD 0.1 via AMM | `2A397517EC2DCC9B3EDD353C429BD7602CF385D34C6F3A362E46B271F4682F95` | 61032 |

### 4.2 券と取引

| 券 | 制度 | 世帯 | 額面 | OfferSequence | Escrow ID | CancelAfter (UTC) | nullifier（先頭） |
|---|---|---|---|---|---|---|---|
| A | P（県 P 基本給付） | H1 | 0.1 | 61018 | `2D1DBB7CD12CC222D7AE0A214F159DB735C92780109B64BC4926B8E188D2A7B5` | 11:15:22 | 2143674363… |
| B | N（NGO N 高齢者要件付き） | H1 | 0.05 | 61020 | `64E280EAA71B8C16C2901AF645DFDDB01B00F1E324C0C819D9AD601462C79E42` | 11:15:30 | 4511586686… |
| C | N（NGO N 高齢者要件付き） | H2 | 0.05 | 61021 | `419F8A75A5352A7727D771C877F3CD96E3510BBA8E690C786DA905B21465D2EC` | 09:22:40 | 2347708068… |

A と B は **同じ H1** が、制度ごとに別の証明・別の申請鍵・別の preimage で作った 2 枚（nullifier・鍵ハッシュ・Condition がすべて異なる）。C は別世帯 H2。申請の証明生成・発券の各 1 試行（`attempts`=1）。

| 段階 | hash | ledger / ledger hash | close (UTC) | 結果 | 期待 | 実測（ledger L−1→L の残高差） |
|---|---|---|---|---|---|---|
| 券 A 発券（P → S、0.10、期限 +2h） | `374DD4A2D7331BD20372B721F7BE3095F12F0997DAAA7412C4135BA2F7DF4A65` | 61034<br>`CA09C8E263FB9C30A577B1C6A4C7A2D1A5B84D0060E8D3989F82A1021E7A1BEB` | 09:15:30 | tesSUCCESS | P −0.10（ロック）、S 0 | P: -0.1 |
| 券 B 発券（N → S、0.05、期限 +2h） | `5777578DBEDF7185A338225A8E5DEC7AAFDBAD352A22B474C75E0A30E93AF5B4` | 61036<br>`82097BD2E6AA8839EC61235BF6D76076C23CF8CA49075281C02A8493872EF974` | 09:15:40 | tesSUCCESS | N −0.05、S 0 | N: -0.05 |
| 券 C 発券（N → S、0.05、期限 7 分） | `0F9DDC14D1F95ED19D9439D07272ECC2BBA4D7A6C742F1F93C09B284D562AC6F` | 61038<br>`A136DF5D79E2506BF2F8B3DFF8901982F83301941AAADD06EC4968E4D8979999` | 09:15:42 | tesSUCCESS | N −0.05、S 0 | N: -0.05 |
| A: S が EscrowFinish（店頭受付の保存データから） | `95BC0F62F3D83BA3E91790498F48B01F04463662E6679DE8FAA8D2B2B1CB7546` | 61042<br>`CD5CB35168E6F8D488D0B2BEBC97F7EDC6C7493955BDCB3DA6E75244330FC9BD` | 09:16:00 | tesSUCCESS | S +0.10 | S: +0.1 |
| B: S が EscrowFinish（同） | `899B801307CCBE48CB013E547AF8254B4A536F6FE397B9F65BB1E2296167E1A5` | 61044<br>`44C4F9004C24D370FE2C5D735ECB95A7D8F7D0A2A6F71AF08F72CE7B7B5E478C` | 09:16:02 | tesSUCCESS | S +0.05 | S: +0.05 |
| C: keeper K が EscrowCancel（期限後） | `52E1092193E993B45BBEA56A2C5483BA2BE673C7420657790158B0B6FB31E039` | 61164<br>`554AAF7A0DDABCDCB24DAD0E1B1E80D7436E144C4C3ACE3BE9D6C9D4404CC75D` | 09:22:50 | tesSUCCESS | N +0.05、S 差 0 | N: +0.05 |

- **店頭受付（A・B）**: 確定した台帳から作った店舗同期データ（A のとき S 宛ての Escrow 3 件、B のとき 2 件）と、H1 の QR（元の鍵の署名つき）で、別プロセスが fetch・ソケット・DNS・TLS を遮断して確認。結果は 2 件とも「**使える**」、**通信の試み 0 回**。再接続後の Finish は、**その店頭受付が保存した Escrow・Fulfillment**（`Owner`・`OfferSequence`・`Condition`・`Fulfillment`）から組み立てた。試験コードが別に持つ秘密からは組み立てていない。**QR のペイロードで実施**（カメラ・実機・PWA は使っていない）。
- **C**: 期限前（ledger 61044、close_time 09:16:02 < CancelAfter 09:22:40）に Escrow が存在し、S は 0.15 のまま（C 由来の着金なし）。**期限到来**は ledger 61162（close 09:22:41 UTC、hash `5915B792E042C3FD87E481FF7634C5620B382969BA3EF08DFDB8EDC0ADDDF9E3`）、**返還取引の確定**は ledger 61164（close 09:22:50 UTC）で、別々に記録。時計の早送りは使っていない。
- **対照（Service の実際の判定）**: ①H1 が県 P に別の申請鍵で再度申請 → `rejected / duplicate`（発券記録 1→1、試行 1→1、P の署名 Sequence 61019→61019 で送信なし）。②高齢者要件を満たさない H3 の N への申請 → 証明を生成できない（`Circuit execution failed: senior required`）、N の発券記録 2→2。
- 世帯の固定アドレスや制度間共通の ID は台帳・Memo・manifest に載せていない（Memo は鍵ハッシュ 1 件）。

### 4.3 最終

| 項目 | 期待 | 実際 |
|---|---|---|
| P / N / S の純増減 | −0.10 / −0.05 / +0.15 | −0.1 / −0.05 / +0.15、合計 0 |
| 未決 Escrow・説明できない差額・manifest 外の取引 | 0 / 0 / 0 | 0 / 0 / 0 |
| 対象 3 券 | すべて解消 | A・B は Finish、C は Cancel |

## 5. 第三者の検算（`pnpm --filter 17-zkp-direct-rlusd verify -- --official`、70/70）

**外部から信頼する入力**: (1) `results/trust.json` — 承認済みの名簿 root、制度 ID・条件、制度とドナーの対応、資産（発券側が選ぶ値）。(2) 回路（spike 13、コミット済み）と、そこから計算した検証鍵（SHA-256 `410957403D707104704BE368075C3934912C649373FF97093916C70F4A8BA438` を manifest・proofs と照合）。(3) 公開 Testnet の validated 履歴。

| 照合 | 台帳由来／事前設定由来 |
|---|---|
| 各券の**実際の EscrowCreate**から owner・Destination・Amount の currency/issuer/value・CancelAfter・Condition・Memo の鍵ハッシュを復元 | 台帳由来 |
| 公開入力の制度 ID が `trust.json` のどの制度か・その owner が EscrowCreate の持ち主か（ドナーとの対応）、名簿 root・制度条件が公開入力と完全一致 | 事前設定由来 |
| 上の 2 つから v2 ダイジェストを再計算し、**本物の証明の `req_hi/req_lo` と一致**。bb.js で証明を検証 | 両者の組み合わせ |
| 資産が信頼する設定・公式ページで確認した組と一致（`--official` で今の公式ページも再確認） | 事前設定＋公式 |
| Finish/Cancel が対応する Create の Escrow を消費（DeletedNode = 券の Escrow ID）、Fulfillment の SHA-256 = Condition、Finish は期限前・Cancel は期限後（ledger の close_time）、券別・口座別の残高差、未決 Escrow、manifest 外の取引 | 台帳由来 |
| 店頭受付の記録（通信 0 回・同期データに当該 Escrow・精算の Fulfillment が受付時の保存値と一致） | manifest の記録（再現不可） |

注意: **Memo の鍵ハッシュは店頭が検査する項目**で、XRPL が署名を検証するものではない。申請 JSON（`proofs.json` の `req`）は検算に使っていない（申請者側の主張にすぎないため）。個々の資格証明の検証と、「異なる 2 券の保有者が同一世帯」であることの第三者証明は別で、後者は未実装。

**改ざん試験**（コピーを作って実行、いずれも終了コード 1）:

| 改ざん | 結果 |
|---|---|
| A と B の証明の対応を入れ替え | 63/69。制度 ID・ダイジェスト・nullifier の不一致を検出 |
| 資産記述の issuer を別アカウントに（manifest と trust） | 55/69。台帳の Amount と不一致 |
| 資産記述の通貨だけを別コードに | 56/69。不一致 |
| C の Cancel 取引を manifest から削除 | 52/56。C の結末・manifest 外の取引 1 件・差額を検出 |
| `trust.json` の名簿 root を差し替え | 66/69。公開入力の不一致を検出 |

## 6. 再実行

- 通常の再開（既定）と新規 run（`-- --new`）を区別。確定済みの run の再実行は取引を増やさない: 再実行で `[tx]` 0 件、journal 11 件のまま、manifest の取引 hash・発券記録・対照結果・期限前の観測は初回と同一。
- 署名済み取引は送信前に `.state/journal.json` へ保存。判定不能な取引は hash を残して止まる（今回は発動していない）。

## 7. XRP 建て費用（別表・給付区間）

| 口座 | 内訳 | 費用 |
|---|---|---|
| P | EscrowCreate 1 | 12 drops |
| N | EscrowCreate 2 | 24 drops |
| S | EscrowFinish 2（Fulfillment あり） | 846 drops（423 × 2） |
| K | EscrowCancel 1 | 12 drops |

準備（TrustSet・AMM 購入）は別計上。Escrow 保有中は Owner 準備金 0.2 XRP/件が拘束される（今回の 3 券とも解消済み）。

## 8. 返ってきたエラーコード

tec/tem/tef は Testnet で一度も出ていない（全取引が初回で tesSUCCESS）。拒否の確認はすべて Service の判定（`policy`・`public_input`・`duplicate`・`root`）または回路（`senior required`）によるもの。

## 9. 設計への影響

1. **申請ダイジェストは v2（資産を台帳の 20 B で拘束）にする。** v1 は通貨 3 文字で RLUSD（40 桁コード）を表せない。回路・名簿・nullifier は変更不要。承認済みの経路で `digest` を v2 にするだけでよい。
2. **検算は「台帳 → 申請を復元 → ダイジェスト → 証明」で閉じる。** 発券側と検算側が同じ JSON をハッシュする方式では資産のすり替えを検出できない。台帳の Amount を使うこの方式なら、通貨・issuer・額面の入れ替えを検出できた（改ざん試験）。
3. **信頼の起点は `trust.json`**（名簿 root・制度 ID・条件・ドナーとの対応）。承認の仕組み（誰が署名し、どう公開するか）は未設計。
4. 直接 RLUSD 方式（spike 16）と ZKP 申請（13）・発券（14）・店頭受付（11c）は、接続部分の変更だけ（`Service` の `digest` 注入）でつながった。ZKV・V・交換注文の役割は不要。
5. keeper は期限後の Cancel だけ（Finish は店舗が自分で送れた）。

## 10. 分からなかったこと

- `trust.json` の正当性（承認の仕組み）。店頭受付の第三者による再現。
- 同一世帯性の選択的開示（A と B が同じ世帯であることの第三者証明）は未実装（必須外）。
- 実機・カメラ・PWA での受付（今回は QR のペイロード）。通信断・プロセス停止・Sequence 競合（依頼範囲外。spike 14 で測定済み）。
- 発行者の clawback が Escrow 中の RLUSD に及ぶか、店舗が RLUSD の trust line を持たない場合の挙動。
- 単一の公開ノード・1 回の実行（n=1）。部分約定のない直接方式なので約定の問題はない。
- Node v24.20.0（AGENTS.md は 26 以上）、xrpl 5.3.0。
- 店舗券方式が大会の受益者要件を満たすかは、技術判定とは別に主催者確認事項として残る。

## 11. 再現・成果物

```bash
pnpm --filter 17-zkp-direct-rlusd local                    # 固定ベクトル・ローカル試験（Testnet なし、53 項目）
pnpm --filter 17-zkp-direct-rlusd run:scenario             # Testnet（前回の続き。完了済みなら取引を増やさず再照合）
pnpm --filter 17-zkp-direct-rlusd run:scenario -- --new    # 新しい独立試験（約 12 分。.env.local に INTEG17_* の seed を自動作成）
pnpm --filter 17-zkp-direct-rlusd verify -- --official     # 読み取り専用の検算（署名鍵・世帯秘密・.env.local なし）
```

| ファイル | 内容 | 秘密 |
|---|---|---|
| `vectors/request-v2.json` | v2 の固定ベクトル | なし |
| `results/local.json` | ローカル検証（53 項目） | なし |
| `results/manifest.json` | 取引 hash・ledger（hash 付き）・Escrow ID・口座・店頭受付の記録・対照 | なし |
| `results/proofs.json`／`trust.json` | 証明と公開入力・検証鍵の SHA-256／信頼する制度設定 | なし |
| `results/run.json`／`verify.json`／`verify.txt`／`harness-links.json` | 実測／検算結果／合成ハーネスの世帯照合記録 | なし |
| `.state/`（gitignore） | 署名済みバイト列・世帯秘密・preimage・QR・端末鍵 | **あり**（共有しない） |

`results/`・`vectors/` に seed・世帯の秘密・preimage・端末の秘密鍵が含まれないことを文字列照合で確認した。コミットはしていない。

## 12. 大会の 3〜5 分デモで見せる取引順

1. （30 秒）`verify` を実行: 70/70、P −0.10／N −0.05／S +0.15、台帳から復元した申請のダイジェストが証明と一致、改ざんすると失敗する。
2. （45 秒）3 券の発券 `374DD4A2D7…`（A）・`5777578DBE…`（B）・`0F9DDC14D1…`（C）: 持ち主が P と N、Amount は公式 RLUSD、Memo は鍵ハッシュだけ。A と B は同じ H1 だが台帳では結び付かない。
3. （60 秒）A: 通信遮断の店頭受付（通信 0 回）→ `95BC0F62F3…`（Finish、S +0.10）。B も同様（`899B801307…`、S +0.05）。
4. （60 秒）C: 期限前に Escrow が存在・S は 0.15 のまま → 期限到来 → `52E1092193…`（keeper の Cancel、N +0.05、S 差額 0）。
5. 結び: 支援を使ったのは H1、着金先は店舗 S（世帯ウォレットではない）。受益者要件の適合は主催者確認事項。C の期限待ちは約 7 分あるので、ライブでは事前に実行した結果を見せる。
