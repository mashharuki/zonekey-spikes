# 01-preflight: Testnet の前提確認（読み取り専用）

## 1. 結論

一部合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| amendment TokenEscrow | enabled = true | feature: {"enabled":true,"name":"TokenEscrow","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=138B968F25822EFBF54C00F97031221C47B1EAB8321D93C7C2AEAF85F04EC5DF （xrpl.org 記載の ID と一致） |
| amendment BatchV1_1 | enabled = true | feature: {"enabled":true,"name":"BatchV1_1","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=9F287AED3CDB50A7BD1ACEC24296A30C9B5230CCD136219317AC790E3B884377 （xrpl.org 記載の ID と一致） |
| amendment Credentials | enabled = true | feature: {"enabled":true,"name":"Credentials","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF （xrpl.org 記載の ID と一致） |
| amendment PriceOracle | enabled = true | feature: {"enabled":true,"name":"PriceOracle","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=96FD2F293A519AE1DB6F8BED23E4AD9119342DA7CB6BAFD00953D16C54205D8B （xrpl.org 記載の ID と一致） |
| amendment DID | enabled = true | feature: {"enabled":true,"name":"DID","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109 （xrpl.org 記載の ID と一致） |
| amendment PermissionDelegationV1_1 | enabled = true | feature: {"enabled":true,"name":"PermissionDelegationV1_1","supported":true}<br>ledger Amendments: true | 判定: 有効。ID=0F48FF561C709540328F31F1C97FD512ACC8B4E42138A161CB0E21ECA292540B （xrpl.org 記載の ID と一致） |
| amendment PermissionDelegation（旧版） | enabled = true、または置換先 PermissionDelegationV1_1 が enabled | feature: 一覧に存在しない<br>ledger Amendments: false | 判定: 旧版=無効 / V1_1=有効。xrpl.org は旧版を v2.6.1 で無効化し V1_1 に置換したと記載。ID=AE6AB9028EEB7299EBB03C7CBCC3F2A4F5FBE00EA28B8223AA3118A0B436C1C5（記載と一致） |
| 基礎準備金（reserve_base_xrp） | 10 XRP または 1 XRP | 1 XRP | server_info.validated_ledger.reserve_base_xrp（ledger seq=22488770） |
| 1件あたりの準備金（reserve_inc_xrp） | 2 XRP または 0.2 XRP | 0.2 XRP | server_info.validated_ledger.reserve_inc_xrp |
| 準備金はどちらに近いか | 「10 / 2」か「1 / 0.2」のどちらか | 1 XRP / 0.2 XRP に近い（完全一致） | 相対誤差の合計: 10/2 との差=1.800, 1/0.2 との差=0.000。validated_ledger={"age":1,"base_fee_xrp":0.00001,"hash":"1686DFD9C6F7CB2A85CAD10CF8CD65966FCD414D35B4B2994D4E78986F6DE773","reserve_base_xrp":1,"reserve_inc_xrp":0.2,"seq":22488770}。build_version=3.4.1 |
| RLUSD 発行者の lsfAllowTrustLineLocking | Flags に 0x40000000 が立っている | Flags=2174353408（0x819A0000） | 判定: 立っていない。立っているフラグ: lsfAllowTrustLineClawback, lsfDepositAuth, lsfDefaultRipple, lsfDisableMaster, lsfDisallowXRP, lsfRequireDestTag。account_flags(返却値)={"allowTrustLineClawback":true,"allowTrustLineLocking":false,"defaultRipple":true,"depositAuth":true,"disableMasterKey":true,"disallowIncomingCheck":false,"disallowIncomingNFTokenOffer":false,"disallowIncomingPayChan":false,"disallowIncomingTrustline":false,"disallowIncomingXRP":true,"globalFreeze":false,"noFreeze":false,"passwordSpent":false,"requireAuthorization":false,"requireDestinationTag":true}。validated=true ledger=22488770 |
| RLUSD 発行者アカウントの存在 | account_info が返る | rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV（Sequence=611833, Balance=99951181 drops, Domain=68747470733A2F2F726970706C652E636F6D2F） | account_info（ledger_index=validated） |
| インストール済み xrpl.js のバージョン | 取得できる（最新版であること） | 5.3.0 | /Users/harukikondo/git/zonekey-spikes/node_modules/.pnpm/xrpl@5.3.0/node_modules/xrpl。最新版かどうかはレジストリ未確認（`pnpm view xrpl version` で比較） |
| 型のエクスポート（Batch / CredentialCreate / CredentialAccept / OracleSet / DIDSet / EscrowCreate） | 6 つすべてが xrpl からエクスポートされている | あり: Batch, CredentialCreate, CredentialAccept, OracleSet, DIDSet, EscrowCreate<br>なし: なし | tsc Version 7.0.2 で probe/types-probe.ts を型検査。診断数=0 |
| EscrowCreate.Amount の型（トークン対応） | XRP の文字列に加え、Trust Line Token（IssuedCurrencyAmount）か MPTAmount を受けられる | d.ts: `Amount: Amount \| MPTAmount;`<br>XRP(drops 文字列): 受けられる / Trust Line Token: 受けられる / MPT: 受けられる | probe/types-probe.ts の代入可否を tsc で判定 |

## 3. 返ってきたエラーコード

なし

## 4. 設計への影響

判定が「不合格」「一部合格」の項目ごとに、06_技術設計の該当箇所（使う amendment、準備金の見積り、RLUSD の Escrow 前提）を見直す。全項目が合格なら なし。

## 5. 分からなかったこと

なし

<!-- generated: 2026-11-21T03:30:01.756Z -->
