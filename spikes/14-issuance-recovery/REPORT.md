# 14-issuance-recovery: 発券直後に通信が切れても元の券を使えるか

実施: 2026-11-27 / spike 13 を引き継ぐ。**Testnet 実測（8 ケース）＋ローカル試験（模擬ノード 1 本）**。RLUSD は使っていない（ZKV は発行者 V の合成トークン）。鍵の喪失と再発行・RLUSD 償還・複数レジの消込は対象外。

## 1. 結論

**条件付きで成立**

- 「承認直後に発券サービスが止まり、XRPL に届いたか分からない」状態から、同じ申請の再送・再起動で **発券記録 1 件・確定した EscrowCreate の成功 1 件（hash 1 種類）・使える券 1 枚** に収束した。最優先の「送信直後の応答喪失」（C2）を含め、Testnet の 8 ケースすべてが期待どおり。件数は DB ではなく、配布口座の validated 履歴をページ末尾まで読んで数えた（8 ケースすべて「確認済み」）。
- **この判断を変える最大の未確認事項: 「応答を受け取る前に」止まるケースを実際には作れていない。** C2 の停止位置は「ノードから `submit` の応答が届いた後・DB に書く前」。送信の途中（ソケットに書いたがノードに届いたか不明）で止まるケースは試していない。この復旧は同じ手順（hash で照会）で通るはずだが、実測していない。
- 他の未確認: 同一署名済みバイト列の**再送**（元取引がまだ成立し得る間の再送）は実装したが、Testnet では一度も通らなかった（照会だけで確定できたため）。単一ノード（公開 Testnet の 1 ノード）の履歴だけを根拠にしている。複数プロセスは同一マシン・同一 SQLite ファイル。

## 2. 何を作ったか

| 部品 | 内容 |
|---|---|
| `src/service.ts` | 発券サービス。spike 13 の検証（方針・公開入力の完全一致・本物の ZK 証明の検証・(制度, nullifier) の UNIQUE）を再利用し、送信を「署名済み取引を先に永続化 → 送信 → validated を照会して確定」にした。SQLite ファイル、WAL |
| `src/chain.ts` | 照会（`tx` を `min_ledger/max_ledger` 付きで呼び `searched_all` を記録、`account_tx` をページ末尾まで、`complete_ledgers` の連続性） |
| `src/worker.ts` | 別プロセスの発券ワーカー（`apply` / `recover`）。障害は環境変数 `FAULT` で注入 |
| `src/shop-offline.ts` | 別プロセスの店舗受付。fetch・ソケット・DNS・TLS を遮断してから spike 11c の `verifyVoucher` を呼ぶ |
| `src/run.ts` | Testnet 全ケースの実行（世帯端末・ワーカー起動・台帳の件数・店舗確認） |
| `src/local.ts` | 模擬ノードでのローカル試験（保留の判定） |
| 再利用 | 回路は変更なし（spike 13 の `eligibility_bound`）。`Zk`・`Roster`・申請ダイジェスト・`voucher/core.ts`・`voucher/shop.ts` をそのまま import |

### DB の構造（上書きで追跡不能にしない）

- `issuance`（1 申請 1 行・`UNIQUE(program_id, nullifier)`）と `attempts`（試行ごとに 1 行。hash・Sequence・LastLedgerSequence・署名済みバイト列・状態・送信回数・validated 結果・不成立の根拠）を分け、**試行は消さず追加だけ**。
- 発券記録と最初の試行（署名済み取引）を **1 つの `BEGIN IMMEDIATE` トランザクション**で保存。送信は COMMIT の後。
- `seq_alloc`: Sequence の採番。`UNIQUE(owner, sequence) WHERE state IN ('active','consumed')` の部分インデックスで、配布口座 D を共有する複数プロセスが同じ Sequence を持てない。失敗が確定して未消費の Sequence は `released` になり再利用される（欠番があると後続の取引が詰まるため）。
- `lease`: プロセス ID と期限で同一申請の処理を 1 プロセスに絞る。持ち主が死んでいれば引き継ぐ（`lease_taken_over`）。
- `events`: 状態遷移の履歴（プロセス ID つき）。

