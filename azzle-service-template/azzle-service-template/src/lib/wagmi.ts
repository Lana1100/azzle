import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";
import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import service from "@/config/service.mjs";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
/** Public Privy app id. Empty = Privy off; the site falls back to plain wagmi connectors. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
/** Opt-in: route embedded-wallet transactions through Privy gas sponsorship (needs sponsorship enabled in the Privy dashboard). */
export const PRIVY_SPONSOR = PRIVY_APP_ID !== "" && process.env.NEXT_PUBLIC_PRIVY_SPONSOR === "1";

const plainConfig = () =>
  createConfig({
    chains: [base],
    connectors: [
      injected({ shimDisconnect: true }),
      baseAccount({ appName: service.name, appLogoUrl: service.brand?.logo ? (process.env.NEXT_PUBLIC_SITE_URL || "") + service.brand.logo : undefined }),
    ],
    transports: { [base.id]: http(RPC_URL) },
    ssr: true,
  });

// With Privy, connectors are owned by Privy (email embedded wallet + external wallets) and injected into wagmi.
export const wagmiConfig = (PRIVY_APP_ID
  ? createPrivyConfig({ chains: [base], transports: { [base.id]: http(RPC_URL) }, ssr: true })
  : plainConfig()) as ReturnType<typeof plainConfig>;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
