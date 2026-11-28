/**
 * 十進の固定精度（10^-15 刻みの BigInt）。XRPL の IOU は 15 桁の有効数字なので、丸めずに足し引きする。
 * 浮動小数点（Number）は金額に使わない。
 */
const SCALE = 15;
const ONE = 10n ** BigInt(SCALE);

/** "0.1" / "-0.05" / "1e-7" / "15" を 10^-15 刻みの BigInt にする。表せない桁（16 桁目以降が非 0）は例外 */
export function parseDec(s: string): bigint {
  const m = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(s).trim());
  if (!m) throw new Error(`十進の数として読めない: ${JSON.stringify(s)}`);
  const [, sign, int = "0", frac = "", exp = "0"] = m;
  const digits = BigInt(int + frac);
  const shift = Number(exp) - frac.length + SCALE;
  let v: bigint;
  if (shift >= 0) v = digits * 10n ** BigInt(shift);
  else {
    const div = 10n ** BigInt(-shift);
    if (digits % div !== 0n) throw new Error(`10^-${SCALE} より細かい桁がある: ${s}`);
    v = digits / div;
  }
  return sign ? -v : v;
}

/** BigInt → "0.1" のような最短の十進表記（符号付き、末尾の 0 は落とす） */
export function fmtDec(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const int = a / ONE;
  const frac = (a % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}
export const dec = parseDec;
/** 符号つきで表示（+0.15 / -0.10 / 0） */
export const fmtSigned = (v: bigint) => (v > 0n ? `+${fmtDec(v)}` : fmtDec(v));
