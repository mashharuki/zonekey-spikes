import { Lism, Flex, Cluster } from 'lism-css/react';

export default function Header({ online, offlineReady }: { online: boolean; offlineReady: boolean }) {
  const baseUrl = import.meta.env.BASE_URL;
  return (
    <Lism as="header" isContainer hasGutter bd-b>
      <Flex ai="center" jc="between" py="20" g="10" style={{ flexWrap: 'wrap' }}>
        <a href={`${baseUrl}#/`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em', color: 'inherit', textDecoration: 'none' }}>
          <img src={`${baseUrl}icon.svg`} alt="" width="28" height="28" />
          <Lism as="span" fw="bold" style={{ whiteSpace: 'nowrap' }}>受取証明チェッカー</Lism>
        </a>
        <Cluster g="10">
          <Lism as="span" fz="xs" px="10" py="5" bdrs="99" bgc={online ? 'base-2' : '#fef3c7'} data-testid="net">
            {online ? 'オンライン' : 'オフライン'}
          </Lism>
          <Lism as="span" fz="xs" px="10" py="5" bdrs="99" bgc={offlineReady ? '#dcfce7' : 'base-2'} data-testid="sw">
            {offlineReady ? 'オフライン可' : '保存中…'}
          </Lism>
        </Cluster>
      </Flex>
    </Lism>
  );
}
