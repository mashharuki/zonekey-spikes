# 07-privy: Privy の XRPL ウォレット（ユーザー所有）・本人承認の署名・ポリシー

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| ✅ 確認1: ユーザーが所有者の XRPL ウォレット | owner_id がある（owner: { user_id } で作成） | address=r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA<br>wallet_id=z7p6ean7oppmzkitcrvuvgir<br>owner_id=mh0s46rlptjmvlai62f99bnb<br>public_key=02721c239c46c029…（33 バイト） | wallets().create / list |
| 🔎 アカウント | - | Privy ウォレット=r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA（wallet_id=z7p6ean7oppmzkitcrvuvgir）<br>運営=rnqDqEGfk5ocB4zhWtj7HaGHU2GrdtaQwk<br>モック発行者=r9b4RmqEVN5ZfvN5o8QupfDZiofDn6ZwiL | 運営・発行者のシードは .env.local |
| 🔎 確認2: 有効化 | 未有効なら 10 XRP 送る | 既に有効化済み（再実行） | account_info |
| ✅ 確認3 TrustSet（ポリシーなし）: Privy の署名 | 署名される | 署名された（SigningPubKey=02721C239C46…、xrpl.js verifySignature=OK） | encodeForSigning の先頭=53545800（署名用接頭辞 53545800） |
| ✅ 確認3 TrustSet（ポリシーなし）: 署名済み blob を Testnet に送信 | tesSUCCESS | tesSUCCESS | [E33EC74F0CF4691E7F55BAB1B8B170A9F50627BC0704D610EBD46EF24C12460C](https://testnet.xrpl.org/transactions/E33EC74F0CF4691E7F55BAB1B8B170A9F50627BC0704D610EBD46EF24C12460C) |
| ✅ 確認4: ユーザー所有のウォレットにポリシーを付ける（本人の JWT で更新） | policy_ids に入る | policy_ids=["ddtu31yobf77rugg7yaodyxr"] | wallets().update + user_jwts |
| ✅ 確認4 許可: TrustSet（ZKV / モック発行者、上限変更）: Privy の署名 | 署名される | 署名された（SigningPubKey=02721C239C46…、xrpl.js verifySignature=OK） | encodeForSigning の先頭=53545800（署名用接頭辞 53545800） |
| ✅ 確認4 許可: TrustSet（ZKV / モック発行者、上限変更）: 署名済み blob を Testnet に送信 | tesSUCCESS | tesSUCCESS | [004B929E202480092CA65A77272E89D2BA0EC4C93A4DAD72E765D8EBD97FAF4B](https://testnet.xrpl.org/transactions/004B929E202480092CA65A77272E89D2BA0EC4C93A4DAD72E765D8EBD97FAF4B) |
| ✅ 確認4 拒否: 別の issuer への TrustSet: Privy の署名 | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | encodeForSigning の先頭 16 桁=5354580012001422… |
| ✅ 確認4 拒否: 任意の Payment（運営へ 1 drop）: Privy の署名 | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | encodeForSigning の先頭 16 桁=5354580012000022… |
| ✅ 確認5 準備: 発行者が CredentialCreate | tesSUCCESS（再実行なら tecDUPLICATE） | tecDUPLICATE | [D3E49FB620C92257AFD9CAAA1108870F7EEE64663652B1706ABC8E7BF92EF025](https://testnet.xrpl.org/transactions/D3E49FB620C92257AFD9CAAA1108870F7EEE64663652B1706ABC8E7BF92EF025) |
| ✅ 確認5a: CredentialAccept（TrustSet のみ許可のポリシー） | 拒否（ポリシーが評価できない種類は既定で拒否） | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction |
| ✅ 確認5b: TransactionType = CredentialAccept を許可するルール | invalid_policy_format（TransactionType に指定できるのは Payment / OfferCreate / OfferCancel / TrustSet だけ） | 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"} | policies().createRule（name="allow-credential-accept"） |
| ✅ 確認5c: 5b + system 時刻条件のルール | invalid_policy_format（TransactionType に指定できるのは Payment / OfferCreate / OfferCancel / TrustSet だけ） | 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"} | policies().createRule（name="allow-credential-accept-system"） |
| ✅ 確認5d 準備: DENY Payment + system 条件だけの ALLOW を追加 | 追加できる | rule_ids=vglzc2ka3g3i07bjpdv7b1di, yajogwamlv9uyqkkr6ofbkck | policies().createRule |
| ✅ 確認5d: CredentialAccept が署名され、送信できる | 署名される → tesSUCCESS | 署名された → tesSUCCESS | [D7B71695C4DD2D92C51ECE27941C869EE04F36C4976498FD479C8AE90F42BC86](https://testnet.xrpl.org/transactions/D7B71695C4DD2D92C51ECE27941C869EE04F36C4976498FD479C8AE90F42BC86) |
| ✅ 確認5d: それでも Payment は DENY で止まる | 拒否（DENY が ALLOW より優先） | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction |
| 🔎 確認5d: 別の issuer への TrustSet も通ってしまうか（送信はしない） | system 条件の ALLOW は種類を問わず許可するはず | 署名された（= TrustSet の issuer 制限が効かなくなる） | xrpl_signTransaction |
| 🔎 確認5d 後片付け: 追加したルールを削除 | ポリシーは TrustSet だけ許可に戻る | 削除 2 件 | policies().deleteRule |
| ✅ 確認6: 同じユーザーが別ブラウザでログインしたときのアドレス | 同じアドレス（2 つ以上の User-Agent から確認） | ログイン 7 回、User-Agent 2 種類、ユーザーごとのアドレス数=1 | 付録のログイン履歴 |

## 3. 返ってきたエラーコード

- `確認4 拒否: 別の issuer への TrustSet: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認4 拒否: 任意の Payment（運営へ 1 drop）: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認5a CredentialAccept: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認5b: TransactionType = CredentialAccept を許可するルール: 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"}`
- `確認5c: 5b + system 時刻条件のルール: 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"}`

## 4. 設計への影響

- 受益者のウォレットは Privy のユーザー所有（owner: { user_id }）で作る。サーバーは App Secret だけでは動かせず、署名のたびに本人の access token（user_jwts）が要る。同じユーザーなら別ブラウザでも同じアドレス（wallets().list で再利用）
- 署名前のバイト列は xrpl.js の encodeForSigning()（先頭 53545800）。SigningPubKey に Privy の public_key（33 バイト）を入れてから autofill → encode → xrpl_signTransaction。署名済み blob の送信はアプリ側（Privy は送らない）
- Privy のポリシーで中身を検査できるのは Payment / OfferCreate / OfferCancel / TrustSet だけ。TransactionType 条件にそれ以外（CredentialAccept・EscrowFinish など）を書くと invalid_policy_format でルール自体が作れない
- CredentialAccept は、ポリシーで個別に許可できない。system 条件だけの ALLOW を足せば署名できるが、そのあいだは種類を問わず許可され、TrustSet の issuer 制限も効かなくなる（DENY を足した Payment だけは止まった）
- **結論（CredentialAccept の扱い）:** 登録時に、制限ポリシーを付ける前のウォレットで本人の承認により CredentialAccept と TrustSet を済ませ、その後で『TrustSet は指定の currency/issuer だけ』のポリシーを付ける（ポリシーの付与も本人の JWT で行える）。後から別の Credential を受け取る必要が出た場合は、DENY で Payment / OfferCreate を塞いだうえで、system 時刻条件の ALLOW を短い時間窓（gt 開始・lt 終了）で一時的に足し、終わったら削除する
- 受益者が自分で EscrowFinish を送る設計にすると同じ問題（ポリシーで評価できない種類）になる。EscrowFinish は keeper が送る（spike 05 で、所有者でなくても完了できることを確認済み）ので、受益者のウォレットには不要
- @privy-io/node は 0.41.0 に固定。0.42.0 は公開から 1 日未満で pnpm の minimumReleaseAge に止められたため。今回使う API の型は 0.42.0 と同一（差はコメントと型の別名 PolicyID のみ）

## 5. 分からなかったこと

なし

<!-- generated: 2026-11-22T02:35:03.643Z -->

## 付録: ログイン履歴（確認 6）

| 時刻 | user_id | アドレス | 作成/再利用 | User-Agent |
| --- | --- | --- | --- | --- |
| 2026-11-22T02:21:11.215Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 作成 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/ |
| 2026-11-22T02:21:18.341Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/ |
| 2026-11-22T02:21:24.172Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/ |
| 2026-11-22T02:26:10.959Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 |
| 2026-11-22T02:26:21.941Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 |
| 2026-11-22T02:34:29.274Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 |
| 2026-11-22T02:34:31.712Z | did:privy:cm7zlkf4m000mkedrtt6hql37 | r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA | 再利用 | Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 |
