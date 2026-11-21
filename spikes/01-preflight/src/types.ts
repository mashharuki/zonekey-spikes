import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addRow, emptyResult, type CheckResult } from "./check.js";

const SPIKE_DIR = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const REQUIRED_TYPES = ["Batch", "CredentialCreate", "CredentialAccept", "OracleSet", "DIDSet", "EscrowCreate"];

function findPackageRoot(entry: string, name: string): string | undefined {
  let dir = dirname(entry);
  for (;;) {
    const pj = resolve(dir, "package.json");
    if (existsSync(pj) && (JSON.parse(readFileSync(pj, "utf8")) as { name?: string }).name === name) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** TypeScript 7 には従来の JS コンパイラ API が無いので、tsc を実行して診断を解析する */
function runProbe(): { output: string; tscVersion: string } {
  const tscBin = resolve(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const run = (args: string[]): string => {
    try {
      return execFileSync(process.execPath, [tscBin, ...args], { cwd: SPIKE_DIR, encoding: "utf8" });
    } catch (e) {
      // tsc は診断があると非ゼロ終了する。出力を解析したいので stdout を返す
      return String((e as { stdout?: string }).stdout ?? e);
    }
  };
  return {
    output: run(["-p", "tsconfig.probe.json", "--noEmit", "--pretty", "false"]),
    tscVersion: run(["--version"]).trim(),
  };
}

export async function checkTypes(): Promise<CheckResult> {
  const res = emptyResult();

  // xrpl.js のバージョン
  let version = "不明";
  let root: string | undefined;
  try {
    root = findPackageRoot(require.resolve("xrpl"), "xrpl");
    if (root) version = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string }).version;
  } catch {
    // 解決できなければ「不明」のまま
  }
  addRow(res, version === "不明" ? "unknown" : "pass", {
    item: "インストール済み xrpl.js のバージョン",
    expected: "取得できる（最新版であること）",
    actual: version,
    evidence: `${root ?? "package.json を解決できず"}。最新版かどうかはレジストリ未確認（\`pnpm view xrpl version\` で比較）`,
  });

  const { output, tscVersion } = runProbe();
  const lines = output.split("\n").filter((l) => l.includes("error TS"));
  const missing = new Set<string>();
  const failedMarkers = new Set<string>();
  const probeSrc = readFileSync(resolve(SPIKE_DIR, "probe/types-probe.ts"), "utf8").split("\n");
  for (const l of lines) {
    const m = /has no exported member '(\w+)'/.exec(l);
    if (m?.[1]) missing.add(m[1]);
    const loc = /types-probe\.ts\((\d+),/.exec(l);
    if (loc?.[1]) {
      const src = probeSrc[Number(loc[1]) - 1] ?? "";
      const marker = /CHECK_[A-Z_]+/.exec(src)?.[0];
      if (marker) failedMarkers.add(marker);
    }
  }
  const unexpected = lines.filter((l) => !/has no exported member/.test(l) && !/CHECK_|types-probe\.ts\(\d+,\d+\): error TS2322/.test(l));

  const probeRanOk = lines.length > 0 || output.trim() === "";
  const present = REQUIRED_TYPES.filter((t) => !missing.has(t));
  addRow(res, !probeRanOk ? "unknown" : missing.size === 0 ? "pass" : "fail", {
    item: "型のエクスポート（Batch / CredentialCreate / CredentialAccept / OracleSet / DIDSet / EscrowCreate）",
    expected: "6 つすべてが xrpl からエクスポートされている",
    actual: `あり: ${present.join(", ") || "なし"}<br>なし: ${[...missing].join(", ") || "なし"}`,
    evidence: `tsc ${tscVersion} で probe/types-probe.ts を型検査。診断数=${lines.length}${unexpected.length ? `。想定外の診断: ${unexpected.join(" / ").replaceAll("|", "/")}` : ""}`,
  });

  // EscrowCreate.Amount がトークンを受けられるか
  const escrowMissing = missing.has("EscrowCreate");
  const rawAmount = (() => {
    if (!root) return "d.ts を特定できず";
    const p = resolve(root, "dist/npm/models/transactions/escrowCreate.d.ts");
    if (!existsSync(p)) return "escrowCreate.d.ts なし";
    return readFileSync(p, "utf8").split("\n").find((l) => /^\s*Amount:/.test(l))?.trim() ?? "Amount 行なし";
  })();
  const verdict = (marker: string): string =>
    escrowMissing ? "判定不能" : failedMarkers.has(marker) ? "受けられない" : "受けられる";
  const tokenOk = !escrowMissing && !failedMarkers.has("CHECK_ESCROW_IOU") && !failedMarkers.has("CHECK_ESCROW_MPT");
  addRow(res, escrowMissing ? "unknown" : tokenOk ? "pass" : "fail", {
    item: "EscrowCreate.Amount の型（トークン対応）",
    expected: "XRP の文字列に加え、Trust Line Token（IssuedCurrencyAmount）か MPTAmount を受けられる",
    actual: `d.ts: \`${rawAmount}\`<br>XRP(drops 文字列): ${verdict("CHECK_ESCROW_XRP")} / Trust Line Token: ${verdict("CHECK_ESCROW_IOU")} / MPT: ${verdict("CHECK_ESCROW_MPT")}`,
    evidence: "probe/types-probe.ts の代入可否を tsc で判定",
  });

  if (!escrowMissing && !tokenOk) res.designImpacts.push(`xrpl.js ${version} の EscrowCreate.Amount がトークンを受けられない。型を拡張するか xrpl.js を更新する`);
  if (missing.size > 0) {
    res.designImpacts.push(`xrpl.js ${version} に型が無い: ${[...missing].join(", ")}。手書きの型で補うか、xrpl.js の更新を待つ`);
    res.unknowns.push(`xrpl.js ${version} に型が無い: ${[...missing].join(", ")}（フィールドを手書きするか、xrpl.js の更新待ちかを設計で判断する必要がある）`);
  }
  return res;
}
