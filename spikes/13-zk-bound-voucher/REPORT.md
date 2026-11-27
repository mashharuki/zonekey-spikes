# 13-zk-bound-voucher: 世帯の固定アドレスを公開せずに店舗券を発行できるか

実施: 2026-11-27 / 範囲: **ローカル検証（模擬台帳）＋ Testnet 券 1 枚の突き合わせ**。RLUSD の着金・実機・QR 画像・カメラは含まない。

## 1. 結論

**条件付きで成立**

- 3 つの要件（発券側が ZK 証明で資格と申請内容を検証 / 制度ごとの 1 世帯 1 回と制度をまたぐ独立性 / 店舗がオフラインで受付）は、合成データ・模擬台帳で 71 項目すべて期待どおり（`results/run.json`）。オフライン受付 10 項目も通った（`results/offline.json`、ネットワーク利用の試み 0 回）。
- Testnet では、検証済みの申請と実際の Escrow の持ち主・宛先・資産・額面・期限・Condition・鍵ハッシュ・OfferSequence が一致した（tx `59D62A06…C0FB`）。
- 「条件付き」の理由は 2 つ。**この判断を変える最大の未確認事項は 1 つ目**:
  1. **発券記録の確定（ローカル DB）と XRPL への送信の間が未検証。** 台帳は模擬で、Testnet は「発券記録 → EscrowCreate」の正常系を 1 枚通しただけ。送信の失敗・再送・Sequence の競合は実台帳で試していない（7 節）。
  2. **世帯が端末の鍵を失うと、その制度では回復できない**（同じ制度の再申請は nullifier で拒否されるため）。これは設計の選択で、解決していない。

## 2. 何を作ったか（既存 spike から変えた箇所）

| 区分 | 内容 |
|---|---|
| 新規 | `circuits/eligibility_bound`（回路）、`circuits/zkv_lib`（ハッシュ定義 1 か所）、`circuits/fixture13`（回路と同じ関数で値を計算する補助）、`src/`（名簿・発券サービス・世帯端末・試験）、`vectors/`、`exchange/`、`results/` |
| spike 08 から変えた点 | ① 葉と公開入力から `acct`（固定アドレス）を外した ② 葉に世帯の秘密そのものを入れず `hh_id = H(DOM_ID, hh_secret)` を入れた（名簿の管理者は秘密を知らない） ③ 公開入力に申請ダイジェスト `req_hi / req_lo` と `req_tag` を追加 ④ nullifier とハッシュに領域分離タグを付けた（`DOM_*`）。spike 08 の回路とコードには手を入れていない |
| spike 11c/11d から再利用 | `voucher/core.ts`（Condition・QR 形式・P-256 署名）と `voucher/shop.ts`（`verifyVoucher`）を **そのまま import**。コピーも改変もしていない |
| 11c から変えた点 | 券の preimage と端末鍵を、世帯の秘密からの導出（HMAC）ではなく **申請ごとの乱数・新しい P-256 鍵**にした。同じ世帯の別制度・再申請で何も使い回さないため |

### 再実行

```bash
pnpm install
pnpm --filter 13-zk-bound-voucher compile     # 回路を noir_wasm でコンパイル → circuits/target/*.json（コミット済み）
pnpm --filter 13-zk-bound-voucher test        # run.ts（71 項目）→ offline.ts（ネット遮断で店頭 10 項目）
pnpm --filter 13-zk-bound-voucher mutant      # 比較実験（制約に入れない公開入力）
pnpm --filter 13-zk-bound-voucher testnet     # Testnet 券 1 枚の突き合わせ（.env.local の V・D の seed を使う）
```

bb.js は初回に CRS を取る（`~/.bb-crs` に spike 08 のキャッシュがあった）。秘密はすべてラベルからの決定論的な合成値で、実在の秘密・個人情報はない。

## 3. 設計: どこで何を結び付けたか