### 確定と再試行の規則（実装した判断）

1. **確定**: validated の取引結果が tesSUCCESS のときだけ。持ち主・宛先・資産・額面・期限・Condition・Memo の鍵ハッシュ・Sequence・Escrow ノードの作成を承認内容と照合。違えば `held`。
2. validated で見つからない間は**同じ署名済み取引**を使う（再送するなら同一バイト列）。1 回の未発見・`found だが validated=false` は失敗扱いにしない。
3. **不成立の確定**は次のどちらかのときだけ: (a) 検索範囲 [署名時の validated, 現在の validated] が `complete_ledgers` に連続して含まれ、hash が validated 履歴にないと言え、かつ `LastLedgerSequence` を越えた。(b) 上に加えて、その Sequence を**別の validated 取引が消費したこと**（hash 違い）を `account_tx` で特定できた（この場合は LastLedgerSequence の前でも確定）。根拠（範囲・searched_all・履歴の連続性・Sequence の消費元）は `attempts.evidence` に保存。
4. 根拠が足りなければ **`held`（保留）**。新しい試行を作らず、再起動・再実行で再評価する。
5. 不成立が確定し、申請の CancelAfter まで余裕（120 秒）があれば新しい試行（未消費なら同じ Sequence、消費済みなら新しい Sequence）。余裕がなければ `aborted`。

## 3. 障害の注入と再現方法

| 項目 | 方法 |
|---|---|
| プロセス停止 | ワーカーは `node --import tsx src/worker.ts` の**別プロセス**。注入位置（`FAULT`）に達したら、`events` に `FAULT_KILL` を書いた直後に `process.kill(process.pid, "SIGKILL")`。親（run.ts）は終了シグナル `SIGKILL` を観測して記録。再起動は新しいプロセスを起動 |
| 位置 `after_prepare` | 署名済み取引を保存して COMMIT した直後、送信前（C1） |
| 位置 `after_submit_response` | `submit` の応答がソケットに届いた直後、DB に書く前（C2）。**応答はノードから届いている**ので、ノードは取引を受理済み。「送信途中で止まる」ではない（1 節の未確認） |
| 位置 `after_validated_before_confirm` | validated 成功を照会で見た直後、確定の保存前（C3） |
| 未送信で停止 | `STOP_AFTER_PREPARE=1`（正常終了）。C5 は `LLS_OFFSET=2` で LastLedgerSequence を validated+2 にして、越えるまで待つ。C6 は未送信の間に、D の別の正規の Payment（D → 店、1 drop）を送って予定 Sequence を消費させる |
| 同時処理 | 同じ DB ファイルを開く 2 プロセスを `Promise.all` で同時に起動 |
| Testnet | 公開ノードは通常のまま。障害はクライアント側だけ |
| 世帯の再送 | C2 は同じ申請（同じ鍵・preimage）を**新しく作り直した証明**（バイト列は初回と別）で再送 |

## 4. ケース別の実測結果（Testnet）

台帳の件数は D の `account_tx` を [開始 ledger, 終了 ledger] でページ末尾まで読み、申請の Condition を持つ EscrowCreate を数えた。`complete_ledgers` は 16111〜（読んだ範囲はすべて連続）。全ケースで「成功 1 件・hash 1 種類・tec 等の失敗 0 件」。店舗は台帳から構成した同期データで確認し、店舗確認中の通信試行は**すべて 0 回**。生データ: `results/testnet.json`（署名済みバイト列・seed・preimage は含めていない）。

