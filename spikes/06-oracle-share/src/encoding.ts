import { convertStringToHex, encode, rippleTimeToUnixTime, type Client, type Memo } from "xrpl";
import type { TxOutcome } from "xrpl-kit";

/**
 * ゾーン ID → BaseAsset。
 * BaseAsset は通貨コード型（3 文字の標準コード、または 160 ビット = 40 桁 16 進の非標準コード）。
 * ゾーン ID は 3 文字に収まらないので、ASCII を 20 バイトまで右詰めゼロ埋めした非標準コードにする。
 * 先頭バイトが 0x00 だと標準コード扱いになるため、ゾーン ID は英字で始める。
 */
export function zoneToCurrency(zoneId: string): string {
  const b = Buffer.from(zoneId, "ascii");
  if (b.length === 0 || b.length > 20) throw new Error(`ゾーン ID は 1〜20 バイト: ${zoneId}`);
  if (b[0] === 0) throw new Error("ゾーン ID の先頭バイトが 0x00");
  return Buffer.concat([b, Buffer.alloc(20 - b.length)]).toString("hex").toUpperCase();
}
export const currencyToZone = (hex: string): string => Buffer.from(hex, "hex").toString("ascii").replace(/\0+$/, "");

/** QuoteAsset はスコアの単位を表す 3 文字の標準コード */
export const SCORE_UNIT = "SCR";
/** スコアは小数 1 桁まで（AI モデルの出力を想定）。AssetPrice = スコア × 10^SCALE */
export const SCALE = 1;
/**
 * AssetPrice は 16 進文字列で渡す（xrpl.org の推奨）。
 * xrpl.js は文字列の AssetPrice を 16 進として解釈するため、10 進の "825" を渡すと 0x825 = 2085 になってしまう。
 */
export const scoreToPrice = (score: number): string => {
  if (score < 0 || score > 100) throw new Error(`スコアは 0〜100: ${score}`);
  return Math.round(score * 10 ** SCALE).toString(16).toUpperCase();
};
/** 台帳上の AssetPrice は 16 進文字列で返る */
export const priceToScore = (assetPriceHex: string, scale: number): number => Number(BigInt(`0x${assetPriceHex}`)) / 10 ** scale;

export const hex = (s: string): string => convertStringToHex(s).toUpperCase();

export function shareMemo(shareHex: string, zoneId: string): Memo {
  return { Memo: { MemoType: hex("zonekey/share"), MemoFormat: hex(`application/x-sss-2of3;zone=${zoneId}`), MemoData: shareHex.toUpperCase() } };
}

/** Memos フィールドを単独で直列化したときのバイト数（xrpl.org: Memos は直列化して 1 KB まで） */
export const memosSerializedBytes = (memos: Memo[]): number => encode({ Memos: memos } as never).length / 2;

/** MemoData を n バイトにしたとき Memos 全体が target バイトになる n を探す */
export function memoDataBytesFor(targetSerialized: number): number {
  for (let n = targetSerialized; n > 0; n--) {
    if (memosSerializedBytes([{ Memo: { MemoData: "AB".repeat(n) } }]) <= targetSerialized) return n;
  }
  throw new Error("見つからない");
}

/** submitAndLog の結果からエラーコード（tes/tec/tem/tef/tel/ter）を取り出す */
export const codeOf = (o: TxOutcome): string => o.engineResult ?? /\b(te[cmfsl]|tel|ter)[A-Z_]+/.exec(o.error ?? "")?.[0] ?? o.error ?? "(不明)";

export async function validatedCloseUnix(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return rippleTimeToUnixTime(r.result.ledger.close_time) / 1000;
}
export async function ledgerCloseUnix(client: Client, ledgerIndex: number): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: ledgerIndex });
  return rippleTimeToUnixTime(r.result.ledger.close_time) / 1000;
}
