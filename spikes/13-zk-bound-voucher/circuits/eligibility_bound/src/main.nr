// 受給資格の証明（spike 13）。spike 08 の回路からの変更:
//  - 葉と公開入力から acct（世帯の固定アドレス）を外した
//  - 世帯の秘密は名簿に入れず、hh_id = H(hh_secret) だけを名簿の葉に入れる
//  - 公開入力に「申請内容の SHA-256（req_hi, req_lo）」と、それを hh_secret に結び付ける req_tag を追加
// 主張: 「登録簿（root）に載った世帯の秘密を知っていて、その世帯は制度の条件を満たし、
//        nullifier はその世帯×制度で決まる値で、この申請内容（req_hi, req_lo）に対して作った証明である」
use zkv_lib::{DEPTH, ZONES, hh_id_of, leaf_hash, merkle_root, nullifier_hash, request_tag};

fn main(
    // ---- 公開入力（発券サービスが自分の値と照合する） ----
    root: pub Field,
    program_id: pub Field,
    zone_set: pub [Field; ZONES], // 使わない枠は対象ゾーンの重複で埋める（0 埋めは不可）
    need_senior: pub bool,
    need_revictim: pub bool,
    min_tier: pub u8,
    req_hi: pub Field, // 申請内容（鍵のハッシュ・店・資産・額面・期限・Condition・制度）の SHA-256 の上位 16B
    req_lo: pub Field, // 同、下位 16B
    nullifier: pub Field,
    req_tag: pub Field,
    // ---- 秘密の入力 ----
    zone: Field,
    senior: bool,
    revictim: bool,
    tier: u8,
    hh_secret: Field,
    salt: Field,
    index: Field,
    siblings: [Field; DEPTH],
) {
    // req_hi / req_lo が 128 ビット以内であることは回路では強制しない（assert_max_bit_size::<128>() を 2 つ入れると
    // ゲートが 1593 → 4347、2 の冪が 2048 → 8192 になり、証明が遅くなる。REPORT の「測ったこと」）。
    // 代わりに発券側が公開入力を「自分で計算した 128 ビット以内の値」と完全一致で照合する（issuer.ts）。

    // 登録簿に載っていること。hh_id は秘密から導くので、秘密を知らない者は葉を作れない
    let leaf = leaf_hash(hh_id_of(hh_secret), zone, senior, revictim, tier, salt);
    assert(merkle_root(leaf, index, siblings) == root, "merkle root mismatch");

    // ゾーンが対象のどれか
    let mut in_set = false;
    for i in 0..ZONES {
        in_set = in_set | (zone == zone_set[i]);
    }
    assert(in_set, "zone not in zone_set");

    // 条件
    assert(!need_senior | senior, "senior required");
    assert(!need_revictim | revictim, "revictim required");
    assert(tier >= min_tier, "tier below min_tier");

    // 制度ごとの一意性
    assert(nullifier == nullifier_hash(hh_secret, program_id), "nullifier mismatch");

    // 申請への結び付け
    assert(req_tag == request_tag(hh_secret, program_id, req_hi, req_lo), "request tag mismatch");
}
