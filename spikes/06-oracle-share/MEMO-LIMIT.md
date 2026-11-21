# Memos の上限の実測（AccountSet + Memo）

| MemoData（バイト） | Memos フィールド全体（バイト） | 全体 − 2（フィールド ID と配列終端を除く） | 結果 | tx |
| --- | --- | --- | --- | --- |
| 1015 | 1022 | 1020 | tesSUCCESS | [D777AC7DAE…](https://testnet.xrpl.org/transactions/D777AC7DAE52C4EB7F042EBE8D49BF5695DD84C88590348963CC6346417DF9F4) |
| 1016 | 1023 | 1021 | tesSUCCESS | [A0484EE2D0…](https://testnet.xrpl.org/transactions/A0484EE2D00C182516CC0FA1B754628570BA8FD1C81E1F5C9C78EA6BFD90FFF3) |
| 1017 | 1024 | 1022 | tesSUCCESS | [5BD1952836…](https://testnet.xrpl.org/transactions/5BD19528365AE28DFA41C22D9122F8DFF69A15968D7A009B53869445BEF8D7E3) |
| 1018 | 1025 | 1023 | tesSUCCESS | [37949480C3…](https://testnet.xrpl.org/transactions/37949480C3976A7DAA4D22DFEAD7C8E5F97047AD80AFC62713D2E786757FD91C) |
| 1019 | 1026 | 1024 | tesSUCCESS | [E26C16D180…](https://testnet.xrpl.org/transactions/E26C16D180725D5B9B89091C6FF199D039CC5BC189E68F5F918F34EEADAAA6E0) |
| 1020 | 1027 | 1025 | fails local checks: The memo exceeds the maximum allowed size. | 未適用 |

**結果:** MemoData 1020 バイト（Memos フィールド全体 1027 / 中身 1025 バイト）で初めて拒否: fails local checks: The memo exceeds the maximum allowed size.。受理された最大は MemoData 1019 バイト（全体 1026 / 中身 1024 バイト）
