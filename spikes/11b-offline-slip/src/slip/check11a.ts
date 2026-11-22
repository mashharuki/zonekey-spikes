/**
 * 11a 確認 1 で台帳に作った Check（spikes/11a-check-settle/results/ledger.json の check1）。
 * この Check はすでに換金され（11a 確認 2）、期限（Expiration）も過ぎている。InvoiceID は 11a のテスト鍵（Node で作り、秘密鍵は捨てた）の値。
 * 11b は台帳に触れないので、世帯の PWA の鍵で試すときは「CheckID・SendMax はこの Check、InvoiceID と期限は試験用に差し替えた一覧」を使う。
 */
import type { CheckInfo } from './format';

export const CHECK_11A: CheckInfo = {
  CheckID: 'BBE0A3C03064E1600B1F01C351B93E5B92B831CAA2C95FBDD71C97D3664B37F3',
  SendMax: '0.5',
  Expiration: 848663882,
  InvoiceID: 'D31D5F9DB787040901A56F2E47CDCF7C11598C3AC139DCC0645D46DF12E6318E',
  source: '11a 確認 1（台帳の値そのまま）',
};
