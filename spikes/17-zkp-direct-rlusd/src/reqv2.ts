/**
 * 申請形式 v2: 資産（通貨と発行者）を XRPL の台帳上の表現（通貨 20 B・発行者 AccountID 20 B）で拘束する。
 * v1（spike 13、191 B、通貨は英数字 3 B）はそのまま残し、v2 は別の固定タグを使う。v1 の申請を v2 として受理しない（タグも長さも違う）。
 *
 * v2 正規バイト列（208 B）:
 *   "todoke-17-request-v2"(20) || program_id(32, BE) || owner AccountID(20) || shop AccountID(20)
 *   || currency(20、XRPL の通貨コード 160 ビット) || issuer AccountID(20) || value(8, BE, 10^-6 単位)
 *   || cancelAfter(4, BE, Ripple Epoch) || pkHash(32) || conditionHash(32)
 * 通貨の入力:
 *   - 40 桁の 16 進（大文字小文字は同じ値）。先頭 1 B が 0x00 以外なら非標準コードとして 20 B をそのまま使う。
 *     先頭 1 B が 0x00 なら標準形式でなければならない（12 B のゼロ ‖ ISO 3 B ‖ 5 B のゼロ）。
 *   - 3 文字の ISO コード（標準形式の 20 B に符号化する）。"XRP" は発行通貨ではないので拒否。
 *   - 拒否: 長さが 3 でも 40 でもない、16 進でない 40 桁、全ゼロ、標準形式の崩れ、ISO に使えない文字、"XRP"。
 * 文字列としての 40 桁 hex を 40 B の ASCII として扱わない。
 */
import { decodeAccountID } from "ripple-address-codec";
import { type Req } from "../../13-zk-bound-voucher/src/lib.js";
import { sha256, unhex } from "../../11c-voucher-escrow/src/voucher/core.js";

export const REQ_TAG_V2 = "todoke-17-request-v2"; // 20 バイト
export const V2_LENGTH = 208;
const enc = new TextEncoder();
const ISO = /^[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}$/;

const be = (n: bigint, bytes: number) => {
  if (n < 0n || n >> BigInt(bytes * 8) !== 0n) throw new Error(`${bytes} バイトに収まらない: ${n}`);
  const out = new Uint8Array(bytes);
  for (let i = bytes - 1, v = n; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
};

/** 通貨 → 20 B。対応外は例外 */
export function currencyBytes(c: string): Uint8Array {
  if (typeof c !== "string") throw new Error("通貨が文字列ではない");
  if (c.length === 3) {
    if (c === "XRP") throw new Error("XRP は発行通貨ではない");
    if (!ISO.test(c)) throw new Error(`ISO コードに使えない文字: ${JSON.stringify(c)}`);
    const out = new Uint8Array(20); out.set(enc.encode(c), 12); return out;
  }
  if (c.length !== 40) throw new Error(`通貨は 3 文字の ISO コードか 40 桁の 16 進: 長さ ${c.length}`);
  if (!/^[0-9A-Fa-f]{40}$/.test(c)) throw new Error("通貨に 16 進でない文字");
  const b = unhex(c);
  if (b.every((x) => x === 0)) throw new Error("全ゼロの通貨コードは XRP を指す");
  if (b[0] === 0) {
    // 標準形式: バイト 0〜11 と 15〜19 は 0、12〜14 が ISO コード
    const reservedOk = b.slice(0, 12).every((x) => x === 0) && b.slice(15).every((x) => x === 0);
    const code = String.fromCharCode(...b.slice(12, 15));
    if (!reservedOk || !ISO.test(code)) throw new Error("標準形式の通貨コードが崩れている");
    if (code === "XRP") throw new Error("XRP は発行通貨ではない");
  }
  return b;
}
/** 通貨の正準表記（40 桁・大文字）。同じ通貨の別表記を 1 つにする */
export const canonicalCurrency = (c: string) => Array.from(currencyBytes(c), (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();

export function encodeRequestV2(r: Req): Uint8Array {
  const u = (h: string, what: string) => { if (!/^[0-9A-Fa-f]{64}$/.test(h)) throw new Error(`${what} は 64 桁の 16 進`); return unhex(h); };
  if (r.valueUnits <= 0n) throw new Error("額面は正");
  const parts = [enc.encode(REQ_TAG_V2), be(r.programId, 32), decodeAccountID(r.owner), decodeAccountID(r.shop), currencyBytes(r.currency), decodeAccountID(r.issuer), be(r.valueUnits, 8), be(BigInt(r.cancelAfter), 4), u(r.pkHash, "pkHash"), u(r.conditionHash, "conditionHash")];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  if (out.length !== V2_LENGTH) throw new Error(`v2 の長さが ${out.length}`);
  return out;
}
export const requestDigestV2 = (r: Req) => sha256(encodeRequestV2(r));
