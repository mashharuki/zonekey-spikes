import { lazy, Suspense, useEffect, useState } from 'react';
import { Lism, Stack, Center, Heading, Text } from 'lism-css/react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Header from './components/Header';

// 検証画面は遅延読み込み（開いたときに追加で読むコードの大きさを測るため）。Service Worker が事前に保存する
const VerifyPage = lazy(() => import('./verify/VerifyPage'));

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
};

const useOnline = () => {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return online;
};

export default function App() {
  const hash = useHash();
  const online = useOnline();
  const { offlineReady: [offlineReady] } = useRegisterSW({ immediate: true });
  // 2 回目以降の起動では offlineReady は来ないので、Service Worker が制御中かでも判断する
  const ready = offlineReady || !!navigator.serviceWorker?.controller;

  return (
    <Stack min-h="100svh">
      <Header online={online} offlineReady={ready} />
      {hash.startsWith('#/verify') ? (
        <Suspense fallback={<Center p="40"><Text>読み込み中…</Text></Center>}>
          <VerifyPage />
        </Suspense>
      ) : (
        <Center as="section" isContainer hasGutter fxg="1" g="40" py="50">
          <Stack g="20" ai="center" max-w="36em">
            <Heading level="1" fz="3xl" ta="center">受取証明を確かめる</Heading>
            <Text ta="center" c="text-2">
              XRPL の受け取り取引が台帳で確定したことを、この端末の中だけで確かめます。ネットにつながっていなくても使えます。
            </Text>
          </Stack>
          <a
            href="#/verify"
            data-testid="open-verify"
            style={{ background: '#14532d', color: '#fff', padding: '1em 2em', borderRadius: '0.75em', fontWeight: 600, textDecoration: 'none', fontSize: '1.125rem' }}
          >
            検証をはじめる
          </a>
          <Text fz="xs" c="text-2" ta="center" max-w="36em">
            iPhone: Safari の共有ボタン →「ホーム画面に追加」。Android / PC の Chrome: アドレスバーのインストールボタン。
          </Text>
        </Center>
      )}
      <Lism as="footer" isContainer hasGutter py="30">
        <Center>
          <Text ta="center" c="text-2" fz="xs">
            ZoneKey Relief PoC — Testnet 専用。検証者リストは Testnet（vl.altnet.rippletest.net）のもの。
          </Text>
        </Center>
      </Lism>
    </Stack>
  );
}
