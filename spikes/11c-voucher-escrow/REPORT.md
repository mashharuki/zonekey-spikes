# 11c-voucher-escrow: お店宛ての受給証 Escrow（券）をオフラインで使う

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 🔎 準備: Testnet | - | rippled 3.4.1 / 準備金 1 XRP + 0.2 XRP/件 / 基本手数料 0.00001 XRP | server_info |
| ✅ 準備: amendment TokenEscrow | enabled | true | feature TokenEscrow |
| ✅ 準備: V → D 受給証 60（本番は D が RLUSD で 1:1 に買う。spike 04 で確認済み） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [8604EF403987C4B5E5F8C59DA58ADD3DD22E8129A994ECDEA5E473ECA16F64B7](https://testnet.xrpl.org/transactions/8604EF403987C4B5E5F8C59DA58ADD3DD22E8129A994ECDEA5E473ECA16F64B7) |
| 🔎 準備: 口座 | - | V=rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh<br>D=rDAHcwJbtQMUgdwkNNZvrzHuQvki57xiUn<br>お店 A=r3U2EkdFGEdVDvfhw5aNTnk7fNVopB29Ax<br>お店 B=rpZtrM6S7sJAyivUKYgJXynVxLJsNVakGG<br>世帯 HH1・HH2 は XRPL の口座なし | お店は受給証のトラストラインを張らない（Finish のときに自動で作られるかを確認 6 で見る） |
| ✅ 確認2: 世帯の秘密から preimage を作り直せる（v1 を 2 回導出） | 一致 | 一致 | HMAC-SHA256(秘密, todoke-11c\|HH1\|1)。preimage の値は出力しない |
| ✅ 確認1: D が EscrowCreate 7 件を Batch（tfAllOrNothing）で送る | 外側 tesSUCCESS・内側 7 件すべて tesSUCCESS | 外側 tesSUCCESS / 内側 [tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS] | [619EF0FE71389CC6…](https://testnet.xrpl.org/transactions/619EF0FE71389CC6AC03212BB8D80C89023BB909808C5AF467C35D15E4053587)<br>手数料 90 drops（10×2 + Σ内側(10+10+10+10+10+10+10) = 90） |
| ✅ 確認1: D の OwnerCount（Escrow 1 件 = 1） | 15 | 15 | 8 → 15。準備金 0.2 XRP × 7 を D が持つ |
| 🔎 確認1: D の残高の変化 | 受給証 −50、XRP は手数料だけ減る | 受給証 70 → 20<br>XRP 91999838 → 91999748 drops（差 -90） | account_lines / account_info |
| ✅ 確認1: 台帳の tx に preimage が出ていない | 0 件 | 0 件 | Batch の tx JSON を全文検索（D が受け取ったのは Condition だけ） |
| ✅ 確認7: 期限前に D が EscrowCancel（v1） | tecNO_PERMISSION（validated） | tecNO_PERMISSION / validated=true | [0B39337B5EC954D3B14EFDE31A08772996F6DBABC4AA55B5D5DEB2306B648B33](https://testnet.xrpl.org/transactions/0B39337B5EC954D3B14EFDE31A08772996F6DBABC4AA55B5D5DEB2306B648B33)。期待は rippled EscrowCancel.cpp（CancelAfter 前） |
| ✅ 確認3: お店 A が account_objects で自店宛ての券を一覧できる | 6 件 | 6 件 | v1〜v4・v6・v7。Escrow は宛先の owner directory にも入る（rippled EscrowCreate.cpp の dirInsert） |
| ✅ 確認3: お店 B の一覧 | 1 件 | 1 件 | v5。account_objects |
| ✅ 確認3: 同期した券の持ち主・宛先・Condition が作った内容と一致 | 0 件の不一致 | 0 件の不一致 | 持ち主 = D（世帯のアドレスは台帳に出ない） |
| ✅ 確認3: 端末の公開鍵のハッシュ（Memo）を同期で取れる | 3 件 | 3 件 | v1〜v3。Escrow には Memo が残らないので、PreviousTxnID の tx から読む |
| 🔎 確認3: 券の QR の大きさ | 1 枚に収まる | 187 B → QR 型番 8（L）/ 10（M）<br>58 B → QR 型番 4（L）/ 4（M） | 署名なし 58 B = 版・フラグ・持ち主・OfferSequence・preimage / 署名つき 187 B = + 公開鍵 65 B・署名 64 B（qrcode で型番を計算） |
| ✅ 確認3: v1（HH1・500 円券・端末の署名つき） | 使える | 使える | 187 B / 1.2 ms |
| ✅ 確認5: v1 をもう一度出す | 使用済み | 使用済み | 187 B / 0.0 ms |
| ✅ 確認3: v2（HH1・1,000 円券・署名つき） | 使える | 使える | 187 B / 0.4 ms |
| ✅ 確認8: v3 の preimage だけを盗み見して出す（署名なし） | 端末の署名がない | 端末の署名がない | 58 B / 0.1 ms |
| ✅ 確認8: v3 を別の端末の鍵で署名して出す | 端末の公開鍵が券と合わない | 端末の公開鍵が券と合わない | 187 B / 0.1 ms |
| ✅ 確認3: v3（本人の端末） | 使える | 使える | 187 B / 0.3 ms |
| ✅ 確認5: v4 の preimage を 1 ビット書き換える | preimage が条件と合わない | preimage が条件と合わない | 58 B / 0.1 ms |
| ✅ 確認3: v4（HH2・500 円券・署名なしの券） | 使える | 使える | 58 B / 0.1 ms |
| ✅ 確認5: v5（お店 B 宛て）をお店 A で出す | このお店宛ての券ではない（または未同期） | このお店宛ての券ではない（または未同期） | 58 B / 0.0 ms |
| ✅ 確認5: v6 を期限の 120 秒前を過ぎた時刻で出す（端末の時計を CancelAfter − 119 秒にして確認） | 期限切れ（精算が間に合わない） | 期限切れ（精算が間に合わない） | 58 B / 0.0 ms |
| ✅ 確認5: 壊れた QR（長さ違い） | 形式が不正 | 形式が不正 | 40 B / 0.0 ms |
| ✅ 確認3: 確認中のネットワーク利用の試み | 0 回 | 0 回 | fetch・ソケット・DNS・TLS を遮断して実行 |
| 🔎 確認3: 受け付けた券 | v1・v2・v3・v4 | v1・v2・v3・v4 | 精算（settle）で EscrowFinish する。Fulfillment は .state/ にだけ保存 |
| 🔎 確認6 準備: お店 A の受給証トラストライン | なし | （線なし） | issue でお店は TrustSet をしていない |
| ✅ 確認6: お店 A が EscrowFinish 5 件を Batch（tfIndependent）で送る（4 件は受け付けた券、5 件目は v7 に条件違いの Fulfillment） | tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS, tecCRYPTOCONDITION_ERROR | tesSUCCESS, tesSUCCESS, tesSUCCESS, tesSUCCESS, tecCRYPTOCONDITION_ERROR | 外側 tesSUCCESS・[AF2371AC004A2914…](https://testnet.xrpl.org/transactions/AF2371AC004A2914CE412780748A9A2D448EB26ADC6E5DDBAE9F25F014B673D2)<br>手数料 1785 drops（10×2 + Σ内側(353+353+353+353+353) = 1785） |
| ✅ 確認6: お店 A の受給証残高 | 30 | 30 | 宛先が自分で Finish したので、トラストラインは自動で作られる（EscrowHelpers.h） |
| 🔎 確認6: お店 A の XRP の変化 | 手数料 + トラストラインの準備金ぶん減る（準備金は残高から引かれない） | 2000000 → 1998215 drops | account_info |
| ✅ 確認6: v7 を正しい Fulfillment で Finish（条件違いの失敗で券が消えていない） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [97B5C50E6CC8E03623AAF2C16448CE82254FDA18B4E5CD5474A736D553CA8814](https://testnet.xrpl.org/transactions/97B5C50E6CC8E03623AAF2C16448CE82254FDA18B4E5CD5474A736D553CA8814) |
| ✅ 確認5: 精算済みの v1 をもう一度 Finish | tecNO_TARGET（validated） | tecNO_TARGET / validated=true | [2C6645AEBF2791D0FF277C43616D6D360B165A9904C1E745C6D4614AC197D55F](https://testnet.xrpl.org/transactions/2C6645AEBF2791D0FF277C43616D6D360B165A9904C1E745C6D4614AC197D55F)。Escrow は消えているので台帳上でも二重には受け取れない |
| ✅ 確認6: 第三者 D が v5（お店 B 宛て）を Finish（B はトラストラインなし） | tecNO_LINE（validated） | tecNO_LINE / validated=true | [9CA559B2A4512B4E65861B7F6E4D8FA02ABF00735531DA6E0D3CAE531A184C95](https://testnet.xrpl.org/transactions/9CA559B2A4512B4E65861B7F6E4D8FA02ABF00735531DA6E0D3CAE531A184C95)。期待は rippled EscrowHelpers.h（宛先以外が出すとラインを作らない） |
| ✅ 確認6: お店 B 自身が v5 を Finish | tesSUCCESS（validated） | tesSUCCESS / validated=true | [1887793B6281564A82CF666C371CABD06FEA54789D8E65400EAC7E65758DC24B](https://testnet.xrpl.org/transactions/1887793B6281564A82CF666C371CABD06FEA54789D8E65400EAC7E65758DC24B) |
| ✅ 確認6: お店 B の受給証残高 | 10 | 10 | トラストラインは自動で作られた |
| 🔎 確認7: v6 の期限が過ぎるまで待つ | - | CancelAfter=848722452 / 検証済みレジャーの close_time=848722461 | ledger |
| ✅ 確認7: 期限後にお店 A が v6 を Finish | tecNO_PERMISSION（validated） | tecNO_PERMISSION / validated=true | [2FE0A8EADFB6A3242B0EB6FA8B8778CB97A1463FF24CA904942CAE3C0B0584DA](https://testnet.xrpl.org/transactions/2FE0A8EADFB6A3242B0EB6FA8B8778CB97A1463FF24CA904942CAE3C0B0584DA)。期待は rippled EscrowFinish.cpp（CancelAfter 後） |
| ✅ 確認7: 期限後に D が v6 を EscrowCancel | tesSUCCESS（validated） | tesSUCCESS / validated=true | [950FA2B7E4D741FB252CAA280B3BDD26315139F78D9D273FCAF2401F31155F35](https://testnet.xrpl.org/transactions/950FA2B7E4D741FB252CAA280B3BDD26315139F78D9D273FCAF2401F31155F35) |
| 🔎 確認7: D の受給証残高 | +5 | 20 → 25 | account_lines |
| 🔎 確認9: 世帯 1 軒あたりのコスト（券 5 枚の場合） | - | 作成: Batch 1 件で内側 5 件なら 10×2 + 10×5 = 70 drops（今回 7 件で 90 drops）<br>準備金: 券 1 枚 0.2 XRP × 5 = 1 XRP を D が精算まで拘束<br>精算: EscrowFinish 1 件 353 drops（330 + 10 × 36/16 の切り上げ）を お店が負担 | D の OwnerCount は今 8（残っている Escrow の数 + トラストライン） |

## 3. 返ってきたエラーコード

- `確認7: 期限前に D が EscrowCancel（v1）: tecNO_PERMISSION`
- `確認5: 精算済みの v1 をもう一度 Finish: tecNO_TARGET`
- `確認6: 第三者 D が v5（お店 B 宛て）を Finish（B はトラストラインなし）: tecNO_LINE`
- `確認7: 期限後にお店 A が v6 を Finish: tecNO_PERMISSION`
- `settle の Batch 内側 5 件目（EscrowFinish、50084B491F2E79EA8C95B68D6D36B22AF7EE5D46198ED8FC1DD8C46215F49D66）: tecCRYPTOCONDITION_ERROR`

## 4. 設計への影響

- **B案（お店宛ての受給証 Escrow ＝ 券）は成立する。** 資金は宛先のお店に固定してロックされ、期限前は誰も取り消せない（tecNO_PERMISSION）。お店はオフラインで券を確かめ（1 枚 1 ms 前後、通信 0 回）、後で EscrowFinish すれば必ず受け取れる。11b（Check＋伝票）にあった「二重払いでお店が損をする」問題がなくなる。Todoke のオフライン払いは、Check（A案）ではなく券（B案）を主にする
- **世帯は XRPL の口座を持たなくてよい。** 券を作るのは配布用アカウント D で、台帳に出るのは「D → お店」だけ。世帯の持ち物は 32 バイトの秘密（と端末の鍵）だけで、preimage は秘密から作り直せる。D が受け取るのは Condition（ハッシュ）だけなので、D も券を使えない。ただし、どの世帯にどの券を出したかは D（支援団体）が知っている。「台帳から世帯と店舗を結び付けられない」とは言えるが、「団体からも匿名」とは言えない
- **お店の準備は XRP の準備金だけでよい。** 宛先のお店自身が EscrowFinish を出せば、受給証のトラストラインは自動で作られた。第三者（D など）が代わりに精算すると tecNO_LINE になる。精算はお店の端末から出す前提にする
- **費用:** 作成は D が負担する（Batch で 8 枚まで 1 回、券 1 枚につき準備金 0.2 XRP を精算まで拘束）。精算はお店が負担する（EscrowFinish 1 枚 353 drops。Batch で 8 枚なら 10×2 + 353×8 = 2,844 drops）。Batch の中で 1 枚が失敗しても、他の券と、失敗した券そのものは残る（tfIndependent・tecCRYPTOCONDITION_ERROR のあとに正しい Fulfillment で成功）
- **盗み見への対策:** EscrowCreate の Memo に端末の公開鍵のハッシュを入れ、QR に端末の署名を付けると、preimage だけを盗んでも、別の鍵で署名しても使えなかった。QR は署名つきで 187 B（QR 型番 8〜10）、署名なしで 58 B（型番 4）
- **期限の設計:** お店は CancelAfter の 120 秒前から券を受け付けない（精算の時間を残す）。期限が切れた券は D が EscrowCancel で回収できた。CancelAfter の長さ（数日〜数週間）は運用で決める
- **お店のオフライン確認の前提:** お店が確かめられるのは「最後に同期した時点で台帳にあった券」だけ。券は前もって発行し、お店はネットがあるうちに同期しておく運用にする

## 5. 分からなかったこと

- スマホ（ブラウザ・PWA）での動作は未確認。今回は Node で実行した。券のロジック（src/voucher/）は Web Crypto だけで書いてあり、11b の画面に組み込むのが次の一歩
- この検証では、段階をまたいで鍵を使うため、端末の鍵を書き出せる形で .state/ に置いた。ブラウザで書き出せない鍵が使えることは 11b で確認済み
- お店が最後に同期した後に作られた券は、オフラインでは確かめられない。xPoP（XLS-41、spike 09 と同じ仕組み）で補う方法は未実施
- お店が閉店したときの救済。期限前は D も取り消せないので、CancelAfter まで資金が動かない
- 端末の時計がずれている場合の、期限の判定への影響は未確認
- D の OwnerCount 8 のうち 7 は 1 回目の実行（比較の書き方の誤りで ❌ になった回）で作った券。期限後に回収していない（11/25 の Testnet リセットで消える）
- 額面と円の換算は扱っていない（5 = 500 円券、10 = 1,000 円券とみなした）

<!-- generated: 2026-11-23T04:15:51.131Z -->
