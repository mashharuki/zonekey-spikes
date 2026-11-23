import { lazy, Suspense, useEffect, useState } from 'react';
import { Lism, Stack, Center, Heading, Text, Cluster, Flex } from 'lism-css/react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const HouseholdPage = lazy(() => import('./household/HouseholdPage'));
const ShopPage = lazy(() => import('./shop/ShopPage'));

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return hash;
};
const useOnline = () => {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const f = () => setOn(navigator.onLine); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []);
  return on;
};

const link: React.CSSProperties = { background: '#14532d', color: '#fff', padding: '1em 2em', borderRadius: '0.75em', fontWeight: 600, textDecoration: 'none' };

export default function App() {
  const hash = useHash();
  const online = useOnline();
  const { offlineReady: [offlineReady] } = useRegisterSW({ immediate: true });
  const ready = offlineReady || !!navigator.serviceWorker?.controller;
  return (
    <Stack min-h="100svh">
      <Lism as="header" isContainer hasGutter bd-b>
        <Flex ai="center" jc="between" py="20" g="10" style={{ flexWrap: 'wrap' }}>
          <a href="#/" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>Todoke 券（試験）</a>
          <Cluster g="5">
            <Lism as="span" fz="xs" px="10" py="5" bdrs="99" bgc={online ? 'base-2' : '#fef3c7'} data-testid="online">{online ? 'オンライン' : 'オフライン'}</Lism>
            <Lism as="span" fz="xs" px="10" py="5" bdrs="99" bgc={ready ? '#dcfce7' : 'base-2'} data-testid="sw">{ready ? 'オフライン可' : '保存中…'}</Lism>
          </Cluster>
        </Flex>
      </Lism>
      <Suspense fallback={<Center p="40"><Text>読み込み中…</Text></Center>}>
        {hash.startsWith('#/household') ? <HouseholdPage /> : hash.startsWith('#/shop') ? <ShopPage /> : (
          <Center as="section" isContainer hasGutter fxg="1" g="30" py="50">
            <Heading level="1" fz="3xl" ta="center">お店で使える券</Heading>
            <Text ta="center" c="text-2" max-w="34em">支援金はお店宛ての券として台帳にロックされています。世帯は券の QR を見せるだけ。お店はネットがなくても、その場で本物か確かめられます。</Text>
            <Cluster g="20" jc="center">
              <a href="#/household" style={link} data-testid="open-household">世帯の画面</a>
              <a href="#/shop" style={link} data-testid="open-shop">お店の画面</a>
            </Cluster>
          </Center>
        )}
      </Suspense>
    </Stack>
  );
}
