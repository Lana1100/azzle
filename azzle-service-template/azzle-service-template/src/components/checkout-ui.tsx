"use client";
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { Friendly } from "@/lib/friendly-error";

import { STEPS } from "@/lib/service";

/** Step labels come from the service config (`steps`), so every shop can name its own flow. */
export { STEPS } from "@/lib/service";

/** 1 Details · 2 Brief · 3 Sign in · 4 Pay · 5 Review and approve. `current` is 0-based. */
export function StepRail({ current, allDone }: { current: number; allDone?: boolean }) {
  return (
    <nav aria-label="Checkout progress" data-testid="step-rail">
      <p className="kicker mb-3 text-ink-64">Step {Math.min(current + 1, STEPS.length)} of {STEPS.length}</p>
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = allDone || i < current, on = !allDone && i === current;
          return (
            <li key={s} aria-current={on ? "step" : undefined} className="min-w-0">
              <div className={`h-1.5 rounded-full ${done ? "bg-ink" : on ? "bg-brand" : "bg-ink/15"}`} />
              <div className={`mt-2 flex items-start gap-1.5 text-[11px] leading-tight sm:text-[13px] ${done || on ? "text-ink" : "text-ink-64"}`}>
                <span className={`grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-semibold sm:size-5 ${done ? "bg-ink text-paper" : on ? "bg-brand text-brand-ink" : "ring-1 ring-ink/25"}`}>
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={`${on ? "font-semibold" : ""} hidden sm:inline`}>{s}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[13px] font-semibold text-ink sm:hidden">{allDone ? "All done" : STEPS[current]}</p>
    </nav>
  );
}

/** Optional detail, closed by default. */
export function Disclosure({ title, children, testId, defaultOpen }: { title: string; children: ReactNode; testId?: string; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-lg border border-ink/15 bg-paper/40" data-testid={testId} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        {title}<ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 border-t border-ink/10 px-3 py-3 text-sm text-ink-64">{children}</div>
    </details>
  );
}

export function TechBlock({ text }: { text: string }) {
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{text}</pre>;
}

export function CopyAddress({ address }: { address: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(address).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}
      className="flex w-full items-center justify-between gap-2 rounded-md border border-ink/20 bg-white/60 px-3 py-2 text-left font-mono text-[12px] text-ink" data-testid="copy-address">
      <span className="break-all">{address}</span>
      <span className="flex shrink-0 items-center gap-1 font-sans text-xs text-ink-64">{ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{ok ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** How to get USDC onto Base, shown when the wallet is short. Numbers come from the live quote. */
export function TopUpHelp({ address, have, need }: { address: string; have: string; need: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-brand bg-brand/15 p-3 text-sm text-ink" data-testid="topup-help">
      <div className="font-semibold">Your wallet has {have} USDC. This step needs {need}.</div>
      <p className="text-ink-64">Send USDC to this address <b className="text-ink">on the Base network</b>. From an exchange like Coinbase, choose &ldquo;Base&rdquo; as the network when you withdraw. Then hit refresh.</p>
      <CopyAddress address={address} />
    </div>
  );
}

export function ErrorNote({ f, address }: { f: Friendly; address?: string }) {
  return (
    <div className={`mt-3 grid gap-1 rounded-lg border p-3 text-sm ${f.kind === "rejected" ? "border-ink/20 bg-white/50" : "border-destructive/30 bg-destructive/5"}`} data-testid={`error-${f.kind}`} role="alert">
      <div className="font-semibold text-ink">{f.title}</div>
      <div className="text-ink-64">{f.body}</div>
      {f.kind === "funds" && address && <div className="mt-1"><CopyAddress address={address} /></div>}
      {f.kind !== "rejected" && <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Technical message</summary><p className="mt-1 break-words font-mono">{f.raw}</p></details>}
    </div>
  );
}

/** "Signature 2 of 3 · Lock the payment in escrow" */
export function SignProgress({ i, n, label, why }: { i: number; n: number; label: string; why?: string }) {
  return (
    <div className="mt-3 grid gap-1 rounded-lg bg-ink p-3 text-paper" data-testid="sign-progress" aria-live="polite">
      <div className="kicker text-paper/70">Signature {i + 1} of {n}</div>
      <div className="font-display text-[19px] leading-tight">{label}</div>
      {why && <div className="text-xs text-paper/75">{why}</div>}
      <div className="mt-1 flex gap-1">{Array.from({ length: n }).map((_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k < i ? "bg-paper" : k === i ? "bg-brand" : "bg-paper/25"}`} />)}</div>
    </div>
  );
}

export function PriceLine({ label, sub, value, strong, testId }: { label: ReactNode; sub?: ReactNode; value: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${strong ? "border-t border-ink pt-2.5" : ""}`} data-testid={testId}>
      <div className="min-w-0"><div className={strong ? "font-semibold text-ink" : "text-ink"}>{label}</div>{sub && <div className="text-xs text-ink-64">{sub}</div>}</div>
      <div className={`shrink-0 text-right font-mono ${strong ? "text-base font-semibold text-ink" : "text-sm text-ink"}`}>{value}</div>
    </div>
  );
}
