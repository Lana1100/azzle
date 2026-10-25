"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { friendlyError, type Friendly } from "@/lib/friendly-error";
import { Disclosure, ErrorNote, SignProgress, TechBlock } from "@/components/checkout-ui";
import { Spinner } from "@/components/spinner";
import { useAccount } from "wagmi";

export type Progress = { i: number; n: number; label: string; why?: string } | null;
const STUCK_AFTER_MS = 60_000;

/**
 * One wallet action, explained in plain words. The exact on-chain template (network, target, method, args, approvals,
 * effects) is still shown before signing, inside "Technical details".
 */
export function TxStep({ title, why, template, cta, onRun, disabled, variant = "default", testId, progress, address, children }: {
  title: string; why?: ReactNode; template?: string; cta: string; onRun: () => Promise<void>; disabled?: boolean;
  variant?: "default" | "outline" | "destructive" | "secondary"; testId?: string; progress?: Progress; address?: string; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Friendly | null>(null);
  const [stuck, setStuck] = useState(false);
  // Email wallet signs in the background (no Privy pop-up), so don't tell those users to check a wallet.
  const embedded = !!useAccount().connector?.id?.startsWith("io.privy.wallet");
  useEffect(() => {
    if (!busy) { setStuck(false); return; }
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy, progress?.i]);
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4" data-testid={testId}>
      <div className="font-display text-[19px] leading-tight text-ink">{title}</div>
      {why && <div className="mt-1 text-sm text-ink-64">{why}</div>}
      {children}
      <Button size="lg" variant={variant} className="mt-3 h-14 w-full px-7 text-base sm:w-auto" disabled={disabled || busy} data-testid={testId ? `${testId}-cta` : undefined} onClick={async () => {
        setBusy(true); setErr(null);
        try { await onRun(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
      }}>
        {busy && <Spinner />}{busy ? (embedded ? "Working on it…" : "Check your wallet…") : cta}
      </Button>
      {busy && progress && <SignProgress {...progress} />}
      {busy && stuck && (
        <div className="mt-3 rounded-lg border border-brand bg-brand/15 p-3 text-sm text-ink" data-testid="stuck-note">
          {embedded
            ? <><b>Still waiting on Base.</b> The network is slow right now. Keep this page open; don&apos;t refresh or press the button again.</>
            : <><b>Still waiting on Base.</b> Open your wallet and check its activity tab. If a request is waiting, approve or reject it there. Don&apos;t refresh mid-signature, and don&apos;t sign twice.</>}
        </div>
      )}
      {err && <ErrorNote f={err} address={address} />}
      {template && <div className="mt-3"><Disclosure title="Technical details (what your wallet will sign)">{<TechBlock text={template} />}</Disclosure></div>}
    </div>
  );
}
