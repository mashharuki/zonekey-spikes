# 12-shop-open: 開店の届け・お店の Credential・券を作るお店の選び方

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 🔎 準備: Testnet | - | rippled 3.4.1 | server_info |
| 🔎 準備: 口座（Faucet） | - | G=rPN8H5GfHe9pFWFrSeytUBQR2Sc7cNr3Bn<br>G2=rJn98bTeaiCwe4g8zpban1LGVWW33YWbvk<br>A=rLuMpv7x8gat3qnUwvaUeu4NnpTkGfccuT<br>B=rDuEUXhZa6iHKkytDaUpP6jRsWVHPhAhv<br>C=rscnJbuUTSfTaDMtoNRmKofuxL8BUtYxmq<br>E=rfbK6ezexVGqbt5szTADpsjVXAaUuY2WN3<br>X=rEWFKxXSmytwNfv4YQ9hgyY1FeiFQhLhoK | G = 自治体（模擬）、G2 = 第三者、A・B・C = 地区13、E = 地区14、X = Credential を G から受けていない |
| 🔎 確認1: CredentialType | 64 バイト以内 | todoke:shop:z13 → 746F646F6B653A73686F703A7A3133（15 B） | rippled Protocol.h kMaxCredentialTypeLength = 64 |
| ✅ 確認1: G → A CredentialCreate（todoke:shop:z13） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [16A008B01AE531D6658D552B6B2543463DFD9312599CA4E61CE1776F84B625A1](https://testnet.xrpl.org/transactions/16A008B01AE531D6658D552B6B2543463DFD9312599CA4E61CE1776F84B625A1) |
| ✅ 確認1: G → B CredentialCreate（todoke:shop:z13、Expiration 180 秒後） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [5DFAD2C7BEA05E1DCD73F53ACC79069A9461C66AC9250AEBED1775296B25C37D](https://testnet.xrpl.org/transactions/5DFAD2C7BEA05E1DCD73F53ACC79069A9461C66AC9250AEBED1775296B25C37D) |
| ✅ 確認1: G → C CredentialCreate（todoke:shop:z13） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [DDA9D408027A3B180AD29294EE7EFD4977AF6272A790F95D7E2DC51C5C4C0FD5](https://testnet.xrpl.org/transactions/DDA9D408027A3B180AD29294EE7EFD4977AF6272A790F95D7E2DC51C5C4C0FD5) |
| ✅ 確認1: G → E CredentialCreate（todoke:shop:z14） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E9736101B27FFE1D52D9544963C4952FDFD8A8FEFCF63F59E1EE9B0231078D0E](https://testnet.xrpl.org/transactions/E9736101B27FFE1D52D9544963C4952FDFD8A8FEFCF63F59E1EE9B0231078D0E) |
| ✅ 確認1: A が CredentialAccept | tesSUCCESS（validated） | tesSUCCESS / validated=true | [FA5AA784C9ADBE8786E1896B1F2B67EAD20877DC97F78993FAF4EC6161021A24](https://testnet.xrpl.org/transactions/FA5AA784C9ADBE8786E1896B1F2B67EAD20877DC97F78993FAF4EC6161021A24) |
| ✅ 確認1: B が CredentialAccept | tesSUCCESS（validated） | tesSUCCESS / validated=true | [90E7C0CA53B521E46399A8D0F86363296974B89435CC61E7B169DE0513809704](https://testnet.xrpl.org/transactions/90E7C0CA53B521E46399A8D0F86363296974B89435CC61E7B169DE0513809704) |
| ✅ 確認1: E が CredentialAccept | tesSUCCESS（validated） | tesSUCCESS / validated=true | [553C69E8193DB92C40636CBD8A27A3922E5F8646E98EA277465B1E4B9E3E4AFF](https://testnet.xrpl.org/transactions/553C69E8193DB92C40636CBD8A27A3922E5F8646E98EA277465B1E4B9E3E4AFF) |
| ✅ 確認1: A の Credential（G の account_objects） | lsfAccepted=true | Flags=0x10000（lsfAccepted=true）/ Expiration=なし / todoke:shop:z13 | lsfAccepted = 0x00010000（rippled LedgerFormats.h）。未受け取りでも発行者とお店の両方の owner directory に入る |
| ✅ 確認1: B の Credential（G の account_objects） | lsfAccepted=true | Flags=0x10000（lsfAccepted=true）/ Expiration=848727281 / todoke:shop:z13 | lsfAccepted = 0x00010000（rippled LedgerFormats.h）。未受け取りでも発行者とお店の両方の owner directory に入る |
| ✅ 確認1: C の Credential（G の account_objects） | lsfAccepted=false | Flags=0x0（lsfAccepted=false）/ Expiration=なし / todoke:shop:z13 | lsfAccepted = 0x00010000（rippled LedgerFormats.h）。未受け取りでも発行者とお店の両方の owner directory に入る |
| ✅ 確認1: E の Credential（G の account_objects） | lsfAccepted=true | Flags=0x10000（lsfAccepted=true）/ Expiration=なし / todoke:shop:z14 | lsfAccepted = 0x00010000（rippled LedgerFormats.h）。未受け取りでも発行者とお店の両方の owner directory に入る |
| ✅ 確認2: G2 → X CredentialCreate（todoke:shop:z13） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E8670129DF9E3BC24060F0072FAD75479BC50942DB0C8E032B8C4DD0755C06CC](https://testnet.xrpl.org/transactions/E8670129DF9E3BC24060F0072FAD75479BC50942DB0C8E032B8C4DD0755C06CC) |
| ✅ 確認2: X が CredentialAccept（発行者 G2） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [50EC91AA18FE0B6FD74C1F7FB327F38BF6E06D59F08656CCF45793CFFFAAA59C](https://testnet.xrpl.org/transactions/50EC91AA18FE0B6FD74C1F7FB327F38BF6E06D59F08656CCF45793CFFFAAA59C) |
| ✅ 確認3: A が開店の届け（AccountSet・設定なし・Memo todoke/open） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [EE37C192DDEB15B34934E3508C19FFEC5C1FBC4145E49C3B2C36A27F0BC73AFB](https://testnet.xrpl.org/transactions/EE37C192DDEB15B34934E3508C19FFEC5C1FBC4145E49C3B2C36A27F0BC73AFB) |
| ✅ 確認3: A が開店の届け（AccountSet・設定なし・Memo todoke/open）: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認3: B が開店の届け | tesSUCCESS（validated） | tesSUCCESS / validated=true | [093B86CCDFC80177B3EFFF24F3C4970EF91870EA7E2EEACBA64A2EFF17411989](https://testnet.xrpl.org/transactions/093B86CCDFC80177B3EFFF24F3C4970EF91870EA7E2EEACBA64A2EFF17411989) |
| ✅ 確認3: B が開店の届け: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認3: C が開店の届け | tesSUCCESS（validated） | tesSUCCESS / validated=true | [B363D518F6537B780909531801A316CE8F35F40B041CE8BB37F81E40AB5BD793](https://testnet.xrpl.org/transactions/B363D518F6537B780909531801A316CE8F35F40B041CE8BB37F81E40AB5BD793) |
| ✅ 確認3: C が開店の届け: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認3: E が開店の届け | tesSUCCESS（validated） | tesSUCCESS / validated=true | [45966C6CDCAD03A5A8191BA104CC9394CF918289CC676E58F91950621136C81A](https://testnet.xrpl.org/transactions/45966C6CDCAD03A5A8191BA104CC9394CF918289CC676E58F91950621136C81A) |
| ✅ 確認3: E が開店の届け: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認3: X が開店の届け | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E9E5B67CEADC4AF6DD46223970566BF491F792EAF87A7077D3A1CDA7BDAE1FC4](https://testnet.xrpl.org/transactions/E9E5B67CEADC4AF6DD46223970566BF491F792EAF87A7077D3A1CDA7BDAE1FC4) |
| ✅ 確認3: X が開店の届け: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認4: A が 2 回目の開店の届け | tesSUCCESS（validated） | tesSUCCESS / validated=true | [11B846F7413960D69544475D09C70F35E23152DC440741D45ECCAE3A3F3B1868](https://testnet.xrpl.org/transactions/11B846F7413960D69544475D09C70F35E23152DC440741D45ECCAE3A3F3B1868) |
| ✅ 確認4: A が 2 回目の開店の届け: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認5: 選ばれたお店 | A | A | close_time 848727381 / 有効時間 600 秒 / 呼び出し account_objects 2・account_tx 3・26904 B・836 ms |
| ✅ 確認5: B が外れた理由 | c: で外れる | c: Credential の期限切れ（Expiration 848727281 < close_time 848727381） | select.ts |
| ✅ 確認5: C が外れた理由 | b: で外れる | b: Credential を受け取っていない（lsfAccepted なし） | select.ts |
| ✅ 確認5: E が外れた理由 | a: で外れる | a: 地区・種類が違う（todoke:shop:z14） | select.ts |
| ✅ 確認5: X が外れた理由 | a: で外れる | a: 発行者が G ではない（rJn98bTeaiCwe4g8zpban1LGVWW33YWbvk の todoke:shop:z13）。G の候補に出ない | select.ts |
| ✅ 確認4: 選ぶときに A の最新の届けを取れる | 11B846F7413960D69544475D09C70F35E23152DC440741D45ECCAE3A3F3B1868 | 11B846F7413960D69544475D09C70F35E23152DC440741D45ECCAE3A3F3B1868 | 1 回目 EE37C192DDEB15B3… / 2 回目 11B846F7413960D6…（account_tx を新しい順に読む） |
| ✅ 確認6: G が A の Credential を CredentialDelete | tesSUCCESS（validated） | tesSUCCESS / validated=true | [FA1A0906B1E31A9045D38A09C6B80AD4F972C86C8C97BDCA769970624B374EC9](https://testnet.xrpl.org/transactions/FA1A0906B1E31A9045D38A09C6B80AD4F972C86C8C97BDCA769970624B374EC9) |
| ✅ 確認6（取り消し後）: 選ばれたお店 | なし | なし | close_time 848727390 / 有効時間 600 秒 / 呼び出し account_objects 3・account_tx 2・17115 B・819 ms |
| ✅ 確認6（取り消し後）: A が外れた理由 | a: で外れる | a: Credential がない。G の候補に出ない | select.ts |
| ✅ 確認6: G が A に Credential を出し直す | tesSUCCESS（validated） | tesSUCCESS / validated=true | [147918D0AAED793EEA0691B71C6DF78BF68FE06D3D6A1A8D38433FF379DFD531](https://testnet.xrpl.org/transactions/147918D0AAED793EEA0691B71C6DF78BF68FE06D3D6A1A8D38433FF379DFD531) |
| ✅ 確認6: A が受け取る | tesSUCCESS（validated） | tesSUCCESS / validated=true | [702D2B72628F91F4B878A427838C97F356597851F25DDE1A07B659C0606A039C](https://testnet.xrpl.org/transactions/702D2B72628F91F4B878A427838C97F356597851F25DDE1A07B659C0606A039C) |
| ✅ 確認6: A が届けを出し直す | tesSUCCESS（validated） | tesSUCCESS / validated=true | [C9EE1C6EEAFF616433CA025831B7C2DF642990E35B29E0689A9F80F98A0AF280](https://testnet.xrpl.org/transactions/C9EE1C6EEAFF616433CA025831B7C2DF642990E35B29E0689A9F80F98A0AF280) |
| ✅ 確認6: A が届けを出し直す: 設定が変わっていない | account_info（Balance・Sequence・PreviousTxn・OwnerCount を除く）が同じ | 同じ | account_info |
| ✅ 確認6（出し直し後）: 選ばれたお店 | A | A | close_time 848727410 / 有効時間 600 秒 / 呼び出し account_objects 2・account_tx 3・35675 B・825 ms |
| ✅ 確認6（出し直し後）: B が外れた理由 | c: で外れる | c: Credential の期限切れ（Expiration 848727281 < close_time 848727410） | select.ts |
| ✅ 確認6（出し直し後）: C が外れた理由 | b: で外れる | b: Credential を受け取っていない（lsfAccepted なし） | select.ts |
| ✅ 確認6（出し直し後）: E が外れた理由 | a: で外れる | a: 地区・種類が違う（todoke:shop:z14） | select.ts |
| ✅ 確認6（出し直し後）: X が外れた理由 | a: で外れる | a: 発行者が G ではない（rJn98bTeaiCwe4g8zpban1LGVWW33YWbvk の todoke:shop:z13）。G の候補に出ない | select.ts |
| ✅ 確認7: D が選ばれたお店（A）宛ての券 2 枚を Batch で作る | 外側・内側すべて tesSUCCESS | 外側 tesSUCCESS / 内側 [tesSUCCESS, tesSUCCESS] | [ED321030066A0001EE5F730B37BD5860C671B55B15A67ED4E2A5AB51950F1E3B](https://testnet.xrpl.org/transactions/ED321030066A0001EE5F730B37BD5860C671B55B15A67ED4E2A5AB51950F1E3B)。CancelAfter 15 分（D が後で回収できる） |
| ✅ 確認7: A 宛ての券の枚数 | 2 | 2 | account_objects（type: escrow） |
| ✅ 確認7: B 宛ての券の枚数 | 0 | 0 | account_objects（type: escrow） |
| ✅ 確認7: C 宛ての券の枚数 | 0 | 0 | account_objects（type: escrow） |
| ✅ 確認7: E 宛ての券の枚数 | 0 | 0 | account_objects（type: escrow） |
| ✅ 確認7: X 宛ての券の枚数 | 0 | 0 | account_objects（type: escrow） |
| ✅ 確認8: 鍵・.env.local なしで、確認6（出し直し後）と同じ判定になる | 同じ | 同じ | 接続先 wss://s.altnet.rippletest.net:51233。環境変数は PATH・HOME だけ。選ばれた A（close_time 848727420）。results/select-public.json |
| ✅ 確認9: お店 5 件のとき、全件が選ばれる | 5 | 5 | 1242 ms / account_objects 1 回・account_tx 5 回・ledger 1 回 / 受け取り 38321 B |
| ✅ 確認9: お店 15 件のとき、全件が選ばれる | 15 | 15 | 2742 ms / account_objects 1 回・account_tx 15 回・ledger 1 回 / 受け取り 114719 B |
| ✅ 確認9: お店 30 件のとき、全件が選ばれる | 30 | 30 | 4946 ms / account_objects 1 回・account_tx 30 回・ledger 1 回 / 受け取り 229336 B |
| 🔎 確認9: 件数と選ぶ時間 | - | 5 件: 1242 ms・account_tx 5 回・account_objects 1 回・38321 B<br>15 件: 2742 ms・account_tx 15 回・account_objects 1 回・114719 B<br>30 件: 4946 ms・account_tx 30 回・account_objects 1 回・229336 B | G=r3K7zbRWxd8Jy7QXhzGNY2b6u9zu7sx5wd。有効時間 3600 秒。Mac から公開 Testnet サーバーへ、お店を 1 件ずつ順に読む |

## 3. 返ってきたエラーコード

なし

## 4. 設計への影響

- **開店の届けに使う取引:** 設定を何も変えない AccountSet に Memo（MemoType "todoke/open"）を付けるだけで足りる。5 件とも tesSUCCESS で、account_info（残高・Sequence・PreviousTxn・OwnerCount を除く）は前後で同じだった。代わりの Payment は不要
- **台帳だけで「券を作ってよいお店」を選べるか:** 選べる。候補は自治体 G の account_objects（type: credential）から作り、外す理由は次の 4 つ。a 地区・種類が違う／発行者が G ではない／Credential がない、b 受け取っていない（lsfAccepted なし）、c Credential の期限切れ（close_time > Expiration）、d 有効時間内の届けがない。G が Credential を取り消すと、次の選び直しでそのお店は外れた
- **自治体以外が出した Credential を外せるか:** 外せる。G2 も同じ CredentialType（todoke:shop:z13）を X に出せて、X も受け取れた。ただし候補を G の account_objects から作るので、X は最初から候補に出ない。「誰が自治体か」は G のアドレスで決める（公開して固定する）
- **選ぶ時間:** お店 30 件で約 5 秒（account_tx 30 回・account_objects 1 回・約 230 KB）。時間とデータ量はお店の数にほぼ比例し、1 件あたり約 150 ms・約 7.6 KB（1 件ずつ順に読んだ場合）。1,000 件なら順に読んで約 2.5 分・約 7.6 MB の見積もり。並列に読めば短くなる（未計測）
- **誰でもやり直せる:** 鍵も .env.local も使わず、公開の Testnet サーバーだけで同じ判定になった（確認 8）。ピッチで「券を作るお店の判定は、台帳を読めば誰でも同じ結果になる」と言える
- **選んだお店にだけ券を作れる:** 選ばれた A 宛てにだけ、11c と同じ券（受給証 Escrow）を Batch で作れた。他のお店宛ての券は 0 枚
- **注意:** 条件 d は「有効時間内に届けがあるか」だけを見る。Credential を取り消して出し直したお店は、出し直す前に送った届けも数えられる（今回は出し直し後にも届けを送った）。厳しくするなら「Credential を受け取った後の届け」に限る（Credential の PreviousTxnID の時刻と比べる）

## 5. 分からなかったこと

- 選ぶ処理は、お店 1 件ずつ account_tx を順に読んだ。並列に読んだ場合の時間、公開サーバーの呼び出し制限に当たるかは未確認
- account_tx は 1 回（20 件）で有効時間内の届けに届いた。届けの後に取引が多いお店では、ページ送り（marker）が増える
- 1 つの自治体が 400 件を超える Credential を出した場合の account_objects のページ送りは未計測
- 確認 7 の券は乱数の preimage から作った（世帯の Condition ではない）。CancelAfter（15 分）後に D が回収できるが、回収はしていない（11/25 の Testnet リセットで消える）

<!-- generated: 2026-11-23T05:49:16.732Z -->
