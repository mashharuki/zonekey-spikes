import { useEffect, useRef, useState } from 'react';
import { Stack, Box, Cluster, Heading, Text } from 'lism-css/react';
import { kvGet, kvSet, slipAdd, slipAll } from '../slip/db';
import { checkSlip, fromUnits, hex, unpackQr, type CheckInfo, type CheckResult } from '../slip/format';
import { qrDataUrl, readQrFromImage, scanQrFromCamera } from '../slip/qr';

/** お店がためる伝票（精算スクリプトに渡す形） */
export interface StoredSlip { qrHex: string; checkId: string; seq: number; total: string; shopId: string; time: number; receivedAt: string; receiverShopId: string; receiverLabel: string }

const btn: React.CSSProperties = { padding: '0.7em 1.1em', borderRadius: '0.6em', border: '1px solid #d4d4d4', background: '#fff', fontSize: '1rem', cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, background: '#14532d', color: '#fff', borderColor: '#14532d' };

function download(name: string, data: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name;
  a.click();
}

export default function ShopPage() {
  const [shop, setShop] = useState<{ id: string; label: string }>();
  const [shopQr, setShopQr] = useState('');
  const [checks, setChecks] = useState<CheckInfo[]>([]);
  const [slips, setSlips] = useState<StoredSlip[]>([]);
  const [result, setResult] = useState<{ source: string; r?: CheckResult; error?: string; slip?: { seq: number; total: string; shopId: string }; verifyMs?: number }>();
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void (async () => {
      let s = await kvGet<{ id: string; label: string }>('shop:self');
      if (!s) {
        // お店の ID: 16 バイトの乱数（合成データ）。名前も合成
        s = { id: hex(crypto.getRandomValues(new Uint8Array(16))), label: `店-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
        await kvSet('shop:self', s);
      }
      setShop(s);
      setShopQr((await qrDataUrl(Uint8Array.from(s.id.match(/../g)!, (x) => parseInt(x, 16)))).url);
      setChecks((await kvGet<CheckInfo[]>('shop:checks')) ?? []);
      setSlips(await slipAll<StoredSlip>());
    })();
  }, []);

  const importChecks = async (f?: File) => {
    if (!f) return;
    const list = JSON.parse(await f.text()) as CheckInfo[];
    const merged = [...checks.filter((c) => !list.some((x) => x.CheckID === c.CheckID)), ...list];
    await kvSet('shop:checks', merged);
    setChecks(merged);
  };

  const receive = async (source: string, get: () => Promise<Uint8Array>) => {
    try {
      const bytes = await get();
      const s = unpackQr(bytes);
      const checkId = hex(s.slip.checkId);
      // d: このお店がすでに受け取った同じ Check の伝票のうち、いちばん新しいもの
      const prev = slips.filter((x) => x.checkId === checkId).sort((a, b) => b.seq - a.seq)[0];
      const t = performance.now();
      const r = await checkSlip(s, checks, prev ? { checkId: s.slip.checkId, seq: prev.seq, total: BigInt(prev.total), shopId: s.slip.shopId, time: prev.time } : undefined);
      const verifyMs = Math.round((performance.now() - t) * 100) / 100;
      // 追加の確認（a〜d の外）: 伝票の宛先がこのお店か
      const toMe = hex(s.slip.shopId) === shop!.id;
      if (!toMe) { r.ok = false; r.reasons.push('宛先: 別のお店宛ての伝票'); }
      if (r.ok) {
        const stored: StoredSlip = { qrHex: hex(bytes), checkId, seq: s.slip.seq, total: s.slip.total.toString(), shopId: hex(s.slip.shopId), time: s.slip.time, receivedAt: new Date().toISOString(), receiverShopId: shop!.id, receiverLabel: shop!.label };
        await slipAdd(stored);
        setSlips((x) => [...x, stored]);
      }
      setResult({ source, r, slip: { seq: s.slip.seq, total: fromUnits(s.slip.total), shopId: hex(s.slip.shopId) }, verifyMs });
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
  return (
    <Stack as="main" isContainer hasGutter g="30" py="40">
      <Heading level="1" fz="2xl">お店: 伝票を受け取る</Heading>

      <Box bd bdrs="20" p="20">
        <Cluster g="20" ai="center">
          {shopQr && <img src={shopQr} alt="お店の ID の QR" width={140} data-testid="shop-qr" />}
          <Stack g="5" style={{ wordBreak: 'break-all' }}>
            <Text fw="bold">{shop?.label}（合成）</Text>
            <Text fz="s">お店の ID: <code data-testid="shop-self-id">{shop?.id}</code></Text>
            <Text fz="xs" c="text-2">世帯の画面でこの QR を読むか、ID を入力してもらう</Text>
          </Stack>
        </Cluster>
      </Box>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">1. Check の一覧（オンラインのうちに取り込む）</Heading>
          <Cluster><label style={btn}>Check 一覧（JSON）を取り込む<input type="file" accept="application/json,.json" style={{ display: 'none' }} data-testid="checks-file" onChange={(e) => void importChecks(e.target.files?.[0])} /></label></Cluster>
          <Text fz="s" data-testid="checks-count">取り込み済み: {checks.length} 件</Text>
          {checks.map((c) => <Text key={c.CheckID} fz="xs" style={{ wordBreak: 'break-all' }}>{c.CheckID.slice(0, 16)}… 上限 {c.SendMax} / InvoiceID {c.InvoiceID.slice(0, 16)}… / {c.source}</Text>)}
        </Stack>
      </Box>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">2. 伝票を読む（オフラインで可）</Heading>
          <Cluster g="10">
            <button type="button" style={primary} onClick={camera}>カメラで QR を読む</button>
            <label style={btn}>QR の画像・伝票ファイルを選ぶ<input type="file" accept="image/*,.bin,application/octet-stream" style={{ display: 'none' }} data-testid="slip-file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </Cluster>
          <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 360, display: scanning ? 'block' : 'none' }} />
          {result && (
            <Box bd bdc={ok ? '#15803d' : '#b91c1c'} bgc={ok ? '#f0fdf4' : '#fef2f2'} bdrs="20" p="20" data-testid="shop-result" data-ok={String(ok)}>
              <Stack g="5">
                <Text fz="xs" c="text-2">{result.source}</Text>
                <Text fz="4xl" fw="bold" style={{ color: ok ? '#15803d' : '#b91c1c' }} data-testid="shop-verdict">{ok ? '受け付け' : '不一致'}</Text>
                {result.error && <Text>読めませんでした: {result.error}</Text>}
                {result.r && (
                  <>
                    {result.r.reasons.map((x) => <Text key={x} fz="s">・{x}</Text>)}
                    <Text fz="s">番号 {result.slip?.seq}・合計 {result.slip?.total} / a InvoiceID {result.r.a_invoiceId ? '✅' : '❌'}・b 署名 {result.r.b_signature ? '✅' : '❌'}・c 上限 {result.r.c_withinSendMax ? '✅' : '❌'}・c 期限 {result.r.c_beforeExpiration ? '✅' : '❌'}・d 増えている {result.r.d_increasing === undefined ? '（初回）' : result.r.d_increasing ? '✅' : '❌'} / 確認 {result.verifyMs} ms</Text>
                  </>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">3. 受け取った伝票（{slips.length} 件）</Heading>
          {slips.map((s, i) => <Text key={i} fz="xs" style={{ wordBreak: 'break-all' }}>Check {s.checkId.slice(0, 10)}… 番号 {s.seq}・合計 {fromUnits(BigInt(s.total))}・{s.receivedAt}</Text>)}
          <textarea readOnly rows={2} value={JSON.stringify(slips)} data-testid="slips-json" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }} />
          <Cluster><button type="button" style={btn} onClick={() => download(`slips-${shop?.label}.json`, JSON.stringify(slips, null, 2))}>伝票を書き出す（精算用 JSON）</button></Cluster>
        </Stack>
      </Box>
    </Stack>
  );
}
