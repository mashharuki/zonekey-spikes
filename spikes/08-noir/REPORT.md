# 08-noir: 資格証明の Noir 回路（UltraHonk）計測

計測日時: Node 2026-11-22T03:12:21.010Z / ブラウザ 2026-11-22T03:12:55.255Z

## バージョン

| 部品 | バージョン |
|---|---|
| Noir コンパイラ（nargo） | 1.0.0+275d3ab1a5c916c6ea73e8d6b943f685f574500c |
| @noir-lang/noir_js | 1.0.0 |
| bb.js（UltraHonk） | @aztec-foundation/bb.js 6.0.0（同梱の bb 6.0.0。旧名 @aztec/bb.js は 5.x で止まり改名された） |
| verifierTarget | noir-recursive（ZK あり・Poseidon2。検証は台帳外の keeper とブラウザ） |
| 計測機 | darwin/arm64, Apple M1 Pro, 10 スレッド, 16 GB, Node v24.20.0 |
| ブラウザ | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36（crossOriginIsolated=true, hardwareConcurrency=10） |

bb の CLI は入れていない（bbup のインストールが実行環境で許可されなかった）。ゲート数は bb.js の `circuitStats` で取った。

## 1. 結論

**合格**

- 正しい入力で証明が作れ、Node（native / wasm）で検証が通った: はい
- 各制約を 1 つずつ破った入力で証明が作れず、狙った制約で止まる（nargo test 13 件 + noir_js の execute 8 件）: はい

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| 回路の大きさ | — | ACIR 138 opcodes / ゲート 1363（2の冪 2048） | circuitStats |
| 証明のバイト数 | — | 14656 B（14.3 KiB）＋公開入力 15 個 × 32 B = 480 B | ProofData |
| 検証鍵のバイト数 | — | 3680 B（3.6 KiB）、生成 17.4 ms | getVerificationKey |
| [native] 初期化 | — | 103.2 ms | Barretenberg.new |
| [native] 1件目 execute / prove | 計測 | 2.1 ms / 73.8 ms | 初回（VK 生成後） |
| [native] 2件目以降 prove | 計測 | 平均 60.5 ms（最小 55.7 / 最大 75.5、n=5） | 5件 |
| [native] 100 件を順に | 計測 | 合計 7010.6 ms（1件 70.1 ms） | execute + prove |
| [native] 検証（VK 事前） | 計測 | 平均 5.2 ms（最小 5.1 / 最大 5.8、n=10） | UltraHonkVerifierBackend |
| [native] 検証（VK 毎回再計算） | 計測 | 平均 26.1 ms（最小 16.1 / 最大 45.9、n=3） | UltraHonkBackend.verifyProof |
| [native] 改ざんした公開入力を拒否 | true | true | acct を書き換え |
| [native] 最大メモリ | 計測 | Node 360 MiB / 子プロセス 43 MiB | RSS を 200ms ごとに採取 |
| [wasm] 初期化 | — | 634.6 ms | Barretenberg.new |
| [wasm] 1件目 execute / prove | 計測 | 2 ms / 141.5 ms | 初回（VK 生成後） |
| [wasm] 2件目以降 prove | 計測 | 平均 103.6 ms（最小 100.1 / 最大 105.1、n=5） | 5件 |
| [wasm] 100 件を順に | 計測 | 合計 10282.8 ms（1件 102.8 ms） | execute + prove |
| [wasm] 検証（VK 事前） | 計測 | 平均 18.6 ms（最小 16.3 / 最大 30.2、n=10） | UltraHonkVerifierBackend |
| [wasm] 検証（VK 毎回再計算） | 計測 | 平均 49.7 ms（最小 40.2 / 最大 64.2、n=3） | UltraHonkBackend.verifyProof |
| [wasm] 改ざんした公開入力を拒否 | true | true | acct を書き換え |
| [wasm] 最大メモリ | 計測 | Node 822 MiB / 子プロセス 12 MiB | RSS を 200ms ごとに採取 |
| [ブラウザ] wasm 初期化 | — | noir 20.6 ms / bb 632.7 ms | initACVM+initNoirC / Barretenberg.new |
| [ブラウザ] 検証（VK 事前） | true | 平均 35.7 ms（最小 28.3 / 最大 66.5、n=10）、すべて true | Node で作った証明 |
| [ブラウザ] 証明 1件目 | 計測 | execute 4.2 ms / prove 172.9 ms | wasm |
| [ブラウザ] 証明 2件目以降 | 計測 | 平均 115.8 ms（最小 110.1 / 最大 121.5、n=2） | wasm |
| [ブラウザ] wasm（Noir: acvm + noirc_abi） | 計測 | 3.66 MiB | PerformanceResourceTiming（Vite 開発サーバーは無圧縮） |
| [ブラウザ] wasm（bb.js） | 計測 | 展開後 17.43 MiB（barretenberg-threads.js に gzip+base64 で埋め込み。JS 5.18 MiB、gzip 配信なら 3.87 MiB） | パッケージを静的に計測（data: URL なので資源一覧に .wasm として出ない） |
| [ブラウザ] wasm 合計（展開後） | 計測 | 21.09 MiB | 上 2 行の和 |
| [ブラウザ] CRS のダウンロード | 計測 | 4 リクエスト。サイズは取れない（別ドメインで Timing-Allow-Origin がなく 0 と出る）。参考: Node のキャッシュ ~/.bb-crs は 196.00 MiB | crs.aztec-labs.com |

