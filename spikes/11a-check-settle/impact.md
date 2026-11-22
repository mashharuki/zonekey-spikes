**問われた 3 つへの答え**

- **Check の上限で、精算口座が引ける額を抑えられるか:** 抑えられる。上限（SendMax）を超える換金は `tecPATH_PARTIAL` で失敗する（確認 3）。ただし換金に成功すると、額にかかわらず Check は台帳から消える（上限 0.5 のうち 0.2 だけ換金すると、残りの 0.3 はもう引けない。確認 2）。**1 つの Check で精算できるのは 1 回だけ**なので、精算はその Check で受けた伝票をまとめて 1 回で行う。
- **資金を移されたときに精算がどう失敗し、何が台帳に残るか:** 世帯の残高が足りないと、精算の CheckCash は `tecPATH_PARTIAL` で失敗し、**Check は台帳に残る**（期限までは引き直せる）。`DeliverMin` を指定すると、**残っていた残高ぶん（今回は 0.1）だけを回収できる**（確認 4）。Batch（tfIndependent）では、資金を抜かれた 1 件だけが失敗し、ほかの 7 件の精算は止まらない（確認 6、手数料 100 drops = 10×2 + 10×8）。お店の損は「伝票の合計 − 回収できた額」で、上限は Check の SendMax。
- **Privy のポリシーで、受給証の持ち出しと CheckCancel を止められるか:** 止められた。受給証の Payment（DENY ルール）、CheckCancel・OfferCreate・別の宛先への CheckCreate（どれも既定の拒否）は、すべて `policy_violation` で署名されなかった（確認 7c）。ポリシーを付けたままでも、S は H2 の Check を換金できた（確認 7d）。

**ほかに分かったこと（設計に効くもの）**

- **ロック中は、新しい Check も作れない。** `TransactionType = CheckCreate` を許可するルールは、今も `invalid_policy_format` で作れない（確認 7b。spike 07 と同じ。docs.privy.io の記述とは食い違う）。そのため、ロック中の世帯はお店宛ての Check を新しく作れない。また Check は 1 回の精算で消えるので、**精算のたびに新しい Check が要る**。運用の候補は 2 つ:
  1. 登録時（オンライン）に、ロックを付ける前に S 宛ての Check を作っておき、そのあとロックを付ける。精算後の次の Check は、世帯がオンラインのときに「ロックを外す → CheckCreate → ロックを付け直す」（どれも本人の JWT が要る）
  2. spike 07 と同じく、DENY で Payment / OfferCreate を塞いだまま、system 時刻条件の ALLOW を短い時間だけ足して CheckCreate させる（そのあいだは他の種類も許可されるので、DENY で塞いだもの以外の持ち出しに注意）
- **Check はお金を確保しない**（xrpl.org Checks）ので、「ゆるいロック」が二重払い対策の本体になる。Check の上限は「精算口座が 1 回で引ける上限」、ロックは「その間に世帯がよそへ移せないようにする」役割で、両方そろって初めてお店の損を抑えられる。
- **RLUSD そのもので Check を作り、換金できた**（確認 8）。Escrow と違い、発行者の lsfAllowTrustLineLocking は要らない。S に RLUSD のトラストラインがなくても、CheckCash が自動で作った（1 回目の実行: [E84A35C7…](https://testnet.xrpl.org/transactions/E84A35C7377EC246149A784D6E1D69DE181CC8CFF53B33EAE89E1BFE293E5CBA)。上の表の 2 回目は、すでに線がある状態）。オフライン払いの部分だけは受給証なしで組める。ただし RLUSD の発行者が凍結・回収できる点は変わらない。
- 06_技術設計で変えるところ: オフライン払いの節に「Check は 1 回の精算で消える」「ロック中は CheckCreate できない（作るのはロックの前、または時間を区切った許可で）」「精算は DeliverMin で残高ぶんを回収、Batch tfIndependent で 8 件ずつ」を加える。
