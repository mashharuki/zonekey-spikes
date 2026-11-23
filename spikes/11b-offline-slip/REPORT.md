# 11b-offline-slip: オフラインの伝票（端末の鍵で署名し、お店がネットなしで確かめる）

確認: 2026-11-22。自動確認は Chrome for Testing 153.0.8010.12（headless、Linux x86_64、Playwright 1.63）。スマホの実機での QR の読み取りは 2026-11-23 に人が確認（手順は下）。
構成: spike 10 と同じ雛形（React 19 + Vite 6 + Lism CSS 1.1 + vite-plugin-pwa 2.0）。暗号は Web Crypto だけ（追加のライブラリなし）。QR は qrcode（表示）と jsQR（読み取り）。
台帳には触れていない（tx なし）。入力にした Check は 11a 確認 1 の Check（CheckID `BBE0A3C0…37F3`、SendMax 受給証 0.5）。

## 1. 結論

**合格**（自動で確かめられる項目はすべて期待どおり。スマホのカメラでの QR の読み取りも人が確認した。任意の確認 6 の Safari は未確認）

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| ✅ 1. 世帯の鍵が取り出せない | exportKey が InvalidAccessError | pkcs8・jwk とも `InvalidAccessError`（key is not extractable）。IndexedDB から読み直したあとも同じ、extractable=false | results/slip-check.json の exportBeforeReload / exportAfterReload |
| ✅ 1. 公開鍵の SHA-256 を表示（InvoiceID に入れる値） | 表示される | `14A1DF91…C66A`（世帯の PWA の鍵） | 画面の「公開鍵の SHA-256」 |
| ✅ 2. オフラインで伝票の作成・QR 表示 | 作れる | 番号 1・合計 0.2、208 バイト、QR 型番 9、署名 0.3 ms | slip1 |
| ✅ 2. お店がオフラインで QR（画像）を読んで確認 | 受け付け | 受け付け（a InvoiceID ✅・b 署名 ✅・c 上限 ✅・c 期限 ✅・d 初回）、確認 0.6 ms | A_receive_slip1_qr |
| ✅ 2. 通信の試み | 0 回 | アプリの画面・伝票の処理による通信: **0 件**（外部宛ても 0 件）。ただしブラウザ自身の Service Worker 更新確認（`Service-Worker: script` 付きの sw.js 取得 5 回と Workbox 本体 1 回）は、Playwright のオフライン化をすり抜けてサーバーに届いた | offline_server_requests / offline_external_requests |
| ✅ 3. 改ざん: 合計額を 1 ビット変えた伝票 | 不一致 | 不一致（b: 署名が正しくない） | tamper_total_1bit |
| ✅ 3. 改ざん: 別の鍵で署名した伝票（公開鍵はもとのまま） | 不一致 | 不一致（b: 署名が正しくない） | tamper_other_key_signature |
| ✅ 3. 改ざん: InvoiceID と合わない公開鍵の伝票（別の世帯が自分の鍵で正しく署名） | 不一致 | 不一致（a: 公開鍵が Check の InvoiceID と合わない） | tamper_pubkey_not_invoiceid |
| ✅ 3. 参考: 同じ伝票をもう一度見せる | 不一致 | 不一致（d: 番号・合計額が前の伝票より大きくない） | replay_same_slip_to_A |
| ✅ 3. 参考: お店 A 宛ての伝票をお店 B に見せる | 不一致 | 不一致（宛先が別のお店。a〜d とは別に足した確認） | slip_for_A_shown_to_B |
| ✅ 4. 二重払い: 番号を戻し、同じ番号 1・違う額（0.4）の伝票をお店 B に出す | お店 B はオフラインでは受け付ける（想定どおり） | 受け付け。続けて番号 2・合計 0.5 も受け付け | B_receive_slip1dup_offline / B_receive_slip2 |
| ✅ 4. 精算スクリプトが二重払いを見つけ、証拠を出す | 見つける | 二重払い 1 件（番号 1: お店 A 合計 0.2 / お店 B 合計 0.4）。両方の伝票・署名・公開鍵を出力。どちらも署名は世帯の鍵で正しい | results/settlement.json の doubleSpends |
| ✅ 4. 精算額が SendMax を超えない | ≤ 0.5 | 請求の合計 0.7 → **精算 0.5**（上限ちょうど）。お店 A: 請求 0.2・支払い 0.2 / お店 B: 請求 0.5・支払い 0.3・**損 0.2** | settlement.json の payouts / byShop |
| ✅ 参考: 上限を超える伝票を世帯の画面が作らない | 作らない | 「合計 0.6 が上限 0.5 を超える」で止まった | household_refuses_over_sendmax |
| 🔎 5. 大きさ・QR | 1 枚に入るか | ECDSA P-256: 伝票 79 + 署名 64 + 公開鍵 65 = **208 バイト、QR 型番 9**（誤り訂正 L）。Ed25519: 79 + 64 + 32 = **175 バイト、型番 8** | slip1 / ed25519 |
| 🔎 5. 署名と確認の時間（50 回の平均） | - | ECDSA P-256: 署名 0.038 ms・確認 0.064 ms / Ed25519: 署名 0.028 ms・確認 0.044 ms（Chrome 153 headless、Linux x86_64） | timing |
| ✅ 5. スマホの画面からの読み取り | 読める | 読み取れた（人による確認。端末名・OS・読み取りにかかった手間は記録していない） | 人による確認の報告（2026-11-23） |
| ✅ 6. 任意: Ed25519 | Chrome で動く | 鍵の作成・署名・お店での確認まで動いた（受け付け）。Safari は未確認 | ed25519 |
| 🔎 PWA | 事前保存 | 15 件・541 KiB（画面・世帯・お店・QR の読み書きのコード） | vite-plugin-pwa のビルドログ |