申請（`Req`）は 191 バイトの正規バイト列にする。可変長の項目はなく、区切りの曖昧さで別の申請が同じバイト列にならない。

```
"todoke-13-request-v1"(20) ‖ program_id(32) ‖ owner D(20) ‖ shop(20) ‖ currency(3) ‖ issuer(20)
 ‖ value(8, 100万分の1単位) ‖ cancelAfter(4) ‖ pkHash(32) ‖ conditionHash(32)
```

`req_digest = SHA-256(正規バイト列)` を上位 16B・下位 16B に分け、それぞれ big-endian の整数 = Field にして公開入力 `req_hi`, `req_lo` にする。

| 項目 | 回路で拘束 | 発券側が検証 | 台帳（XRPL）が強制 | 店（オフライン）が検証 |
|---|---|---|---|---|
| 名簿への所属（root） | ○ 葉 = H(hh_id(秘密), 属性, salt) から root | **承認済み root か**（回路は root が正規かを知らない） | — | — |
| 制度の条件（zone_set・senior・revictim・tier） | ○ | **公開入力が制度の設定と完全一致か** | — | — |
| nullifier = H(DOM_NULL, 秘密, program_id) | ○ | **DB の UNIQUE(制度, nullifier)** | — | — |
| 受取鍵 pkHash | ○（req_digest 経由。`req_tag` で秘密と結合） | **自分が承認した申請からダイジェストを作り直して一致** | Memo に載るだけで**強制しない** | ○ Memo の pkHash = SHA-256(QR の公開鍵)、P-256 署名 |
| 店・額面・資産・持ち主・期限・Condition・制度 | ○（同上） | 同上。加えて**方針検査**（持ち主 = 制度の D、資産、額面の許可値、店の許可リスト、期限の範囲） | ○ Destination・Amount・CancelAfter・Condition | ○ 宛先が自店、期限の余裕、SHA-256(preimage) = Condition |
| 発券記録の作成 | — | ○ 1 件のみ（同時・再試行でも） | — | — |
| OfferSequence | — | 採番（Testnet では D の Sequence から） | ○ tx の Sequence | ○ 署名の対象に含む |

### バイト列と Field の変換（固定ベクトル）

`vectors/bytes-field.json`。TS（BigInt）と Noir（`fixture13` が `[u8; 32]` から `be16_to_field` で計算）が同じ値を返した（試験 V0）。

| 項目 | 値 |
|---|---|
| 入力 | program_id=0x9001、currency=ZKV、value=5000000、cancelAfter=900000000、pkHash=0x11…11（32B）、conditionHash=0x22…22（32B）、owner/shop/issuer は合成アカウント |
| 正規バイト列 | 191 B（先頭 `746F646F6B652D31332D726571756573742D7631`）。全体は json 参照 |
| SHA-256 | `B647EC59648641274C719D1F41BF1906815A5CD32504D42DAEB00251ADCAF97D` |
| req_hi | `0x…b647ec59648641274c719d1f41bf1906`（TS・Noir 一致） |
| req_lo | `0x…815a5cd32504d42daeb00251adcaf97d`（TS・Noir 一致） |

### 回路が `req_*` を制約に入れる方法と、測って分かったこと

回路は `req_tag == H(DOM_BIND, hh_secret, program_id, req_hi, req_lo)` を検証する。この結び付けが効いているかを `mutant_nobind`（`req_hi/lo` を公開入力に足しただけで制約には使わない版）と比べた（`results/mutant.json`）。

| 攻撃 | 変異体（tag なし） | 本番（tag あり） |
|---|---|---|
| 公開入力の `req_hi/lo` を別の申請に書き換える（再証明なし） | **検証器が拒否** | 検証器が拒否（T6） |
| 秘密を知らない者が証明を作る | 作れない（merkle root mismatch） | 作れない（T5） |
| 回路の大きさ | 1442 ゲート | 1593 ゲート（2 の冪はどちらも 2048） |

