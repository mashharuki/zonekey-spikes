/**
 * 精算スクリプト（Node。ネット不要）: 複数のお店がためた伝票を集め、Check ごとに精算額を決める。
 *   pnpm --filter 11b-offline-slip settle <checks.json> <お店Aの伝票.json> <お店Bの伝票.json> ...
 * 出力: results/settlement.json（精算額・お店ごとの支払いと損・二重払いの証拠）
 *
 * 規則（この検証で決めたもの）:
 * 1. 伝票は署名・InvoiceID・上限・期限を確かめ直す（お店の確認を信じない）。同じバイト列の重複は 1 枚にまとめる
 * 2. 同じ Check・同じ番号で中身の違う伝票が 2 枚以上あれば「二重払い」。両方の伝票・署名・公開鍵を証拠として出す
 *    （どちらも世帯の鍵で署名されているので、世帯が二重に払ったことの証拠になる）
 * 3. 各伝票の額 = その伝票の合計額 − 1 つ前の番号の伝票のうち、合計額がその伝票より小さい中で最大のもの（同じ流れの直前の伝票）
 * 4. お店が受け取った時刻の順に、Check の SendMax に達するまで払う。超えた分はそのお店の損
 *    （受け取った時刻はお店の端末の時計。オフラインの端末どうしの時計はずれうる）
 * 実際の CheckCash は 11a の仕組み（DeliverMin で残高ぶんを回収、Batch tfIndependent で 8 件ずつ）で別に送る
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkSlip, fromUnits, hex, toUnits, unhex, unpackQr, type CheckInfo } from '../src/slip/format.ts';

interface StoredSlip { qrHex: string; checkId: string; seq: number; total: string; shopId: string; time: number; receivedAt: string; receiverShopId: string; receiverLabel: string }

const [checksPath, ...slipPaths] = process.argv.slice(2);
if (!checksPath || slipPaths.length === 0) throw new Error('使い方: settle <checks.json> <伝票.json>...');
const checks = JSON.parse(readFileSync(checksPath, 'utf8')) as CheckInfo[];
const all = slipPaths.flatMap((p) => JSON.parse(readFileSync(p, 'utf8')) as StoredSlip[]);
const unique = [...new Map(all.map((s) => [s.qrHex, s])).values()];

const out: Record<string, unknown>[] = [];
for (const check of checks) {
  const sendMax = toUnits(check.SendMax);
  const rows = [];
  for (const s of unique.filter((x) => x.checkId.toUpperCase() === check.CheckID.toUpperCase())) {
    const signed = unpackQr(unhex(s.qrHex));
    const r = await checkSlip(signed, [check], undefined);
    rows.push({ s, signed, valid: r.ok, reasons: r.reasons });
  }
  const valid = rows.filter((x) => x.valid);
  // 二重払い: 同じ番号で中身が違う
  const bySeq = new Map<number, typeof valid>();
  for (const v of valid) bySeq.set(v.s.seq, [...(bySeq.get(v.s.seq) ?? []), v]);
  const doubleSpends = [...bySeq.entries()].filter(([, xs]) => new Set(xs.map((x) => hex(x.signed.slipBytes))).size > 1).map(([seq, xs]) => ({
    seq,
    slips: xs.map((x) => ({ shop: x.s.receiverLabel, shopId: x.s.receiverShopId, total: fromUnits(BigInt(x.s.total)), slipTime: x.s.time, receivedAt: x.s.receivedAt,
      slipHex: hex(x.signed.slipBytes), signatureHex: hex(x.signed.signature), publicKeyHex: hex(x.signed.publicKey), alg: x.signed.alg })),
  }));
  // 各伝票の額と、受け取った時刻順の支払い
  const claims = valid.map((v) => {
    const prev = (bySeq.get(v.s.seq - 1) ?? []).map((x) => BigInt(x.s.total)).filter((t) => t < BigInt(v.s.total)).sort((a, b) => (a > b ? -1 : 1))[0] ?? 0n;
    return { v, claim: BigInt(v.s.total) - prev };
  }).sort((a, b) => a.v.s.receivedAt.localeCompare(b.v.s.receivedAt));
  let remaining = sendMax;
  const payouts = claims.map(({ v, claim }) => {
    const pay = claim < remaining ? claim : remaining;
    remaining -= pay;
    return { shop: v.s.receiverLabel, seq: v.s.seq, total: fromUnits(BigInt(v.s.total)), claim: fromUnits(claim), paid: fromUnits(pay), loss: fromUnits(claim - pay), receivedAt: v.s.receivedAt };
  });
  const paid = sendMax - remaining;
  const byShop: Record<string, { claim: string; paid: string; loss: string }> = {};
  for (const p of payouts) {
    const b = byShop[p.shop] ?? { claim: '0', paid: '0', loss: '0' };
    byShop[p.shop] = { claim: fromUnits(toUnits(b.claim) + toUnits(p.claim)), paid: fromUnits(toUnits(b.paid) + toUnits(p.paid)), loss: fromUnits(toUnits(b.loss) + toUnits(p.loss)) };
  }
  const row = {
    CheckID: check.CheckID, SendMax: check.SendMax, slipsReceived: all.filter((x) => x.checkId === check.CheckID).length, slipsUnique: rows.length,
    invalid: rows.filter((x) => !x.valid).map((x) => ({ shop: x.s.receiverLabel, seq: x.s.seq, reasons: x.reasons })),
    doubleSpends, payouts, byShop, settlementTotal: fromUnits(paid), withinSendMax: paid <= sendMax,
    totalClaimed: fromUnits(claims.reduce((a, c) => a + c.claim, 0n)), totalLoss: fromUnits(claims.reduce((a, c) => a + c.claim, 0n) - paid),
  };
  out.push(row);
  console.log(`[11b] Check ${check.CheckID.slice(0, 12)}…: 伝票 ${row.slipsUnique} 枚 / 二重払い ${doubleSpends.length} 件 / 請求 ${row.totalClaimed} / 精算 ${row.settlementTotal}（上限 ${check.SendMax} 以内: ${row.withinSendMax}）/ 損 ${row.totalLoss}`);
  for (const [shop, b] of Object.entries(byShop)) console.log(`[11b]   ${shop}: 請求 ${b.claim} / 支払い ${b.paid} / 損 ${b.loss}`);
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/settlement.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), inputs: { checks: checksPath, slips: slipPaths }, checks: out }, null, 2));
console.log('[11b] wrote results/settlement.json');
