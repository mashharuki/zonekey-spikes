# zonekey-spikes

XRPLハッカソン（2026年12月）向けPoC「ZoneKey Relief」の事前技術検証用リポジトリ。
ここのコードは検証のためだけのもので、本番には持ち込まない。目的は「動くか・動かないか」を事実で確かめること。

## プロダクトの要約
災害時、国・県・NGOのドナーが世帯ごとにRLUSD（相当のトークン）のToken Escrowを積む。
条件はPREIMAGE-SHA-256。ゾーン鍵をShamir 2-of-3で3つのオラクルに分け、2つが閾値を超えると
鍵が揃って巡回ボット（keeper）がEscrowFinishをBatchで一斉に送る。期限（CancelAfter）切れはEscrowCancelでドナーへ戻る。

## 絶対に守ること
- XRPL Testnet のみ。Mainnetには接続しない。エンドポイント: wss://s.altnet.rippletest.net:51233
- テスト用XRPはFaucet（https://faucet.altnet.rippletest.net/accounts）またはxrpl.jsの fundWallet で取得
- 秘密鍵・シード・APIキーをコードやコミットに書かない。.env.local（gitignore済み）から読む
- 個人情報は使わない。ID・住所などは明らかな合成データだけ
- 結果を良く見せるための回避策を勝手に入れない。期待どおりに動かなければ、そこで止めて事実を記録する

## 技術
- Node.js 22以上、TypeScript（strict）、pnpm、tsx で実行
- xrpl.js は最新版。使う前に、Batch・Credential・Oracle・DID・Token Escrow のフィールドが型にあるかを確認する
- トランザクションのフィールド名・フラグ値・エラーコードは記憶で書かず、xrpl.org のリファレンスと xrpl.js の型定義で確認してから使う

## 報告の形式（必須）
各検証の結果を spikes/<番号>/REPORT.md に書く。
1. 結論: 合格 / 不合格 / 一部合格 のどれか（1行）
2. 確認項目ごとの表: 項目 | 期待 | 実際 | 根拠（tx hash、engine_result、計測値）
3. 実際に返ってきたエラーコード（tec/tem/tef）をそのまま
4. 設計への影響: 06_技術設計のどこを変えるべきか（なければ「なし」）
5. 分からなかったこと
Testnet上のtx hashは必ず残す（あとで testnet.xrpl.org で確認できるように）。