**事実として: 変異体でも、書き換えは検証器が拒否した。`req_tag` が防ぐ攻撃を、この実験では見つけられなかった。** 申請への結び付きの実質は「UltraHonk の証明は公開入力全体に結び付く」ことと「発券側が自分で作り直した値と完全一致で照合する」ことで、`req_tag` は関係式（relation）に申請を明示的に入れる保険（+約 150 ゲート）に留まる。保険の価値（将来のバックエンドや最適化で、制約のない公開入力の扱いが変わった場合）は推測で、未検証。

また、`req_hi/lo` が 128 ビット以内であることは**回路では強制しない**。`assert_max_bit_size::<128>()` を 2 つ入れると 1593 → 4347 ゲート（2 の冪 2048 → 8192）になった（別バリアントで計測。`u128` 型にしても同じ 4347）。代わりに発券側が公開入力を自分で計算した値と完全一致で照合する。`hi + 2^128` に書き換えた入力は発券側が拒否した（T6）。

## 4. 確認項目（判定表の順）

凡例: 止まった場所 = 回路（実行）/ 検証器 / 発券側。tx は模擬台帳のため無し。全 71 行は `results/run.json`。

| 試験 | 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|---|
| T1 | H1→県の証明と検証 | 通る | 通る | 証明 14,656 B、公開入力 17 個、prove 83〜98 ms、verify 約 6 ms |
| T1 | 発券 | 1 枚 | created、記録 1 件 | |
| T1 | 発券記録から作り直した申請ダイジェスト = 発券前 = 証明の公開入力 | 一致 | 一致 | 実際に発行される券と証明の対応 |
| T1/T7 | 店のオフライン受付 | 成功 | `使える`（187 B / 約 2 ms） | `offline.json`、ネット遮断で 0 回 |
| T2 | H1→県（別の鍵）の証明 | 通る | 通る（回路は同じ世帯を拒まない） | |
| T2 | nullifier | 一致 | 一致 `0x2dafd2b4…3536` | pkHash・Condition は別 |
| T2 | 新しい券 | 0 枚 | 発券側が `reject:duplicate` | 県×H1 の記録 1 件のまま |
| T3 | H1→NGO | 1 枚 | created | nullifier は県と別（`0x01ad1dae…`） |
| T3 | H2→県（店 B） | 1 枚 | created | 記録は計 3 件 |
| T4a | 同じ申請を 8 件同時 | 1 枚 | created 1 / replayed 7、OfferSequence は 1 種類 | |
| T4b | 別の鍵 2 種 × 4 件を同時 | 1 枚 | created 1 / replayed 3 / duplicate 4 | どちらの鍵が先に入るかは実行ごとに変わりうる |
| T4c | 発券記録の作成後に応答を返せない → 再試行（証明は作り直し） | 同じ結果 | `replayed`、OfferSequence・Condition・鍵ハッシュが最初の記録と同一。記録 1 件 | 証明のバイト列は初回と別（ZK は毎回違う）。冪等性の鍵は (制度, nullifier) + 申請ダイジェスト |
| T4d | 応答喪失の後、端末が鍵を失い別の鍵で申請 | 矛盾する券を出さない | `reject:duplicate` | **回復できない**（7 節） |
| T4e | 台帳（模擬）への送信が途中で落ちる（書く前 / 書いた後・状態更新の前） | 二重 Escrow なし | 台帳件数 = 記録件数（6）、approved 残り 0 | `INSERT OR IGNORE` の冪等送信。模擬台帳での結果 |
| T5 | H3（ゾーン外）/ H4（区分不足）/ H5（高齢者でない） | 発券 0 | **回路が止める**: `zone not in zone_set` / `tier below min_tier` / `senior required` | 証明が作れないので発券側には証明が届かない |
| T5 | H3 が zone_set を自分のゾーンに書き換えた証明 | 発券 0 | 回路・検証器は**通る** → **発券側が止める**（`public input mismatch: zone_set[0]`） | 証明は「その条件を満たす」としか言わない |
| T5 | 攻撃者が自分で作った名簿の root | 発券 0 | 回路・検証器は**通る** → **発券側が止める**（`root not approved`） | 検証器は root の正規性を知らない |
| T5 | 登録されていない秘密（H1 の経路を流用） | 発券 0 | **回路が止める**（`merkle root mismatch`） | |
| T5 | `req_tag` の書き換え / 秘密を知らない者の tag・nullifier | 発券 0 | **回路が止める**（`request tag mismatch` / `nullifier mismatch`） | |
| T6 | 受取鍵・店・額面・期限・Condition を 1 つずつ変えた申請 + 元の証明 | 拒否 | 5 件とも**発券側が拒否**（`public input mismatch: req_hi`） | |
| T6 | 上の 5 件で公開入力も新しい申請に書き換える | 拒否 | 5 件とも**検証器が拒否**（`proof invalid`） | |
| T6 | 持ち主・資産の発行者・制度を変えた申請 | 拒否 | **発券側の方針検査**が拒否（`policy:owner` / `policy:asset` / `policy:owner`） | ダイジェストも変わるが方針検査が先に止める |
| T6 | `req_hi` を hi + 2^128 に | 拒否 | 発券側が拒否（`public input mismatch: req_hi`） | 回路では強制していない項目 |
| T6 | 拒否の後 | 記録 0 → 元の申請で 1 枚 | 0 件 → created | 途中で何も作られない |
| T7 | 別の申請鍵（H1 NGO の鍵）で署名した県の券 | 拒否 | `端末の公開鍵が券と合わない` | |
| T7 | preimage だけ盗み見て署名なし / 見知らぬ端末の鍵 | 拒否 | `端末の署名がない` / `端末の公開鍵が券と合わない` | |
| T7 | 正規の券と鍵 | 受付 | `使える`（県・NGO・H2 の 3 枚）。再提示は `使用済み`。他店宛ては `このお店宛ての券ではない`。preimage 1 ビット改変は `preimage が条件と合わない` | |
| T8 | 公開範囲 | 出ない | 6 種の成果物に、世帯の秘密・hh_id・salt・氏名・住所（9 世帯 × 5 = 45 値）は出ない | 下の点検 |

