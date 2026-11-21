# 02-rlusd-wallet

Testnet RLUSD を貯めるための固定ウォレットを用意する。

```
pnpm --filter 02-rlusd-wallet start    # 初回: ウォレット作成 → .env.local に DONOR_SEED 保存 → XRP を Faucet で入金 → RLUSD の TrustSet
pnpm --filter 02-rlusd-wallet status   # 読み取り専用: XRP / RLUSD 残高
```

- シードは `.env.local`（gitignore 済み）の `DONOR_SEED` にだけ保存される。ログ・REPORT.md には出ない。
- RLUSD は https://tryrlusd.com/ で受け取る（手動。`start` の最後に表示されるアドレスを使う）。
- `start` は何度実行しても安全（既にあれば何も送らない）。