| ケース | 障害位置 | 送信試行 | Sequence | LastLedgerSequence | 成功 hash（validated ledger） | DB の推移 | 台帳の成功件数 | 店舗の判定 |
|---|---|---|---|---|---|---|---|---|
| C0 正常系 | なし | 1 | 40411 | 40994 | `26F4F0D4FAA139A548E7C6EC8C237D69663AE6D00FA762A709CCDAED5628DE83`（40976） | approved → prepared → submitting → confirmed | 1 | 元の鍵の QR: 使える |
| C1 送信前停止 | 保存後・送信前（SIGKILL） | 停止時 0 → 復旧後 1 | 40412 | 40997 | `701939A9CE1B6AE1476C91582D04786898DBE2406493E04DA15BACD40F9FAD02`（40979） | prepared（送信 0・台帳に取引なし）→ 再起動で submitting → confirmed | 1 | 使える |
| **C2 送信直後の応答喪失** | 応答受領後・DB 更新前（SIGKILL） | 1（再送なし） | 40413 | 41000 | `328BDE7D5F304138AF1469C5B7AE5461A3686AFFB5A905D5E1718F0643516841`（40982） | submitting（送信 1・結果不明）のまま停止 → 世帯の再送を新プロセスが受け、`apply_replay` → lease 引き継ぎ → tx 照会 2 回（1 回目は found・未 validated、2 回目は validated tesSUCCESS）→ confirmed | 1 | 使える |
| C3 確定後・DB 更新前停止 | validated 成功を観測した直後（SIGKILL） | 1（復旧で追加の送信なし） | 40414 | 41003 | `221F671BB08F3D89A6664E507F417BAB253324F602A086A008C9E20171AB792F`（40985） | submitting（発券記録は approved のまま）→ 照会だけで confirmed。試行 1 つ | 1 | 使える |
| C4a 同一申請を 2 プロセスで | なし（同時処理） | 1 | 40415 | 41006 | `7506EE8D4CF0B832B0C7DAC873D4E938882082DDC7FFBE967C51FCDFDF04DAAE`（40988） | プロセス A は lease で `in_progress` を返し、プロセス B が確定。試行 1 つ | 1 | 使える |
| C4b 異なる 2 申請・D 共有 | なし（2 プロセス） | 各 1 | 40416 / 40417 | 41010 / 41010 | `54E018F7EBB672AB23FEB383978610B13507811BA5AE5218EBC91891214F74A6`（40992）/ `13789C3AE22E33771449DCCB11A162680E1256874FB811D70A19665DF188B73C`（40992） | 2 件とも confirmed。確定 OfferSequence = 台帳上の Sequence（申請ごとに一致） | 各 1 | 2 枚とも使える。申請 1 の鍵・preimage で申請 2 の OfferSequence に署名した QR は `preimage が条件と合わない` |
| C5 有効 ledger 期限切れ | 保存後に未送信のまま LastLedgerSequence（40996）を越える | 旧 0 / 新 1 | 旧 40418 / 新 40418（同じ） | 旧 40996 / 新 41018 | 旧（不成立）`B20963E9734F6B27542487939FB33D584700709193800436EB5698A7AD27F5C0`、新（成功）`CA1A443B0C66D4EB23FFFD0F6D6CD963CB71F2390E501D5D46F9B3AF0AECF692`（41000） | 旧 prepared → `skip_submit_lls_passed`（送らない）→ failed_final → 新試行 → confirmed | 1 | 使える |
| C6 Sequence 競合 | 保存後・未送信の間に別の正規の取引が 40419 を消費 | 旧 1 / 新 1 | 旧 40419 / 新 **40420** | 41021 / 41023 | 競合: `2FECDDC7F345D7A796203E8CB00CE800DBA30ECBD241FC599D819F00AC2B6A94`（Payment、41003）。旧（不成立）`63D13FCF0FF1A5C1F7E8FEB83DE4F8730E7DFD9B5C24505D9731878488F537ED`。新（成功）`0F24AFA146735AA5678BEE98C869698D807402C1688306696836BAB7654EC21D`（41005） | 旧 prepared → 送信（tefPAST_SEQ）→ 照会 → failed_final → 新試行（再採番）→ confirmed | 1 | 元の鍵で**新しい OfferSequence** に署名した QR: 使える。旧 OfferSequence（40419）の QR: `このお店宛ての券ではない（または未同期）` |

### 各ケースの検証の根拠（抜粋）

