import { Wallet, convertStringToHex, xrpToDrops, type Client } from "xrpl";
import {
  Abort,
  configureEscrowableIssuer,
  createFundedWallet,
  issued,
  isSuccess,
  submitAndLog,
  type Recorder,
} from "xrpl-kit";

/** モックの受給証（spike 04 と同じ作り方の発行者。RLUSD の裏付けは 04 で検証済みなので、ここでは使わない） */
export const TOKEN = "ZKV";
export const HOUSEHOLDS = 8;

export interface Donor {
  label: string;
  /** 台帳上の Domain に書く識別子（台帳だけでドナー名を引けるようにする） */
  domain: string;
  wallet: Wallet;
}

export interface Accounts {
  issuer: Wallet;
  donors: Donor[];
  keeper: Wallet;
  households: Wallet[];
}

async function must(r: Recorder, item: string, p: ReturnType<typeof submitAndLog>): Promise<void> {
  const o = await p;
  if (!isSuccess(o)) {
    r.tx(item, o, "tesSUCCESS");
    throw new Abort(`準備に失敗: ${item}`);
  }
}

export async function setupAccounts(client: Client, r: Recorder): Promise<Accounts> {
  const issuer = (await createFundedWallet(client, "mock-issuer")).wallet;
  for (const o of await configureEscrowableIssuer(client, issuer)) if (!r.tx("発行者: AccountSet（DefaultRipple / AllowTrustLineLocking）", o, "tesSUCCESS")) throw new Abort("発行者の設定に失敗");

  const donors: Donor[] = [];
  for (const [label, domain] of [["国", "donor-national.zonekey.test"], ["県", "donor-prefecture.zonekey.test"], ["NGO", "donor-ngo.zonekey.test"]] as const) {
    const w = (await createFundedWallet(client, `donor ${label}`)).wallet;
    await must(r, `donor ${label}: Domain`, submitAndLog(client, `donor ${label} Domain`, { TransactionType: "AccountSet", Account: w.address, Domain: convertStringToHex(domain) }, w));
    await must(r, `donor ${label}: TrustSet`, submitAndLog(client, `donor ${label} TrustSet`, { TransactionType: "TrustSet", Account: w.address, LimitAmount: issued(TOKEN, issuer.address, "1000000") }, w));
    await must(r, `issuer → donor ${label}`, submitAndLog(client, `issue to ${label}`, { TransactionType: "Payment", Account: issuer.address, Destination: w.address, Amount: issued(TOKEN, issuer.address, "10") }, issuer));
    donors.push({ label, domain, wallet: w });
  }

  const keeper = (await createFundedWallet(client, "keeper")).wallet;
  const funder = (await createFundedWallet(client, "funder")).wallet;
  const households: Wallet[] = [];
  for (let i = 1; i <= HOUSEHOLDS; i++) {
    const h = Wallet.generate();
    // 基礎準備金 1 XRP + トラストライン 0.2 XRP + 手数料に足りる額
    await must(r, `世帯 h${i}: 口座開設`, submitAndLog(client, `fund h${i}`, { TransactionType: "Payment", Account: funder.address, Destination: h.address, Amount: xrpToDrops("3") }, funder));
    // keeper が EscrowFinish するので、世帯は事前にトラストラインが要る（なければ tecNO_LINE。spike 04 / XLS-85）
    await must(r, `世帯 h${i}: TrustSet`, submitAndLog(client, `h${i} TrustSet`, { TransactionType: "TrustSet", Account: h.address, LimitAmount: issued(TOKEN, issuer.address, "1000000") }, h));
    households.push(h);
  }
  r.add("observe", "アカウント", "-",
    [`発行者=${issuer.address}`, ...donors.map((d) => `donor ${d.label}=${d.wallet.address}（Domain=${d.domain}）`), `keeper=${keeper.address}`, ...households.map((h, i) => `h${i + 1}=${h.address}`)].join("<br>"),
    "すべて使い捨て（シードは保存しない）");
  return { issuer, donors, keeper, households };
}
