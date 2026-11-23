/**
 * 11c 段階 2（オフライン）: お店 A の端末が、同期済みの一覧（results/synced-A.json）だけで券を確かめる
 *   pnpm --filter 11c-voucher-escrow offline
 * 最初に fetch・ソケット・DNS・TLS を使えなくする（呼ばれたら回数を数えて例外。spike 09 と同じ方法）。Wi-Fi を切って実行してもよい
 */
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

let netAttempts = 0;
const deny = (what: string) => () => { netAttempts++; throw new Error(`オフライン確認中にネットワークを使おうとした: ${what}`); };
globalThis.fetch = deny("fetch") as never;
net.Socket.prototype.connect = deny("net.Socket.connect") as never;
(net as unknown as Record<string, unknown>)["connect"] = deny("net.connect");
(net as unknown as Record<string, unknown>)["createConnection"] = deny("net.createConnection");
(tls as unknown as Record<string, unknown>)["connect"] = deny("tls.connect");
(dns as unknown as Record<string, unknown>)["lookup"] = deny("dns.lookup");

const { Recorder } = await import("xrpl-kit");
const { STATE, SYNCED_A, loadJson, saveJson, saveResults } = await import("./common.js");
const core = await import("./voucher/core.js");
const { REASONS, verifyVoucher } = await import("./voucher/shop.js");
type State = import("./common.js").State;
type SyncedEscrow = import("./voucher/shop.js").SyncedEscrow;

const r = new Recorder("11c");
const state = loadJson<State>(STATE);
const listA = loadJson<SyncedEscrow[]>(SYNCED_A);
const shop = state.accounts.A;
const MARGIN = 120; // 期限の 120 秒前からは受け付けない（精算の時間を残す）
const used = new Set<string>();
const claims: NonNullable<State["claims"]> = [];
const v = (id: string) => state.vouchers.find((x) => x.id === id)!;
const qr = (id: string) => core.unhex(v(id).qrHex);

async function check(item: string, bytes: Uint8Array, expect: string, opts: { now?: number; accept?: string } = {}) {
  const t0 = performance.now();
  const res = await verifyVoucher(bytes, listA, { shop, nowRipple: opts.now ?? core.rippleNow(), marginSec: MARGIN, used });
  const ms = (performance.now() - t0).toFixed(1);
  r.eq(item, expect, res.reason, `${bytes.length} B / ${ms} ms`);
  if (res.ok && opts.accept) { used.add(res.escrow.index); claims.push({ id: opts.accept, offerSequence: res.escrow.offerSequence, fulfillmentHex: res.fulfillmentHex }); }
}

// 別の端末の鍵（盗み見した人が自分の鍵で署名した場合）
const other = (await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const otherPub = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", other.publicKey));
const v3 = core.decodeVoucher(qr("v3"))!;
const stolenPlain = core.encodeVoucher({ owner: v3.owner, offerSequence: v3.offerSequence, preimage: v3.preimage });
const stolenOtherKey = core.encodeVoucher({ ...v3, sig: { pub: otherPub, sig: await core.signVoucher(other.privateKey, v3.owner, v3.offerSequence, shop) } });
const tampered = qr("v4").slice(); tampered[core.PREIMAGE_OFFSET + 5]! ^= 0x01;
const v6 = v("v6");

await check("確認3: v1（HH1・500 円券・端末の署名つき）", qr("v1"), REASONS.ok, { accept: "v1" });
await check("確認5: v1 をもう一度出す", qr("v1"), REASONS.used);
await check("確認3: v2（HH1・1,000 円券・署名つき）", qr("v2"), REASONS.ok, { accept: "v2" });
await check("確認8: v3 の preimage だけを盗み見して出す（署名なし）", stolenPlain, REASONS.noSig);
await check("確認8: v3 を別の端末の鍵で署名して出す", stolenOtherKey, REASONS.wrongKey);
await check("確認3: v3（本人の端末）", qr("v3"), REASONS.ok, { accept: "v3" });
await check("確認5: v4 の preimage を 1 ビット書き換える", tampered, REASONS.preimage);
await check("確認3: v4（HH2・500 円券・署名なしの券）", qr("v4"), REASONS.ok, { accept: "v4" });
await check("確認5: v5（お店 B 宛て）をお店 A で出す", qr("v5"), REASONS.notMine);
await check("確認5: v6 を期限の 120 秒前を過ぎた時刻で出す（端末の時計を CancelAfter − 119 秒にして確認）", qr("v6"), REASONS.expired, { now: v6.cancelAfter - MARGIN + 1 });
await check("確認5: 壊れた QR（長さ違い）", qr("v1").slice(0, 40), REASONS.format);

r.eq("確認3: 確認中のネットワーク利用の試み", "0 回", `${netAttempts} 回`, "fetch・ソケット・DNS・TLS を遮断して実行");
r.add("observe", "確認3: 受け付けた券", "v1・v2・v3・v4", claims.map((c) => c.id).join("・"), "精算（settle）で EscrowFinish する。Fulfillment は .state/ にだけ保存");

saveJson(STATE, { ...state, claims });
saveResults("offline", r, { marginSec: MARGIN, accepted: claims.map((c) => ({ id: c.id, offerSequence: c.offerSequence })) });
