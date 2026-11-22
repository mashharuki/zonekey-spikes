// 受給資格の証明。
// 主張: 「登録簿（Merkle 根 root）に、アカウント acct の世帯が載っていて、その世帯は
//        プログラムの条件（ゾーン・高齢者・再被災・区分）を満たす。nullifier はこの世帯と
//        プログラムに一意で、同じ世帯が同じプログラムに二重に申請できない」
// 世帯の属性（zone / senior / revictim / tier）と秘密（hh_secret / salt）は公開しない。
use elig_lib::{DEPTH, leaf_hash, merkle_root, nullifier_hash, ZONES};

fn main(
    // ---- 公開入力（検証者＝keeper / 台帳側が自分の値と照合する） ----
    root: pub Field, // 登録簿の Merkle 根（DID の Data に置いた値と照合）
    acct: pub Field, // 受益者の XRPL アカウント（証明をこのアカウントに結び付け、横取りを防ぐ）
    program_id: pub Field, // プログラム（ドナー層）の識別子。nullifier の領域分離に使う
    zone_set: pub [Field; ZONES], // 対象ゾーン。使わない枠は対象ゾーンのどれかを重複させて埋める（0 埋めは不可）
    need_senior: pub bool,
    need_revictim: pub bool,
    min_tier: pub u8,
    nullifier: pub Field, // 二重申請の検出用（台帳側で使用済みか照合）
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
    // 登録簿に載っていること（acct を葉に含めるので、他人の葉では根が合わない）
    let leaf = leaf_hash(acct, zone, senior, revictim, tier, hh_secret, salt);
    assert(merkle_root(leaf, index, siblings) == root, "merkle root mismatch");

    // ゾーンが対象のどれか
    let mut in_set = false;
    for i in 0..ZONES {
        in_set = in_set | (zone == zone_set[i]);
    }
    assert(in_set, "zone not in zone_set");

    // 条件（need_* が false のときは制約しない）
    assert(!need_senior | senior, "senior required");
    assert(!need_revictim | revictim, "revictim required");
    assert(tier >= min_tier, "tier below min_tier");

    // nullifier はこの世帯とプログラムで決まる値と一致すること
    assert(nullifier == nullifier_hash(hh_secret, program_id), "nullifier mismatch");
}

// ================= テスト =================
// 正しい入力を 1 つ作り、そこから制約を 1 つずつ破る。
struct Case {
    root: Field,
    acct: Field,
    program_id: Field,
    zone_set: [Field; ZONES],
    need_senior: bool,
    need_revictim: bool,
    min_tier: u8,
    nullifier: Field,
    zone: Field,
    senior: bool,
    revictim: bool,
    tier: u8,
    hh_secret: Field,
    salt: Field,
    index: Field,
    siblings: [Field; DEPTH],
}

fn good() -> Case {
    let acct = 0x1234;
    let zone = 13101;
    let (senior, revictim, tier) = (true, true, 3);
    let (hh_secret, salt, program_id) = (0xabcdef, 0x5a17, 0x9001);
    let index = 1234; // < 2^12
    let mut siblings = [0; DEPTH];
    for i in 0..DEPTH {
        siblings[i] = (i as Field) * 7 + 11;
    }
    let leaf = leaf_hash(acct, zone, senior, revictim, tier, hh_secret, salt);
    Case {
        root: merkle_root(leaf, index, siblings),
        acct,
        program_id,
        zone_set: [13101, 13102, 13103, 13104, 13105, 13106, 13107, 13108],
        need_senior: true,
        need_revictim: true,
        min_tier: 2,
        nullifier: nullifier_hash(hh_secret, program_id),
        zone,
        senior,
        revictim,
        tier,
        hh_secret,
        salt,
        index,
        siblings,
    }
}

fn run(c: Case) {
    main(
        c.root,
        c.acct,
        c.program_id,
        c.zone_set,
        c.need_senior,
        c.need_revictim,
        c.min_tier,
        c.nullifier,
        c.zone,
        c.senior,
        c.revictim,
        c.tier,
        c.hh_secret,
        c.salt,
        c.index,
        c.siblings,
    );
}

#[test]
fn ok_all_conditions() {
    run(good());
}

#[test]
fn ok_conditions_not_required() {
    // need_* が false なら senior / revictim が false でも通る（葉を作り直す）
    let mut c = good();
    c.senior = false;
    c.revictim = false;
    c.need_senior = false;
    c.need_revictim = false;
    c.root = merkle_root(
        leaf_hash(c.acct, c.zone, false, false, c.tier, c.hh_secret, c.salt),
        c.index,
        c.siblings,
    );
    run(c);
}

#[test]
fn ok_tier_equal_min() {
    let mut c = good();
    c.min_tier = 3;
    run(c);
}

#[test(should_fail_with = "merkle root mismatch")]
fn bad_root() {
    let mut c = good();
    c.root += 1;
    run(c);
}

#[test(should_fail_with = "merkle root mismatch")]
fn bad_acct_other_account() {
    let mut c = good();
    c.acct = 0x9999;
    run(c);
}

#[test(should_fail_with = "merkle root mismatch")]
fn bad_attribute_tamper() {
    // 区分を偽って高く申告すると、葉が変わって根が合わない
    let mut c = good();
    c.tier = 5;
    run(c);
}

#[test(should_fail_with = "zone not in zone_set")]
fn bad_zone_not_in_set() {
    let mut c = good();
    c.zone_set = [1, 2, 3, 4, 5, 6, 7, 8];
    run(c);
}

#[test(should_fail_with = "senior required")]
fn bad_senior() {
    let mut c = good();
    c.senior = false;
    c.root = merkle_root(
        leaf_hash(
            c.acct,
            c.zone,
            false,
            c.revictim,
            c.tier,
            c.hh_secret,
            c.salt,
        ),
        c.index,
        c.siblings,
    );
    run(c);
}

#[test(should_fail_with = "revictim required")]
fn bad_revictim() {
    let mut c = good();
    c.revictim = false;
    c.root = merkle_root(
        leaf_hash(c.acct, c.zone, c.senior, false, c.tier, c.hh_secret, c.salt),
        c.index,
        c.siblings,
    );
    run(c);
}

#[test(should_fail_with = "tier below min_tier")]
fn bad_tier() {
    let mut c = good();
    c.min_tier = 4;
    run(c);
}

#[test(should_fail_with = "nullifier mismatch")]
fn bad_nullifier() {
    let mut c = good();
    c.nullifier += 1;
    run(c);
}

#[test(should_fail_with = "nullifier mismatch")]
fn bad_nullifier_other_program() {
    // 別プログラム用の nullifier を流用できない
    let mut c = good();
    c.nullifier = nullifier_hash(c.hh_secret, 0x9002);
    run(c);
}

#[test(should_fail)]
fn bad_index_out_of_range() {
    // index が 2^12 以上なら to_le_bits の範囲制約で失敗する
    let mut c = good();
    c.index = 4096 + 1234;
    run(c);
}
