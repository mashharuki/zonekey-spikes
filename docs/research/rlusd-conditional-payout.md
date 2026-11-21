# RLUSD のまま「期限付き・条件付き・返還あり」を実現する方法の調査

調査日: 2026-11-21 / 対象: XRPL Testnet（ハッカソン提出先）

## 0. 結論（先に）

- **RLUSD をネイティブ Escrow に入れることは、Testnet でも Mainnet でも現時点ではできない。**
  - Token Escrow（XLS-85）は、Trust Line Token の発行者が `lsfAllowTrustLineLocking`（0x40000000）を立てていることを要求する。立っていなければ `EscrowCreate` は `tecNO_PERMISSION`。
  - Testnet 発行者 `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`: Flags `0x819A0000`（01-preflight で取得）。`EscrowCreate` が実際に `tecNO_PERMISSION`（03-rlusd-escrow、tx `ABD56ECD…5030`）。
  - Mainnet 発行者 `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`: Flags `2174353408`（= `0x819A0000`、Testnet と同値）。xrpscan の公開 API で確認。コードからは Mainnet に接続していない。
  - Ripple が有効化する予定は、公式資料では見つからなかった。サードパーティ（AgentTrust）も「Ripple がフラグを立てるのを待っている」と書いている。
- **同じ壁に当たったチームは実在する**（後述 §3）。多くは「自前発行トークンで代替」か「協調的な返金（オフチェーン）」に後退している。
- **有力な代替は、RLUSD を 1:1 で裏付けた「受給証トークン」を Escrow し、DEX の常設オファーで RLUSD に償還する方式（方式 A）**。ロック・条件・期限切れ返還はネイティブ Escrow、入出金は RLUSD、償還はオンレジャーで、オフチェーンの判断を挟まない。**2026-11-21 に実 RLUSD で実機検証し合格**（§4、spikes/04-voucher-escrow）。

## 1. 重要な外部要因: 11/25 の Testnet リセット

- xrpl.org 公式告知: Testnet と Devnet を **2026-11-25（水）にリセット**。全レジャーデータ（アカウント、残高、トークン、AMM、Escrow）が消える。
- リセット後、Testnet の amendment 状態は Mainnet に合わせて復元される。Network ID と URL は変わらない。
- RLUSD の Testnet 発行者が再作成されるか、どのフラグで作られるかは告知に記載なし。
- 時刻は告知本文に記載なし。報道では 5〜6 PM PT（= 11/26 10:00〜11:00 JST 前後）。
- **影響**: `DONOR_SEED` / `BENEFICIARY_SEED` のアカウントと 1 RLUSD は消える（シードは残るので Faucet で再作成可）。RLUSD の貯め始めはリセット後にやり直し。リセット後に 01-preflight を再実行し、発行者のフラグと amendment を確認し直す。

## 2. XRPL のプリミティブ別: RLUSD で使えるか

| 機能 | RLUSD で使えるか | 資金はロックされるか | 期限 | 返還 | Testnet で使えるか | 出典 |
|---|---|---|---|---|---|---|
| Token Escrow（XLS-85） | **不可**（発行者フラグなし） | される | CancelAfter | EscrowCancel で送り手へ | amendment は有効 | EscrowCreate, XLS-85 |
| Checks | 可（SendMax に IOU 可） | **されない**（換金時に残高確認） | Expiration（期限後は誰でも取消可） | 自動返還ではない（そもそも動いていない） | 可 | Checks, CheckCreate |
| Payment Channel | 不可（XRP のみ） | される | あり | あり | — | Payment Channels |
| Single Asset Vault（XLS-65） | 資産として IOU 可。シェアは MPT（公開 Vault のシェアは CanEscrow 付き、という第三者解説あり） | Vault に預託 | なし | なし | **不可**（Mainnet 未有効。Testnet は Mainnet に合わせる） | Single Asset Vaults, Zenn(tequ) |
| DEX オファー | 可 | **されない** | Expiration 任意 | — | 可 | Offers |
| Smart Escrow | — | — | — | — | 開発中（Devnet） | Known Amendments |

補足:
- Checks は「期限付きの引き出し権」は表現できるが、資金がロックされないので、送り手が先に使ってしまえば換金できない。
- Vault のシェアを Escrow する案（rival.finance が XLS-65/66/85 で実装例あり）は筋が良いが、Vault が Testnet で使えないため今回は不可。

## 3. 先行事例（同じことをしようとした人）

