# 04-voucher-escrow: RLUSD 裏付けの受給証で Escrow（条件付き・期限切れ返還）と 1:1 償還

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| ✅ ドナーの RLUSD 残高 | >= 0.3 | 0.7 | https://testnet.xrpl.org/accounts/rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh |
| 🔎 アカウント | - | V(発行者)=rL78UuDATjCUXaRt1xBunNG9qUB6uhRGg1<br>donor=rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh<br>ben=rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe<br>ben2=r3o7RYnUcM3HfHyCuxvtFs5eFfg6Y5zXVh<br>keeper=rnLhRMaLLdQ8QguFNWRvrjaU3yk8ihiHeP | シードは .env.local（V, ben）または使い捨て（keeper, ben2） |
| ✅ V: AccountSet asfDefaultRipple（8） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [64A1A7ADD86B09BDC4CA8AC1A9885EF2CD562E7539FAC0EF91B4C9956B79B0C3](https://testnet.xrpl.org/transactions/64A1A7ADD86B09BDC4CA8AC1A9885EF2CD562E7539FAC0EF91B4C9956B79B0C3) |
| ✅ V: AccountSet asfAllowTrustLineLocking（17） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E9E3E4E4FAC839140F7B7B1999C380270401A39A7FEEA50192B0BEA78B438A0D](https://testnet.xrpl.org/transactions/E9E3E4E4FAC839140F7B7B1999C380270401A39A7FEEA50192B0BEA78B438A0D) |
| ✅ V に lsfDefaultRipple と lsfAllowTrustLineLocking が立つ | Flags & 0x40800000 = 0x40800000 | Flags=1082130432（0x40800000） | account_info（validated） |
| ✅ V: RLUSD TrustSet | tesSUCCESS（validated） | tesSUCCESS / validated=true | [7F55163D22A2821F5EBF0AFCD1F509358DB81CA7CBA6F75D47F49345B4DF62EB](https://testnet.xrpl.org/transactions/7F55163D22A2821F5EBF0AFCD1F509358DB81CA7CBA6F75D47F49345B4DF62EB) |
| ✅ V: 発行オファー（受給証→RLUSD 1:1、残高 0 の発行者） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [D371D03F11E528BF71DA14EED3E6D757B890C4AE0998FA7226B1885E0C93D1C2](https://testnet.xrpl.org/transactions/D371D03F11E528BF71DA14EED3E6D757B890C4AE0998FA7226B1885E0C93D1C2) |
| ✅ donor: 受給証のトラストライン | tesSUCCESS（validated） | tesSUCCESS / validated=true | [11234FDE415A529033FBB10C3CAF78E4893DDFE2EACA2AFA1557DBAC3AE7D67A](https://testnet.xrpl.org/transactions/11234FDE415A529033FBB10C3CAF78E4893DDFE2EACA2AFA1557DBAC3AE7D67A) |
| ✅ donor: RLUSD 0.3 で受給証を購入（IoC） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [553E508BAB2FB77A970684CA4BA3111386C3CCB58D6F0377F41D739F23680A55](https://testnet.xrpl.org/transactions/553E508BAB2FB77A970684CA4BA3111386C3CCB58D6F0377F41D739F23680A55) |
| ✅ ドナー RLUSD の減少 | 0.3 | 0.3 | 0.7 → 0.4 |
| ✅ ドナー受給証の増加 | 0.3 | 0.3 | 0 → 0.3 |
| ✅ V の RLUSD 準備金の増加 | 0.3 | 0.3 | 0 → 0.3 |
| ✅ V: 償還オファー（RLUSD→受給証 1:1、tfPassive） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [5BF3B952CBF2A2DC19A9677D0CDC3B7E4BFFA939D168F774D7C62166030E286A](https://testnet.xrpl.org/transactions/5BF3B952CBF2A2DC19A9677D0CDC3B7E4BFFA939D168F774D7C62166030E286A) |
| ✅ 発行・償還オファーが両方板に残る（自己交差しない） | 両方あり | seq=22492483 gets=1000000 524C555344000000000000000000000000000000 pays=1000000 ZKV flags=0x00010000<br>seq=22492482 gets=999999.7 ZKV pays=999999.7 524C555344000000000000000000000000000000 flags=0x00000000 | account_offers（validated） |
| ✅ 準備金の一致（購入直後） | V の RLUSD = 保有者の受給証 + Escrow 中の受給証 | V RLUSD=0.3<br>保有者合計=0.3 / Escrow 中=0 | gateway_balances.obligations={"ZKV":"0.3"} |
| 🔎 gateway_balances に Escrow 中の受給証が含まれるか（購入直後） | 仕様に記載なし（実測） | obligations.ZKV=0.3 / 保有者合計=0.3 / 保有者+Escrow=0.3 | gateway_balances（validated） |
| ✅ ben: 受給証のトラストライン | tesSUCCESS（validated） | tesSUCCESS / validated=true | [6EC81999032E080547DD6551BCB1D81E28E4FD8A45BA5B9BC01441ACA7B7B338](https://testnet.xrpl.org/transactions/6EC81999032E080547DD6551BCB1D81E28E4FD8A45BA5B9BC01441ACA7B7B338) |
| ✅ ben の受給証ラインの発行者側に NoRipple が付かない | no_ripple_peer = false/なし | no_ripple_peer=undefined / no_ripple=undefined | account_lines（validated） |
| ✅ Escrow A 作成（受給証 0.1、PREIMAGE-SHA-256、CancelAfter 1 時間） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [DF971E8434FC207097F43534DFE55E774A8C184738623D07056DC5A89C9BF733](https://testnet.xrpl.org/transactions/DF971E8434FC207097F43534DFE55E774A8C184738623D07056DC5A89C9BF733) |
| ✅ 準備金の一致（Escrow A ロック中） | V の RLUSD = 保有者の受給証 + Escrow 中の受給証 | V RLUSD=0.3<br>保有者合計=0.2 / Escrow 中=0.1 | gateway_balances.obligations={"ZKV":"0.2"} |
| 🔎 gateway_balances に Escrow 中の受給証が含まれるか（Escrow A ロック中） | 仕様に記載なし（実測） | obligations.ZKV=0.2 / 保有者合計=0.2 / 保有者+Escrow=0.3 | gateway_balances（validated） |
| ✅ Escrow A: 誤った Fulfillment では完了できない | tecCRYPTOCONDITION_ERROR（validated） | tecCRYPTOCONDITION_ERROR / validated=true | [6CD1323D4C2DDA3FBA780F7989CB8EF795187638EBD623654D0709541A9C7704](https://testnet.xrpl.org/transactions/6CD1323D4C2DDA3FBA780F7989CB8EF795187638EBD623654D0709541A9C7704) |
| ✅ Escrow A: 第三者（keeper）が正しい Fulfillment で完了 | tesSUCCESS（validated） | tesSUCCESS / validated=true | [90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C](https://testnet.xrpl.org/transactions/90AD02700471CD53D255489446210E55E742973058C93F3E0428A86E1ACAEA8C) |
| ✅ ben の受給証の増加 | 0.1 | 0.1 | 0 → 0.1 |
| ✅ ben: 受給証 0.1 を RLUSD に償還（IoC） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [19FB65AF2F66DB1A90398C0173D7F6BA7329404A8C8D537B07C0FFFC2066FD5C](https://testnet.xrpl.org/transactions/19FB65AF2F66DB1A90398C0173D7F6BA7329404A8C8D537B07C0FFFC2066FD5C) |
| ✅ ben の RLUSD 増加（償還額） | 0.1 | 0.1 | 0 → 0.1 |
| ✅ ben の受給証残高 | 0 | 0 | 0.1 → 0 |
| ✅ 準備金の一致（A 償還後） | V の RLUSD = 保有者の受給証 + Escrow 中の受給証 | V RLUSD=0.2<br>保有者合計=0.2 / Escrow 中=0 | gateway_balances.obligations={"ZKV":"0.2"} |
| 🔎 gateway_balances に Escrow 中の受給証が含まれるか（A 償還後） | 仕様に記載なし（実測） | obligations.ZKV=0.2 / 保有者合計=0.2 / 保有者+Escrow=0.2 | gateway_balances（validated） |
| ✅ Escrow B 作成（CancelAfter 60 秒後） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [9A280A74978EC21FD826D00DA720E8C9272991CB778721CF8C375D4241CD02FA](https://testnet.xrpl.org/transactions/9A280A74978EC21FD826D00DA720E8C9272991CB778721CF8C375D4241CD02FA) |
| ✅ Escrow B: 期限前の取消は拒否される | tecNO_PERMISSION（validated） | tecNO_PERMISSION / validated=true | [A5C8DB65B9FC7392EAC48C6ADE0131185C46863FC657FB6A353A812BE174001C](https://testnet.xrpl.org/transactions/A5C8DB65B9FC7392EAC48C6ADE0131185C46863FC657FB6A353A812BE174001C) |
| 🔎 レジャー時刻が CancelAfter を超えた | > 848559631 | 848559632 | ledger（validated）.close_time |
| ✅ Escrow B: 期限後は正しい Fulfillment でも完了できない | tecNO_PERMISSION（validated） | tecNO_PERMISSION / validated=true | [8F62723AF671A0C5018FD62115095E0405B08A50C93A1275C4E7996621F28339](https://testnet.xrpl.org/transactions/8F62723AF671A0C5018FD62115095E0405B08A50C93A1275C4E7996621F28339) |
| ✅ Escrow B: 期限後に第三者（keeper）が取消 | tesSUCCESS（validated） | tesSUCCESS / validated=true | [B8B37351E57BB7F11740737694BD1959E9B912CFA638C73FD24F15D9D42DE140](https://testnet.xrpl.org/transactions/B8B37351E57BB7F11740737694BD1959E9B912CFA638C73FD24F15D9D42DE140) |
| ✅ ドナーへの返還（受給証） | 0.1 | 0.1 | 0.1 → 0.2 |
| ✅ Escrow C 作成（ben2 はトラストラインなし、受給証 0.05） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [D9C752E4785BC8E812241ACCF5E222EBDEC28E0E1C12296ED8DEEF74F93BDC03](https://testnet.xrpl.org/transactions/D9C752E4785BC8E812241ACCF5E222EBDEC28E0E1C12296ED8DEEF74F93BDC03) |
| ✅ Escrow C: 受取側が自分で完了するとトラストラインが自動作成されるか | XLS-85 は可能と記述（実測） | tesSUCCESS / ben2 受給証=0.05 | [4EA37AE52FBCD6637D944E9EDB6A80EC22008E6378605764AEFF3F4E678FFE53](https://testnet.xrpl.org/transactions/4EA37AE52FBCD6637D944E9EDB6A80EC22008E6378605764AEFF3F4E678FFE53) |
| ✅ ben2: RLUSD のトラストライン | tesSUCCESS（validated） | tesSUCCESS / validated=true | [C6F8484E0E49AE7F6B6D06F8084697D86E6FF9EE44D1D1CC444CB35122806950](https://testnet.xrpl.org/transactions/C6F8484E0E49AE7F6B6D06F8084697D86E6FF9EE44D1D1CC444CB35122806950) |
| ✅ ben2: 受給証 0.05 を償還 | tesSUCCESS（validated） | tesSUCCESS / validated=true | [83701C1B5C91C8389338F6EA1811985E1CB7F6E377618CADADB9A4E9752D6346](https://testnet.xrpl.org/transactions/83701C1B5C91C8389338F6EA1811985E1CB7F6E377618CADADB9A4E9752D6346) |
| ✅ ben2 の RLUSD | 0.05 | 0.05 | account_lines |
| ✅ donor: 残りの受給証 0.15 を RLUSD に戻す（返還分を含む） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [77345E8B124E654CAD3D9350CDB53EDE97F9F375577FB4DBF3E1490F261A189C](https://testnet.xrpl.org/transactions/77345E8B124E654CAD3D9350CDB53EDE97F9F375577FB4DBF3E1490F261A189C) |
| ✅ ドナーの RLUSD 増加 | 0.15 | 0.15 | account_lines |
| ✅ 準備金の一致（全償還後） | V の RLUSD = 保有者の受給証 + Escrow 中の受給証 | V RLUSD=0<br>保有者合計=0 / Escrow 中=0 | gateway_balances.obligations={} |
| 🔎 gateway_balances に Escrow 中の受給証が含まれるか（全償還後） | 仕様に記載なし（実測） | obligations.ZKV=なし / 保有者合計=0 / 保有者+Escrow=0 | gateway_balances（validated） |
| 🔎 V の RLUSD が 0 になったあと償還オファーは板に残るか | 仕様では未資金のオファーは処理中に見つかると削除（実測） | seq=22492482 gets=999999.7 ZKV pays=999999.7 524C555344000000000000000000000000000000 | account_offers。V RLUSD=0 |
| 🔎 検証終了時のレジャー時刻 | - | 848559681 | ledger（validated） |

## 3. 返ってきたエラーコード

- `Escrow A: 誤った Fulfillment では完了できない: tecCRYPTOCONDITION_ERROR`
- `Escrow B: 期限前の取消は拒否される: tecNO_PERMISSION`
- `Escrow B: 期限後は正しい Fulfillment でも完了できない: tecNO_PERMISSION`

## 4. 設計への影響

- RLUSD 発行者のフラグに依存せず、RLUSD 裏付けの受給証（自前発行・lsfAllowTrustLineLocking あり）でネイティブ Escrow の条件付き支給・期限切れ返還ができ、DEX の常設オファーで RLUSD と 1:1 に交換できた。06_技術設計の Escrow 資産を「RLUSD 直接」から「受給証（RLUSD 1:1 裏付け）」に置き換える案が成立する

## 5. 分からなかったこと

- 発行者 V の運営者は常設オファーを取り消せる（マスターキー無効＋マルチシグでの緩和は未検証）
- 1 回目の実機検証で作った旧発行者（rEhTGPAG…）には RLUSD 0.3 の準備金と未償還の受給証が残る（11/25 のリセットで消える）
- 11/25 の Testnet リセットで本検証のアカウント・残高・tx はすべて消える。tx hash の確認はリセット前に行う

<!-- generated: 2026-11-21T07:01:27.325Z -->