### 公開範囲の点検（T8）

調べたもの: 証明の公開入力、返却された発券記録、店舗の同期データ、QR（全種の hex）、想定する EscrowCreate、発券サービスの DB 全表。

- 公開入力 17 個はすべて「制度の設定・申請ダイジェスト・nullifier・tag」で説明できる。世帯の属性の値（zone・senior・revictim・tier）は入らない（zone_set は制度の条件であり、世帯の値ではない）。
- 公開取引に現れる XRPL アカウントは支援元 D と店舗だけ。世帯のアドレスは名簿にも申請にもなく、設計上存在しない（世帯は XRPL 口座を持たない前提）。
- 制度間の使い回し: H1 の県と NGO で、端末鍵・Condition・持ち主・nullifier がすべて別。県への再申請でも pkHash・Condition を使い回さない。同じ制度の再申請で外から見える共通点は nullifier だけ（これは重複検出のために意図したもの）。
- 注意: 秘密の検索は文字列の一致なので、「出ていない」ことの証明ではなく、検索した値が出ていないという事実のみ。検索の対象は 45 値。

## 5. 全面的な匿名性は結論しない（推測として残るもの）

「固定アドレスが出なかった」以上の主張はしない。次は**試験していない**推測の経路。

| 経路 | 内容 |
|---|---|
| 店・額面・時刻の組み合わせ | 店と額面と受付時刻が揃うと、少数の世帯しか来ない店では特定されうる。Memo の `pkHash` は 1 申請ごとに別だが、同じ店で同じ時刻に 2 枚が出れば同一世帯の疑いが立つ |
| 発券サービスのログ | 発券サービスは接続元・時刻・nullifier・pkHash・申請ダイジェストを見る。同じ制度の再申請は nullifier で同じ世帯と分かる（意図した性質）。異なる制度の申請は、通信元が同じなら結び付けられる |
| 名簿の管理者 | `hh_id ⇄ 氏名・住所` の対応表を持つ。`hh_id = H(DOM_ID, hh_secret)` から nullifier は導けないので、**`hh_secret` を管理者が知らない限り** nullifier と人は結び付かない。管理者が登録窓口で `hh_secret` を作って渡す運用にすると、nullifier から氏名まで辿れる。`hh_secret` は世帯端末で作ることが前提 |
| 属性の絞り込み | 名簿の中で zone・区分の組み合わせが一意な世帯は、制度の条件（zone_set など）が絞り込むと候補が減る。これは公開入力が制度の条件を含む以上避けられない |

