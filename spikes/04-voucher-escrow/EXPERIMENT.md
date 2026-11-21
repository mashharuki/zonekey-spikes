# 04 償還 tecKILLED の切り分け実験

| 段 | 変更（実送信） | 結果 | 償還 simulate（ben, IoC 0.1） |
| --- | --- | --- | --- |
| E0 変更なし（基準） | - | - | **tecKILLED** |
| E1 V の RLUSD ラインの NoRipple を解除（TrustSet tfClearNoRipple） | TrustSet | tesSUCCESS [181075E51A…](https://testnet.xrpl.org/transactions/181075E51A72F4129FDD9FF429A99B00B778B00529DE76E07E4F30F4E03347FD) | **tecKILLED** |
| E2 V に DefaultRipple を設定（AccountSet asfDefaultRipple） | AccountSet | tesSUCCESS [CF3BDF789D…](https://testnet.xrpl.org/transactions/CF3BDF789D4B3F37A5ADE85CC0BC57FDA1247ED54E66D5B5CCFD81925BA0E35F) | **tecKILLED** |
| E3 V 側の ben の受給証ラインの NoRipple を解除（TrustSet tfClearNoRipple, limit 0） | TrustSet | tesSUCCESS [CFAEF15E5F…](https://testnet.xrpl.org/transactions/CFAEF15E5F78CE77082ACAFC1CE3ECF7E98BE4AD1C7C9B86BD2695E8972FF49A) | **tesSUCCESS** |

**結論: 「E3 V 側の ben の受給証ラインの NoRipple を解除（TrustSet tfClearNoRipple, limit 0）」の段で償還が通るようになった。**
