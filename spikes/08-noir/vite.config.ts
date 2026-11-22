import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

/** ブラウザの計測結果を bench/browser-results.json に保存する（開発サーバーのみ） */
const saveResults = (): Plugin => ({
  name: "save-results",
  configureServer(server) {
    server.middlewares.use("/__results", (req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        writeFileSync(new URL("./bench/browser-results.json", import.meta.url), body);
        res.end("ok");
      });
    });
  },
});

// bb.js の wasm マルチスレッドには SharedArrayBuffer が必要 → COOP / COEP を付ける
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  root: "web",
  plugins: [nodePolyfills(), saveResults()],
  server: { headers: isolation, // root=web なので、回路 JSON（../circuits）と pnpm の node_modules（リポジトリ直下）も配信を許可する
    fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url)))] } },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ["@aztec-foundation/bb.js", "@noir-lang/noirc_abi", "@noir-lang/acvm_js"] },
  build: { target: "esnext", outDir: "../dist", emptyOutDir: true },
  esbuild: { target: "esnext" },
});
