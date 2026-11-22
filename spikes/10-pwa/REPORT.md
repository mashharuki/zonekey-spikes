# 10-pwa: 受取証明をネットなしで検証する PWA

確認: 2026-11-22。自動確認は Chrome for Testing 153.0.8010.12（Playwright 1.63）で実施。iPhone の実機確認は未実施（手順は下の「iPhone の実機確認の手順」）。
構成: create-lism minimal-vite の雛形（lism-css 1.1.0 / React 19.3.1 / Vite 6.4.6 / TypeScript 5.8.3）+ vite-plugin-pwa 2.0.0（Workbox 7.4、generateSW）+ jsQR 1.4.0
対象: S7 = spike 09（受け取りパック）と判断した（S2 = spike 04 と同じく「spike 番号 − 2」）。検証は spike 09 の `src/lib/verifier.ts` をそのまま読み込む。
取引の送信はしていない（tx hash なし）。サンプルは spike 09 の受け取りパック（live: [64D0B887F5…](https://testnet.xrpl.org/transactions/64D0B887F5F3D1504115642FBE3ADF81D99908FC3809883707D3CCB140958393)、S2: [90AD027004…](https://testnet.xrpl.org/transactions/90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C)）。

## 1. 結論

**一部合格**（自動で確かめられる部分はすべて合格。iPhone の実機確認は人が行う）

- Chrome でオフライン（DevTools の Offline と同じネットワーク条件のエミュレーション）にして、再読み込みから検証完了までできた。オフライン中のサーバーへのリクエストは **0 件**
- ファイル選択・QR を写した画像・アプリ内サンプルの 3 通りで、確定済みのパックは「確定済み」、1 ビット書き換えたものと署名なし（S2）は「不一致」と出た
- Chrome のインストール可否の判定でエラー 0 件（ホーム画面に追加できる）
- 初回に読み込むのは 17 ファイル・775 KiB（gzip 276 KiB）。検証画面を開いたときに追加で読むのは 381 KiB（gzip 122 KiB）で、Service Worker が事前に保存しているので 2 回目以降はネットから 0 バイト

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| manifest | 名前・アイコン・standalone | name「ZoneKey 受取証明チェッカー」/ short_name「受取証明」/ display standalone / アイコン 64・192・512・maskable 512 / apple-touch-icon 180 | `Page.getAppManifest` の errors: [] |
| ホーム画面に追加できるか（Chrome） | インストール可能 | ✅ `Page.getInstallabilityErrors` → []（通常のプロファイル） | results/offline-check.json の installability |
| Service Worker | 有効・ページを制御 | ✅ 制御中、キャッシュ `workbox-precache-v2` に 15 件 | 同 swController / precached |
| 事前保存の対象 | 画面と検証用コード | ✅ index.html・CSS・JS（遅延読み込みの検証画面を含む）・アイコン・manifest・サンプル。重複なし 15 件 | dist/sw.js の precache 一覧 |
| NetworkOnly | Privy・API・XRPL は保存しない | ✅ 3 ルール（`*.privy.io`、`/api/`、`rippletest.net`・`xrpl.org`・`ripple.com`）。オフラインでの fetch は 3 つとも「Failed to fetch」（キャッシュから返らない） | dist/sw.js の registerRoute / offline.networkOnly |
| 2 回目の訪問 | ネットに行かない | ✅ サーバーへのリクエスト 0 件 | secondVisit |
| オフラインで再読み込み | 画面が出る | ✅ サーバーへのリクエスト 0 件で表示 | offline.server |
| オフライン: ファイル選択（.bin） | 確定済み / 不一致 / 不一致 | ✅ 確定済み / 不一致 / 不一致 | offline の file:* |
| オフライン: QR を写した画像 | 同上 | ✅ 確定済み / 不一致 / 不一致（jsQR でバイトモードを読み、展開して検証） | offline の qrImage:* |
| オフライン: アプリ内サンプル | 同上 | ✅ 確定済み / 不一致 / 不一致（Service Worker のキャッシュから読む） | offline の sampleButton:* |
| 不一致の理由 | 段階ごとに出る | 書き換え: 「A: 対象の取引がヘッダの木に入っていない」/ 署名なし: 「C: パックに検証者の署名が入っていない」 | スクリーンショット results/offline-*.png |
| 検証にかかる時間（ブラウザ） | — | 約 25〜75 ms（1 件目が最も遅い） | 画面の「入力」行 |
| カメラでの QR 読み取り | 読める | 未確認（ヘッドレスの Chrome にカメラがない。iPhone の手順で確かめる） | — |
| iPhone（ホーム画面に追加 → 機内モード） | 同じことができる | 未確認（人が行う） | 下の手順 |

画面（オフラインで検証したところ）: results/offline-confirmed.png、results/offline-tampered.png、results/offline-no-signatures.png、iPhone の幅（390px）: results/offline-confirmed-390.png

### 5. 読み込むファイルの大きさ

サーバーは圧縮なしで配った。gzip は gzip -9 で圧縮した場合の目安。

| 場面 | ファイル | 大きさ（gzip） |
|---|---|---|
| 初回: 画面が出るまで | index.html・CSS・JS（React・Lism・workbox-window）・icon.svg・manifest・192px アイコン（7 件） | 316,563 B ≒ 309 KiB（99 KiB） |
| 初回: 続いて Service Worker が事前保存 | 15 件（上と重なる分を含む。検証画面の JS 381 KiB を含む）＋ sw.js・Workbox 本体 | 775,655 B + 17,665 B |
| **初回の合計（重複なし）** | 17 ファイル | **793,320 B ≒ 775 KiB（276 KiB）** |
| 初回の実測（HTTP キャッシュを使わない場合の上限） | 25 リクエスト。Service Worker が画面で読んだファイルも取り直すため重複する | 1,118,028 B |
| **検証画面を開いたとき（Service Worker なし）** | 遅延読み込みの検証画面の JS 1 件 | **390,427 B ≒ 381 KiB（122 KiB）** |
| 検証画面を開いたとき（Service Worker あり） | キャッシュから | ネットから 0 B |
| 2 回目以降の訪問 | キャッシュから | ネットから 0 B |

検証画面の JS の内訳（esbuild で同じ入口を minify して測った。React・Lism は共通部分にあるので除く。合計 381,741 B）:

| 中身 | バイト | 役割 |
|---|---|---|
| jsqr | 130,502 | QR の読み取り |
| ripple-binary-codec（＋ bignumber.js 18,450・@scure/base 13,421・ripple-address-codec 6,142・@xrplf/isomorphic 2,705） | 126,350（計 167,068） | **表示用**のデコード（取引の種類・受取人・額）。検証そのものには使っていない |
| @noble/curves・@noble/hashes | 41,908 + 17,075 | 署名の検証（secp256k1 / Ed25519）と SHA-512 |
| spike 09 の検証コード | 12,032 | A・B・C の手順 |
| 画面のコード | 6,281 | |
| 検証者リスト（VL とマニフェスト） | 5,725 | 信頼の起点（発行者鍵はコード内で固定） |

アイコン（PNG・SVG）には、作業環境から手元へファイルを移したときに C2PA（コンテンツの来歴）のメタデータが付き、1 ファイルあたり約 6 KB 増えている。上の数値はそれを含む。

## 3. エラー（そのまま）

自動確認ではエラーなし。開発中に出たもの:
- create-lism: `Error: Failed to download https://api.github.com/repos/lism-css/core/tarball/main: TypeError: fetch failed`（この作業環境から api.github.com に届かない。create-lism 0.10.1 と同じ処理を手で行った。手順はコミット d15512d のメッセージ）
- TypeScript: `Type '"span"' is not assignable to type 'ComponentType<any> | TextAllowedTag | undefined'`（Lism の `Text` は span にできない。`Lism as="span"` にした）

## 4. 設計への影響

- **ネットなしの受取確認は PWA で成り立つ。** 初回にネットがあるところで一度開けば、以後は画面・検証コード・検証者リストがすべて端末にある。被災地で配る前に「一度開いておく」手順が要る。
- **iPhone では「ホーム画面に追加」したアプリを、ネットがあるうちに一度開く。** ホーム画面のアプリは Safari と保存領域が分かれるとされている（実機で確かめる。手順 5）。Safari で開いただけでは、ホーム画面のアプリに Service Worker が入っていない可能性がある。
- **QR はアプリの中で読む。** パックはバイナリなので、iPhone の標準カメラで読んでも中身は渡せない。PWA の「カメラで QR を読む」（jsQR）か、QR を写した画像を選ぶ。
- **検証者リストはアプリに焼き込む。** VL の期限は 2027-08-07。期限切れや検証者の鍵の入れ替えのときは、`trust` で作り直して配信し直す（autoUpdate なので、次にネットにつながったときに新しい版に入れ替わる。オフラインのままなら古い版で動く）。
- **XRPL の通信は WebSocket（wss）なので Service Worker を通らない。** NetworkOnly のルールは HTTP（JSON-RPC・Faucet・Privy・自前 API）にだけ効く。WebSocket はそもそも保存されない。
- **軽くできる余地: 検証画面の JS の 44% は表示用のデコード、34% は QR 読み取り。** 表示に要るフィールドは spike 09 の STObject 読み取り器（stobject.ts）で読めるので ripple-binary-codec を外せば約 167 KB 減る。jsQR をカメラ・画像を使うときだけ読み込めば、ファイル選択だけの人はさらに 130 KB 減る。どちらも事前保存されるので、効くのは初回の通信量だけ。
- 画面右上の「オンライン / オフライン」表示（navigator.onLine）は、Playwright のオフラインのエミュレーションでは「オンライン」のままだった（通信は実際に止まっていた）。表示は目安で、判定には使っていない。

## 5. 分からなかったこと

- iPhone の実機での動作（ホーム画面に追加・機内モードでの起動・カメラの許可・QR の読み取り）。下の手順で人が確かめる。
- iOS が使っていないホーム画面アプリのキャッシュを消すかどうか、消すならいつか。
- カメラでの QR 読み取りの速さと、画面に映した QR（型番 31、1,764 B）を iPhone のカメラで読めるか。
- Android の Chrome での動作（今回は確かめていない）。

## Chrome（DevTools）での手動確認の手順

1. `pnpm --filter 10-pwa build` → `pnpm --filter 10-pwa preview`
2. Chrome で http://localhost:4173 を開く。右上が「オフライン可」になるまで待つ
3. DevTools → Application → Service workers が「activated and is running」、Manifest の Installability にエラーがない、Cache storage の `workbox-precache-v2-…` に 15 件あることを見る
4. DevTools → Network の「No throttling」を「Offline」にする
5. ページを再読み込み（Cmd+R）→ 画面が出る →「検証をはじめる」
6. 「確定済みのもの」→ 確定済み、「1 ビット書き換えたもの」→ 不一致、「署名なし（S2）」→ 不一致
7. 「ファイルを選ぶ」で `public/samples/confirmed.bin` と `samples-qr/confirmed.png` を選ぶ → どちらも確定済み
8. （任意）アドレスバーのインストールボタンで入れ、オフラインのまま起動して 5〜7 を繰り返す

## iPhone の実機確認の手順

Service Worker は HTTPS（または localhost）でしか動かないので、Mac の preview を HTTPS で公開して iPhone で開く。

準備（Mac）:
1. `pnpm --filter 10-pwa build` → `pnpm --filter 10-pwa preview`（http://localhost:4173）
2. 別のターミナルで `brew install cloudflared`（初回だけ）→ `cloudflared tunnel --url http://localhost:4173`
3. 表示された `https://….trycloudflare.com` の URL を控える（vite.config.ts で `*.trycloudflare.com` からの接続を許可済み）

iPhone（ネットあり）:
4. Safari で上の URL を開く。右上が「オフライン可」になるまで待つ
5. 共有ボタン →「ホーム画面に追加」→ 名前が「受取証明」、アイコンが緑の盾であることを見て「追加」
6. **ホーム画面のアイコンから一度開く**（ネットがあるうちに）。右上が「オフライン可」になるまで待つ。上にアドレスバーが出ない（standalone）ことを見る

iPhone（機内モード）:
7. コントロールセンターで機内モードをオン（Wi-Fi もオフ）
8. アプリを上にスワイプして終了 → ホーム画面のアイコンから開き直す → 画面が出ること
9. 「検証をはじめる」→「確定済みのもの」→ **確定済み**、「1 ビット書き換えたもの」→ **不一致**、「署名なし（S2）」→ **不一致**
10. Mac の画面に `samples-qr/confirmed.png` を大きく表示 →「カメラで QR を読む」→ カメラを許可 → QR に向ける → **確定済み**。`samples-qr/tampered.png` で **不一致**
11. （任意）AirDrop で `public/samples/confirmed.bin` を iPhone の「ファイル」に送り、「ファイルを選ぶ」で選ぶ → **確定済み**

記録すること: iOS のバージョン、手順 5・6・8〜11 の結果（できた / できなかった、出た文言）、カメラの許可がオフラインで出たか、手順 9・10 の画面のスクリーンショット。

## 根拠

- vite-plugin-pwa: https://vite-pwa-org.netlify.app/guide/ 、型定義 `vite-plugin-pwa/dist/index.d.ts`（2.0.0）
- Workbox の戦略（NetworkOnly）: https://developer.chrome.com/docs/workbox/modules/workbox-strategies
- Web App Manifest（display: standalone）: https://developer.mozilla.org/docs/Web/Manifest
- Service Worker は安全な文脈（HTTPS / localhost）でだけ動く: https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- create-lism 0.10.1（`dist/index.js` の minimal-vite の定義と postProcessTemplate）、lism-css/core 327ae98 の templates/minimal/vite
