import type { Client, Request } from "xrpl";

/** このスパイクで許可する読み取り専用コマンド。submit 系は一切通さない。 */
const READ_ONLY_COMMANDS = new Set<string>(["feature", "server_info", "account_info", "ledger_entry"]);

export async function readOnlyRequest<R extends Request>(client: Client, req: R) {
  if (!READ_ONLY_COMMANDS.has(req.command)) {
    throw new Error(`読み取り専用スパイクで許可されないコマンド: ${req.command}`);
  }
  return client.request(req);
}

export interface DescribedError {
  /** rippled のエラーコード（noPermission, actNotFound など）。無ければ undefined */
  code: string | undefined;
  message: string;
}

export function describeError(e: unknown): DescribedError {
  const data = (e as { data?: { error?: string; error_message?: string } } | null)?.data;
  const message = data?.error_message ?? (e instanceof Error ? e.message : String(e));
  return { code: data?.error, message };
}

export const json = (v: unknown): string => JSON.stringify(v);
