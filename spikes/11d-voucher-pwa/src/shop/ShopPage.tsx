import { useEffect, useRef, useState } from 'react';
import { Stack, Box, Cluster, Heading, Text } from 'lism-css/react';
import { claimAdd, claimAll, kvGet, kvSet } from '../lib/db';
import { readQrFromImage, scanQrFromCamera } from '../lib/qr';
import { download, labelOf, type Claim, type ShopSyncFile } from '../lib/exchange';
import { rippleNow } from '../../../11c-voucher-escrow/src/voucher/core';
import { verifyVoucher, type ShopResult } from '../../../11c-voucher-escrow/src/voucher/shop';

/** お店の画面。オンライン中に取り込んだ「自店宛ての券の一覧」だけで、券の QR をオフラインで確かめる（11c と同じ verifyVoucher） */
const MARGIN = 120; // 期限の 120 秒前からは受け付けない
const btn: React.CSSProperties = { padding: '0.7em 1.1em', borderRadius: '0.6em', border: '1px solid #d4d4d4', background: '#fff', fontSize: '1rem', cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, background: '#14532d', color: '#fff', borderColor: '#14532d' };

export default function ShopPage() {
  const [sync, setSync] = useState<ShopSyncFile>();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [result, setResult] = useState<{ source: string; r?: ShopResult; error?: string; ms?: number; bytes?: number }>();
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void (async () => {
      setSync(await kvGet<ShopSyncFile>('shop:sync'));
      setClaims(await claimAll<Claim>());
    })();
  }, []);

  const importSync = async (f?: File) => {
    if (!f) return;
    const s = JSON.parse(await f.text()) as ShopSyncFile;
    if (s.kind !== 'todoke-11d-shop') { setResult({ source: f.name, error: 'お店の一覧のファイルではない' }); return; }
    await kvSet('shop:sync', s);
    setSync(s);
  };

  const receive = async (source: string, get: () => Promise<Uint8Array>) => {
    try {
      const bytes = await get();
      const t = performance.now();
      const r = await verifyVoucher(bytes, sync?.list ?? [], { shop: sync?.shop ?? '', nowRipple: rippleNow(), marginSec: MARGIN, used: new Set(claims.map((c) => c.index)) });
      const ms = Math.round((performance.now() - t) * 100) / 100;
      if (r.ok) {
        const c: Claim = { index: r.escrow.index, offerSequence: r.escrow.offerSequence, owner: r.escrow.owner, value: r.escrow.amount.value, fulfillmentHex: r.fulfillmentHex, at: new Date().toISOString(), verifyMs: ms };
        await claimAdd(c);
        setClaims((x) => [...x, c]);
      }
      setResult({ source, r, ms, bytes: bytes.length });
    } catch (e) {
      setResult({ source, error: (e as Error).message });
    }
  };
  const onFile = (f?: File) => { if (f) void receive(f.name, async () => (f.type.startsWith('image/') ? readQrFromImage(f) : new Uint8Array(await f.arrayBuffer()))); };
  const camera = () => {
    setScanning(true);
    void scanQrFromCamera(videoRef.current!, (b) => { setScanning(false); void receive('カメラの QR', async () => b); }).catch((e) => { setScanning(false); setResult({ source: 'カメラ', error: (e as Error).message }); });
  };

  const ok = result?.r?.ok === true;
  const total = claims.reduce((s, c) => s + Number(c.value), 0);
  return (
    <Stack as="main" isContainer hasGutter g="30" py="40">
      <Heading level="1" fz="2xl">お店: 券を受け取る</Heading>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">1. 自店宛ての券の一覧（オンラインのうちに取り込む）</Heading>
          <Cluster><label style={btn}>一覧（shop-sync.json）を取り込む<input type="file" accept="application/json,.json" style={{ display: 'none' }} data-testid="sync-file" onChange={(e) => { void importSync(e.target.files?.[0]); e.target.value = ''; }} /></label></Cluster>
          <Text fz="s" data-testid="sync-count" style={{ wordBreak: 'break-all' }}>{sync ? `お店 ${sync.shop} / ${sync.list.length} 枚 / 同期 ${new Date(sync.syncedAt).toLocaleString('ja-JP')}` : '未取り込み'}</Text>
        </Stack>
      </Box>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">2. 券の QR を読む（オフラインで可）</Heading>
          <Cluster g="10">
            <button type="button" style={primary} onClick={camera} disabled={!sync}>カメラで QR を読む</button>
            <label style={btn}>QR の画像を選ぶ<input type="file" accept="image/*,.bin,application/octet-stream" style={{ display: 'none' }} data-testid="voucher-file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </Cluster>
          <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 360, display: scanning ? 'block' : 'none' }} />
          {result && (
            <Box bd bdc={ok ? '#15803d' : '#b91c1c'} bgc={ok ? '#f0fdf4' : '#fef2f2'} bdrs="20" p="20" data-testid="shop-result" data-ok={String(ok)}>
              <Stack g="5">
                <Text fz="xs" c="text-2">{result.source}</Text>
                <Text fz="4xl" fw="bold" style={{ color: ok ? '#15803d' : '#b91c1c' }} data-testid="shop-verdict">{ok ? '受け付け' : '使えません'}</Text>
                {result.r?.ok && <Text fz="2xl" fw="bold">{labelOf(result.r.escrow.amount.value)}</Text>}
                <Text fz="s">{result.error ? `読めませんでした: ${result.error}` : result.r?.reason}</Text>
                {result.ms !== undefined && <Text fz="xs" c="text-2">{result.bytes} B・確認 {result.ms} ms・通信なし</Text>}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">3. 受け付けた券（{claims.length} 枚・受給証 {total}）</Heading>
          {claims.map((c) => <Text key={c.index} fz="xs" style={{ wordBreak: 'break-all' }}>{labelOf(c.value)}・番号 {c.offerSequence}・{new Date(c.at).toLocaleString('ja-JP')}・{c.verifyMs} ms</Text>)}
          <Cluster><button type="button" style={btn} disabled={!claims.length} onClick={() => download(`claims-${sync?.shop.slice(0, 8) ?? 'shop'}.json`, JSON.stringify({ kind: 'todoke-11d-claims', shop: sync?.shop, claims }, null, 2))} data-testid="claims-download">精算用に書き出す</button></Cluster>
        </Stack>
      </Box>
    </Stack>
  );
}
