# 08-noir

資格証明の Noir 回路（circuits/eligibility）と、UltraHonk の証明・検証の計測。

- 回路のテスト: `cd circuits && nargo test --workspace`（nargo 1.0.0）
- コンパイル済みの回路は `circuits/target/*.json` にコミット済み（JS 側の計測に nargo は不要）
- bb.js は初回に CRS を crs.aztec-labs.com から取る（Node は ~/.bb-crs にキャッシュ）

```bash
pnpm install
pnpm --filter 08-noir bench        # Node: native と wasm、100 件。bench/node-results.json と web/public/fixture/ を作る
pnpm --filter 08-noir web          # http://localhost:5173 を開いて「計測する」→ bench/browser-results.json
pnpm --filter 08-noir report       # REPORT.md を作る
```
