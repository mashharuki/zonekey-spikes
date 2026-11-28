/** spike 15 の定数。秘密は一切含まない（検算コマンドもこのファイルを読む） */
export const NETWORK = "XRPL Testnet";
export const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
export const RIPPLE_EPOCH_OFFSET = 946684800;

/** 公式に案内された Testnet RLUSD（2026-11-28 に https://tryrlusd.com/addresses の「XRPL Testnet」欄で確認。旧 rQhWct2f… は存在しない） */
export const RLUSD = {
  currency: "524C555344000000000000000000000000000000",
  issuer: "rpcFL7MzZvGYFCihoUx9nrhhgAp4nSDdvG",
  source: "https://tryrlusd.com/addresses（XRPL Testnet の RLUSD issuer / Currency code 524C555344…）",
} as const;
/** 給付資産 ZKV（V 発行。RLUSD と 1:1 の受給証） */
export const ZKV_CURRENCY = "ZKV";

/** 券の額面（RLUSD / ZKV と同じ数量の十進表記） */
export const AMOUNTS = { A: "0.1", B: "0.05", C: "0.05" } as const;
export const CONTRIB = { P: "0.1", N: "0.1" } as const;

export const ACCOUNT_ONE = "rrrrrrrrrrrrrrrrrrrrBZbvji";
