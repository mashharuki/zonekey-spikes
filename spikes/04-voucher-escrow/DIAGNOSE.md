# 04 償還 tecKILLED の診断（読み取り専用）

## 1. RLUSD 発行者 account_info（TransferRate / TickSize / Flags）

```json
{
  "account_data": {
    "Account": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
    "Balance": "99951181",
    "Domain": "68747470733A2F2F726970706C652E636F6D2F",
    "Flags": 2174353408,
    "LedgerEntryType": "AccountRoot",
    "OwnerCount": 23,
    "PreviousTxnID": "4DB5475B240890F929931477414151E6C383DAC689BD2E837C3166AF109EB3BE",
    "PreviousTxnLgrSeq": 22492054,
    "Sequence": 611833,
    "TickSize": 7,
    "index": "DC5BBAC5661E91FD934E8E96419FCDE8086BB90DF2E4112D1BEB032E9908C649"
  },
  "account_flags": {
    "allowTrustLineClawback": true,
    "allowTrustLineLocking": false,
    "defaultRipple": true,
    "depositAuth": true,
    "disableMasterKey": true,
    "disallowIncomingCheck": false,
    "disallowIncomingNFTokenOffer": false,
    "disallowIncomingPayChan": false,
    "disallowIncomingTrustline": false,
    "disallowIncomingXRP": true,
    "globalFreeze": false,
    "noFreeze": false,
    "passwordSpent": false,
    "requireAuthorization": false,
    "requireDestinationTag": true
  },
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "validated": true
}
```

## 2. V account_info

```json
{
  "account_data": {
    "Account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
    "Balance": "99999952",
    "Flags": 1073741824,
    "LedgerEntryType": "AccountRoot",
    "OwnerCount": 3,
    "PreviousTxnID": "08170D8E009450D65CF6158B78455B7583E7B356DB568BC3B190D54BDBB7C9CA",
    "PreviousTxnLgrSeq": 22492052,
    "Sequence": 22492004,
    "index": "BF68DB013E0FFCD239163D63DEAC80A103795B2537380DF9AA01BAC600757A93"
  },
  "account_flags": {
    "allowTrustLineClawback": false,
    "allowTrustLineLocking": true,
    "defaultRipple": false,
    "depositAuth": false,
    "disableMasterKey": false,
    "disallowIncomingCheck": false,
    "disallowIncomingNFTokenOffer": false,
    "disallowIncomingPayChan": false,
    "disallowIncomingTrustline": false,
    "disallowIncomingXRP": false,
    "globalFreeze": false,
    "noFreeze": false,
    "passwordSpent": false,
    "requireAuthorization": false,
    "requireDestinationTag": false
  },
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "validated": true
}
```

## 3. V の RLUSD トラストライン（no_ripple / freeze など）

```json
{
  "account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "lines": [
    {
      "account": "rGgAL2ktF89J9dNvWmdZDfmRt1LH5zWDwK",
      "balance": "-0.05",
      "currency": "ZKV",
      "limit": "0",
      "limit_peer": "0",
      "no_ripple": true,
      "no_ripple_peer": true,
      "quality_in": 0,
      "quality_out": 0
    },
    {
      "account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
      "balance": "-0.1",
      "currency": "ZKV",
      "limit": "0",
      "limit_peer": "1000000000",
      "no_ripple": true,
      "quality_in": 0,
      "quality_out": 0
    },
    {
      "account": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
      "balance": "0.3",
      "currency": "524C555344000000000000000000000000000000",
      "limit": "1000000000",
      "limit_peer": "0",
      "no_ripple": true,
      "quality_in": 0,
      "quality_out": 0
    },
    {
      "account": "rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh",
      "balance": "-0.15",
      "currency": "ZKV",
      "limit": "0",
      "limit_peer": "1000000000",
      "no_ripple": true,
      "quality_in": 0,
      "quality_out": 0
    }
  ],
  "validated": true
}
```

## 4. ben のトラストライン

```json
{
  "account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "lines": [
    {
      "account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
      "balance": "0.1",
      "currency": "ZKV",
      "limit": "1000000000",
      "limit_peer": "0",
      "no_ripple_peer": true,
      "quality_in": 0,
      "quality_out": 0
    },
    {
      "account": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
      "balance": "0",
      "currency": "524C555344000000000000000000000000000000",
      "limit": "1000000000",
      "limit_peer": "0",
      "no_ripple": true,
      "quality_in": 0,
      "quality_out": 0
    }
  ],
  "validated": true
}
```

## 5. V の account_offers

