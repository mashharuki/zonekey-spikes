/**
 * レジャーヘッダと ledger_hash の再計算。
 * 根拠: rippled src/libxrpl/protocol/LedgerHeader.cpp calculateLedgerHash() / addRaw()
 *   sha512Half("LWR\0", seq u32, drops u64, parentHash, txHash, accountHash,
 *              parentCloseTime u32, closeTime u32, closeTimeResolution u8, closeFlags u8)
 */
import { type Bytes, HashPrefix, Reader, concat, hex, sha512Half, u32, u64, u8, unhex } from "./bytes.js";

export interface Header {
  seq: number; drops: bigint; parentHash: Bytes; txHash: Bytes; accountHash: Bytes;
  parentCloseTime: number; closeTime: number; closeTimeResolution: number; closeFlags: number;
}

export const HEADER_BYTES = 118;
export const serializeHeader = (h: Header): Bytes =>
  concat(u32(h.seq), u64(h.drops), h.parentHash, h.txHash, h.accountHash, u32(h.parentCloseTime), u32(h.closeTime), u8(h.closeTimeResolution), u8(h.closeFlags));
export const ledgerHash = (h: Header): Bytes => sha512Half(HashPrefix.LedgerMaster, serializeHeader(h));

export function parseHeader(b: Bytes): Header {
  const r = new Reader(b);
  return {
    seq: Buffer.from(r.take(4)).readUInt32BE(), drops: Buffer.from(r.take(8)).readBigUInt64BE(),
    parentHash: r.take(32), txHash: r.take(32), accountHash: r.take(32),
    parentCloseTime: Buffer.from(r.take(4)).readUInt32BE(), closeTime: Buffer.from(r.take(4)).readUInt32BE(),
    closeTimeResolution: r.u8(), closeFlags: r.u8(),
  };
}

/** ledger メソッドの JSON（binary: false）から */
export function headerFromJson(j: Record<string, unknown>): Header {
  return {
    seq: Number(j["ledger_index"]), drops: BigInt(String(j["total_coins"])),
    parentHash: unhex(String(j["parent_hash"])), txHash: unhex(String(j["transaction_hash"])), accountHash: unhex(String(j["account_hash"])),
    parentCloseTime: Number(j["parent_close_time"]), closeTime: Number(j["close_time"]),
    closeTimeResolution: Number(j["close_time_resolution"]), closeFlags: Number(j["close_flags"] ?? 0),
  };
}

export const describe = (h: Header) => ({
  ledger_index: h.seq, total_coins: h.drops.toString(), parent_hash: hex(h.parentHash), transaction_hash: hex(h.txHash),
  account_hash: hex(h.accountHash), parent_close_time: h.parentCloseTime, close_time: h.closeTime,
  close_time_resolution: h.closeTimeResolution, close_flags: h.closeFlags,
});

/** Ripple Epoch（2000-01-01T00:00:00Z）秒 → ISO */
export const rippleTimeIso = (t: number): string => new Date((t + 946684800) * 1000).toISOString();
