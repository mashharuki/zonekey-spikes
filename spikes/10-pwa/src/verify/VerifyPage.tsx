import { useRef, useState } from 'react';
import { Stack, Box, Cluster, Heading, Text, Lism } from 'lism-css/react';
// spike 09 の検証コードをそのまま使う（Node で動かしたものと同じソース）
import { verifyReceipt, type Verdict } from '09-offline-receipt/verifier';
import trust from '../trust/testnet-unl.json';
import { readQrFromImage, scanQrFromCamera } from './qr';

type State = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; source: string; verdict: Verdict } | { kind: 'error'; source: string; message: string };

const amount = (a: unknown) =>
  typeof a === 'object' && a ? `${(a as { value: string }).value} ${(a as { currency: string }).currency}` : typeof a === 'string' ? `${Number(a) / 1e6} XRP` : '—';

const btn: React.CSSProperties = { padding: '0.8em 1.2em', borderRadius: '0.6em', border: '1px solid #d4d4d4', background: '#fff', fontSize: '1rem', cursor: 'pointer' };

export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const run = async (source: string, get: () => Promise<Uint8Array>) => {
    setState({ kind: 'busy', label: `${source} を検証中…` });
    try {
      const bytes = await get();
      setState({ kind: 'done', source, verdict: await verifyReceipt(bytes, trust) });
    } catch (e) {
      setState({ kind: 'error', source, message: (e as Error).message });
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    void run(f.name, async () => (f.type.startsWith('image/') ? readQrFromImage(f) : new Uint8Array(await f.arrayBuffer())));
  };

  const startCamera = async () => {
    setScanning(true);
    try {
      stopRef.current = await scanQrFromCamera(videoRef.current!, (b) => { setScanning(false); void run('カメラの QR', async () => b); });
    } catch (e) {
      setScanning(false);
      setState({ kind: 'error', source: 'カメラ', message: (e as Error).message });
    }
  };
  const stopCamera = () => { stopRef.current?.(); setScanning(false); };

  const sample = (name: string) => run(`サンプル ${name}`, async () => new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}samples/${name}.bin`)).arrayBuffer()));

  return (
    <Stack as="main" isContainer hasGutter g="30" py="40" fxg="1">
      <Heading level="1" fz="2xl">受取証明の検証</Heading>

      <Stack g="15">
        <Cluster g="10">
          <label style={{ ...btn, background: '#14532d', color: '#fff', borderColor: '#14532d' }}>
            ファイルを選ぶ
            <input type="file" accept=".bin,application/octet-stream,image/*" data-testid="file" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {scanning ? (
            <button type="button" style={btn} onClick={stopCamera}>読み取りをやめる</button>
          ) : (
            <button type="button" style={btn} onClick={() => void startCamera()}>カメラで QR を読む</button>
          )}
        </Cluster>
        <Text fz="xs" c="text-2">受け取りパック（.bin、そのままでも圧縮でも可）か、QR コードを写した画像を選べます。</Text>
        <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 420, borderRadius: 12, display: scanning ? 'block' : 'none', background: '#000' }} />
      </Stack>

      <Result state={state} />

      <Stack g="10">
        <Text fz="xs" c="text-2">試験用のサンプル（spike 09 で作った受け取りパック）</Text>
        <Cluster g="10">
          <button type="button" style={btn} data-testid="sample-confirmed" onClick={() => void sample('confirmed')}>確定済みのもの</button>
          <button type="button" style={btn} data-testid="sample-tampered" onClick={() => void sample('tampered')}>1 ビット書き換えたもの</button>
          <button type="button" style={btn} data-testid="sample-no-signatures" onClick={() => void sample('no-signatures')}>署名なし（S2）</button>
        </Cluster>
      </Stack>
    </Stack>
  );
}

function Result({ state }: { state: State }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'busy') return <Text data-testid="busy">{state.label}</Text>;
  const ok = state.kind === 'done' && state.verdict.confirmed;
  const color = ok ? '#15803d' : '#b91c1c';
  return (
    <Box bd bdc={color} bdrs="20" p="30" bgc={ok ? '#f0fdf4' : '#fef2f2'} data-testid="result" data-confirmed={String(ok)}>
      <Stack g="15">
        <Text fz="xs" c="text-2">{state.source}</Text>
        <Text fz="5xl" fw="bold" style={{ color, lineHeight: 1.1 }} data-testid="verdict">{ok ? '確定済み' : '不一致'}</Text>
        {state.kind === 'error' ? (
          <Text>読めませんでした: {state.message}</Text>
        ) : (
          <Detail v={state.verdict} />
        )}
      </Stack>
    </Box>
  );
}

function Detail({ v }: { v: Verdict }) {
  const rows: [string, string][] = [
    ['取引', `${String(v.target.TransactionType ?? '—')}（${String(v.target.TransactionResult ?? '—')}）`],
    ['受取人', String(v.target.Destination ?? '—')],
    ['額', amount(v.target.delivered_amount)],
    ['レジャー', `${v.ledger.index}（${v.ledger.closeTime}）`],
    ['A 台帳の木に入っている', v.A.ok ? '✅' : '❌'],
    ['C 検証者の署名', `${v.C.ok ? '✅' : '❌'} ${v.C.signers} / 定足数 ${v.C.quorum ?? '—'}（UNL ${v.C.unlSize ?? '—'} 人）`],
    ['検証者リスト', `sequence ${v.C.vlSequence ?? '—'} / 期限 ${v.C.vlExpiration ?? '—'}`],
    ['入力', `${v.input.bytes} B${v.input.compressed ? `（展開後 ${v.input.unpackedBytes} B）` : ''}／検証 ${v.ms} ms`],
  ];
  return (
    <Stack g="10">
      {v.reasons.length > 0 && (
        <Stack as="ul" g="5" style={{ paddingLeft: '1.2em', margin: 0 }}>
          {v.reasons.map((r) => <li key={r}><Lism as="span">{r}</Lism></li>)}
        </Stack>
      )}
      <Lism as="dl" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14em, 1fr))', gap: '0.75em 1.5em', margin: 0 }}>
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt style={{ color: '#525252', fontSize: '0.75rem', margin: 0 }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: '0.9375rem', wordBreak: 'break-all' }}>{val}</dd>
          </div>
        ))}
      </Lism>
    </Stack>
  );
}