- **theFastandtheFungible PR #340**: 公式 Testnet RLUSD を使用。「発行者フラグに AllowTrustLineLocking がないので token escrow は拒否される。RLUSD の escrow は送っていない」「返金は協調的な返金で、レジャー強制の取消ではない」と明記。
- **maokner/agent-pledge Issue #1**: Testnet RLUSD が手に入らなければ、自前の発行者でトークンを出し、`allowTrustLineLocking` を立ててネイティブ Token Escrow を見せる、という保険を計画。
- **Jalil-g/XRLP-Hack PR #94**: Devnet で「RLUSD」名の IOU による条件付き Escrow の作成・完了・取消を実施（自前発行と思われる。ページは取得制限で未確認）。期限切れ後の EscrowFinish は `tecNO_PERMISSION`、受取側にトラストラインが無いと `tecNO_LINE`、などの実測あり。
- **AgentTrust（cryptovault.co.uk）**: ロードマップに「RLUSD のネイティブ Escrow は Ripple が発行者フラグを立てる必要がある。立てたらすぐ有効化する」。
- **MortgageOS（vanfwilson）**: 「RLUSD の発行者がトラストラインのロックを許可していないので RLUSD は Escrow できない」ため、決済資産を自前の USD MPT にした。

## 4. 実現方式の候補

### 方式 A: RLUSD 裏付けの受給証トークンを Escrow し、DEX で 1:1 償還（推奨候補・要検証）

構成:
1. プログラム用の発行アカウント V を作る。V は `lsfAllowTrustLineLocking` を立て、RLUSD のトラストラインを持つ。マスターキー無効＋マルチシグ（運営・監査）。
2. V は DEX に 2 つの常設オファーを置く。
   - 発行: 受給証を売り、RLUSD を受け取る（1:1）。発行者は自分のトークンを残高に関係なくオファーで発行できる。
   - 償還: RLUSD を売り、受給証を受け取る（1:1）。V の RLUSD 残高が原資。
3. ドナーは RLUSD で受給証を買い（発行オファーを約定）、世帯ごとに条件付き Escrow（PREIMAGE-SHA-256 + CancelAfter）を作る。
4. 閾値到達で keeper が EscrowFinish（Batch で一斉）。受取側は受給証を償還オファーで RLUSD に換える。
5. 期限切れは EscrowCancel で受給証がドナーに戻り、ドナーは償還オファーで RLUSD に戻す。

得るもの:
- ロック・条件・期限・返還はネイティブ Escrow のまま。入金も最終受取も RLUSD。
- 「V の RLUSD 残高 = 流通している受給証の総量」をレジャー上で誰でも確認できる（準備金の可視化）。
- ドナー層ごとに受給証の通貨コードを分ければ、層別の追跡もレジャー上で完結する。

失うもの・前提:
- 受給証という中間トークンが入る。審査で「RLUSD で決済」と言えるかは主催者確認が要る。
- V の運営者は償還オファーを取り消せる（マルチシグで緩和。脅威モデルに明記が必要）。
- 受取側は受給証と RLUSD の両方のトラストラインが要る（準備金 0.2 XRP × 2）。

検証すべきこと（スパイク 04）:
- 自前発行者で `asfAllowTrustLineLocking` を立てる（AccountSet のフラグ値はリファレンスで確認）。
- 受給証の Escrow 作成・完了・期限切れ取消。
- 発行者自身の常設オファーで、RLUSD ⇄ 受給証が 1:1 で約定するか（DEX の自動ブリッジや丸めで端数が出ないか）。

### 方式 A の実機検証結果（2026-11-21、spikes/04-voucher-escrow）

**合格（38 項目すべて pass）。** 実 RLUSD（Testnet 発行者 rQhWct…）で、購入 → 条件付き Escrow → 完了 → RLUSD へ 1:1 償還、期限切れ → 取消 → 返還 → 償還まで通った。tx hash は REPORT.md（11/25 のリセットで消えるので、それまでに Explorer で確認）。

分かったこと:
- **発行者は、保有者がトラストラインを張る前に asfDefaultRipple を立てる必要がある。** 立てずに作った 1 回目は、償還（受給証 → RLUSD）だけが tecKILLED / tecPATH_DRY になった。板には資金付きの償還オファーがあり、book_offers でも約定可能量 0.3 と見えていたのに使えなかった。保有者ラインの発行者側に NoRipple が付いていたのが原因で、外すと通った（EXPERIMENT.md）。発行方向（RLUSD → 受給証）は NoRipple でも通る非対称な挙動。
- 発行者自身の RLUSD ラインは NoRipple のままでよい（2 回目は付けたまま合格）。
- 発行オファー（通常）と償還オファー（tfPassive）を同じ発行者が 1:1 で置いても、自己交差しない。
- Escrow 中の受給証は gateway_balances の obligations に**含まれない**。準備金の証明は「RLUSD 準備金 = obligations + Escrow 中の額」で示す。
- 受取側にトラストラインが無くても、受取側自身が EscrowFinish すればトラストラインが自動作成されて受け取れる。第三者（keeper）が完了する場合は事前にトラストラインが要る（XLS-85 の記述どおり）。
- 発行者の RLUSD が 0 になると償還オファーは板から消える（全償還後に発行オファーだけが残った）。運用では、償還オファーの再設置を keeper の仕事に入れる。
- 期限前の EscrowCancel、期限後の EscrowFinish はともに tecNO_PERMISSION。誤った Fulfillment は tecCRYPTOCONDITION_ERROR。