### 誰が何を強制するか（信頼前提）

| 強制する主体 | 強制する内容 |
|---|---|
| **店のオフライン検証** | 券の鍵の署名（Memo の pkHash と QR の公開鍵）、宛先が自店、期限の余裕、SHA-256(preimage) = Condition、同一端末内の使用済み |
| **発券サービスの ZK 検証** | 名簿所属・制度条件・nullifier・申請内容の結び付き（回路）と、承認済み root・制度設定・方針・申請との完全一致（コード） |
| **XRPL Escrow** | Destination・Amount・CancelAfter・Condition。**Memo の中身は強制しない**。EscrowFinish は preimage を知る者なら誰でも送れる |
| **信頼するもの** | 発券サービスが、承認した内容どおりに（その内容だけで）EscrowCreate を送ること。今回の突き合わせは 1 枚の事後確認で、発券サービスが別の内容で Escrow を作る不正は**防げない**（ダイジェストと台帳を第三者が照合できる材料は残るが、照合の運用は作っていない）。名簿の管理者が正規の root を選ぶことも信頼している |

## 6. 追加検証

### 6.1 Testnet: 合成データの券 1 枚（`results/testnet.json`）

発券記録（申請ではなく、承認して記録した内容）から EscrowCreate を作って送り、台帳から読み戻した。

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| EscrowCreate | tesSUCCESS | tesSUCCESS | tx `59D62A064CF498C4D31E87E48F2659322C6F31A2BC6A886582D7FDF90B79C0FB` |
| 持ち主 / 宛先 / 資産 / 額面 / 期限 / Condition | 申請と一致 | 6 項目すべて一致 | D=`rDAHcwJbtQMUgdwkNNZvrzHuQvki57xiUn`、店=`rfFrM1oN6jZnCvG6Ade5z6RZrbP8WruVeF`、資産=ZKV/`rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh`、額面 5 |
| Memo の鍵ハッシュ | 一致 | 一致（`F09B497A…4FBE`） | XRPL は強制しない |
| OfferSequence = 採番した値 | 一致 | 40369 = 40369 | 発券側が D の Sequence から採番 |
| 台帳の内容から作ったダイジェスト = 証明の公開入力 | 一致 | 一致 | 検証済みの申請 = 台帳の Escrow |
| 台帳由来の同期データで店が QR を確かめる | 使える | 使える | |

付随して起きたこと（事実）:

