import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

interface WalletInfo { address: string; walletId: string; created: boolean; userId: string }

async function post<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function App() {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const [wallet, setWallet] = useState<WalletInfo>();
  const [log, setLog] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // ログインしたら、サーバーにウォレットを用意させてアドレスを表示する（確認 1 / 6）
  useEffect(() => {
    if (!ready || !authenticated) return;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        setWallet(await post<WalletInfo>("/api/wallet", token));
      } catch (e) {
        setLog(`ウォレットの用意に失敗: ${(e as Error).message}`);
      }
    })();
  }, [ready, authenticated, getAccessToken]);

  const run = async () => {
    setBusy(true);
    setLog("実行中…（1〜2 分）");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("access token が取れない");
      const r = await post<{ verdict: string; lines: string[] }>("/api/run", token);
      setLog([`verdict: ${r.verdict}`, ...r.lines].join("\n"));
    } catch (e) {
      setLog(`失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <p>読み込み中…</p>;
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", lineHeight: 1.6 }}>
      <h1>07-privy</h1>
      {!authenticated ? (
        <button onClick={login}>メールでログイン</button>
      ) : (
        <>
          <p>Privy user: <code>{user?.id}</code></p>
          <p>
            XRPL アドレス: <code>{wallet?.address ?? "用意中…"}</code>
            {wallet && <>（{wallet.created ? "今回作成" : "既存を再利用"}）</>}
          </p>
          <button onClick={run} disabled={!wallet || busy}>検証 2〜5 を実行</button>{" "}
          <button onClick={logout}>ログアウト</button>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: "1rem" }}>{log}</pre>
        </>
      )}
    </main>
  );
}
