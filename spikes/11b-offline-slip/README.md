# 11b-offline-slip

オフライン払いの「伝票」の試験。世帯が端末の鍵（Web Crypto、取り出せない鍵）で伝票に署名して QR で見せ、
お店がネットなしで確かめてためる。精算スクリプトが二重払いを見つけ、Check の上限を超えない精算額を出す。台帳には触れない。

```bash
pnpm --filter 11b-offline-slip build
pnpm --filter 11b-offline-slip preview          # http://localhost:4173（#/household と #/shop）
pnpm --filter 11b-offline-slip settle results/checks.json results/slips-A.json results/slips-B.json
python3 scripts/slip-check.py dist results       # Chrome でオフライン確認（要 Playwright）
```

- 伝票の形式・確認 a〜d: `src/slip/format.ts`（ブラウザと Node で共通）
- 世帯の画面: `src/household/HouseholdPage.tsx` / お店の画面: `src/shop/ShopPage.tsx` / 精算: `scripts/settle.ts`
- `results/`: 自動確認の結果（slip-check.json）、お店が書き出した伝票、精算結果（settlement.json）、QR とスクリーンショット
