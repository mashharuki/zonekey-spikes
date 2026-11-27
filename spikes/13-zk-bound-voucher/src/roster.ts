/** 名簿の管理者（registrar）。世帯の hh_id と属性から葉を作り、Merkle 木の根と経路を出す。名簿の管理者は「hh_id ⇄ 氏名・住所」の対応表を持つ（ここは推測の対象。REPORT の 5 節） */
import type { Zk } from "./zk.js";
import { DEPTH } from "./zk.js";

export interface Household {
  id: string;
  secret: bigint; // 世帯端末だけが持つ。名簿の管理者・発券サービスには渡さない
  salt: bigint;
  zone: bigint;
  senior: boolean;
  revictim: boolean;
  tier: number;
  profile: { name: string; address: string }; // 明らかな合成データ。名簿の管理者だけが持つ
}

export class Roster {
  private levels: Map<number, bigint>[] = [];
  private zeros: bigint[] = [0n];
  root = 0n;
  hhIds = new Map<string, bigint>();
  constructor(readonly members: Household[]) {}

  async build(zk: Zk) {
    for (let i = 0; i < DEPTH; i++) this.zeros.push(await zk.node(this.zeros[i]!, this.zeros[i]!));
    let cur = new Map<number, bigint>();
    for (const [i, h] of this.members.entries()) {
      const d = await zk.derive({ hhSecret: h.secret, programId: 0n, zone: h.zone, senior: h.senior, revictim: h.revictim, tier: h.tier, salt: h.salt, digest: new Uint8Array(32) });
      this.hhIds.set(h.id, d.hhId);
      cur.set(i, d.leaf);
    }
    this.levels.push(cur);
    for (let l = 0; l < DEPTH; l++) {
      const next = new Map<number, bigint>();
      for (const idx of cur.keys()) {
        const p = idx >> 1;
        if (next.has(p)) continue;
        next.set(p, await zk.node(cur.get(p * 2) ?? this.zeros[l]!, cur.get(p * 2 + 1) ?? this.zeros[l]!));
      }
      this.levels.push(next);
      cur = next;
    }
    this.root = cur.get(0)!;
    return this;
  }

  /** 世帯 i の Merkle 経路 */
  path(i: number): bigint[] {
    const out: bigint[] = [];
    let idx = i;
    for (let l = 0; l < DEPTH; l++) { out.push(this.levels[l]!.get(idx ^ 1) ?? this.zeros[l]!); idx >>= 1; }
    return out;
  }
}