### 制約を破った入力（noir_js の execute）

| ケース | 期待する止まり方 | 期待どおり止まった | メッセージ |
|---|---|---|---|
| 根が違う | `merkle root mismatch` | true | `Circuit execution failed: merkle root mismatch` |
| 別アカウント（acct だけ差し替え） | `merkle root mismatch` | true | `Circuit execution failed: merkle root mismatch` |
| ゾーンが対象外 | `zone not in zone_set` | true | `Circuit execution failed: zone not in zone_set` |
| 高齢者が必要なのに senior=false（根は作り直し） | `senior required` | true | `Circuit execution failed: senior required` |
| 再被災が必要なのに revictim=false（根は作り直し） | `revictim required` | true | `Circuit execution failed: revictim required` |
| 区分が足りない | `tier below min_tier` | true | `Circuit execution failed: tier below min_tier` |
| nullifier が違う | `nullifier mismatch` | true | `Circuit execution failed: nullifier mismatch` |
| 別プログラムの nullifier | `nullifier mismatch` | true | `Circuit execution failed: nullifier mismatch` |

### ブラウザで読み込んだ wasm

| ファイル | 展開後 | 転送 |
|---|---|---|
| acvm_js_bg.wasm | 2978.8 KiB | 2978.8 KiB |
| noirc_abi_wasm_bg.wasm | 771.1 KiB | 771.1 KiB |

## 3. エラーコード（そのまま）

なし（制約違反時のメッセージは上の表のとおり）

## 4. 設計への影響

### デモ中に証明を作れるか、事前に作っておくべきか

**デモ中に作れる。** ただし bb の初期化（wasm の展開と CRS の取得）に 632.7 ms かかるので、ボタンを押してからではなくページを開いた時点で済ませておく。ブラウザ（wasm）で 1 件目 172.9 ms、2 件目以降 平均 115.8 ms で、目安の 10 秒以内。初回に読み込む wasm は展開後で 21.09 MiB。またデモ機の回線・CPU で変わるので、本番デモでは事前に作った証明を 1 件用意しておき、失敗したらそれに切り替える。

- keeper（Node）側の検証は VK を事前に持てば 1 件 5.2 ms。`UltraHonkBackend.verifyProof` は毎回 VK を作り直すので 26.1 ms かかる。keeper は VK を起動時に 1 回だけ作るか、ファイルで持つ。
- 100 件の一括作成（native）は 7010.6 ms。受給者名簿を事前に処理する用途なら問題ない大きさ。
- verifyProof が true でも「何かの公開入力で正しい」だけ。keeper は root・program_id・zone_set・need_*・min_tier を自分の状態から組み立てて、証明の公開入力と一致するかを必ず比べる。nullifier は使用済み一覧と照合する。

### 回路の注意点（レビューで見つけたこと）

- zone_set を 8 個未満で使うときは、0 ではなく有効なゾーンの重複で埋める（0 で埋めると zone=0 の葉が通る）。
- nullifier と Merkle の内部ノードがどちらも 2 入力の Poseidon2。今の形でも衝突は現実的でないが、本番ではドメイン分離の定数を先頭に入れる。
- acct が公開入力なので、同じ人の証明はプログラムをまたいでつながる。送金先を隠す設計ではない。

## 5. 分からなかったこと

- bb CLI での `bb gates` / `bb prove` の数値（CLI を入れられなかった）。
- native バックエンドの子プロセスのメモリは ps の RSS の最大値で、共有メモリの数え方は OS 依存。
- モバイル端末の実機での時間。実機で測るには Vite を LAN に公開する必要があり、http では crossOriginIsolated にならず単一スレッドになる。
- ブラウザの bb 初期化の時間は、同じ Mac の 1 回目の計測（2026-11-22T03:04、DevTools のモバイル表示）では 3747.8 ms で、今回の 2 回目は 632.7 ms だった。差は CRS や wasm のキャッシュの有無と見られるが、切り分けていない。デモ機では初回訪問で数秒かかる前提にする。
- bb.js は証明・VK 生成に必要な CRS（共通参照文字列）を crs.aztec-labs.com から取る。Node は ~/.bb-crs にキャッシュする。会場の回線が使えないときに備え、デモ機で一度実行してキャッシュを作っておく必要がある。
- Testnet は使っていない（この検証は台帳とは無関係）。
