import { useEffect, useRef, useState } from 'react';
import { Stack, Box, Cluster, Heading, Text } from 'lism-css/react';
import { CHECK_11A } from '../slip/check11a';
import { kvGet, kvSet } from '../slip/db';
import { RIPPLE_EPOCH, encodeSlip, exportPublicRaw, fromUnits, generateKeyPair, hex, packQr, sha256, sign, toUnits, unhex, type Alg, type CheckInfo } from '../slip/format';
import { qrDataUrl, readQrFromImage, scanQrFromCamera } from '../slip/qr';

interface Keys { alg: Alg; privateKey: CryptoKey; publicKey: CryptoKey; publicRaw: string; invoiceId: string }
interface Progress { seq: number; total: string } // total は最小単位（10^-6）の整数を文字列で
const btn: React.CSSProperties = { padding: '0.7em 1.1em', borderRadius: '0.6em', border: '1px solid #d4d4d4', background: '#fff', fontSize: '1rem', cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, background: '#14532d', color: '#fff', borderColor: '#14532d' };
const input: React.CSSProperties = { padding: '0.6em', borderRadius: '0.5em', border: '1px solid #d4d4d4', fontSize: '1rem', width: '100%', fontFamily: 'monospace' };

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
}

export default function HouseholdPage() {
  const [keys, setKeys] = useState<Keys>();
  const [alg, setAlg] = useState<Alg>('ECDSA-P256');
  const [exportResult, setExportResult] = useState('');
  const [check, setCheck] = useState<CheckInfo>();
  const [progress, setProgress] = useState<Progress>({ seq: 0, total: '0' });
  const [shopId, setShopId] = useState('');
  const [amount, setAmount] = useState('0.1');
  const [slip, setSlip] = useState<{ qr: string; version: number; hex: string; bytes: number; signMs: number; seq: number; total: string }>();
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void (async () => {
      const k = await kvGet<Keys>('household:keys');
      if (k) { setKeys(k); setAlg(k.alg); }
      const c = await kvGet<CheckInfo>('household:check');
      if (c) { setCheck(c); setProgress((await kvGet<Progress>(`household:progress:${c.CheckID}`)) ?? { seq: 0, total: '0' }); }
    })();
  }, []);

  const createKeys = async () => {
    const pair = await generateKeyPair(alg);
    const raw = await exportPublicRaw(pair.publicKey);
    const k: Keys = { alg, privateKey: pair.privateKey, publicKey: pair.publicKey, publicRaw: hex(raw), invoiceId: hex(await sha256(raw)) };
    await kvSet('household:keys', k);
    setKeys(k);
    // 試験用の Check 一覧: CheckID・SendMax は 11a の Check、InvoiceID はこの鍵の値、期限は 30 日後（台帳には作らない）
    const c: CheckInfo = { ...CHECK_11A, InvoiceID: k.invoiceId, Expiration: Math.floor(Date.now() / 1000) - RIPPLE_EPOCH + 30 * 86400,
      source: '試験用（CheckID・SendMax は 11a 確認 1 の Check。InvoiceID はこの世帯の鍵、期限は 30 日後に差し替え。台帳には作っていない）' };
    await kvSet('household:check', c);
    await kvSet(`household:progress:${c.CheckID}`, { seq: 0, total: '0' });
    setCheck(c);
    setProgress({ seq: 0, total: '0' });
    setSlip(undefined);
  };

  // 確認 1: 秘密鍵を書き出そうとする（取り出せない鍵なら InvalidAccessError）
  const tryExport = async () => {
    const out: string[] = [];
    for (const f of ['pkcs8', 'jwk'] as const) {
      try { await crypto.subtle.exportKey(f, keys!.privateKey); out.push(`${f}: 書き出せてしまった`); }
      catch (e) { out.push(`${f}: ${(e as DOMException).name}（${(e as Error).message}）`); }
    }
    out.push(`extractable=${String(keys!.privateKey.extractable)}`);
    setExportResult(out.join(' / '));
  };

  const makeSlip = async () => {
    setMsg('');
    try {
      if (!keys || !check) throw new Error('先に鍵を作る');
      if (!/^[0-9A-Fa-f]{32}$/.test(shopId)) throw new Error('お店の ID は 16 バイト（16 進 32 文字）');
      const seq = progress.seq + 1;
      const total = BigInt(progress.total) + toUnits(amount);
      if (total > toUnits(check.SendMax)) throw new Error(`合計 ${fromUnits(total)} が上限 ${check.SendMax} を超える（世帯の画面で止める）`);
      const slipBytes = encodeSlip({ checkId: unhex(check.CheckID), seq, total, shopId: unhex(shopId), time: Math.floor(Date.now() / 1000) });
      const t = performance.now();
      const signature = await sign(keys.alg, keys.privateKey, slipBytes);
      const signMs = Math.round((performance.now() - t) * 100) / 100;
      const packed = packQr({ slip: { checkId: unhex(check.CheckID), seq, total, shopId: unhex(shopId), time: 0 }, slipBytes, signature, publicKey: unhex(keys.publicRaw), alg: keys.alg });
      const { url, version } = await qrDataUrl(packed);
      const p = { seq, total: total.toString() };
      await kvSet(`household:progress:${check.CheckID}`, p);
      setProgress(p);
      setSlip({ qr: url, version, hex: hex(packed), bytes: packed.length, signMs, seq, total: fromUnits(total) });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // 二重払いの試験用: 番号と合計額を 1 つ前に戻す（悪意のある世帯の動きを再現する）
  const rewind = async (to: Progress) => { await kvSet(`household:progress:${check!.CheckID}`, to); setProgress(to); };
  const [history, setHistory] = useState<Progress[]>([]);
  useEffect(() => { setHistory((h) => (h.at(-1)?.seq === progress.seq ? h : [...h, progress])); }, [progress]);

  const scanShop = async (file?: File) => {
    try {
      const b = file ? await readQrFromImage(file) : await new Promise<Uint8Array>((res, rej) => {
        setScanning(true);
        void scanQrFromCamera(videoRef.current!, (x) => { setScanning(false); res(x); }).catch((e) => { setScanning(false); rej(e); });
      });
      if (b.length !== 16) throw new Error(`お店の QR ではない（${b.length} バイト）`);
      setShopId(hex(b));
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <Stack as="main" isContainer hasGutter g="30" py="40">
      <Heading level="1" fz="2xl">世帯: 伝票をつくる</Heading>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">1. 鍵（初回・オンライン）</Heading>
          <Cluster g="10">
            <select value={alg} onChange={(e) => setAlg(e.target.value as Alg)} style={{ padding: '0.6em', fontSize: '1rem' }} data-testid="alg">
              <option value="ECDSA-P256">ECDSA P-256</option>
              <option value="Ed25519">Ed25519（任意の確認）</option>
            </select>
            <button type="button" style={primary} onClick={() => void createKeys()} data-testid="create-keys">{keys ? '鍵を作り直す' : '鍵を作る'}</button>
            {keys && <button type="button" style={btn} onClick={() => void tryExport()} data-testid="try-export">秘密鍵を取り出してみる</button>}
          </Cluster>
          {keys && (
            <Stack g="5" style={{ fontSize: '0.875rem', wordBreak: 'break-all' }}>
              <Text>方式: {keys.alg} / 秘密鍵 extractable={String(keys.privateKey.extractable)}</Text>
              <Text>公開鍵: <code>{keys.publicRaw}</code></Text>
              <Text>公開鍵の SHA-256（Check の InvoiceID に入れる値）: <b data-testid="invoice-id">{keys.invoiceId}</b></Text>
            </Stack>
          )}
          {exportResult && <Text data-testid="export-result" fz="s">{exportResult}</Text>}
          {check && (
            <Stack g="5">
              <Text fz="xs" c="text-2">お店に渡す Check の一覧（{check.source}）</Text>
              <textarea readOnly value={JSON.stringify([check])} rows={3} style={{ ...input, fontSize: '0.75rem' }} data-testid="checks-json" />
              <Cluster><button type="button" style={btn} onClick={() => download('checks.json', JSON.stringify([check], null, 2), 'application/json')}>Check 一覧を書き出す</button></Cluster>
            </Stack>
          )}
        </Stack>
      </Box>

      {keys && check && (
        <Box bd bdrs="20" p="20">
          <Stack g="10">
            <Heading level="2" fz="l">2. 支払い（オフラインで可）</Heading>
            <Text fz="s">Check {check.CheckID.slice(0, 12)}… / 上限 {check.SendMax} / これまで: 番号 <b data-testid="seq">{progress.seq}</b>・合計 <b data-testid="total">{fromUnits(BigInt(progress.total))}</b></Text>
            <label>お店の ID（16 進 32 文字）<input style={input} value={shopId} onChange={(e) => setShopId(e.target.value.trim())} data-testid="shop-id" /></label>
            <Cluster g="10">
              <button type="button" style={btn} onClick={() => void scanShop()}>お店の QR をカメラで読む</button>
              <label style={btn}>お店の QR の画像を選ぶ<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void scanShop(e.target.files?.[0])} /></label>
            </Cluster>
            <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 360, display: scanning ? 'block' : 'none' }} />
            <label>今回の額（受給証）<input style={input} value={amount} onChange={(e) => setAmount(e.target.value.trim())} data-testid="amount" /></label>
            <Cluster><button type="button" style={primary} onClick={() => void makeSlip()} data-testid="make-slip">伝票をつくる</button></Cluster>
            {msg && <Text c="#b91c1c" data-testid="household-msg">{msg}</Text>}
            {slip && (
              <Stack g="5" ai="center">
                <img src={slip.qr} alt="伝票の QR" data-testid="slip-qr" style={{ width: 280, imageRendering: 'pixelated' }} />
                <Text fz="s" data-testid="slip-info">番号 {slip.seq}・合計 {slip.total} / {slip.bytes} バイト・QR 型番 {slip.version} / 署名 {slip.signMs} ms</Text>
                <input type="hidden" value={slip.hex} data-testid="slip-hex" readOnly />
                <button type="button" style={btn} onClick={() => download(`slip-${slip.seq}.bin`, unhex(slip.hex) as BlobPart, 'application/octet-stream')}>伝票を書き出す（.bin）</button>
              </Stack>
            )}
          </Stack>
        </Box>
      )}

      {keys && check && history.length > 1 && (
        <Box bd bdc="#b91c1c" bdrs="20" p="20">
          <Stack g="10">
            <Text fz="s" c="#b91c1c">試験用（二重払いを再現する）: 番号と合計額を前の状態に戻す。正しい世帯の画面にはない操作。</Text>
            <Cluster g="10">
              {history.slice(0, -1).map((h) => (
                <button key={h.seq} type="button" style={btn} onClick={() => void rewind(h)} data-testid={`rewind-${h.seq}`}>番号 {h.seq}・合計 {fromUnits(BigInt(h.total))} に戻す</button>
              ))}
            </Cluster>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
