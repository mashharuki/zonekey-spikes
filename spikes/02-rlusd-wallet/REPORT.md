# 02-rlusd-wallet: 固定ウォレットと RLUSD トラストライン

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 固定ウォレット（donor） | DONOR_SEED のシードから復元、無ければ新規作成して .env.local に保存 | 新規作成し .env.local に保存（シードは出力しない） | [rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh](https://testnet.xrpl.org/accounts/rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh) |
| XRP 残高（手数料・準備金用） | アカウントが有効化され XRP がある | 100 XRP（今回 Faucet で入金） | account_info（validated） |
| RLUSD の TrustSet 送信 | tesSUCCESS かつ validated | tesSUCCESS / validated=true | [70A9E0A155EE3D8FB85F01EBE024FC77E27A0DD8106BB362013E433272214F86](https://testnet.xrpl.org/transactions/70A9E0A155EE3D8FB85F01EBE024FC77E27A0DD8106BB362013E433272214F86) |
| RLUSD トラストラインの存在 | account_lines に rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV の RLUSD がある | あり（balance=0, limit=1000000000, no_ripple=true） | account_lines（validated） |

## 3. 返ってきたエラーコード

なし

## 4. 設計への影響

なし（RLUSD を貯めるための準備作業）

## 5. 分からなかったこと

- tryrlusd.com の 1 日 10 枚の上限が、GitHub ログイン単位かウォレット単位かは未確認
- faucet が受取先に『ブラウザウォレット接続』を要求する場合の、このウォレットの使い方（シードのインポート可否）は未確認

<!-- generated: 2026-11-21T03:52:59.380Z -->