伝票の形式（この検証で決めたもの。`src/slip/format.ts`）:
`"TODOKE-SLIP-v1\0"`（15）‖ CheckID（32）‖ 通し番号 UInt32（4）‖ ここまでの合計額 UInt64（8、受給証 0.000001 を 1 とする整数）‖ お店の ID（16）‖ 時刻 UInt32（4、Unix 秒）= 79 バイト。
QR = 伝票 ‖ 署名（64、r‖s）‖ 公開鍵（P-256 は非圧縮 65、Ed25519 は 32）。InvoiceID = SHA-256(公開鍵の生バイト)。

**入力の Check について:** 11b は台帳に触れないので、世帯の PWA の鍵を InvoiceID に入れた Check は台帳に作っていない。お店の Check 一覧は「CheckID・SendMax は 11a 確認 1 の実在の Check、InvoiceID は世帯の PWA の鍵の値、期限は 30 日後」に差し替えた試験用（results/checks.json に明記）。11a 確認 1 の実物は、InvoiceID が 11a のテスト鍵（秘密鍵は捨てた）の値で、すでに換金済み・期限切れ。InvoiceID が台帳の Check に残ること自体は 11a 確認 1 で確認済み。

精算の規則（この検証で決めたもの。`scripts/settle.ts`）: 伝票ごとの額は「同じ流れの直前の伝票との差」、お店が受け取った時刻の順に SendMax まで払い、超えた分はそのお店の損。

## 3. 返ってきたエラー（そのまま）

- 秘密鍵の書き出し: `InvalidAccessError: Failed to execute 'exportKey' on 'SubtleCrypto': key is not extractable`（pkcs8・jwk とも。期待どおり）
- 不一致の理由はお店の画面の文言（上の表）。XRPL の tec/tem/tef はない（台帳に触れていない）

## 4. 設計への影響

