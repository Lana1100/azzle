"use client";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Wallet, LogOut, Mail } from "lucide-react";
import { PRIVY_APP_ID } from "@/lib/wagmi";
import { service } from "@/lib/service";

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
type Size = "default" | "lg" | "sm";

function Connected({ size, onOut }: { size: Size; onOut: () => void }) {
  const { address, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const wrong = chainId != null && chainId !== base.id;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs" data-testid="connected-address">
          <span className={`size-2 rounded-full ${wrong ? "bg-destructive" : "bg-ink"}`} />Signed in <span className="font-mono">{short(address)}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onOut}><LogOut /> Sign out</Button>
      </div>
      {wrong && (
        <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="wrong-network" role="alert">
          <div><b>Wrong network.</b> Your wallet is on another network. {service.name} only works on <b>Base</b>. Switching costs nothing and nothing is sent.</div>
          <Button size={size} className="w-fit" disabled={isPending} onClick={() => switchChain({ chainId: base.id })}>Switch to Base</Button>
          {error && <div className="text-xs text-ink-64">Your wallet didn&apos;t switch. Open it and pick &ldquo;Base&rdquo; from its network menu.</div>}
        </div>
      )}
    </div>
  );
}

/** Privy: one button, email (embedded wallet on Base) or any external wallet. */
const big = (s: Size) => (s === "lg" ? "h-14 w-full px-7 text-base sm:w-auto" : "");

function PrivyConnect({ size }: { size: Size }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { isConnected } = useAccount();
  if (authenticated && isConnected) return <Connected size={size} onOut={() => logout()} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size={size} className={big(size)} disabled={!ready || authenticated} onClick={() => login()} data-testid="connect-privy">
        <Mail /> {authenticated ? "Opening your wallet…" : "Sign in with email or wallet"}
      </Button>
    </div>
  );
}

function WagmiConnect({ size }: { size: Size }) {
  const { isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected) return <Connected size={size} onOut={() => disconnect()} />;
  const baseAcc = connectors.find((c) => c.id === "baseAccount");
  const inj = connectors.find((c) => c.type === "injected");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {baseAcc && (
        <Button size={size} className={big(size)} disabled={isPending} onClick={() => connect({ connector: baseAcc })}>
          <span className="inline-block size-3 rounded-[3px] bg-white" /> Sign in with Base
        </Button>
      )}
      {inj && (
        <Button size={size} className={big(size)} variant="outline" disabled={isPending} onClick={() => connect({ connector: inj })} data-testid="connect-injected">
          <Wallet /> Use a browser wallet
        </Button>
      )}
    </div>
  );
}

export function ConnectButton({ size = "default" }: { size?: Size }) {
  return PRIVY_APP_ID ? <PrivyConnect size={size} /> : <WagmiConnect size={size} />;
}
