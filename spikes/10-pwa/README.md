# 10-pwa

受取証明（spike 09 の受け取りパック）を、ネットなしで検証する PWA。
React + Vite + Lism CSS（create-lism の minimal-vite と同じ雛形）に vite-plugin-pwa を入れたもの。
検証のコードは spike 09 のもの（`09-offline-receipt/verifier`）をそのまま使う。

```bash
pnpm --filter 10-pwa dev        # 開発（Service Worker は本番ビルドでだけ動く）
pnpm --filter 10-pwa build      # 本番ビルド（dist/）
pnpm --filter 10-pwa preview    # dist を http://localhost:4173 で配る（localhost なら Service Worker が動く）
pnpm --filter 10-pwa trust      # spike 09 の data/unl から検証者リストを src/trust/ に作り直す
pnpm --filter 10-pwa samples    # spike 09 の receipts から public/samples と samples-qr を作り直す
python3 scripts/offline-check.py dist samples-qr results/offline-check.json   # Chrome でオフライン確認（要 Playwright）
```

- `samples-qr/*.png`: QR 読み取りの試験用（別の画面に表示して、PWA の「カメラで QR を読む」で読む）
- `public/samples/*.bin`: ファイル選択とアプリ内サンプルの試験用（圧縮した受け取りパック）
