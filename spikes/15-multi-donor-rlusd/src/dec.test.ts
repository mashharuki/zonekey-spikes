import assert from "node:assert/strict";
import { fmtDec, parseDec } from "./dec.js";

// 0.1 + 0.2 が 0.3 になる（Number なら 0.30000000000000004）
assert.equal(fmtDec(parseDec("0.1") + parseDec("0.2")), "0.3");
assert.equal(fmtDec(parseDec("0.10") - parseDec("0.05")), "0.05");
assert.equal(fmtDec(parseDec("1e-7")), "0.0000001");
assert.equal(fmtDec(parseDec("-5E-1")), "-0.5");
assert.equal(fmtDec(parseDec("999999.7")), "999999.7");
assert.equal(fmtDec(0n), "0");
assert.equal(fmtDec(parseDec("-0.05") + parseDec("0.05")), "0");
assert.throws(() => parseDec("1e-16"));
assert.throws(() => parseDec("abc"));
// 合計 0 の検算
const d = [parseDec("-0.10"), parseDec("-0.05"), parseDec("0.15"), 0n];
assert.equal(d.reduce((a, b) => a + b, 0n), 0n);
console.log("dec: ok");
