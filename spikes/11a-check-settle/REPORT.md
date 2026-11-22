# 11a-check-settle: 受給証の Check・Privy のゆるいロック・Batch での精算

## 1. 結論

合格

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
| --- | --- | --- | --- |
| 🔎 準備: Testnet | - | rippled 3.4.1 / 準備金 1 XRP + 0.2 XRP/件 / 基本手数料 0.00001 XRP | server_info |
| 🔎 準備: 口座 | - | S=rQDnLqPzrH9yuyFWVdxfBuopn8xS7u4fBY<br>V=rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh<br>H1=rLcnf4tmAVye2YwGSi8AmSY1jN8LCDKJYL（受給証 1.0）<br>T（第三者）=rUmHE72sttaXmS63bsiMu4wVoSMVQVN1CN<br>H3〜H10=rMJH3FHVqSktGPE8aRvu153591UEgDgpwV, rwRjExJFa5qeKicMYbLVksCeUrG2QGDBVd, rLEDdHgME3phvPAgLh7nWw8MSsG3hf7QvN, rNWsojQvhRcr5TziUXUPu9uyjiSyTtmwAg, rDQ96HRma6Uwg5gBEmhX8udJBS15CzvfSn, rLzXzgW6xqGp1rAFweiKAoXWhUZmwfKrGo, r3vKqqfu9nVktcifVw8uuxZ42gd6Sx7VVC, r4mybnTgRBZUk6Zz5DtCmVSDXPwpuKtEEy（受給証 0.2 ずつ） | 世帯の受給証は V から直接配った（本番は Escrow の払い出し）。S・V の seed は .env.local |
| ✅ 確認1: H1 → S CheckCreate（SendMax 受給証 0.5、Expiration 30 分、InvoiceID） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [472905FC5D85C3BFBF227FA343E427716E1D0427E2673FD1FE837A2E274398A2](https://testnet.xrpl.org/transactions/472905FC5D85C3BFBF227FA343E427716E1D0427E2673FD1FE837A2E274398A2) |
| ✅ 確認1: 台帳の Check に InvoiceID が残る（account_objects） | D31D5F9DB787040901A56F2E47CDCF7C11598C3AC139DCC0645D46DF12E6318E | D31D5F9DB787040901A56F2E47CDCF7C11598C3AC139DCC0645D46DF12E6318E | CheckID=BBE0A3C03064E1600B1F01C351B93E5B92B831CAA2C95FBDD71C97D3664B37F3<br>伝票の公開鍵（P-256 非圧縮 65 B）=0449b6e0e777aa2ee27f… |
| ✅ 確認1: H1 の OwnerCount | 1 増える | 1 → 2 | account_info |
| ✅ 確認2: S が CheckCash（Amount 0.2） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [562BAE2D9105C7F280BE703C996B5CFB6AAE45DD49FAD8A80EC94FA973A2B169](https://testnet.xrpl.org/transactions/562BAE2D9105C7F280BE703C996B5CFB6AAE45DD49FAD8A80EC94FA973A2B169) |
| ✅ 確認2: 上限 0.5 のうち 0.2 だけ換金したあと、Check は台帳から消えるか | 消える（rippled CheckCash.cpp: 成功したら額にかかわらず erase） | 消えた（残りの 0.3 も引けなくなる） | ledger_entry / account_objects |
| 🔎 確認2: 受給証の残高 | H1 −0.2 / S +0.2 | H1 1 → 0.8<br>S 1 → 1.2 | account_lines |
| ✅ 確認2: 同じ CheckID でもう一度 CheckCash | tecNO_ENTRY（validated） | tecNO_ENTRY / validated=true | [377D278875033F830B96DFD09F6588FCE8EEA7FC5BB01A70BCF0B811CA10E82F](https://testnet.xrpl.org/transactions/377D278875033F830B96DFD09F6588FCE8EEA7FC5BB01A70BCF0B811CA10E82F) |
| ✅ 確認3 準備: 新しい Check（SendMax 0.3） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [6B437A00BD4F7FC86E55DAC603F5E44551B9C000AACD9881B94D8A96C6670676](https://testnet.xrpl.org/transactions/6B437A00BD4F7FC86E55DAC603F5E44551B9C000AACD9881B94D8A96C6670676) |
| ✅ 確認3: Amount 0.4 で CheckCash（上限 0.3 を超える） | tecPATH_PARTIAL（validated） | tecPATH_PARTIAL / validated=true | [8A7B162F6529933FA349DF5290FA1F1B8FC5B55FCF0CE3EB2B3FA06319ECAA15](https://testnet.xrpl.org/transactions/8A7B162F6529933FA349DF5290FA1F1B8FC5B55FCF0CE3EB2B3FA06319ECAA15)。期待は rippled 3.4.1 CheckCash.cpp（value > sendMax）による |
| 🔎 確認3: 失敗後も Check は残るか | 残る（xrpl.org: 換金に失敗したら Check は残る） | 残っている | ledger_entry |
| ✅ 確認4 準備: 新しい Check（SendMax 0.5） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [35CCA05B1E7656272C48167BE6BBE0D004875A92DF77B1362ED934AA1DA105C9](https://testnet.xrpl.org/transactions/35CCA05B1E7656272C48167BE6BBE0D004875A92DF77B1362ED934AA1DA105C9) |
| ✅ 確認4 準備: H1 が受給証 0.7 を T へ移す（残高を 0.1 に） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E41A642C707F9E539E9863CF3C7B30FD2FFBEA20BD9C41C935B3C50451562885](https://testnet.xrpl.org/transactions/E41A642C707F9E539E9863CF3C7B30FD2FFBEA20BD9C41C935B3C50451562885) |
| 🔎 確認4: H1 の受給証残高 | 0.1 | 0.8 → 0.1 | account_lines |
| ✅ 確認4: Amount 0.3 で CheckCash（H1 の残高 0.1） | tecPATH_PARTIAL（validated） | tecPATH_PARTIAL / validated=true | [0C2006D2410844EDDEACE52417719994F42CF93285BD0DD1A53BC5D162271146](https://testnet.xrpl.org/transactions/0C2006D2410844EDDEACE52417719994F42CF93285BD0DD1A53BC5D162271146)。期待は rippled CheckCash.cpp（value > 送り手の残高）による |
| 🔎 確認4: 失敗後も Check は残るか | 残る | 残っている（期限まで再試行できる） | ledger_entry |
| ✅ 確認4: DeliverMin 0.05 で CheckCash | tesSUCCESS（validated） | tesSUCCESS / validated=true | [A9193F70266C55AF2F9481092712617191625D3D972BE8EF04C2C38BE6688841](https://testnet.xrpl.org/transactions/A9193F70266C55AF2F9481092712617191625D3D972BE8EF04C2C38BE6688841) |
| 🔎 確認4: 届いた額（delivered_amount） | 送り手の残高ぶん（0.1） | {"currency":"ZKV","issuer":"rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh","value":"0.1"} | [A9193F70266C55AF2F9481092712617191625D3D972BE8EF04C2C38BE6688841](https://testnet.xrpl.org/transactions/A9193F70266C55AF2F9481092712617191625D3D972BE8EF04C2C38BE6688841)。H1 の残高 0、Check は 消えた |
| ✅ 確認5 準備: Check（Expiration 90 秒後） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [20E2C1272C63AD36984C3C2C377E2A53180CDB1F7A62F56C82BE410F7C072F3E](https://testnet.xrpl.org/transactions/20E2C1272C63AD36984C3C2C377E2A53180CDB1F7A62F56C82BE410F7C072F3E) |
| 🔎 確認5: 期限が過ぎるまで待つ | - | Expiration=848662232 / 検証済みレジャーの close_time=848662240 | ledger |
| ✅ 確認5: 期限後に S が CheckCash | tecEXPIRED（validated） | tecEXPIRED / validated=true | [62431FF39929BA4307623DEECE21EBA7C59089B06AC06B5010ACAB691390BA27](https://testnet.xrpl.org/transactions/62431FF39929BA4307623DEECE21EBA7C59089B06AC06B5010ACAB691390BA27) |
| ✅ 確認5: 無関係の第三者 T が CheckCancel | tesSUCCESS（validated） | tesSUCCESS / validated=true | [BFFC2756CCF003E0F9CBA2338DB598976E3F0EE3BF4B738750A6462176E8D947](https://testnet.xrpl.org/transactions/BFFC2756CCF003E0F9CBA2338DB598976E3F0EE3BF4B738750A6462176E8D947) |
| 🔎 確認5: 取消後の Check | 消える | 消えた | ledger_entry |
| ✅ 確認6 準備: H3 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [4CD51904C37D524892F743B133F6E51500A1A16AF378FC30C3725D9DB5A26EB4](https://testnet.xrpl.org/transactions/4CD51904C37D524892F743B133F6E51500A1A16AF378FC30C3725D9DB5A26EB4) |
| ✅ 確認6 準備: H4 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E445255D13C56CB8D5D80E182582FEB75C04926AD6975BD632B94218D1D8FD6D](https://testnet.xrpl.org/transactions/E445255D13C56CB8D5D80E182582FEB75C04926AD6975BD632B94218D1D8FD6D) |
| ✅ 確認6 準備: H5 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [5A607ABFE5B0092B3B0DB7EDF8CFD29A907BFD7D13AB85D5102944D3115E8E41](https://testnet.xrpl.org/transactions/5A607ABFE5B0092B3B0DB7EDF8CFD29A907BFD7D13AB85D5102944D3115E8E41) |
| ✅ 確認6 準備: H6 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [2FB9E9DF8862A4EC9A022912F929652C625DD5B79E4CABD9FF49694A02447589](https://testnet.xrpl.org/transactions/2FB9E9DF8862A4EC9A022912F929652C625DD5B79E4CABD9FF49694A02447589) |
| ✅ 確認6 準備: H7 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [32D78EBC028D502B4271E6F7B11932E712220FC432EEFB9E046D4046DCF30F63](https://testnet.xrpl.org/transactions/32D78EBC028D502B4271E6F7B11932E712220FC432EEFB9E046D4046DCF30F63) |
| ✅ 確認6 準備: H8 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [383022D51CF139E034A230F9681C42CD07B14A89B58799E92490718096392F51](https://testnet.xrpl.org/transactions/383022D51CF139E034A230F9681C42CD07B14A89B58799E92490718096392F51) |
| ✅ 確認6 準備: H9 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [FA33E668ECFCED455D7A282FC45556469326FB5DD492FF69D9A804F77F16B8F5](https://testnet.xrpl.org/transactions/FA33E668ECFCED455D7A282FC45556469326FB5DD492FF69D9A804F77F16B8F5) |
| ✅ 確認6 準備: H10 → S CheckCreate（SendMax 0.1） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [4448F20F2CB700536B45F8B768C3E68490C8A45DABD66848072619DC72FC694C](https://testnet.xrpl.org/transactions/4448F20F2CB700536B45F8B768C3E68490C8A45DABD66848072619DC72FC694C) |
| ✅ 確認6 準備: H5 が受給証 0.2 を T へ移す（5 件目の Check を引けなくする） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [5C2636096D09209E3F59BA6A967836C1629D17F85395AE533607E8A427FA9222](https://testnet.xrpl.org/transactions/5C2636096D09209E3F59BA6A967836C1629D17F85395AE533607E8A427FA9222) |
| ✅ 確認6: S が CheckCash 8 件を Batch（tfIndependent）で送る: 外側 | tesSUCCESS | tesSUCCESS / Fee=100 drops（計算式 10×2 + Σ内側(10+10+10+10+10+10+10+10) = 100）/ XRP 残高差=-100 drops | [F1A4BF2EF560B4E9C9FC7AFD3AD185F22969A12C445BC94791547B3BEBEBD460](https://testnet.xrpl.org/transactions/F1A4BF2EF560B4E9C9FC7AFD3AD185F22969A12C445BC94791547B3BEBEBD460) |
| 🔎 確認6: 内側 #1（H3） | tesSUCCESS | tesSUCCESS | [6284F19299588447271F96EA8B976AD6010F72F5EF4D8B45F8F7B074ECDB149F](https://testnet.xrpl.org/transactions/6284F19299588447271F96EA8B976AD6010F72F5EF4D8B45F8F7B074ECDB149F)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #2（H4） | tesSUCCESS | tesSUCCESS | [46A8BAFD62434C3F0D62FC942A5D79F1F957E755B8352C20349153278578E22A](https://testnet.xrpl.org/transactions/46A8BAFD62434C3F0D62FC942A5D79F1F957E755B8352C20349153278578E22A)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #3（H5） | 失敗（資金を抜いた） | tecPATH_PARTIAL | [3941CE767FEB9A0406ED4A10ED980B8B6A538ABC0B1BB3C786DA3C25B8185413](https://testnet.xrpl.org/transactions/3941CE767FEB9A0406ED4A10ED980B8B6A538ABC0B1BB3C786DA3C25B8185413)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #4（H6） | tesSUCCESS | tesSUCCESS | [9BE36D4B4A60CE2EBFC6685A92A95864165E30ABA51F6849A2A67AEF3DD8376C](https://testnet.xrpl.org/transactions/9BE36D4B4A60CE2EBFC6685A92A95864165E30ABA51F6849A2A67AEF3DD8376C)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #5（H7） | tesSUCCESS | tesSUCCESS | [D700653F5B38E452084839D576FFBBDDDA3D7B6B94B27642C75535377188699B](https://testnet.xrpl.org/transactions/D700653F5B38E452084839D576FFBBDDDA3D7B6B94B27642C75535377188699B)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #6（H8） | tesSUCCESS | tesSUCCESS | [EE5D92395DA1812960938BC92123B6C21FA1DDCBCAC6CEB93CD30185651D2FB6](https://testnet.xrpl.org/transactions/EE5D92395DA1812960938BC92123B6C21FA1DDCBCAC6CEB93CD30185651D2FB6)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #7（H9） | tesSUCCESS | tesSUCCESS | [8106E670656D2BFB24679804884361199E66E83A9321491B26C1CC8F09FFECA9](https://testnet.xrpl.org/transactions/8106E670656D2BFB24679804884361199E66E83A9321491B26C1CC8F09FFECA9)（ParentBatchID: 外側と一致） |
| 🔎 確認6: 内側 #8（H10） | tesSUCCESS | tesSUCCESS | [CEEB2E9894239B67BAAD322B508F81A229110886880A5C1D7089C8A74AAACA34](https://testnet.xrpl.org/transactions/CEEB2E9894239B67BAAD322B508F81A229110886880A5C1D7089C8A74AAACA34)（ParentBatchID: 外側と一致） |
| ✅ 確認6: 内側の結果 | 7 件成功・1 件（#3 = H5）失敗 | 成功 7 件 / 失敗 #3 tecPATH_PARTIAL | S の受給証 1.3 → 2 |
| ✅ 確認8: DONOR → S RLUSD の CheckCreate（SendMax 0.01） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [38E75ADD387B67C5A7EEEB4BBF08E73C16D69A089413AA89CA82862D143702D7](https://testnet.xrpl.org/transactions/38E75ADD387B67C5A7EEEB4BBF08E73C16D69A089413AA89CA82862D143702D7)。DONOR=rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh（H1 は RLUSD を持たないため spike 02 の DONOR から送った） |
| ✅ 確認8: S が RLUSD の CheckCash（換金前の S の RLUSD トラストライン: あり） | tesSUCCESS（Escrow と違い lsfAllowTrustLineLocking は不要。トラストラインが無ければ CheckCash が作る: rippled CheckCash.cpp） | tesSUCCESS / 換金後の S の RLUSD: あり（残高 0.02） | [8672BA96ACE898CA5B70EBE8EE9DA59F2A4E0365CD010FB0534DF049001F30F4](https://testnet.xrpl.org/transactions/8672BA96ACE898CA5B70EBE8EE9DA59F2A4E0365CD010FB0534DF049001F30F4) |
| 🔎 確認7: 口座 | - | H2（Privy のユーザー所有）=r3FDUiRWkL37BUs1iWPCgPb4Fdu8w56KJA（wallet_id=z7p6ean7oppmzkitcrvuvgir）<br>S=rQDnLqPzrH9yuyFWVdxfBuopn8xS7u4fBY / V=rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh<br>付いていたポリシー=["ddtu31yobf77rugg7yaodyxr"] | wallets().list |
| ✅ 確認7 準備: H2 のポリシーを外す（本人の JWT で） | policy_ids=[] | policy_ids=[] | wallets().update + user_jwts |
| ✅ 確認7 準備: H2 の受給証トラストライン（Privy で署名） | 署名される → tesSUCCESS | 署名された → tesSUCCESS | [863719506B3746DA8510BA07DE5B0EF906094CF81283483A3139818843561836](https://testnet.xrpl.org/transactions/863719506B3746DA8510BA07DE5B0EF906094CF81283483A3139818843561836) |
| ✅ 確認7 準備: V → H2 受給証 1.0 | tesSUCCESS（validated） | tesSUCCESS / validated=true | [390B53460D0DB74EF7DCA9A95A848BBEC3B106B9D5DF53A9C51F5DC1167C6C2E](https://testnet.xrpl.org/transactions/390B53460D0DB74EF7DCA9A95A848BBEC3B106B9D5DF53A9C51F5DC1167C6C2E) |
| ✅ 確認7a: H2 → S CheckCreate（SendMax 0.5）を xrpl_signTransaction で署名して送る（ポリシーなし） | 署名される → tesSUCCESS | 署名された → tesSUCCESS | [46061FC3ADF43F447FC8F55C7FE3957E1AF1B1222B46F65AB62CD9D8B86611DE](https://testnet.xrpl.org/transactions/46061FC3ADF43F447FC8F55C7FE3957E1AF1B1222B46F65AB62CD9D8B86611DE) |
| 🔎 確認7 準備: ゆるいロックのポリシー | - | policy_id=hp8ydaboqfp1hhuh9tvfs5x5<br>DENY: Payment かつ Payment.Amount.currency=ZKV<br>ALLOW: TrustSet（ZKV / V）だけ。それ以外は既定で拒否 | policies().create |
| 🔎 確認7b: TransactionType = CheckCreate の ALLOW ルール | 作れる？（spike 07 では 4 種類以外は invalid_policy_format。今のドキュメントは作れるように読める） | 作れない: 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"} | policies().createRule |
| ✅ 確認7c 準備: ゆるいロックを H2 に付ける（本人の JWT で） | policy_ids に入る | policy_ids=["hp8ydaboqfp1hhuh9tvfs5x5"] | wallets().update + user_jwts |
| ✅ 確認7c(1): 受給証の Payment（H2 → S 0.1） | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction（送信なし） |
| ✅ 確認7c(2): CheckCancel（7a の Check） | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction（送信なし） |
| ✅ 確認7c(3): OfferCreate（受給証 0.1 を XRP に） | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction（送信なし） |
| ✅ 確認7c(参考): 新しい CheckCreate（S 以外の宛先へ） | ポリシーで拒否される | 拒否: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"} | xrpl_signTransaction（送信なし） |
| ✅ 確認7d: ポリシーを付けたまま、S が H2 の Check を CheckCash（Amount 0.2） | tesSUCCESS（validated） | tesSUCCESS / validated=true | [E4C1E0096199AF101E5CF2712896ABCBB2C92F567DF3F95009D6B6BFC0FDE062](https://testnet.xrpl.org/transactions/E4C1E0096199AF101E5CF2712896ABCBB2C92F567DF3F95009D6B6BFC0FDE062)。Check は 消えた |
| 🔎 確認7 後片付け: H2 のポリシーを元に戻す | ["ddtu31yobf77rugg7yaodyxr"] | ["ddtu31yobf77rugg7yaodyxr"] | wallets().update + user_jwts |

## 3. 返ってきたエラーコード

- `確認2: 同じ CheckID でもう一度 CheckCash: tecNO_ENTRY`
- `確認3: Amount 0.4 で CheckCash（上限 0.3 を超える）: tecPATH_PARTIAL`
- `確認4: Amount 0.3 で CheckCash（H1 の残高 0.1）: tecPATH_PARTIAL`
- `確認5: 期限後に S が CheckCash: tecEXPIRED`
- `確認6 内側 #3: tecPATH_PARTIAL`
- `確認7b: 400 {"error":"Validation error: Condition value must be a supported XRPL transaction type (Payment, OfferCreate, OfferCancel, TrustSet) for the 'TransactionType' field at \"value\"","code":"invalid_policy_format"}`
- `確認7c(1): 受給証の Payment（H2 → S 0.1）: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認7c(2): CheckCancel（7a の Check）: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認7c(3): OfferCreate（受給証 0.1 を XRP に）: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`
- `確認7c(参考): 新しい CheckCreate（S 以外の宛先へ）: 400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}`

## 4. 設計への影響

**問われた 3 つへの答え**

- **Check の上限で、精算口座が引ける額を抑えられるか:** 抑えられる。上限（SendMax）を超える換金は `tecPATH_PARTIAL` で失敗する（確認 3）。ただし換金に成功すると、額にかかわらず Check は台帳から消える（上限 0.5 のうち 0.2 だけ換金すると、残りの 0.3 はもう引けない。確認 2）。**1 つの Check で精算できるのは 1 回だけ**なので、精算はその Check で受けた伝票をまとめて 1 回で行う。
- **資金を移されたときに精算がどう失敗し、何が台帳に残るか:** 世帯の残高が足りないと、精算の CheckCash は `tecPATH_PARTIAL` で失敗し、**Check は台帳に残る**（期限までは引き直せる）。`DeliverMin` を指定すると、**残っていた残高ぶん（今回は 0.1）だけを回収できる**（確認 4）。Batch（tfIndependent）では、資金を抜かれた 1 件だけが失敗し、ほかの 7 件の精算は止まらない（確認 6、手数料 100 drops = 10×2 + 10×8）。お店の損は「伝票の合計 − 回収できた額」で、上限は Check の SendMax。
- **Privy のポリシーで、受給証の持ち出しと CheckCancel を止められるか:** 止められた。受給証の Payment（DENY ルール）、CheckCancel・OfferCreate・別の宛先への CheckCreate（どれも既定の拒否）は、すべて `policy_violation` で署名されなかった（確認 7c）。ポリシーを付けたままでも、S は H2 の Check を換金できた（確認 7d）。

**ほかに分かったこと（設計に効くもの）**

- **ロック中は、新しい Check も作れない。** `TransactionType = CheckCreate` を許可するルールは、今も `invalid_policy_format` で作れない（確認 7b。spike 07 と同じ。docs.privy.io の記述とは食い違う）。そのため、ロック中の世帯はお店宛ての Check を新しく作れない。また Check は 1 回の精算で消えるので、**精算のたびに新しい Check が要る**。運用の候補は 2 つ:
  1. 登録時（オンライン）に、ロックを付ける前に S 宛ての Check を作っておき、そのあとロックを付ける。精算後の次の Check は、世帯がオンラインのときに「ロックを外す → CheckCreate → ロックを付け直す」（どれも本人の JWT が要る）
  2. spike 07 と同じく、DENY で Payment / OfferCreate を塞いだまま、system 時刻条件の ALLOW を短い時間だけ足して CheckCreate させる（そのあいだは他の種類も許可されるので、DENY で塞いだもの以外の持ち出しに注意）
- **Check はお金を確保しない**（xrpl.org Checks）ので、「ゆるいロック」が二重払い対策の本体になる。Check の上限は「精算口座が 1 回で引ける上限」、ロックは「その間に世帯がよそへ移せないようにする」役割で、両方そろって初めてお店の損を抑えられる。
- **RLUSD そのもので Check を作り、換金できた**（確認 8）。Escrow と違い、発行者の lsfAllowTrustLineLocking は要らない。S に RLUSD のトラストラインがなくても、CheckCash が自動で作った（1 回目の実行: [E84A35C7…](https://testnet.xrpl.org/transactions/E84A35C7377EC246149A784D6E1D69DE181CC8CFF53B33EAE89E1BFE293E5CBA)。上の表の 2 回目は、すでに線がある状態）。オフライン払いの部分だけは受給証なしで組める。ただし RLUSD の発行者が凍結・回収できる点は変わらない。
- 06_技術設計で変えるところ: オフライン払いの節に「Check は 1 回の精算で消える」「ロック中は CheckCreate できない（作るのはロックの前、または時間を区切った許可で）」「精算は DeliverMin で残高ぶんを回収、Batch tfIndependent で 8 件ずつ」を加える。

## 5. 分からなかったこと

- 確認 8 の「S に RLUSD のトラストラインがない場合」は 1 回目の実行（結果ファイルの保存で止まった回）のログでだけ確認した（[E84A35C7…](https://testnet.xrpl.org/transactions/E84A35C7377EC246149A784D6E1D69DE181CC8CFF53B33EAE89E1BFE293E5CBA)、tesSUCCESS、換金後の残高 0.01）。表にあるのは 2 回目（線がある状態）
- Privy の鍵のエクスポート（docs.privy.io の XRPL のページに記載がある）でポリシーを回避できるか、アプリ側でエクスポートを止められるかは確かめていない。止められないなら「ゆるいロック」は世帯の協力が前提になる
- 確認 7c で署名されなかった取引のほか、ポリシーで止まらない持ち出しの経路（例: 他の種類の取引）が残っていないかは、既定の拒否に頼っている。種類ごとには確かめていない
- 一部だけ換金したときに残りを引き続き使える方法（Check を作り直さずに済む方法）は XRPL の Check にはない（rippled CheckCash.cpp）。代わりの仕組みは調べていない

<!-- generated: 2026-11-22T11:46:27.830Z -->
