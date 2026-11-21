# 06-oracle-share: OracleSet でスコアと分け前を配り、DIDSet に Merkle ルートを置く

## 1. 結論

合格（Memo 上限の 1 項目は期待値の誤りで、追試 MEMO-LIMIT.md で上限を確定）

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 🔎 アカウント | - | o1=rGzdAc9gqeAbX1iaXRJgsMVZqfJpYoyHkq<br>o2=rJEy92tjbbSqayfhwzTQVjReYyFwT5zFQg<br>o3=rpa6QYiypLFn86UquRMuntMEviv54X8oTy | 使い捨て（シードは保存しない） |
| 🔎 Shamir 2-of-3 の分け前の長さ | 32 バイト（依頼の想定） | 33, 33, 33 バイト | shamir-secret-sharing 0.0.4: 秘密と同じ長さ + x 座標 1 バイト。以降は 33 バイトの分け前を扱う |
| ✅ 確認1/2 o1: OracleSet（2 ゾーンのスコア + Memo に分け前 33 バイト） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [7A068C5BF122A352BE73F9D82AF6096B9FE929D8727FAC9EA7881F4CF82900BB](https://testnet.xrpl.org/transactions/7A068C5BF122A352BE73F9D82AF6096B9FE929D8727FAC9EA7881F4CF82900BB)。Memos の直列化サイズ=96 バイト |
| ✅ 確認1/2 o2: OracleSet（2 ゾーンのスコア + Memo に分け前 33 バイト） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [B3A51BE6FD9EEF59631F8354EBC4348C144AAC094528A2AE2DDE914188421032](https://testnet.xrpl.org/transactions/B3A51BE6FD9EEF59631F8354EBC4348C144AAC094528A2AE2DDE914188421032)。Memos の直列化サイズ=96 バイト |
| ✅ 確認1/2 o3: OracleSet（2 ゾーンのスコア + Memo に分け前 33 バイト） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [093EA2C486ECE64164B3825B576DEDFC9D03D849044485A3371C6DB20284E0F8](https://testnet.xrpl.org/transactions/093EA2C486ECE64164B3825B576DEDFC9D03D849044485A3371C6DB20284E0F8)。Memos の直列化サイズ=96 バイト |
| ✅ 確認1 o1: 台帳から読み戻したスコア | ZONE-13101-A/SCR=82.5<br>ZONE-13101-B/SCR=100 | ZONE-13101-A/SCR=82.5<br>ZONE-13101-B/SCR=100 | ledger_entry { oracle: { account, oracle_document_id: 1 } }。AssetPrice は 16 進で返る（例 339） |
| ✅ 確認1 o2: 台帳から読み戻したスコア | ZONE-13101-A/SCR=78<br>ZONE-13101-B/SCR=45.5 | ZONE-13101-A/SCR=78<br>ZONE-13101-B/SCR=45.5 | ledger_entry { oracle: { account, oracle_document_id: 1 } }。AssetPrice は 16 進で返る（例 30c） |
| ✅ 確認1 o3: 台帳から読み戻したスコア | ZONE-13101-A/SCR=90<br>ZONE-13101-B/SCR=61 | ZONE-13101-A/SCR=90<br>ZONE-13101-B/SCR=61 | ledger_entry { oracle: { account, oracle_document_id: 1 } }。AssetPrice は 16 進で返る（例 384） |
| 🔎 確認1 補足: get_aggregate_price で ZONE-13101-A の 3 オラクル集計 | 中央値は 82.5（Scale 適用済み）か 825（未適用）のどちらか（実測） | median=82.5<br>mean=83.5<br>size=3 | get_aggregate_price（台帳上で計算） |
| ✅ 確認1 補足: スコア 0（AssetPrice=0）を書けるか | リファレンスに記載なし（実測） | tesSUCCESS | [D10D1865948342D8734152E447E3FF9CA1498A8FA57BE19CC19A6F5B8430F4BF](https://testnet.xrpl.org/transactions/D10D1865948342D8734152E447E3FF9CA1498A8FA57BE19CC19A6F5B8430F4BF) |
| ✅ 確認1b: LastUpdateTime を検証済みレジャー時刻 -330 秒 | tecINVALID_UPDATE_TIME | tecINVALID_UPDATE_TIME | 適用レジャーの close time との差=-339 秒。[9EA3C5A0EB2F6C7B1D18171811F1D405161746CDF7974A16B6EA2367872651AE](https://testnet.xrpl.org/transactions/9EA3C5A0EB2F6C7B1D18171811F1D405161746CDF7974A16B6EA2367872651AE) |
| ✅ 確認1b: LastUpdateTime を検証済みレジャー時刻 -270 秒 | tesSUCCESS | tesSUCCESS | 適用レジャーの close time との差=-272 秒。[0CFADCA58E1C80004CFAA92CFA91863EA089FA5F7044244C66090487226F3537](https://testnet.xrpl.org/transactions/0CFADCA58E1C80004CFAA92CFA91863EA089FA5F7044244C66090487226F3537) |
| ✅ 確認1b: LastUpdateTime を検証済みレジャー時刻 +270 秒 | tesSUCCESS | tesSUCCESS | 適用レジャーの close time との差=261 秒。[774590B4EA3782A2FA1C972138348C2111CC0537FF7CE45AB94B52339379C933](https://testnet.xrpl.org/transactions/774590B4EA3782A2FA1C972138348C2111CC0537FF7CE45AB94B52339379C933) |
| ✅ 確認1b: LastUpdateTime を検証済みレジャー時刻 +330 秒 | tecINVALID_UPDATE_TIME | tecINVALID_UPDATE_TIME | 適用レジャーの close time との差=321 秒。[F5615EAA0FA9D3DF4A46D1F8735EABD2BA01A657730CBECB418760C661026124](https://testnet.xrpl.org/transactions/F5615EAA0FA9D3DF4A46D1F8735EABD2BA01A657730CBECB418760C661026124) |
| ✅ 確認1b: 更新時に LastUpdateTime が前回と同じ | tecINVALID_UPDATE_TIME（前回より大きい必要） | tecINVALID_UPDATE_TIME | 前回=1795261412。[C1E605FAE84833AC17341578510678A6454D258D9EA1390F26167A3B93342194](https://testnet.xrpl.org/transactions/C1E605FAE84833AC17341578510678A6454D258D9EA1390F26167A3B93342194) |
| ✅ 確認2 o1: OracleSet の Memo から分け前を読み戻す | 送った分け前と一致 | 一致 | Oracle エントリー → PreviousTxnID [7A068C5BF1…](https://testnet.xrpl.org/transactions/7A068C5BF122A352BE73F9D82AF6096B9FE929D8727FAC9EA7881F4CF82900BB) → tx_json.Memos |
| ✅ 確認2 o2: OracleSet の Memo から分け前を読み戻す | 送った分け前と一致 | 一致 | Oracle エントリー → PreviousTxnID [B3A51BE6FD…](https://testnet.xrpl.org/transactions/B3A51BE6FD9EEF59631F8354EBC4348C144AAC094528A2AE2DDE914188421032) → tx_json.Memos |
| ✅ 確認2 o3: OracleSet の Memo から分け前を読み戻す | 送った分け前と一致 | 一致 | Oracle エントリー → PreviousTxnID [093EA2C486…](https://testnet.xrpl.org/transactions/093EA2C486ECE64164B3825B576DEDFC9D03D849044485A3371C6DB20284E0F8) → tx_json.Memos |
| ✅ 確認2: Memos の直列化サイズ 1024 バイト（MemoData 1017 バイト） | tesSUCCESS（1 KB 以内） | tesSUCCESS | [09C7349C7711C60FB47C8D4F4804B368BF9CEE2609BCAE742365B64607F8D242](https://testnet.xrpl.org/transactions/09C7349C7711C60FB47C8D4F4804B368BF9CEE2609BCAE742365B64607F8D242) |
| 🔎 確認2: Memos の直列化サイズ 1025 バイト（MemoData 1018 バイト） | 拒否（1 KB 超過）← 期待値の誤り | tesSUCCESS | 私は Memos フィールド全体（フィールド ID と配列終端の 2 バイトを含む）で数えていた。rippled は配列の中身で数えるため、これは中身 1,023 バイトで上限内。追試 MEMO-LIMIT.md 参照 |
| ✅ 確認3: 台帳の Memo から集めた o1 + o2 で鍵を復元 | 元の 32 バイト鍵と一致 | 一致 | combine() |
| ✅ 確認3: 台帳の Memo から集めた o1 + o3 で鍵を復元 | 元の 32 バイト鍵と一致 | 一致 | combine() |
| ✅ 確認3: 台帳の Memo から集めた o2 + o3 で鍵を復元 | 元の 32 バイト鍵と一致 | 一致 | combine() |
| ✅ 確認3: 分け前 1 つでは復元できない | 復元不可 | 例外: shares must have at least 2 and at most 255 elements | combine([o1]) |
| ✅ 確認3: 分け前 1 つ + 偽の分け前では元の鍵にならない | 元の鍵と不一致 | 不一致 | combine([o1, 偽]) |
| 🔎 確認4: 代替（Payment の Memo） | 確認2 が不可の場合のみ実施 | 確認2 が成立したため実施せず | - |
| 🔎 確認1b まとめ | - | -330s → tecINVALID_UPDATE_TIME（差 -339s）<br>-270s → tesSUCCESS（差 -272s）<br>+270s → tesSUCCESS（差 261s）<br>+330s → tecINVALID_UPDATE_TIME（差 321s） | - |
| ✅ 確認5: DIDSet Data = Merkle ルート 32B + バージョン 4B = 36 バイト | tesSUCCESS | tesSUCCESS | [68D41A945D0CD2CC179F75A105242D9B7005D13220909A5AF95748675E0D24D7](https://testnet.xrpl.org/transactions/68D41A945D0CD2CC179F75A105242D9B7005D13220909A5AF95748675E0D24D7) |
| ✅ 確認5: Merkle ルート 32B + バージョン 4B = 36 バイト を ledger_entry で読み戻す | 送った Data と一致 | 一致<br>root=8902D855544F567123D8F4F2E6257832538A075E612DCF9926E5AC4A67A77EE0<br>version=1 | ledger_entry { did: account } |
| ✅ 確認5: DIDSet Data = 上限ちょうど 256 バイト | tesSUCCESS | tesSUCCESS | [4F12D85534FAB699D6F152F45AB095292ECECCE86A977FC65C47E3B8F18B0325](https://testnet.xrpl.org/transactions/4F12D85534FAB699D6F152F45AB095292ECECCE86A977FC65C47E3B8F18B0325) |
| ✅ 確認5: 上限ちょうど 256 バイト を ledger_entry で読み戻す | 送った Data と一致 | 一致 | ledger_entry { did: account } |
| ✅ 確認5: DIDSet Data = 上限超過 257 バイト | 拒否 | temMALFORMED | 未適用。Transaction failed, temMALFORMED: Malformed transaction. |
| ✅ 確認5: 上限超過 257 バイト 拒否後の DID | 直前の Data のまま | 変わっていない | ledger_entry { did: account } |

## 3. 返ってきたエラーコード

- Memos 上限超過（中身 1,025 バイト、追試）: `fails local checks: The memo exceeds the maximum allowed size.`
- `LastUpdateTime -330s: tecINVALID_UPDATE_TIME`
- `LastUpdateTime +330s: tecINVALID_UPDATE_TIME`
- `LastUpdateTime 前回と同じ: tecINVALID_UPDATE_TIME`
- `DIDSet Data 257 バイト: temMALFORMED`

## 4. 設計への影響

- **分け前の置き場所: OracleSet の Memo。** スコアの書き込みと分け前の公開が 1 つの tx で原子的に起きる。収集側は Oracle エントリーの PreviousTxnID からその tx を引けば台帳だけで集められる。別の取引（Payment）は不要
- 分け前は 33 バイト（秘密 32 + x 座標 1）。Memo は直列化 1 KB までなので余裕がある
- 注意: Memo は公開される。分け前を出すのは『ゾーンのスコアが閾値を超えた』と判断したオラクルだけにする（2 つ出た時点で誰でも鍵＝Fulfillment を復元できる。これは EscrowFinish で Fulfillment が公開されるのと同じ扱い）
- 注意: Oracle エントリーの PreviousTxnID は最新の更新 tx を指す。分け前を出した後にスコアだけ更新すると PreviousTxnID が変わるので、収集は account_tx で Memo 付きの OracleSet を探す方が確実
- ゾーン ID は BaseAsset に非標準通貨コード（ASCII 最大 20 バイト）、スコアは QuoteAsset=SCR・Scale=1・AssetPrice=スコア×10 で表す。3 オラクルが同じペアを書けば get_aggregate_price で台帳上の集計が取れる

## 5. 分からなかったこと

- 11/25 の Testnet リセットで本検証の tx は消える

## 付録: Memos の上限（追試 MEMO-LIMIT.md）

AccountSet に Memo を 1 つ付け、MemoData を 1 バイトずつ増やして実測した。

| MemoData | Memos フィールド全体 | 中身（全体 − 2） | 結果 |
| --- | --- | --- | --- |
| 1,019 バイト | 1,026 バイト | **1,024 バイト** | tesSUCCESS（受理された最大） |
| 1,020 バイト | 1,027 バイト | 1,025 バイト | 送信時に拒否: `fails local checks: The memo exceeds the maximum allowed size.` |

- 上限は **Memos 配列の中身（フィールド ID と配列終端を除く）で 1,024 バイト**。
- 超過時はエンジン結果コード（tem/tec）ではなく、送信時のローカル検査で拒否される（台帳に入らず手数料もかからない）。xrpl.js の submitAndWait は例外として返す。
- 分け前の Memo（MemoType + MemoFormat + 33 バイトの分け前）は 96 バイトなので、上限まで十分な余裕がある。

<!-- generated: 2026-11-21T11:45:11.844Z -->
