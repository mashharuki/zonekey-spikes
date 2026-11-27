// 入力生成と固定ベクトル用（証明はしない。noir_js の execute の戻り値だけ使う）。回路と同じ関数を呼ぶ
use zkv_lib::{be16_to_field, hh_id_of, leaf_hash, merkle_node, nullifier_hash, request_tag};

fn main(
    hh_secret: Field,
    program_id: Field,
    zone: Field,
    senior: bool,
    revictim: bool,
    tier: u8,
    salt: Field,
    req_digest: [u8; 32],
    left: Field,
    right: Field,
) -> pub (Field, Field, Field, Field, Field, Field, Field) {
    let mut a = [0 as u8; 16];
    let mut b = [0 as u8; 16];
    for i in 0..16 {
        a[i] = req_digest[i];
        b[i] = req_digest[16 + i];
    }
    let hi = be16_to_field(a);
    let lo = be16_to_field(b);
    let hh_id = hh_id_of(hh_secret);
    (
        hh_id,
        leaf_hash(hh_id, zone, senior, revictim, tier, salt),
        nullifier_hash(hh_secret, program_id),
        request_tag(hh_secret, program_id, hi, lo),
        merkle_node(left, right),
        hi,
        lo,
    )
}
