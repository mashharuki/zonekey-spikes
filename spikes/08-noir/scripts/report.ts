/**
 * bench/node-results.json と bench/browser-results.json から REPORT.md を作る。
 * 数値はそのまま転記し、結論は数値から機械的に決める（閾値はコード内に明記）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => new URL(p, import.meta.url);
const load = (p: string): Any => (existsSync(here(p)) ? JSON.parse(readFileSync(here(p), "utf8")) : undefined);
const node: Any = load("../bench/node-results.json");
const web: Any = load("../bench/browser-results.json");
if (!node) throw new Error("bench/node-results.json がありません。先に pnpm --filter 08-noir bench を実行してください");

const kb = (b: number) => `${(b / 1024).toFixed(1)} KiB`;
const mb = (b: number) => `${(b / 2 ** 20).toFixed(2)} MiB`;
const s = (x: Any) => (x ? `平均 ${x.avg} ms（最小 ${x.min} / 最大 ${x.max}、n=${x.n}）` : "—");
const nat = node.modes.find((m: Any) => m.label === "native");
const wsm = node.modes.find((m: Any) => m.label === "wasm");

// デモ中に証明を作れるかの判定基準: 利用者が待てる目安を 10 秒とする（ブラウザでの証明時間で判断）
const DEMO_LIMIT_MS = 10_000;
const browserProve = web?.prove?.warmProve?.avg ?? web?.prove?.firstProveMs;
const browserFirst = web?.prove?.firstProveMs;
const bbw = (node.bbBrowserWasm ?? []).find((x: Any) => x.file === (web?.crossOriginIsolated === false ? "barretenberg.js" : "barretenberg-threads.js"));
const noirWasmDecoded = (web?.wasm?.files ?? []).filter((f: Any) => !f.url.includes("?")).reduce((a: number, f: Any) => a + f.decoded, 0);
const wasmTotal = bbw ? noirWasmDecoded + bbw.wasmBytes : undefined;
const crsCacheBytes = (node.crsCache ?? []).reduce((a: number, f: Any) => a + f.bytes, 0);
// UA がモバイルでも、hardwareConcurrency が計測機の CPU 数と同じなら DevTools のエミュレーションとみなす
const emulated = web && /Mobile/.test(web.userAgent) && web.hardwareConcurrency === node.machine.cpus;
const negOk = node.negative.every((r: Any) => r.blocked);
const verifyOk = [nat, wsm].every((m: Any) => !m || (m.verify?.withVkAllTrue && m.verify?.rejectsTamperedPublicInput));
const errors = [nat?.error, wsm?.error, web?.error].filter(Boolean);
const verdict = !negOk || errors.length > 0 || !verifyOk ? "不合格" : web ? "合格" : "一部合格（ブラウザ計測が未実施）";

const row = (a: string, b: string, c: string, d: string) => `| ${a} | ${b} | ${c} | ${d} |`;
const modeRows = (m: Any) => !m ? [] : [
  row(`[${m.label}] 初期化`, "—", `${m.initMs} ms`, "Barretenberg.new"),
  row(`[${m.label}] 1件目 execute / prove`, "計測", `${m.single?.firstExecuteMs} ms / ${m.single?.firstProveMs} ms`, "初回（VK 生成後）"),
  row(`[${m.label}] 2件目以降 prove`, "計測", s(m.single?.warmProve), "5件"),
  row(`[${m.label}] ${m.batch?.n} 件を順に`, "計測", `合計 ${m.batch?.totalMs} ms（1件 ${m.batch?.perProofMs} ms）`, "execute + prove"),
  row(`[${m.label}] 検証（VK 事前）`, "計測", s(m.verify?.withVk), "UltraHonkVerifierBackend"),
  row(`[${m.label}] 検証（VK 毎回再計算）`, "計測", s(m.verify?.recomputeVk), "UltraHonkBackend.verifyProof"),
  row(`[${m.label}] 改ざんした公開入力を拒否`, "true", String(m.verify?.rejectsTamperedPublicInput), "acct を書き換え"),
  row(`[${m.label}] 最大メモリ`, "計測", `Node ${m.memory?.peakNodeMB} MiB / 子プロセス ${m.memory?.peakChildrenMB} MiB`, "RSS を 200ms ごとに採取"),
  ...(m.error ? [row(`[${m.label}] エラー`, "なし", m.error, "")] : []),
];

const md = `# 08-noir: 資格証明の Noir 回路（UltraHonk）計測

計測日時: Node ${node.at}${web ? ` / ブラウザ ${web.at}` : ""}

## バージョン

| 部品 | バージョン |
|---|---|
| Noir コンパイラ（nargo） | ${node.versions.noir_compiler} |
| @noir-lang/noir_js | ${node.versions.noir_js} |
| bb.js（UltraHonk） | @aztec-foundation/bb.js ${node.versions.bb_js}（同梱の bb ${node.versions.bb_js}。旧名 @aztec/bb.js は 5.x で止まり改名された） |
| verifierTarget | ${node.verifierTarget}（ZK あり・Poseidon2。検証は台帳外の keeper とブラウザ） |
| 計測機 | ${node.machine.platform}/${node.machine.arch}, ${node.machine.cpuModel}, ${node.machine.cpus} スレッド, ${node.machine.memGB} GB, Node ${node.machine.node} |
| ブラウザ | ${web ? `${emulated ? "**DevTools のモバイル表示（実機ではない）** " : ""}${web.userAgent}（crossOriginIsolated=${web.crossOriginIsolated}, hardwareConcurrency=${web.hardwareConcurrency}）` : "未計測"} |

bb の CLI は入れていない（bbup のインストールが実行環境で許可されなかった）。ゲート数は bb.js の \`circuitStats\` で取った。

## 1. 結論

**${verdict}**

- 正しい入力で証明が作れ、Node（native / wasm）で検証が通った: ${verifyOk ? "はい" : "いいえ"}
- 各制約を 1 つずつ破った入力で証明が作れず、狙った制約で止まる（nargo test 13 件 + noir_js の execute ${node.negative.length} 件）: ${negOk ? "はい" : "いいえ"}

## 2. 確認項目

| 項目 | 期待 | 実際 | 根拠 |
|---|---|---|---|
| 回路の大きさ | — | ${typeof nat?.gates === "object" ? `ACIR ${nat.gates.numAcirOpcodes} opcodes / ゲート ${nat.gates.numGates}（2の冪 ${nat.gates.numGatesDyadic}）` : String(nat?.gates)} | circuitStats |
| 証明のバイト数 | — | ${nat?.sizes?.proofBytes} B（${kb(nat?.sizes?.proofBytes ?? 0)}）＋公開入力 ${nat?.sizes?.publicInputs} 個 × 32 B = ${nat?.sizes?.publicInputsBytes} B | ProofData |
| 検証鍵のバイト数 | — | ${nat?.sizes?.vkBytes} B（${kb(nat?.sizes?.vkBytes ?? 0)}）、生成 ${nat?.vk?.ms} ms | getVerificationKey |
${modeRows(nat).join("\n")}
${modeRows(wsm).join("\n")}
${web ? [
  row("[ブラウザ] wasm 初期化", "—", `noir ${web.noirWasmInitMs} ms / bb ${web.bbInitMs} ms`, "initACVM+initNoirC / Barretenberg.new"),
  row("[ブラウザ] 検証（VK 事前）", "true", `${s(web.verify?.withVk)}、すべて ${web.verify?.allTrue}`, "Node で作った証明"),
  row("[ブラウザ] 証明 1件目", "計測", `execute ${web.prove?.firstExecuteMs} ms / prove ${web.prove?.firstProveMs} ms`, "wasm"),
  row("[ブラウザ] 証明 2件目以降", "計測", s(web.prove?.warmProve), "wasm"),
  row("[ブラウザ] wasm（Noir: acvm + noirc_abi）", "計測", mb(noirWasmDecoded), "PerformanceResourceTiming（Vite 開発サーバーは無圧縮）"),
  row("[ブラウザ] wasm（bb.js）", "計測", bbw ? `展開後 ${mb(bbw.wasmBytes)}（${bbw.file} に gzip+base64 で埋め込み。JS ${mb(bbw.jsBytes)}、gzip 配信なら ${mb(bbw.jsGzipBytes)}）` : "—", "パッケージを静的に計測（data: URL なので資源一覧に .wasm として出ない）"),
  row("[ブラウザ] wasm 合計（展開後）", "計測", wasmTotal ? mb(wasmTotal) : "—", "上 2 行の和"),
  row("[ブラウザ] CRS のダウンロード", "計測", `${web.crs?.files?.length ?? 0} リクエスト。サイズは取れない（別ドメインで Timing-Allow-Origin がなく 0 と出る）。参考: Node のキャッシュ ~/.bb-crs は ${mb(crsCacheBytes)}`, "crs.aztec-labs.com"),
  ...(web.error ? [row("[ブラウザ] エラー", "なし", web.error, "")] : []),
].join("\n") : row("ブラウザ計測", "実施", "未実施", "bench/browser-results.json なし")}

### 制約を破った入力（noir_js の execute）

| ケース | 期待する止まり方 | 期待どおり止まった | メッセージ |
|---|---|---|---|
${node.negative.map((r: Any) => `| ${r.case} | \`${r.expected}\` | ${r.blocked} | \`${String(r.result).replace(/\|/g, "\\|")}\` |`).join("\n")}

${web?.wasm?.files ? `### ブラウザで読み込んだ wasm\n\n| ファイル | 展開後 | 転送 |\n|---|---|---|\n${web.wasm.files.filter((f: Any) => !f.url.includes("?")).map((f: Any) => `| ${f.url} | ${kb(f.decoded)} | ${kb(f.encoded)} |`).join("\n")}\n` : ""}
## 3. エラーコード（そのまま）

${errors.length ? errors.map((e) => `- \`${e}\``).join("\n") : "なし（制約違反時のメッセージは上の表のとおり）"}

## 4. 設計への影響

### デモ中に証明を作れるか、事前に作っておくべきか

${browserProve === undefined
  ? `ブラウザでの証明時間が未計測のため未判定。Node（native）では 1 件 ${nat?.single?.warmProve?.avg} ms、wasm では ${wsm?.single?.warmProve?.avg} ms。`
  : browserProve <= DEMO_LIMIT_MS
    ? `**デモ中に作れる。** ただし bb の初期化（wasm の展開と CRS の取得）に ${web?.bbInitMs} ms かかるので、ボタンを押してからではなくページを開いた時点で済ませておく。ブラウザ（wasm）で 1 件目 ${browserFirst} ms、2 件目以降 平均 ${browserProve} ms で、目安の ${DEMO_LIMIT_MS / 1000} 秒以内。初回に読み込む wasm は展開後で ${wasmTotal ? mb(wasmTotal) : "—"}。またデモ機の回線・CPU で変わるので、本番デモでは事前に作った証明を 1 件用意しておき、失敗したらそれに切り替える。`
    : `**事前に作っておく。** ブラウザ（wasm）で 1 件 ${browserProve} ms かかり、目安の ${DEMO_LIMIT_MS / 1000} 秒を超える。`}

- keeper（Node）側の検証は VK を事前に持てば 1 件 ${nat?.verify?.withVk?.avg} ms。\`UltraHonkBackend.verifyProof\` は毎回 VK を作り直すので ${nat?.verify?.recomputeVk?.avg} ms かかる。keeper は VK を起動時に 1 回だけ作るか、ファイルで持つ。
- 100 件の一括作成（native）は ${nat?.batch?.totalMs} ms。受給者名簿を事前に処理する用途なら問題ない大きさ。
- verifyProof が true でも「何かの公開入力で正しい」だけ。keeper は root・program_id・zone_set・need_*・min_tier を自分の状態から組み立てて、証明の公開入力と一致するかを必ず比べる。nullifier は使用済み一覧と照合する。

### 回路の注意点（レビューで見つけたこと）

- zone_set を 8 個未満で使うときは、0 ではなく有効なゾーンの重複で埋める（0 で埋めると zone=0 の葉が通る）。
- nullifier と Merkle の内部ノードがどちらも 2 入力の Poseidon2。今の形でも衝突は現実的でないが、本番ではドメイン分離の定数を先頭に入れる。
- acct が公開入力なので、同じ人の証明はプログラムをまたいでつながる。送金先を隠す設計ではない。

## 5. 分からなかったこと

- bb CLI での \`bb gates\` / \`bb prove\` の数値（CLI を入れられなかった）。
- native バックエンドの子プロセスのメモリは ps の RSS の最大値で、共有メモリの数え方は OS 依存。
- モバイル端末の実機での時間${emulated ? "（今回のブラウザ計測は Mac の Chrome でモバイル表示にしただけ）" : ""}。実機で測るには Vite を LAN に公開する必要があり、http では crossOriginIsolated にならず単一スレッドになる。
- ブラウザの bb 初期化の時間は、同じ Mac の 1 回目の計測（2026-11-22T03:04、DevTools のモバイル表示）では 3747.8 ms で、今回の 2 回目は ${web?.bbInitMs} ms だった。差は CRS や wasm のキャッシュの有無と見られるが、切り分けていない。デモ機では初回訪問で数秒かかる前提にする。
- bb.js は証明・VK 生成に必要な CRS（共通参照文字列）を crs.aztec-labs.com から取る。Node は ~/.bb-crs にキャッシュする。会場の回線が使えないときに備え、デモ機で一度実行してキャッシュを作っておく必要がある。
- Testnet は使っていない（この検証は台帳とは無関係）。
`;
writeFileSync(here("../REPORT.md"), md);
console.log("[08] wrote REPORT.md");
