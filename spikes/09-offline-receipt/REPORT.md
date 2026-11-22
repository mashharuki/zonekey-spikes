# 09-offline-receipt: 受け取り取引の確定をネットなしで検証できるか

計測: 2026-11-22T04:53:29.481Z（取得は 2026-11-22T04:31:04.678Z）/ Testnet サーバー: 3.4.1
実装: 根拠に使った rippled のソースは **3.4.1**（タグ）。xrpl 5.3.0（取得のみ）、ripple-binary-codec 2.11.0（表示用のデコードのみ）、@noble/curves 2.4.0（secp256k1 / Ed25519）、ハッシュは Node の SHA-512
対象: S2 = spike 04「Escrow A: 第三者（keeper）が正しい Fulfillment で完了」の EscrowFinish（リポジトリに「S2」の表記がないため、受益者に受給証が届いた EscrowFinish をこれと判断した）

## 1. 結論

- **S2 の EscrowFinish: 検証Bまで**（C は不可能: このレジャーへの検証者の署名（validation）を持っていない。validations ストリームは受信時点のものしか流れず、過去のレジャーの検証を後から取る公開 API はない）
- **その場で署名を集めた受け取り（live）: 検証Cまでできた**
- オフライン検証（verify）中のネットワーク利用の試み: **0 回**（fetch・ソケット・DNS・TLS を遮断して実行）

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| s2: 対象 tx | validated | EscrowFinish / tesSUCCESS / 受取 rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe / 額 0.1 ZKV | [90AD027004…](https://testnet.xrpl.org/transactions/90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C)（ledger 22492505） |
| s2: A 木の根を再計算 | ヘッダの transaction_hash と一致 | ✅ DA6DD60ABA64C0C9225D98F50463A1999B52FDF221A9CF9DDE4F49E7D7556402（tx 6 件） | ヘッダ: DA6DD60ABA64C0C9225D98F50463A1999B52FDF221A9CF9DDE4F49E7D7556402 |
| s2: A 対象 tx が木に入っている | true | ✅ txid 90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C | tx と meta から葉を作り、同じ鍵・同じ葉があるか |
| s2: A 枝だけで根を再計算 | 一致 | ✅（1 段） | 対象までの兄弟ハッシュだけを使う |
| s2: B ledger_hash を再計算 | API の ledger_hash と一致 | ✅ 8831D4CEDDB509073F7010D43155537CB3D5E63C6B07D37EAD4B0D5E6382CF07 | API: 8831D4CEDDB509073F7010D43155537CB3D5E63C6B07D37EAD4B0D5E6382CF07 |
| s2: B バイナリのヘッダ（ledger_data） | JSON と同じ hash | ✅ | ledger（binary: true）の ledger_data 先頭 118 バイト |
| s2: パック A・B だけで検証（1846 B） | A・B が通る | A ✅ / B ✅ | receipts/*.bin と事前に持つ VL・マニフェストだけ |
| s2: C 定足数の署名 | 定足数 — 以上 | ❌ 0 人 | このレジャーへの検証者の署名（validation）を持っていない。validations ストリームは受信時点のものしか流れず、過去のレジャーの検証を後から取る公開 API はない |
| live: 対象 tx | validated | Payment / tesSUCCESS / 受取 rNon59tzfcgzmcmETTG6coVwBn3ZDQaEac / 額 100000000 drops | [64D0B887F5…](https://testnet.xrpl.org/transactions/64D0B887F5F3D1504115642FBE3ADF81D99908FC3809883707D3CCB140958393)（ledger 22515681） |
| live: A 木の根を再計算 | ヘッダの transaction_hash と一致 | ✅ CCE09C0DD9D3FCEA809BB45A9868CD99AB9BFA636FF23B1983A9F16683F6E9D0（tx 17 件） | ヘッダ: CCE09C0DD9D3FCEA809BB45A9868CD99AB9BFA636FF23B1983A9F16683F6E9D0 |
| live: A 対象 tx が木に入っている | true | ✅ txid 64D0B887F5F3D1504115642FBE3ADF81D99908FC3809883707D3CCB140958393 | tx と meta から葉を作り、同じ鍵・同じ葉があるか |
| live: A 枝だけで根を再計算 | 一致 | ✅（2 段） | 対象までの兄弟ハッシュだけを使う |
| live: B ledger_hash を再計算 | API の ledger_hash と一致 | ✅ 4D119012DB5D3EB0CE8070F2D1D91D9BD57288E89D36176BF578BF53FE4074D8 | API: 4D119012DB5D3EB0CE8070F2D1D91D9BD57288E89D36176BF578BF53FE4074D8 |
| live: B バイナリのヘッダ（ledger_data） | JSON と同じ hash | ✅ | ledger（binary: true）の ledger_data 先頭 118 バイト |
| live: C 検証者リスト（VL） | 発行者・署名・期間 OK | ✅ sequence 59 / UNL 6 人 / 署名鍵を解決 6 人 / 期限 2027-08-07T17:31:06.000Z | vl.altnet.rippletest.net、発行者鍵 ED2648…5860 |
| live: パック A・B だけで検証（1186 B） | A・B が通る | A ✅ / B ✅ | receipts/*.bin と事前に持つ VL・マニフェストだけ |
| live: パック A・B・C だけで検証（2357 B） | A・B・C が通る | A ✅ / B ✅ / C ✅（5 / 5 人） | receipts/*.bin と事前に持つ VL・マニフェストだけ |
| live: C 定足数の署名 | 定足数 5 以上 | ✅ 6 人（受信 6 件・署名が正しい 6 件・このレジャー宛て 6 件・リスト外 0 件） | サーバーの validation_quorum: 5 |

### 改ざんしたら落ちるか（1 ビット変更）

| 対象 | meta を変える → A が落ちる | close_time +1 → B が落ちる | account_hash を変える → B が落ちる | 検証 1 件を変える → 数えられる人数 |
|---|---|---|---|---|
| s2 | ✅ | ✅ | ✅ | — |
| live | ✅ | ✅ | ✅ | 6 → 5 人 |

### 実装の自己確認（ネット不要）

- 木の再計算: xrpl.js のテスト用データ（Mainnet ledger 7501326 の全 17 tx、38129、40000）で、根がヘッダの transaction_hash と一致し、全 tx の枝からも同じ根になった
- ledger_hash: xrpl.js の `hashLedgerHeader` と同じ値になった（テスト用データのヘッダ自体は編集されていて元の hash と一致しないため、実データでの一致は上の B で確認）
- 検証 C: `pnpm --filter 09-offline-receipt selftest` で、合成した鍵・マニフェスト・VL・検証の 10 ケース（定足数ちょうど / 不足 / 重複 / 別レジャー / 部分検証 / リスト外 / 発行者違い / blob 改ざん / 鍵の入れ替えあり・なし）がすべて期待どおり

### 段階 5: 持ち運び（大きさと QR コード）

QR コードはバイトモード、誤り訂正 L（型番 40 の上限 2953 バイト）で実際に符号化して試した（qrcode 1.5.4）。

| データ | バイト数 | QR 1 つ（L） | 圧縮（deflate）した場合 |
|---|---|---|---|
| s2: 全部（ヘッダ + 全 tx 6 件 + 集めた全検証 + VL + マニフェスト） | 12298 | — | — |
| s2: パック A・B（ヘッダ + 対象 tx + meta + 枝 1 段） | 1846 | 入る（型番 32） | 圧縮後 1183 B: 入る（型番 25） |
| s2: **見積もり** A・B・C（live の検証 5 件を大きさの見積もりに使った（署名は無効）） | 3017 | 入らない（The amount of data is too big to be stored in a QR Code） | 圧縮後 1908 B: 入る（型番 32） |
| live: 全部（ヘッダ + 全 tx 17 件 + 集めた全検証 + VL + マニフェスト） | 18020 | — | — |
| live: パック A・B（ヘッダ + 対象 tx + meta + 枝 2 段） | 1186 | 入る（型番 25） | 圧縮後 1075 B: 入る（型番 23） |
| live: パック A・B・C（＋検証 5 件、1 件 232〜233 B） | 2357 | 入る（型番 36） | 圧縮後 1764 B: 入る（型番 31） |
| live: 上に VL とマニフェストも入れた場合 | 7437 | — | — |

内訳（バイト）:

| 対象 | ヘッダ | tx | meta | 枝 | 検証（定足数分） | VL（JSON） | マニフェスト |
|---|---|---|---|---|---|---|---|
| s2 | 118 | 260 | 1328 | 131 | — | 3790 | 1290 |
| live | 118 | 188 | 515 | 357 | 1161 | 3790 | 1290 |

パックの形式（この検証で決めたもの）: `"ZKR1" ‖ ヘッダ 118 B ‖ VL(tx) ‖ VL(meta) ‖ 枝（段ごとに 16 ビットの表 + 空でない兄弟のハッシュ）‖ 検証の数 ‖ VL(検証)…`。
ledger_hash はヘッダから再計算できるので入れない。検証者リスト（VL）とマニフェストは検証アプリに事前に入れておく前提で入れない。

## 3. エラー（そのまま）

- s2 / C: このレジャーへの検証者の署名（validation）を持っていない。validations ストリームは受信時点のものしか流れず、過去のレジャーの検証を後から取る公開 API はない

## 4. 設計への影響

- **確定の証明は、取引の直後にしか作れない。** レジャーへの検証者の署名は validations ストリームで流れた時点のものしかなく、後から取る公開 API がない。S2 のような過去の tx は B（台帳のヘッダに入っている）までしか示せない。keeper は EscrowFinish を送る前から validations を購読し、確定したら定足数分の署名をその場で保存して受け取りパックを作る。
- **A・B だけなら QR 1 つに入る**（S2 1846 B / live 1186 B）。ただし A・B は「このヘッダのレジャーに入っている」までで、そのヘッダが本物の確定レジャーかは C がないと分からない（誰でも同じ形のヘッダは作れる）。
- **C まで入れると: QR 1 つに入る（live の Payment で 2357 B、型番 36）。** 大きさの大半は meta と検証（1 件 約 232 B × 定足数 5）。tx・meta は葉のハッシュの計算に全バイトが要り、検証は定足数より減らせないので、どちらも削れない。
- **実際の受け取り（EscrowFinish）は meta が大きい**（S2 で 1328 B。受給証のトラストラインの変化が入るため）。C を付けた見積もりは 3017 B で、**そのままでは QR 1 つ（L: 2953 B）を少し超える**。deflate で圧縮すると 1908 B（入る（型番 32））。→ 受け取りパックは圧縮して QR にする（圧縮しても検証の手順は同じ。展開してから検証する）。それでも足りない場合は QR を 2 枚に分ける（1 枚目 A・B、2 枚目 検証）。
- **信頼の起点は「Testnet の VL 発行者の鍵」1 つ。** 検証アプリに発行者鍵（ED2648…5860）を埋め込み、VL とマニフェストは事前に（ネットがあるときに）入れておく。VL には期限（expiration）があり、検証は「レジャーの close_time の時点で有効だったリスト」で行う（今の時刻ではない）。検証者が鍵を入れ替えると古いマニフェストでは数えられないので、VL を取るときに manifest メソッドの最新も一緒に入れておく。
- **定足数は厳しい側で数えている。** rippled は「有効 UNL（Negative UNL を除いた数）の 80%（ただし UNL の 60% 以上）」。オフラインでは Negative UNL が分からないので UNL 全体の 80% で数える。Negative UNL が効いているときに足りなく見えることはあるが、甘くなることはない。
- 受け取りの意味（誰が・いくら受け取ったか）は meta の `TransactionResult`・`DeliveredAmount` と tx の `Destination` から読む。A で meta ごと葉のハッシュに入っているので、改ざんできない。

## 5. 分からなかったこと

- Testnet の Negative UNL の状態（取得していない）。定足数は UNL 全体の 80% で数えた。
- validations ストリームに流れる `data`（署名付きの生バイト）は xrpl.org の subscribe のページには載っていない。rippled の実装（NetworkOPs.cpp）にはある。今回 data 付きで届いた検証: 6 件。
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
- ハッシュの接頭辞（TXN / SND / MIN / LWR / VAL / MAN）: https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/protocol/HashPrefix.h#L39-L84
- ledger_hash: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/LedgerHeader.cpp#L59-L74 （並び: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/LedgerHeader.cpp#L13-L28）
- tx の葉: https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/shamap/SHAMapTxPlusMetaLeafNode.h#L51-L55 / 葉の中身 VL(tx)‖VL(meta): https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/ledger/Ledger.cpp#L527-L540
- 内部ノード: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/shamap/SHAMapInnerNode.cpp#L193-L206 / 空の子は 0: https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/shamap/detail/TaggedPointer.ipp#L142-L172
- 枝の選び方: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/shamap/SHAMapNodeID.cpp#L146-L167
- txid: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/STTx.cpp#L74
- 長さ接頭辞: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/Serializer.cpp#L210-L243
- 検証の署名ハッシュ: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/STValidation.cpp#L70-L74 、https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/STObject.cpp#L383-L390
- 検証の署名検証（full canonical の扱い）: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/STValidation.cpp#L100-L134 、https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/PublicKey.cpp#L223-L290
- 署名対象外のフィールド: https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/protocol/detail/sfields.macro#L282 、https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/protocol/detail/sfields.macro#L295
- validations ストリームの data: https://github.com/XRPLF/rippled/blob/3.4.1/src/xrpld/app/misc/NetworkOPs.cpp#L2595-L2602
- マニフェスト: https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/server/Manifest.cpp#L57-L91 、https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/server/Manifest.cpp#L196-L214 、https://github.com/XRPLF/rippled/blob/3.4.1/src/libxrpl/protocol/Sign.cpp#L89-L99
- VL の検証: https://github.com/XRPLF/rippled/blob/3.4.1/src/xrpld/app/misc/detail/ValidatorList.cpp#L1241-L1300
- 定足数: https://github.com/XRPLF/rippled/blob/3.4.1/src/xrpld/app/misc/detail/ValidatorList.cpp#L1707-L1797
- Testnet の VL の入手元と発行者鍵: https://github.com/XRPLF/rippled/blob/3.4.1/cfg/validators-example.txt#L64-L72