残る課題:
- 発行者の運営者は常設オファーを取り消せる（マスターキー無効＋マルチシグで緩和。未検証）。
- お題の「RLUSD で決済」に受給証方式が当てはまるかは主催者確認が要る。

### 方式 B: 保管口座（マルチシグ）＋ Checks

- 割当ごと、またはプログラムごとの保管口座に RLUSD を置き、マスターキーを無効にして、オラクルの 2-of-3 を SignerList にする。
- 受給資格が確定したら、保管口座から受益者宛てに Check（SendMax = RLUSD、Expiration）を発行し、受益者が期限内に換金する。
- 得るもの: RLUSD のまま。受益者側の期限はレジャーで強制される。
- 失うもの: Check は資金をロックしないので、保管口座から他に出ていけば換金できない（マルチシグで緩和）。期限切れ後のドナーへの返金は、自動ではなく署名者の取引になる。

### 方式 C: 主催者・Ripple に確認（最優先・低コスト）

- 事実（Testnet・Mainnet とも `0x819A0000`、`tecNO_PERMISSION` の tx）を添えて質問する。
- リセット後に Testnet 発行者が再作成されるタイミングで設定が変わる可能性もあるので、リセット後に 01-preflight を再実行する。

### 採らない方向

- XRPL EVM サイドチェーンの RLUSD（ERC-20）でスマートコントラクトの Escrow を書く: お題が「XRPL プロトコルを使用し XRPL Testnet 上にデプロイ」としているため対象外の可能性が高い。Testnet 版の RLUSD の有無も未確認。
- Xahau Hooks: 別ネットワークなので同上。

## 5. 次のアクション

1. 主催者・Ripple への質問を送る（方式 C）。
2. スパイク 04（方式 A の検証）。11/25 のリセットで消えるので、リセット前は検証のみ、データは残さない前提で進める。
3. 11/26 以降に 01-preflight を再実行し、発行者フラグと amendment を確認し直す。

## 出典

- XRPL: Escrow（概念） https://xrpl.org/docs/concepts/payment-types/escrow
- XRPL: EscrowCreate https://xrpl.org/docs/references/protocol/transactions/types/escrowcreate
- XLS-85 Token-Enabled Escrows https://xls.xrpl.org/xls/XLS-0085-token-escrow.html
- XRPL: Checks https://xrpl.org/docs/concepts/payment-types/checks
- XRPL: CheckCreate https://xrpl.org/docs/references/protocol/transactions/types/checkcreate
- XRPL: Payment Channels https://xrpl.org/docs/concepts/payment-types/payment-channels
- XRPL: Single Asset Vaults https://xrpl.org/docs/concepts/tokens/single-asset-vaults
- XRPL: Offers https://xrpl.org/docs/concepts/tokens/decentralized-exchange/offers
- XRPL Blog: Upcoming Testnet and Devnet Resets https://xrpl.org/blog/2026/testnet-devnet-reset
- Ripple: RLUSD on the XRP Ledger https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl
- xrpscan API（Mainnet RLUSD 発行者） https://api.xrpscan.com/api/v1/account/rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De
- theFastandtheFungible PR #340 https://github.com/Collaboration95/theFastandtheFungible/pull/340
- maokner/agent-pledge Issue #1 https://github.com/maokner/agent-pledge/issues/1
- Jalil-g/XRLP-Hack PR #94 https://github.com/Jalil-g/XRLP-Hack/pull/94
- AgentTrust Roadmap https://www.cryptovault.co.uk/roadmap/
- MortgageOS https://github.com/vanfwilson/xrpl-mortgage-tokenizing-htm
- rival.finance https://github.com/abaresks24/rival.finance
- Zenn: XRP Ledger の Single Asset Vault 機能 https://zenn.dev/tequ/articles/xrpl-single-asset-vault
- 第三者による Testnet RLUSD 入手条件の記述 https://github.com/justmoon/dassie/pull/244