- **C2（最優先）**: 停止直後の DB は `submitting`・送信回数 1・`last_engine_result` が null（応答を DB に残せていない）。再起動後、DB に保存してあった元の hash（40413 / `328BDE7D…6841`）で照会し、validated tesSUCCESS を確認して確定。**新しい Escrow も新しい署名もしていない**（試行 1 つ）。確定した成功 hash と最初の hash は同一。世帯の再送の証明は初回と別のバイト列だったが、(制度, nullifier)＋申請ダイジェストで同じ申請と判定され、新しい記録を作らなかった。
- **C3**: 復旧時の送信回数の合計は最初の 1 回のまま。DB の修復は `tx` 照会だけ。
- **C5**: 旧取引の不成立の根拠（`attempts.evidence`）: 範囲 [40994, 40998]、`complete_ledgers` 16111-40998、`tx` の `searched_all=true`、validated Sequence 40418（旧 Sequence は未消費）。最後にもう一度旧 hash を照会しても見つからない（`searched_all=true`）。Sequence が未消費だったので、新試行は同じ Sequence 40418 を再利用し、OfferSequence は変わらない。
- **C6**: 根拠は「validated Sequence が 40420 に進み、`account_tx`（[41001, 41003]、履歴 1 ページ）で Sequence 40419 の取引が別の hash（`2FECDDC7…B25B`、Payment・tesSUCCESS・ledger 41003）と特定できた」こと。その取引は元申請と無関係（種類が Payment・Condition なし）。LastLedgerSequence（41021）の前に確定。
- **C4b**: 2 プロセスが D の Sequence を取り合ったが、`seq_alloc` の部分 UNIQUE により 40416 / 40417 に分かれ、各申請の確定 OfferSequence が台帳上のその申請の EscrowCreate の Sequence と一致した（取り違えなし）。

## 5. ローカル試験（模擬ノード。Testnet ではない）

`results/local.json`（11 項目すべて期待どおり）。同じ `Service` を、履歴の欠落を作れる模擬のクライアントに繋いだ。

| 状況 | 期待 | 実際 |
|---|---|---|
| LastLedgerSequence 超過・`tx` が見つからず `searched_all=false` | 保留。新試行なし・送信なし | held / 試行 1 / 送信 0 |
| `searched_all=true` だが `complete_ledgers` に範囲内の穴 | 保留。新試行なし | held / 試行 1 |
| 履歴が連続し `searched_all=true` | 旧取引の不成立を確定 → 再試行 → 確定 | confirmed。試行は failed_final + validated_success、hash は別、模擬ノードで validated になった取引は 1 件、発券記録 1 件 |

保留（`held`）は Testnet では起きなかったため、実ノードでの保留の実測はない。

## 6. 実際に返ってきたエラーコード・観測した事実

| 種類 | 内容 |
|---|---|
| XRPL submit | C6 の旧取引の送信: **`tefPAST_SEQ`**（`applied: false`, `accepted: true`）。別の取引が Sequence を消費済みのため。tem は出ていない |
| XRPL 照会 | `tx` が `txnNotFound`＋`searched_all`（C5 の旧 hash は `true`）。tec は成功候補に出ていない（台帳の tec 失敗 0 件） |
| **`tx` の挙動（想定外）** | tefPAST_SEQ で拒否された取引でも、`tx` は **`found` かつ `validated=false` を返し続けた**（C6 の初回実装では 約 40 回（約 100 秒）照会しても同じ。LastLedgerSequence まで約 80 秒待つ設計だった）。「見つかった＝成立し得る」ではない。現在の実装は、validated 履歴に出るかで判断する（C6 の根拠はこの方法で作った） |
| SQLite | 複数プロセスが**同時に新しい DB を開く**と `database is locked`（errcode 5）で片方のプロセスが死んだ（C4b の初回実行で、発券記録 0 件で終了）。`busy_timeout` が効かないのは `journal_mode=WAL` 切り替えとスキーマ作成。`openDb` に再試行を追加して解消（以後の全実行は通過） |
| 実装の不具合（試験で発見） | 初回実装は、送信直後の最初の照会で「未 validated」だと、同じバイト列をすぐ再送していた（C0・C3 で送信回数が 2 になり失敗）。再送は 4 回目の照会ごとに変更。これは同じ hash の再送で二重 Escrow にはならない |

