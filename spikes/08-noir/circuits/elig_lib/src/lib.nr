// 受給資格の回路と、計測用の入力生成回路の両方が使う関数。
// JS 側で同じハッシュを別実装すると食い違いの原因になるので、ここ 1 か所で定義する。
use poseidon::poseidon2::Poseidon2;

pub global DEPTH: u32 = 12;
pub global ZONES: u32 = 8;

/// 葉 = Poseidon2(acct, zone, senior, revictim, tier, hh_secret, salt)
pub fn leaf_hash(
    acct: Field,
    zone: Field,
    senior: bool,
    revictim: bool,
    tier: u8,
    hh_secret: Field,
    salt: Field,
) -> Field {
    Poseidon2::hash(
        [acct, zone, senior as Field, revictim as Field, tier as Field, hh_secret, salt],
        7,
    )
}

/// nullifier = Poseidon2(hh_secret, program_id)。プログラムごとに別の値になり、世帯をまたいで結び付かない
pub fn nullifier_hash(hh_secret: Field, program_id: Field) -> Field {
    Poseidon2::hash([hh_secret, program_id], 2)
}

/// 葉から根を計算する。index のビット i が 1 なら、その段の自分は右側
pub fn merkle_root(leaf: Field, index: Field, siblings: [Field; DEPTH]) -> Field {
    // to_le_bits は index < 2^DEPTH を制約する（範囲外の index で別の葉を指せないように）
    let bits: [bool; DEPTH] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..DEPTH {
        let is_right = bits[i];
        let (l, r) = if is_right {
            (siblings[i], node)
        } else {
            (node, siblings[i])
        };
        node = Poseidon2::hash([l, r], 2);
    }
    node
}
