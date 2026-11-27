/**
 * 回路を noir_wasm（コンパイラ本体と同じもの）でコンパイルし、circuits/target/*.json に書く。
 * nargo が入っていない環境用。nargo がある環境では `cd circuits && nargo compile --workspace` でも同じ JSON ができる
 */
import { compile_program, createFileManager } from "@noir-lang/noir_wasm";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../circuits");
mkdirSync(`${root}/target`, { recursive: true });
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["eligibility_bound", "fixture13"]) {
  const fm = createFileManager(root);
  const t = performance.now();
  const out = await compile_program(fm, `${root}/${name}` as never);
  writeFileSync(`${root}/target/${name}.json`, JSON.stringify(out.program));
  console.log(`${name}: コンパイル OK（${Math.round(performance.now() - t)} ms, noir ${out.program.noir_version}）`);
}
