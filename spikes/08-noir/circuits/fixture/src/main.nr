// 計測用の入力生成（証明はしない。noir_js の execute で戻り値だけ使う）。
// 受給資格の回路と同じ関数で、葉・根・nullifier を計算して返す。
use elig_lib::{DEPTH, leaf_hash, merkle_root, nullifier_hash};

fn main(
    acct: Field,
    zone: Field,
    senior: bool,
    revictim: bool,
    tier: u8,
    hh_secret: Field,
    salt: Field,
    index: Field,
    siblings: [Field; DEPTH],
    program_id: Field,
) -> pub (Field, Field) {
    let leaf = leaf_hash(acct, zone, senior, revictim, tier, hh_secret, salt);
    (merkle_root(leaf, index, siblings), nullifier_hash(hh_secret, program_id))
}