- **お店はオフラインで、何を確かめられて、何を確かめられないか:** 確かめられるのは「Check に結び付いた鍵（InvoiceID）の持ち主が、改ざんされていない伝票に署名したこと・合計が上限以下で期限内であること・このお店に対して番号と合計額が増えていること・自分宛てであること」。確かめられないのは「ほかのお店に同じ番号の伝票を出していないか（二重払い）」「世帯の受給証の残高があるか（Check はお金を確保しない。11a 確認 4）」「その Check がまだ台帳にあるか（換金・取消済みでないか）」「伝票の時刻が正しいか（世帯の端末の時計）」。
- **二重払いがあったときの損は、Check の上限までに収まるか:** 精算口座が引く額（＝支援元側の出費）は Check の上限までに収まる（今回: 請求 0.7 → 精算 0.5）。ただし**お店側の損は上限で抑えられない。** 各店はオフラインでそれぞれ上限まで受け付けられるので、n 店に二重払いされると、お店全体の損は最大で (n − 1) × SendMax になる。また世帯が受給証をよそへ移していれば、回収できる額はさらに減る（11a 確認 4）。ピッチで言えるのは「精算口座の出費の上限は Check の上限」「1 店あたりの損の上限は、その店が受け付けた額」まで。
- 1 店あたりの損を小さくするには、Check の上限を小さくする（1 回の買い物ぶん程度）、お店ごとに受け付ける上限を伝票の確認に足す、オンラインになったお店から順に伝票を共有して早く二重払いを止める、のどれか。どれも 06_技術設計の「オフライン払い」に書き足す。
- 伝票は 208 バイト（QR 型番 9）と小さく、署名・確認はミリ秒未満。オフライン払いの重さは問題にならない。
- 鍵は Privy ではなく端末の Web Crypto（取り出せない鍵、IndexedDB に保存）。**端末を替えたり保存領域が消えたりすると鍵を失い、その Check では払えなくなる**（新しい鍵で Check を作り直す必要がある。台帳での手続きはオンライン）。

## 5. 分からなかったこと

- スマホでの確認の細部（端末名・OS、どちらの画面の QR を何で読んだか、画面に出た署名・確認の時間）は記録していない
- Safari（iPhone）で ECDSA P-256 と Ed25519 の取り出せない鍵を作り、IndexedDB に保存できるか。iOS がホーム画面のアプリの IndexedDB を消す条件（消えると鍵を失う）
- Check の期限切れ（確認 c の期限）は、伝票の時刻の比較としてコードにはあるが、期限切れの Check で試していない
- お店の端末どうしの時計のずれが、精算の順番（受け取った時刻の順）にどう効くか
- 精算の規則（時刻の順に払う）は 1 つの案。公平さ（先に受け付けた店が守られる）以外の案は比べていない

## スマホでの確認の手順（実機）

spike 10 と同じく、Mac の preview を HTTPS で公開する（Service Worker とカメラは HTTPS が必要）。

1. Mac: `pnpm --filter 11b-offline-slip build` → `pnpm --filter 11b-offline-slip preview` → 別のターミナルで `cloudflared tunnel --url http://localhost:4173`
2. 世帯のスマホ: 表示された https の URL に `#/household` を付けて開く →「鍵を作る」→「Check 一覧を書き出す」で checks.json を保存し、AirDrop などでお店側へ送る
3. お店（もう 1 台のスマホ、または Mac）: 同じ URL に `#/shop` を付けて開く →「Check 一覧を取り込む」で checks.json を選ぶ
4. 両方とも右上が「オフライン可」になったら、両方を機内モードにする
5. 世帯: 「お店の QR をカメラで読む」でお店の画面の QR を読む → 額を入れて「伝票をつくる」→ QR が出る
6. お店: 「カメラで QR を読む」で世帯の画面の QR を読む → **受け付け**。同じ QR をもう一度読む → **不一致**
7. 記録: 端末名と OS、手順 5・6 の成否、画面に出た「署名 … ms」「確認 … ms」

## 根拠

- MDN SubtleCrypto.exportKey（取り出せない鍵は InvalidAccessError）: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey
- MDN SubtleCrypto.sign（ECDSA の署名は r‖s、Ed25519）: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign
- MDN Structured clone algorithm（CryptoKey は保存できる型）: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
- Ed25519 の対応（Chrome 137 から既定で有効、Safari 17.0 から）: https://blogs.igalia.com/jfernandez/?p=1950 、https://caniuse.com/mdn-api_subtlecrypto_generatekey_ed25519
- 11a の REPORT（Check の InvoiceID・資金を移されたときの精算・Batch）: ../11a-check-settle/REPORT.md
