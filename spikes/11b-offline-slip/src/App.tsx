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

const link: React.CSSProperties = { background: '#14532d', color: '#fff', padding: '1em 2em', borderRadius: '0.75em', fontWeight: 600, textDecoration: 'none' };

export default function App() {
  const hash = useHash();
  const { offlineReady: [offlineReady] } = useRegisterSW({ immediate: true });
  const ready = offlineReady || !!navigator.serviceWorker?.controller;
  return (
    <Stack min-h="100svh">
      <Lism as="header" isContainer hasGutter bd-b>
        <Flex ai="center" jc="between" py="20" g="10" style={{ flexWrap: 'wrap' }}>
          <a href="#/" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>Todoke オフライン伝票（試験）</a>
          <Lism as="span" fz="xs" px="10" py="5" bdrs="99" bgc={ready ? '#dcfce7' : 'base-2'} data-testid="sw">{ready ? 'オフライン可' : '保存中…'}</Lism>
        </Flex>
      </Lism>
      <Suspense fallback={<Center p="40"><Text>読み込み中…</Text></Center>}>
        {hash.startsWith('#/household') ? <HouseholdPage /> : hash.startsWith('#/shop') ? <ShopPage /> : (
          <Center as="section" isContainer hasGutter fxg="1" g="30" py="50">
            <Heading level="1" fz="3xl" ta="center">オフライン伝票</Heading>
            <Text ta="center" c="text-2" max-w="34em">世帯が端末の鍵で伝票に署名し、お店がネットなしで確かめる試験。台帳には触れない。</Text>
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
