/**
 * 試験用のサンプルを spike 09 の受け取りパックから作る（ネット不要）。
 *   public/samples/*.bin … アプリ内の「サンプル」ボタンとファイル選択の試験用（deflate-raw で圧縮）
 *   samples-qr/*.png      … QR 読み取りの試験用（別の画面に表示して iPhone のカメラで読む）
 *   pnpm --filter 10-pwa samples
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import QRCode from "qrcode";

const s09 = (p: string) => new Uint8Array(readFileSync(new URL(`../../09-offline-receipt/receipts/${p}`, import.meta.url)));
const here = (p: string) => new URL(`../${p}`, import.meta.url);

const confirmed = s09("live-abc.bin");
// 取引の中身を 1 ビット変える（"ZKR1" 4 + ヘッダ 118 + 長さ 1 の後ろ、tx の 20 バイト目）→ A が落ちる
const tampered = Uint8Array.from(confirmed);
tampered[4 + 118 + 1 + 20]! ^= 0x01;
const samples: [string, Uint8Array, string][] = [
  ["confirmed", confirmed, "確定済みになるはず（live: Faucet からの受け取り、検証者 5 人の署名つき）"],
  ["tampered", tampered, "不一致になるはず（上の tx を 1 ビット変更）"],
  ["no-signatures", s09("s2-ab.bin"), "不一致になるはず（S2 の EscrowFinish。A・B だけで署名なし）"],
];
for (const [name, raw, note] of samples) {
  const z = new Uint8Array(deflateRawSync(raw, { level: 9 }));
  writeFileSync(here(`public/samples/${name}.bin`), z);
  await QRCode.toFile(here(`samples-qr/${name}.png`).pathname, [{ data: z, mode: "byte" }], { errorCorrectionLevel: "L", margin: 4, scale: 6 });
  const v = QRCode.create([{ data: z, mode: "byte" }], { errorCorrectionLevel: "L" }).version;
  console.log(`[10] ${name}: ${raw.length} B → 圧縮 ${z.length} B / QR 型番 ${v} … ${note}`);
}