```json
{
  "account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "offers": [
    {
      "flags": 0,
      "quality": "1",
      "seq": 22492002,
      "taker_gets": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "999999.7"
      },
      "taker_pays": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        "value": "999999.7"
      }
    },
    {
      "flags": 65536,
      "quality": "1",
      "seq": 22492003,
      "taker_gets": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        "value": "1000000"
      },
      "taker_pays": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "1000000"
      }
    }
  ],
  "validated": true
}
```

## 6. 板: RLUSD を売り ZKV を買うオファー（taker=ben から見た owner_funds / funded）

```json
{
  "ledger_hash": "6EA85B3F1195F22028D7BCC39F4871A382C2AD1C3BCA24FCA613209AFB21C28B",
  "ledger_index": 22492370,
  "offers": [
    {
      "Account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
      "BookDirectory": "F7864FB3A80A6022DCCFDBCC8E975790B3B42085D09D76BF55038D7EA4C68000",
      "BookNode": "0",
      "Flags": 65536,
      "LedgerEntryType": "Offer",
      "OwnerNode": "0",
      "PreviousTxnID": "5D00A5E2449AE8282E19A28567F492EAB64B926AF1F32DA61D97B746DC484620",
      "PreviousTxnLgrSeq": 22492016,
      "Sequence": 22492003,
      "TakerGets": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        "value": "1000000"
      },
      "TakerPays": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "1000000"
      },
      "index": "A9093DBC3EEA51AFD0122C5C079E6ABB692921DC8F680A75AC6AAF880715E6AF",
      "owner_funds": "0.3",
      "quality": "1",
      "taker_gets_funded": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        "value": "0.3"
      },
      "taker_pays_funded": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "0.3"
      }
    }
  ],
  "validated": true
}
```

## 7. 逆向きの板: ZKV を売り RLUSD を買うオファー（発行オファー）

```json
{
  "ledger_hash": "F6EE7C84264E5C0D1DCE12C611D403D19521F8BE2D6338D25FD1454A7DBF204B",
  "ledger_index": 22492371,
  "offers": [
    {
      "Account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
      "BookDirectory": "2CB994D2DF12D6EDDC83E3082FB6D0821FAF9A971112E8BE55038D7EA4C68000",
      "BookNode": "0",
      "Flags": 0,
      "LedgerEntryType": "Offer",
      "OwnerNode": "0",
      "PreviousTxnID": "92A867D52810E00415E01148571BCB306B533DC9503441159DB3CFEC51EE4817",
      "PreviousTxnLgrSeq": 22492014,
      "Sequence": 22492002,
      "TakerGets": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "999999.7"
      },
      "TakerPays": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        "value": "999999.7"
      },
      "index": "25359855C695700F5B0A3FFEB8DBAA3BC1E5D9A01DE83989DCAE63994178764F",
      "owner_funds": "999999.7",
      "quality": "1"
    }
  ],
  "validated": true
}
```

## 8. tecKILLED になった tx 1C0356BAFAD55D0BB0FBCAE59B209BE8118B934E3E9B633B7469FFC262D55DA7

```json
{
  "close_time_iso": "2026-11-21T06:32:32Z",
  "ctid": "C157337A00050001",
  "hash": "1C0356BAFAD55D0BB0FBCAE59B209BE8118B934E3E9B633B7469FFC262D55DA7",
  "ledger_hash": "867FF1BD127AD599280DA24B98A536D30C7FB797A88038EE4B79B78887484CD3",
  "ledger_index": 22492026,
  "meta": {
    "AffectedNodes": [
      {
        "ModifiedNode": {
          "FinalFields": {
            "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
            "Balance": "99999964",
            "Flags": 0,
            "OwnerCount": 2,
            "Sequence": 22489382
          },
          "LedgerEntryType": "AccountRoot",
          "LedgerIndex": "584A9BF7655C90C128A4F65DA87A36F475D12929948734513B873500A5401204",
          "PreviousFields": {
            "Balance": "99999976",
            "Sequence": 22489381
          },
          "PreviousTxnID": "41CD3398C3C416988617E01F8CE0CE9D5D388794C557295DD27BCE999082BB98",
          "PreviousTxnLgrSeq": 22492024
        }
      }
    ],
    "TransactionIndex": 5,
    "TransactionResult": "tecKILLED"
  },
  "tx_json": {
    "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
    "Fee": "12",
    "Flags": 131072,
    "LastLedgerSequence": 22492044,
    "Sequence": 22489381,
    "SigningPubKey": "EDF00C47E46BA2516C5652D6BFAD51CB6F2A5C6BB632FCE49E72D0371D0E8EEA10",
    "TakerGets": {
      "currency": "ZKV",
      "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
      "value": "0.1"
    },
    "TakerPays": {
      "currency": "524C555344000000000000000000000000000000",
      "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
      "value": "0.1"
    },
    "TransactionType": "OfferCreate",
    "TxnSignature": "0E2FF9E0D0B3B48698E83064A7DED0BCB6757C9A6038A54B69528A58AFE62C57261382C72D9638B139354E533C74EA349A8FCD42A67A8BE5FBDABEBEDB55140C",
    "ctid": "C157337A00050001",
    "date": 848557952,
    "ledger_index": 22492026
  },
  "validated": true
}
```