- Testnet は 11c の実施後にリセットされていた（発行者 V の Flags が 0、D の Sequence が 4 万台）。V に `AllowTrustLineLocking` がない状態で EscrowCreate を送ると **`tecNO_PERMISSION`**（tx `73C0DBBE3DC4EF43854EA00DDDEE0D8A11C284B3697A80741BB10DC3114C2E7B`、ledger 40373）。これは私の試験スクリプトが V の設定を飛ばしたことが原因で、設計の問題ではない（AGENTS の spike 03 の知見と同じ）。11c と同じ `configureEscrowableIssuer`（tx `C0CEA814…0B3C` / `94D97E84…6CBC`、tesSUCCESS）を足して再実行し、上の結果を得た。`results/testnet.json` は成功した実行のもの。
- 店への XRP 送金 tx: `8D4F2135…AADA72`（成功した実行）/ `46A7641A…D69EB`（初回）。
- EscrowFinish・EscrowCancel は試していない（11c で確認済み）。RLUSD は使っていない（ZKV は発行者 V の合成トークン）。

### 6.2 選択的開示（**記述のみ。実装・実行していない**）

問い: 本人が選んだ県・NGO の 2 枚が、同じ登録世帯に属することだけを監査者に示す。

- 文: 「ある hh_secret が存在し、(a) hh_id が承認済み root の葉に入っている、(b) `nullifier_1 = H(DOM_NULL, hh_secret, program_県)`、(c) `nullifier_2 = H(DOM_NULL, hh_secret, program_NGO)`」。公開入力は root・2 つの制度 ID・2 つの nullifier・監査者が出す challenge（証明の使い回しを防ぐ）。属性・氏名・hh_id は出さない。
- 監査者が確認すること: 2 つの nullifier が発券サービスの記録に存在し、それぞれの記録の申請ダイジェストが、本人が示す 2 枚の券（Escrow の内容から作り直せる）に一致する。これで「発券済みの正規の券」が同じ世帯のものだと言える。
- 今回の部品を流用できる: `nullifier_hash` と `merkle_root` は共通。新しい回路は nullifier を 2 つ計算して葉を 1 回だけ検証する形で、見積もりでは 1 回分の検証より小さい（未計測）。
- 比較用の「異なる世帯 2 件」: 例として H1 の県の券と、別世帯 H2 の NGO の券を選ぶ。H2 は NGO の条件を満たさないので、実際には H6 など NGO の対象世帯を用意して発券し、`hh_secret` が別の 2 枚を選ぶ。回路は同じ hh_secret を要求するので、別世帯の組み合わせでは証明を作れない（回路が止まる）はず、という予想。**試していない。**
- 残る問題: 本人が選んだ 2 枚だけを示しても、2 つの nullifier は一緒に見える。監査者がこの 2 つを他の記録と照合して、同じ世帯の別の制度（3 つ目）を探す手がかりにはならないが、「この世帯がこの 2 制度から受給した」という事実は監査者に開示される（それが目的）。

## 7. 実際に返ってきたエラーコード

| 場所 | コード / メッセージ |
|---|---|
| XRPL（Testnet） | `tecNO_PERMISSION`（V に AllowTrustLineLocking なし、EscrowCreate）、その後 `tesSUCCESS` |
| 回路（noir_js execute） | `zone not in zone_set` / `tier below min_tier` / `senior required` / `merkle root mismatch` / `nullifier mismatch` / `request tag mismatch` |
| 発券サービス（自作の理由コード） | `policy:owner|asset|value|shop|cancelAfter`、`public input mismatch: <名前>`、`root not approved`、`proof invalid`、`duplicate` |
| 店の端末（11c の既存の判定） | `端末の公開鍵が券と合わない` / `端末の署名がない` / `preimage が条件と合わない` / `使用済み` / `このお店宛ての券ではない` |

tem/tef は出ていない。

## 8. 設計への影響（06_技術設計）

