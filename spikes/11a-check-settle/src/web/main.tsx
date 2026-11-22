import { PrivyProvider } from "@privy-io/react-auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const appId = import.meta.env["VITE_PRIVY_APP_ID"] as string | undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {appId ? (
      <PrivyProvider
        appId={appId}
        config={{
          // メール OTP だけでログインする。組み込みウォレットはクライアントでは作らない（サーバーが作る）
          loginMethods: ["email"],
          embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
        }}
      >
        <App />
      </PrivyProvider>
    ) : (
      <p>VITE_PRIVY_APP_ID が .env.local にありません。</p>
    )}
  </StrictMode>,
);