## 9. ripple_path_find（ben→ben、ZKV で RLUSD 0.1 を受け取る経路）

```json
{
  "alternatives": [],
  "destination_account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
  "destination_amount": {
    "currency": "524C555344000000000000000000000000000000",
    "issuer": "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
    "value": "0.1"
  },
  "destination_currencies": [
    "524C555344000000000000000000000000000000",
    "ZKV",
    "XRP"
  ],
  "full_reply": true,
  "id": 9,
  "ledger_hash": "F6EE7C84264E5C0D1DCE12C611D403D19521F8BE2D6338D25FD1454A7DBF204B",
  "ledger_index": 22492371,
  "source_account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
  "validated": true
}
```

## 10. simulate S1 元と同じ: OfferCreate IoC（ZKV 0.1 → RLUSD 0.1）

```json
{
  "engine_result": "tecKILLED",
  "message": "No funds transferred and no offer created.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999952",
      "PrevBalance": "99999964",
      "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe"
    }
  ]
}
```

## 10. simulate S2 IoC + tfSell、希望額を少し下げる（RLUSD 0.099）

```json
{
  "engine_result": "tecKILLED",
  "message": "No funds transferred and no offer created.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999952",
      "PrevBalance": "99999964",
      "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe"
    }
  ]
}
```

## 10. simulate S3 フラグなし（板に残るか、交差するか）

```json
{
  "engine_result": "tesSUCCESS",
  "message": "The simulated transaction would have been applied.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "DirectoryNode"
    },
    {
      "kind": "ModifiedNode",
      "type": "DirectoryNode"
    },
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999952",
      "PrevBalance": "99999964",
      "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe"
    },
    {
      "kind": "CreatedNode",
      "type": "Offer",
      "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe",
      "TakerGets": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "0.1"
      }
    }
  ]
}
```

## 10. simulate S4 Payment ben→ben（Amount RLUSD 0.1、SendMax ZKV 0.1）

```json
{
  "engine_result": "tecPATH_DRY",
  "message": "Path could not send partial amount.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999952",
      "PrevBalance": "99999964",
      "Account": "rf5KmznG6nH8rW3orSRq7oxmUvVGKUTzCe"
    }
  ]
}
```

## 10. simulate S5 donor で S1 と同じ償還

```json
{
  "engine_result": "tecKILLED",
  "message": "No funds transferred and no offer created.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999892",
      "PrevBalance": "99999904",
      "Account": "rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh"
    }
  ]
}
```

## 10. simulate S6 比較: donor が RLUSD 0.01 で受給証を買う（発行方向）

```json
{
  "engine_result": "tesSUCCESS",
  "message": "The simulated transaction would have been applied.",
  "nodes": [
    {
      "kind": "ModifiedNode",
      "type": "Offer",
      "Account": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
      "TakerGets": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "999999.69"
      },
      "PrevTakerGets": {
        "currency": "ZKV",
        "issuer": "rEhTGPAGz7pKwoUkHqo3K3M5MKPmsHpmgh",
        "value": "999999.7"
      }
    },
    {
      "kind": "ModifiedNode",
      "type": "AccountRoot",
      "Balance": "99999892",
      "PrevBalance": "99999904",
      "Account": "rUbh5WJVtCuymfJNT6NHCBrdkCbFLDumfh"
    },
    {
      "kind": "ModifiedNode",
      "type": "RippleState",
      "Balance": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.69"
      },
      "PrevBalance": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.7"
      }
    },
    {
      "kind": "ModifiedNode",
      "type": "RippleState",
      "Balance": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.31"
      },
      "PrevBalance": {
        "currency": "524C555344000000000000000000000000000000",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.3"
      }
    },
    {
      "kind": "ModifiedNode",
      "type": "RippleState",
      "Balance": {
        "currency": "ZKV",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.16"
      },
      "PrevBalance": {
        "currency": "ZKV",
        "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
        "value": "0.15"
      }
    }
  ]
}
```
