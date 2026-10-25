"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { base } from "wagmi/chains";
import { PrivyProvider, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount } from "wagmi";
import { wagmiConfig, PRIVY_APP_ID, PRIVY_SPONSOR } from "@/lib/wagmi";
import { setSponsoredSender, getTxUi } from "@/lib/tx";
import { service, priceLabel } from "@/lib/service";

/** Hands Privy's sponsored sender to lib/tx when the active wagmi account is a Privy embedded wallet. */
function PrivyBridge() {
  const { address, isConnected } = useAccount();
  const { ready, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { sendTransaction } = useSendTransaction();
  const tried = useRef<string | null>(null);

  // Signed in with Privy but wagmi has no active account yet (fresh load, reconnect race): pick the user's wallet
  // automatically so checkout moves past "Sign in" without another click. Prefers a wallet linked to this user.
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || isConnected || !user) return;
    const linked = new Set((user.linkedAccounts ?? []).filter((a: any) => a.type === "wallet").map((a: any) => String(a.address).toLowerCase()));
    const w = wallets.find((x) => linked.has(x.address.toLowerCase())) ?? wallets.find((x) => x.walletClientType === "privy");
    if (!w || tried.current === w.address) return;
    tried.current = w.address;
    setActiveWallet(w).catch(() => { tried.current = null; });
  }, [ready, authenticated, walletsReady, isConnected, user, wallets, setActiveWallet]);
  useEffect(() => { if (!authenticated) tried.current = null; }, [authenticated]);

  useEffect(() => {
    const embedded = wallets.find((w) => w.walletClientType === "privy" && address && w.address.toLowerCase() === address.toLowerCase());
    if (!PRIVY_SPONSOR || !embedded) { setSponsoredSender(null); return; }
    setSponsoredSender({
      address: embedded.address,
      send: async (tx) => {
        const ui = getTxUi();
        const uiOptions = ui ? {
          description: [ui.step, ui.description].filter(Boolean).join(" · "), buttonText: "Confirm", isCancellable: true,
          transactionInfo: { title: "Details", action: ui.title }, successHeader: "Done", successDescription: ui.title,
          showWalletUIs: false,
        } : { showWalletUIs: false };
        return (await sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: base.id }, { sponsor: true, address: embedded.address, uiOptions })).hash;
      },
    });
    return () => setSponsoredSender(null);
  }, [address, wallets, sendTransaction]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        defaultChain: base,
        supportedChains: [base],
        // Email (embedded) wallet: no Privy confirm / "Transaction completed" screens. Our own Pay button and step list are the
        // confirmation (every amount is shown on the page before the click). External wallets keep their own prompts.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        appearance: {
          theme: service.brand.paper as `#${string}`,
          accentColor: service.brand.accent as `#${string}`,
          ...(service.brand.logo ? { logo: service.brand.logo } : {}),
          landingHeader: service.copy.privyHeader || `Sign in to ${service.name}`,
          loginMessage: service.copy.privyMessage || `Email or wallet. ${priceLabel}, on Base.`,
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
          walletList: ["base_account", "metamask", "coinbase_wallet", "rainbow", "detected_ethereum_wallets"],
        },
      }}
    >
      <QueryClientProvider client={qc}>
        <PrivyWagmiProvider config={wagmiConfig}>
          <PrivyBridge />
          {children}
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
