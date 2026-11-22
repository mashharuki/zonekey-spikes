import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// .env.local はリポジトリ直下にある。Vite がブラウザに渡すのは VITE_ で始まる変数だけ
// （PRIVY_APP_SECRET などのサーバー用の値はブラウザに出ない）。
export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