1. **回路の公開入力から `acct` を外し、葉を `hh_id`（秘密から導く）にする**。spike 08 の「acct を葉に含めて横取りを防ぐ」は、世帯の固定アドレスが公開取引に出るので、この要件とは両立しない。横取りの防止は、申請ごとの鍵（pkHash）と申請ダイジェストの結び付きに置き換えた。
2. **発券サービスは 3 つを必ず行う**: (a) 公開入力を自分の値（承認済み root・制度設定・申請から作り直したダイジェスト）と完全一致で照合してから検証器を呼ぶ（検証器は root と制度の条件の正規性を知らない）、(b) `UNIQUE(制度, nullifier)` を DB に持たせる、(c) 冪等性は (制度, nullifier) + 申請ダイジェストで取り、同じ申請なら最初の結果を返す。
3. **OfferSequence は発券側が採番するので、配布用アカウントの Sequence（または Ticket）の確保が必須**。Testnet で採番を D の次の Sequence に合わせると一致した。他の tx が D の Sequence を進めると券が作れない。
4. 券の鍵は申請ごとに新しく作る（11c の「秘密から導出」はやめる）。その代わり、鍵を失うとその制度では回復できない。回復の仕組み（本人確認つきの再発行・nullifier の失効など）は設計していない。
5. `hh_secret` は世帯端末で作る。名簿の管理者には `hh_id` だけを渡す。
6. 回路の範囲検査を回路に入れるとゲートが 2.7 倍になる。発券側の完全一致で足りる項目は回路に入れない。

## 9. 測定

| 項目 | 値 |
|---|---|
| 回路 | ACIR 150 opcodes / 1,593 ゲート / 2 の冪 2,048（spike 08: 1,363 / 2,048） |
| 証明 | 14,656 B + 公開入力 17 個 × 32 B = 544 B。検証鍵 3,680 B |
| prove（witness 生成を除く、native bb、Node） | 平均 66.3 ms（最小 59.8 / 最大 122、n=13） |
| verify（VK 事前） | 平均 5.4 ms（最小 5.2 / 最大 6.2、n=6） |
| 初期化 / VK 生成 | 71 ms / 15.6 ms |
| 店頭の `verifyVoucher` | 約 0.1〜2.7 ms（ペイロード直渡し） |
| 環境 | darwin/arm64、Apple M1 Pro 10 コア、16 GB、Node v24.20.0 |
| バージョン | Noir 1.0.0+275d3ab（`@noir-lang/noir_wasm` 1.0.0でコンパイル）、noir_js 1.0.0、`@aztec-foundation/bb.js` 6.0.0（native）、poseidon v0.4.0、xrpl 5.3.0。verifierTarget は `noir-recursive` |
| 範囲 | ブラウザ・wasm での prove は今回測っていない（spike 08 の値が参考。回路は約 17% 大きい） |

## 10. 分からなかったこと・実施できなかったこと

- **発券記録 → XRPL 送信の境界**: 模擬台帳では冪等送信を確かめたが、実台帳での二重送信・Sequence 競合・tx の最終確定の待ち（記録が `submitted` になる条件）・`LastLedgerSequence` 切れの扱いは未検証。Testnet は 1 枚の正常系のみ。
- **鍵の喪失からの回復**（上記）。
- **複数プロセス・複数台の同時申請**: 同時性は 1 プロセス内（`await` の間に割り込む非同期）で試した。DB は SQLite の `UNIQUE` で守っているが、複数プロセスで同じ DB を触る試験はしていない。
- **nargo が入っていない環境だった**: 回路は `noir_wasm`（同じコンパイラ本体）でコンパイルし、`#[test]` は書かず、各制約を破る入力を `noir_js` の execute で試した（spike 08 の 13 個の nargo test に相当するものはこの回路では未実装）。`bb` の CLI も入れていない。
- **Node のバージョン**: AGENTS は Node 26 以上だが、実行環境は v24.20.0。`node:sqlite` はこの版で動いた。
- **実機・カメラ・QR 画像**: QR は 187 B のバイト列を直接渡した。11d の実機確認の結果をこのデータ形式で再現していない。
- **回路の監査はしていない**。Noir 1.0.0 は未監査（公式の注意）。
- **選択的開示**は記述のみ（6.2）。
- **店舗・金額・時刻の組み合わせからの特定、ログからの推測**は定性的な記述のみで、実測していない。
