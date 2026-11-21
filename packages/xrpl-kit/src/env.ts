import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * リポジトリ直下の .env.local を読む（無ければ何もしない）。
 * 既に環境変数にある値は上書きしない。秘密情報はここ経由でのみ扱う。
 */
export function loadEnvLocal(startDir: string = process.cwd()): void {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = resolve(dir, ".env.local");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    // pnpm-workspace.yaml があるディレクトリがリポジトリルート
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return;
    const parent = resolve(dir, "..");
    if (parent === dir) return;
    dir = parent;
  }
}
