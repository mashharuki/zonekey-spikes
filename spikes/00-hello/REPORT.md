# 00-hello: Faucet ウォレット作成と 1 XRP 送金

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| Faucet で alice を作成 | 資金が入った状態で作成される | 100 XRP | rnL9HFoqjjFu4dnXGzP6vcQLci6YFeBzDT |
| Faucet で bob を作成 | 資金が入った状態で作成される | 100 XRP | rna3VMiRBvY9MLQbEqfHKvD8T44YKB1JQB |
| alice → bob に 1 XRP を送金 | tesSUCCESS かつ validated | tesSUCCESS / validated=true | [C52C804DD1C29A407FB0892EF3E2ECA17B0176308B0F2109FC9EDF6321FA5333](https://testnet.xrpl.org/transactions/C52C804DD1C29A407FB0892EF3E2ECA17B0176308B0F2109FC9EDF6321FA5333) |
| bob の残高増分 | +1 XRP | +1 XRP | before=100, after=101 |

## 3. 返ってきたエラーコード

なし

## 4. 設計への影響

なし（土台の動作確認のみ）

## 5. 分からなかったこと

なし

<!-- generated: 2026-11-21T03:19:52.725Z -->
