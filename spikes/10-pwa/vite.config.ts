import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
// PWA: https://vite-pwa-org.netlify.app/guide/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 新しい版が出たら自動で入れ替える（確認ダイアログは出さない）
      registerType: 'autoUpdate',
      // 事前保存の対象は下の globPatterns で決める（includeAssets や manifest のアイコンの自動追加を使うと同じファイルが重複して並ぶ）
      includeManifestIcons: false,
      manifest: {
        name: 'ZoneKey 受取証明チェッカー',
        short_name: '受取証明',
        description: 'XRPL の受け取りが台帳で確定したことを、ネットなしで確かめる',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#14532d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 画面と検証用コード（遅延読み込みの検証画面も含む）・検証者リスト・アイコン・サンプルを事前に保存する
        globPatterns: ['**/*.{js,css,html,svg,png,ico,bin}'], // manifest.webmanifest はプラグインが自動で加える
        // QR 読み取り試験用の画像（samples-qr）は public に置かないので対象外
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Privy・API・XRPL への通信は保存しない（常にネットへ。オフラインなら失敗させる）
        // 注: WebSocket（wss://…rippletest.net）は Service Worker を通らないので、ここでは扱えない
        runtimeCaching: [
          { urlPattern: ({ url }) => url.hostname === 'privy.io' || url.hostname.endsWith('.privy.io'), handler: 'NetworkOnly' },
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          {
            urlPattern: ({ url }) => ['rippletest.net', 'xrpl.org', 'ripple.com'].some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`)),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: { target: 'es2022' },
  // iPhone の実機確認で Cloudflare の一時トンネル（https://*.trycloudflare.com）から preview を開くため
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
