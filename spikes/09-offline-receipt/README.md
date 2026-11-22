# 09-offline-receipt

XRPL の受け取り取引が台帳で確定したことを、取得済みのデータだけでネットなしに検証できるかを確かめる。

```bash
pnpm --filter 09-offline-receipt collect     # Testnet から取得（Mac・ネットあり）。引数で S2 の tx hash を変えられる
pnpm --filter 09-offline-receipt receipt    # 受け取りパックを作り、大きさと QR に入るかを測る（ネット不要）
pnpm --filter 09-offline-receipt verify     # ネットを遮断して A / B / C を検証（Wi-Fi を切って実行してもよい）
pnpm --filter 09-offline-receipt report     # REPORT.md
pnpm --filter 09-offline-receipt selftest   # 検証 C の実装の自己確認（合成データ）
```

- data/: 取得した生データ（公開の Testnet データのみ。シードは保存しない）
- receipts/: 受け取りパック（`*-ab.bin` は A・B、`*-abc.bin` は C の署名つき）
- results/: verify / pack の結果
