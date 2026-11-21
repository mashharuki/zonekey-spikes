# 03-rlusd-escrow: 実 RLUSD（Testnet）での条件付き EscrowCreate

## 1. 結論

不合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 送り手（donor）の RLUSD 残高 | >= 0.1 RLUSD | 1 RLUSD | account_lines（rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh） |
| 受取側（beneficiary）の RLUSD トラストライン | あり（Escrow の失敗要因から受取側を除外するため） | あり（limit=1000000000） | TrustSet [BCC2DDB49A77CCB21DF317B51A66275DC9414574910799853E3A374B6D6F69B0](https://testnet.xrpl.org/transactions/BCC2DDB49A77CCB21DF317B51A66275DC9414574910799853E3A374B6D6F69B0) |
| RLUSD 0.1 の条件付き EscrowCreate | tesSUCCESS かつ validated（Token Escrow で RLUSD をロックできる） | tecNO_PERMISSION / validated=true | [ABD56ECD59162AE1DE6EF08477850F8E5AA7175DF126488A3135D046AD105030](https://testnet.xrpl.org/transactions/ABD56ECD59162AE1DE6EF08477850F8E5AA7175DF126488A3135D046AD105030)。Condition=A0258020899E23EC703AF65C8087BEA9AEBE8A6F2E4EDC9E0470EC79DE4CFA54D4754A2B810120、CancelAfter(Ripple epoch)=848549676 |
| 送り手の RLUSD 残高の変化 | 変化なし | 1 → 1 | account_lines（validated） |

## 3. 返ってきたエラーコード

- `tecNO_PERMISSION`

## 4. 設計への影響

- RLUSD の Testnet 発行者では Token Escrow を作成できなかった（tecNO_PERMISSION）。01-preflight の「発行者に lsfAllowTrustLineLocking が無い」と整合する。06_技術設計の『RLUSD を Escrow に入れる』前提を見直す必要がある。発行者側の設定変更が無い限り、RLUSD でのロックは設計に使えない

## 5. 分からなかったこと

- tecNO_PERMISSION の原因がフラグ未設定のみかは、この 1 回の結果だけでは断定できない（発行者が設定すれば変わるかを見るのが確実）

<!-- generated: 2026-11-21T04:04:43.231Z -->
