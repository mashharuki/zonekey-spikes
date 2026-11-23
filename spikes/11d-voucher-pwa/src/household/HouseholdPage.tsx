import { useEffect, useState } from 'react';
import { Stack, Box, Cluster, Heading, Text } from 'lism-css/react';
import { kvGet, kvSet } from '../lib/db';
import { qrDataUrl } from '../lib/qr';
import { PLAN, download, labelOf, type RequestFile, type VouchersFile } from '../lib/exchange';
import { conditionOf, derivePreimage, encodeVoucher, hex, sha256, signVoucher, voucherLabel } from '../../../11c-voucher-escrow/src/voucher/core';

/**
 * 世帯の画面。持ち物は 32 バイトの秘密と、取り出せない端末の鍵（ECDSA P-256）だけ。XRPL の口座は持たない
 * 券の QR はその場で作る: preimage = HMAC-SHA256(秘密, 券のラベル)、署名 = 端末の鍵で（持ち主・番号・お店）に署名
 */
interface Device { id: string; secret: Uint8Array; privateKey: CryptoKey; publicKey: CryptoKey; pkHash: string }
const btn: React.CSSProperties = { padding: '0.7em 1.1em', borderRadius: '0.6em', border: '1px solid #d4d4d4', background: '#fff', fontSize: '1rem', cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, background: '#14532d', color: '#fff', borderColor: '#14532d' };
const ripple = (t: number) => new Date((t + 946684800) * 1000).toLocaleString('ja-JP');

