// spike 13: 受給資格の回路（固定アドレスなし・申請に結び付く版）と fixture 回路の共通関数。
// ハッシュの定義はここ 1 か所だけ。JS 側で Poseidon2 を別実装しない（fixture13 を execute して得る）。
use poseidon::poseidon2::Poseidon2;

pub global DEPTH: u32 = 12;
pub global ZONES: u32 = 8;

// 領域分離のタグ（ハッシュの用途が混ざらないように、先頭の入力に置く）
pub global DOM_ID: Field = 0x7a6b7631; // "zkv1"
pub global DOM_LEAF: Field = 0x7a6b7632;
pub global DOM_NULL: Field = 0x7a6b7633;
pub global DOM_BIND: Field = 0x7a6b7634;

/// 世帯の公開用の識別子。名簿の管理者には hh_id だけを渡し、hh_secret は渡さない
pub fn hh_id_of(hh_secret: Field) -> Field {
    Poseidon2::hash([DOM_ID, hh_secret], 2)
}

/// 葉 = H(DOM_LEAF, hh_id, zone, senior, revictim, tier, salt)。XRPL のアカウント（acct）は入れない
pub fn leaf_hash(hh_id: Field, zone: Field, senior: bool, revictim: bool, tier: u8, salt: Field) -> Field {
    Poseidon2::hash([DOM_LEAF, hh_id, zone, senior as Field, revictim as Field, tier as Field, salt], 7)
}

/// nullifier = H(DOM_NULL, hh_secret, program_id)。制度ごとに別の値。申請ごとの鍵には依存しない
pub fn nullifier_hash(hh_secret: Field, program_id: Field) -> Field {
    Poseidon2::hash([DOM_NULL, hh_secret, program_id], 3)
}

/// 申請への結び付け。公開入力 req_hi / req_lo（申請内容の SHA-256 の上位・下位 16 バイト）を、
/// 世帯の秘密と一緒にハッシュして公開する。これにより req_* は「制約に入った値」になり、
/// hh_secret を知らない者は、どの申請内容に対しても有効な証明を作れない。
pub fn request_tag(hh_secret: Field, program_id: Field, req_hi: Field, req_lo: Field) -> Field {
    Poseidon2::hash([DOM_BIND, hh_secret, program_id, req_hi, req_lo], 5)
}

pub fn merkle_node(l: Field, r: Field) -> Field {
    Poseidon2::hash([l, r], 2)
}

/// 葉から根を計算する。index のビット i が 1 なら、その段の自分は右側。to_le_bits は index < 2^DEPTH を制約する
pub fn merkle_root(leaf: Field, index: Field, siblings: [Field; DEPTH]) -> Field {
    let bits: [bool; DEPTH] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..DEPTH {
        let (l, r) = if bits[i] { (siblings[i], node) } else { (node, siblings[i]) };
        node = merkle_node(l, r);
    }
    node
}

/// 16 バイト（big-endian）→ Field。上位 16 バイトと下位 16 バイトに分けた SHA-256 を体の要素にする規則
pub fn be16_to_field(b: [u8; 16]) -> Field {
    let mut acc: Field = 0;
    for i in 0..16 {
        acc = acc * 256 + (b[i] as Field);
    }
    acc
}
