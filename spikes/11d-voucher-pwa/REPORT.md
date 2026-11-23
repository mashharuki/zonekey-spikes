# 11d-voucher-pwa: 券（お店宛ての受給証 Escrow）を iPhone で見せ、お店がオフラインで確かめる

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| ✅ 準備: V → D 受給証 40（本番は D が RLUSD で買う） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [B00DE59A3EAD5E97718D6F5081CA743B606AFDF346E6D42E9F5D5257AB75C082](https://testnet.xrpl.org/transactions/B00DE59A3EAD5E97718D6F5081CA743B606AFDF346E6D42E9F5D5257AB75C082) |
| 🔎 発行: 口座 | - | D=rDAHcwJbtQMUgdwkNNZvrzHuQvki57xiUn<br>お店 S=rBEaXHXsoNxaJf7ff7WLMQDt68N59hjD2e<br>世帯 5548EE17（XRPL の口座なし） | お店の seed は .state/shop.json（コミットしない） |
| ✅ 発行: D が券 4 枚を Batch（tfAllOrNothing）で作る | 外側・内側すべて tesSUCCESS | 外側 tesSUCCESS / 内側 [tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS] | [983F23A00A5C3D7EEDFECFC87EF16EBBD5692523F7CDE1721DB4CCB8CCA20EC3](https://testnet.xrpl.org/transactions/983F23A00A5C3D7EEDFECFC87EF16EBBD5692523F7CDE1721DB4CCB8CCA20EC3)<br>手数料 60 drops（10×2 + Σ内側(10+10+10+10) = 60） |
| ✅ 発行: お店の一覧（account_objects）の枚数 | 4 | 4 | Escrow は宛先の owner directory にも入る |
| ✅ 発行: 世帯に渡す券の番号・Condition が台帳と一致 | 0 件の不一致 | 0 件の不一致 | account_objects と照合 |
| 🔎 精算: お店が受け付けた券 | - | 2 枚（番号 22540374・5 / 番号 22540376・10） | お店の画面で受け付けた時点の確認時間: 2.2 ms, 1.5 ms |
| ✅ 精算: お店 S が EscrowFinish 2 件を Batch（tfIndependent）で送る | tesSUCCESS, tesSUCCESS | tesSUCCESS, tesSUCCESS | 外側 tesSUCCESS・[6B9CB2963D93CE1FAF64D792325318089EB5F1433572E4E82D7886838B03F389](https://testnet.xrpl.org/transactions/6B9CB2963D93CE1FAF64D792325318089EB5F1433572E4E82D7886838B03F389)<br>手数料 726 drops（10×2 + Σ内側(353+353) = 726） |
| ✅ 精算: お店 S の受給証残高 | 15 | 15 | 精算前 （線なし）。トラストラインはお店自身の Finish で自動で作られる |
| ✅ iPhone: 端末の鍵（作成直後） | extractable=false | extractable=false | 確認メモ（2026-11-23 13:42 のスクリーンショット）。UA: iPhone OS 18_7、Safari（UA の表記どおり Version/27.2） |
| ✅ iPhone: 秘密鍵を書き出してみる | できない（InvalidAccessError） | できない（InvalidAccessError） | 確認メモ |
| ✅ iPhone: 券の取り込み（秘密から作り直した Condition と券の一致） | 4 / 4 | 4 / 4 | 確認メモ。台帳の券（results/issue.json）と、iPhone の秘密から作り直した Condition が一致 |
| ✅ iPhone: 券の QR を出す | 出る（187 B・型番 8）・秘密と券の一致 ✅ | 187 B・型番 8・作成 7 ms・一致 ✅（1,000 円券 #3） | スクリーンショット（機内モードを戻した後に撮影） |
| 🔎 iPhone: 保存の永続化 | 観察 | 求める前 persisted=false → persist() の結果 true | 確認メモ |
| ✅ お店: 券の QR をカメラで読む（お店の端末はオフライン） | 受け付け | 受け付け・500 円券・187 B・確認 2.2 ms・通信なし | お店の画面の表示（人が報告）。1,000 円券も受け付け（確認 1.5 ms、results/settle.json） |
| ✅ iPhone: 機内モードで券の QR を出す | 出る | 出た（人による確認の報告。機内モードにしたあとアプリは開き直していない） | 2026-11-23 13:43 の報告。スクリーンショットは機内モードを戻した後に撮影 |
| ✅ iPhone: 開き直したあとの端末の鍵 | extractable=false のまま | extractable=false | 確認メモの「端末の鍵（再読み込み後）」の行（2026-11-23 13:44 の報告） |
| ✅ お店: 同じ券をもう一度読む | 使えません（使用済み） | 1 回目は受け付け、2 回目は「使えません」（500 円券 #2） | お店の画面の表示（人による確認の報告、2026-11-23 13:45）。コンテナの Chrome でも「使用済み」を確認 |

## 3. 返ってきたエラーコード

なし

## 4. 設計への影響

- **11c の券の方式は、スマホの PWA でそのまま動く。** 世帯の iPhone は 32 バイトの秘密と、書き出せない端末の鍵（ECDSA P-256）だけを持ち、券の QR（187 B・QR 型番 8）をその場で 7 ms で作れた。お店はネットなしでカメラから読み、1 枚 2 ms 前後で「受け付け」と判定した
- **iPhone から Mac に渡すのはハッシュだけでよい。** 申し込みは Condition と公開鍵のハッシュだけで、台帳の券と iPhone の秘密から作り直した Condition が 4 / 4 一致した。preimage は iPhone の外に出ない
- **精算はお店の口座 1 つで済む。** お店は前もってトラストラインを張らず、自分の EscrowFinish（Batch）で受給証を受け取れた（2 枚で 726 drops）
- **ホーム画面の Web アプリでは、保存の永続化（persist）が許可された。** 秘密が消えるリスクは下がるが、アプリを削除すると消えるので、秘密の控え（紙の QR など）は別に要る

## 5. 分からなかったこと

- この検証では、お店の鍵（seed）は Mac に置き、精算は Mac のスクリプトから出した。本番ではお店の端末が自分の鍵で出す
- 世帯・お店・Mac の間のファイルの受け渡しは AirDrop で行った。本番では、発行と同期を通信のあるうちにアプリの中で行う
- 秘密の控え（紙の QR など）から復元する画面は作っていない
- Safari（ホーム画面に追加しない場合）での動作は未確認
- 500 円券 #2 はお店で受け付けたが、精算（settle）はしていない（精算したのは #1・#3 の 2 枚）。期限（24 時間）後に D が回収できる。11/25 の Testnet リセットで消える

<!-- generated: 2026-11-23T04:45:55.226Z -->