## 7. 設計への影響（06_技術設計）

1. **署名済み取引（hash・Sequence・LastLedgerSequence・バイト列）を、送信より先に、発券記録と同じトランザクションで保存する**。これで「送信前に止まった」「送信後に止まった」のどちらでも、同じ hash を照会できる（C1・C2）。
2. **確定は validated の照会だけ**。`submit` の応答や `found` は確定にしない（C6 で、拒否された取引が `found / validated=false` のまま残ることを観測）。
3. **不成立の確定には、検索範囲・履歴の連続性・Sequence の消費元の 3 点を保存する**。足りなければ保留にする。Sequence が他の取引に消費された場合は LastLedgerSequence を待たずに確定できる（C6）。
4. **Sequence の採番を DB の部分 UNIQUE で守る**。配布口座を複数プロセス・複数申請で共有しても取り違えない（C4b）。欠番を作らないよう、未消費で確定した Sequence は再利用する（C5）。ただし別の取引に消費されたときは **OfferSequence が変わる**ので、世帯端末は確定した OfferSequence で、最初の鍵を使って QR に署名し直す必要がある。それまでに配った QR は店で使えない（C6）。この「署名し直し」の導線（世帯端末が確定結果を取りに来る API）は設計していない。
5. 配布口座に**発券サービス以外の取引を流さない**運用にすると C6 は起きにくい。起きたときの復旧は上のとおり動く。
6. DB は SQLite の単一ファイルで動いたが、複数台・複数ノードになる場合は別の仕組みが要る（7 節の未確認）。

## 8. 分からなかったこと・実施できなかったこと

- **送信の途中で止まる**ケース（ノードに届いたか不明）: 未実施。C2 は応答受領後・DB 更新前の停止。
- **同一署名済みバイト列の再送**（`resubmit_same_blob`）: コードはあるが、Testnet の 8 ケースでは一度も実行されなかった（毎回、照会だけで確定できた）。ローカルの模擬試験でも通していない。再送が同一 hash であることは XRPL の仕様に依拠しているだけで、本実験の実測ではない。
- **保留（`held`）の実ノードでの再現**: 公開 Testnet ノードは履歴が 16111 から連続していて、`searched_all` も毎回 true だった。保留はローカルの模擬ノードでだけ確認した。
- **単一ノード・単一リージョン**: 照会はすべて同じ公開 Testnet ノードへ。別ノードの履歴が食い違う場合や、ノードが一時的に古い場合は未検証。
- **同一マシン・同一ファイルの SQLite**: 複数台のワーカー、ネットワーク越しの DB、ディスク障害は未検証。lease の生死判定は同一マシンのプロセス ID に依存している。
- **店舗確認はペイロードのバイト列**: QR 画像・カメラ・実機は使っていない。同期データは台帳から作ったが、店舗端末へ同期する通信は含まない。
- **ZK 証明の再利用**: C2 の再送は新しい証明を作った。同じ証明のバイト列の再送や、期限切れの root での再送は試していない。
- **Node のバージョン**: AGENTS は Node 26 以上だが、実行環境は v24.20.0（`node:sqlite` は動いた）。xrpl 5.3.0。
- 発券サービスの**悪意**（承認と違う内容で Escrow を作る）は対象外。確定時の照合は同じ DB の承認内容との突き合わせで、第三者の監査ではない。

## 9. 再実行

```bash
pnpm install
pnpm --filter 14-issuance-recovery test            # Testnet 全 8 ケース（数分。.env.local の V・D の seed が必要）
pnpm --filter 14-issuance-recovery test C2 C6      # 指定ケースだけ
pnpm --filter 14-issuance-recovery local           # 模擬ノードの保留試験（ネット不要）
```

状態は `.state/`（gitignore 済み。署名済みバイト列・世帯の preimage を含む）。結果は `results/`。