export default function HouseholdPage() {
  const [dev, setDev] = useState<Device>();
  const [issued, setIssued] = useState<VouchersFile>();
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<{ n: number; value: string; url: string; version: number; bytes: number; ms: number; ok: boolean }>();
  const [msg, setMsg] = useState('');

  const note = (k: string, v: string) => setChecks((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    void (async () => {
      const d = await kvGet<Device>('hh:device');
      if (d) setDev(d);
      const v = await kvGet<VouchersFile>('hh:issued');
      if (v) setIssued(v);
      if (navigator.storage?.persisted) note('保存の永続化（persisted）', String(await navigator.storage.persisted()));
      if (d) note('端末の鍵（再読み込み後）', `extractable=${d.privateKey.extractable}`);
    })();
  }, []);

  const setup = async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const d: Device = { id: hex(crypto.getRandomValues(new Uint8Array(4))), secret: crypto.getRandomValues(new Uint8Array(32)), privateKey: pair.privateKey, publicKey: pair.publicKey, pkHash: hex(await sha256(pub)) };
    await kvSet('hh:device', d);
    setDev(d);
    setIssued(undefined);
    await kvSet('hh:issued', undefined);
    note('端末の鍵（作成直後）', `extractable=${pair.privateKey.extractable}`);
    if (navigator.storage?.persist) note('保存の永続化を求めた結果（persist）', String(await navigator.storage.persist()));
  };

  const tryExport = async () => {
    try { await crypto.subtle.exportKey('pkcs8', dev!.privateKey); note('秘密鍵の書き出し', '書き出せてしまった'); } catch (e) { note('秘密鍵の書き出し', `できない（${(e as Error).name}）`); }
  };

  const request = async (): Promise<string> => {
    const vouchers = [];
    for (const p of PLAN) vouchers.push({ n: p.n, value: p.value, condition: (await conditionOf(await derivePreimage(dev!.secret, voucherLabel(dev!.id, p.n)))).conditionHex });
    const r: RequestFile = { kind: 'todoke-11d-request', household: dev!.id, pkHash: dev!.pkHash, vouchers };
    return JSON.stringify(r, null, 2);
  };

  const importVouchers = async (f?: File) => {
    if (!f) return;
    try {
      const v = JSON.parse(await f.text()) as VouchersFile;
      if (v.kind !== 'todoke-11d-vouchers' || v.household !== dev?.id) throw new Error('この世帯の券のファイルではない');
      // 秘密から作り直した Condition が、台帳に作られた券と合うか
      let match = 0;
      for (const x of v.vouchers) if ((await conditionOf(await derivePreimage(dev.secret, voucherLabel(dev.id, x.n)))).conditionHex === x.condition.toUpperCase()) match++;
      note('秘密から作り直した Condition と券の一致', `${match} / ${v.vouchers.length}`);
      await kvSet('hh:issued', v);
      setIssued(v);
      setMsg('');
    } catch (e) { setMsg((e as Error).message); }
  };

  const show = async (x: VouchersFile['vouchers'][number]) => {
    const t = performance.now();
    const pre = await derivePreimage(dev!.secret, voucherLabel(dev!.id, x.n));
    const ok = (await conditionOf(pre)).conditionHex === x.condition.toUpperCase();
    const sig = await signVoucher(dev!.privateKey, issued!.owner, x.offerSequence, issued!.shop);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', dev!.publicKey));
    const bytes = encodeVoucher({ owner: issued!.owner, offerSequence: x.offerSequence, preimage: pre, sig: { pub, sig } });
    const ms = Math.round((performance.now() - t) * 10) / 10;
    const q = await qrDataUrl(bytes);
    setShown({ n: x.n, value: x.value, url: q.url, version: q.version, bytes: bytes.length, ms, ok });
  };

  return (
    <Stack as="main" isContainer hasGutter g="30" py="40">
      <Heading level="1" fz="2xl">世帯: 券を見せる</Heading>

      <Box bd bdrs="20" p="20">
        <Stack g="10">
          <Heading level="2" fz="l">1. 端末の準備（最初の 1 回）</Heading>
          <Text fz="s" c="text-2">32 バイトの秘密と、取り出せない端末の鍵を作る。XRPL の口座は作らない。</Text>
          <Cluster g="10">
            <button type="button" style={dev ? btn : primary} onClick={() => void setup()} data-testid="setup">{dev ? '作り直す（券は使えなくなる）' : '秘密と鍵を作る'}</button>
            {dev && <button type="button" style={btn} onClick={() => void tryExport()} data-testid="try-export">秘密鍵を書き出してみる</button>}
          </Cluster>
          {dev && <Text fz="s" data-testid="hh-id">世帯 ID: <code>{dev.id}</code>（合成）/ 公開鍵のハッシュ {dev.pkHash.slice(0, 16)}…</Text>}
        </Stack>
      </Box>

      {dev && (
        <Box bd bdrs="20" p="20">
          <Stack g="10">
            <Heading level="2" fz="l">2. 券の申し込み（Mac に渡す）</Heading>
            <Text fz="s" c="text-2">渡すのは Condition（preimage のハッシュ）と公開鍵のハッシュだけ。500 円券 2 枚・1,000 円券 2 枚。</Text>
            <Cluster g="10">
              <button type="button" style={primary} onClick={() => void request().then((s) => download(`request-${dev.id}.json`, s))} data-testid="request-download">申し込みを書き出す</button>
              <button type="button" style={btn} onClick={() => void request().then((s) => navigator.clipboard.writeText(s)).then(() => setMsg('コピーした'), (e: Error) => setMsg(e.message))}>コピー</button>
            </Cluster>
          </Stack>
        </Box>
      )}

      {dev && (
        <Box bd bdrs="20" p="20">
          <Stack g="10">
            <Heading level="2" fz="l">3. 券を取り込む（発行後）</Heading>
            <Cluster><label style={btn}>券のファイル（vouchers-….json）を選ぶ<input type="file" accept="application/json,.json" style={{ display: 'none' }} data-testid="vouchers-file" onChange={(e) => { void importVouchers(e.target.files?.[0]); e.target.value = ''; }} /></label></Cluster>
            {issued && <Text fz="xs" c="text-2" style={{ wordBreak: 'break-all' }}>お店 {issued.shop} / 発行 {issued.batchTx.slice(0, 16)}…</Text>}
          </Stack>
        </Box>
      )}

      {issued && (
        <Box bd bdrs="20" p="20">
          <Stack g="10">
            <Heading level="2" fz="l">4. 券（{issued.vouchers.length} 枚）— タップで QR を出す</Heading>
            <Cluster g="10">
              {issued.vouchers.map((x) => (
                <button key={x.n} type="button" style={shown?.n === x.n ? primary : btn} onClick={() => void show(x)} data-testid={`voucher-${x.n}`}>{labelOf(x.value)} #{x.n}</button>
              ))}
            </Cluster>
            {shown && (
              <Stack g="5" ai="center" data-testid="voucher-qr">
                <Text fz="2xl" fw="bold">{labelOf(shown.value)}</Text>
                <img src={shown.url} alt="券の QR" style={{ width: '100%', maxWidth: 320, imageRendering: 'pixelated' }} />
                <Text fz="xs" c="text-2">{shown.bytes} B・QR 型番 {shown.version}・作成 {shown.ms} ms・秘密と券の一致 {shown.ok ? '✅' : '❌'}・期限 {ripple(issued.vouchers.find((v) => v.n === shown.n)!.cancelAfter)}</Text>
              </Stack>
            )}
          </Stack>
        </Box>
      )}

      {msg && <Text c="#b91c1c">{msg}</Text>}
      <Box bd bdrs="20" p="20">
        <Stack g="5" data-testid="hh-checks">
          <Heading level="2" fz="l">確認メモ</Heading>
          {Object.entries(checks).map(([k, v]) => <Text key={k} fz="s">・{k}: {v}</Text>)}
          <Text fz="xs" c="text-2">{navigator.userAgent}</Text>
        </Stack>
      </Box>
    </Stack>
  );
}
