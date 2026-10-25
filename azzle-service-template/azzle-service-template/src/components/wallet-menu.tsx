"use client";
// Header wallet pill + wallet modal: balances, the AZZLE deposit, withdraw, sign out.
// Every figure is a live read (wallet-core.mjs); USD values use the same live quote as checkout.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { useAccount, useDisconnect, usePublicClient } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { Copy, Check, X, ArrowUpRight, Wallet } from "lucide-react";
import { PRIVY_APP_ID } from "@/lib/wagmi";
import { ADDR, depositAbi, quoteUsd, BASESCAN, UNISWAP_AZL_USDC, MARKET } from "@/lib/client-azzle";
import * as wc from "@/lib/wallet-core.mjs";
import { sendTx, errMsg, isUserRejection } from "@/lib/tx";
import { Spinner } from "@/components/spinner";
import { BaseLogo } from "@/components/base-logo";

const { readWalletState, depositStatus, azlToUsd6 } = wc as any;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const usd = (v: bigint | null | undefined) => (v == null ? "…" : "$" + (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const azlFmt = (w: bigint | null | undefined) => (w == null ? "…" : Math.floor(Number(w / 10n ** 18n)).toLocaleString("en-US"));
const ethFmt = (w: bigint | null | undefined) => (w == null ? "…" : (Number(w) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 5 }));

type WState = Awaited<ReturnType<typeof readWalletState>> | null;
type Wd = { kind: "idle" } | { kind: "working" } | { kind: "done"; hash: string; amount: bigint } | { kind: "error"; msg: string };

function Row({ label, sub, value, approx, testId }: { label: string; sub?: string; value: string; approx?: string; testId?: string }) {
  return (
    <div className="wm-row" data-testid={testId}>
      <div className="min-w-0">
        <div className="text-[14px] text-ink">{label}</div>
        {sub && <div className="text-[12px] leading-[1.45] text-ink-64">{sub}</div>}
      </div>
      <span className="wm-leader" aria-hidden />
      <div className="text-right">
        <div className="font-mono text-[14px] text-ink tabular-nums">{value}</div>
        {approx && <div className="font-mono text-[11px] text-ink-64 tabular-nums">{approx}</div>}
      </div>
    </div>
  );
}

function WalletPill({ onSignOut }: { onSignOut: () => void }) {
  const { address, isConnected } = useAccount();
  const pub = usePublicClient();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<WState>(null);
  const [quote, setQuote] = useState<any>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wd, setWd] = useState<Wd>({ kind: "idle" });

  const load = useCallback(async (withQuote = false) => {
    if (!pub || !address) return;
    try {
      const [st, q] = await Promise.all([readWalletState(pub, address), withQuote ? quoteUsd(pub, 1_000_000n).catch(() => null) : Promise.resolve(undefined)]);
      setS(st); if (q !== undefined) setQuote(q); setReadErr(null);
    } catch (e) { setReadErr(errMsg(e)); }
  }, [pub, address]);

  useEffect(() => { setS(null); setWd({ kind: "idle" }); if (isConnected) load(); }, [isConnected, address, load]);
  useEffect(() => { if (!isConnected) return; const t = setInterval(() => load(open), 30_000); return () => clearInterval(t); }, [isConnected, open, load]);
  useEffect(() => { if (open) load(true); }, [open, load]);

  if (!isConnected || !address) return null;
  const status = depositStatus(s);
  const v = (azl?: bigint) => (azl != null && quote ? `≈ ${usd(azlToUsd6(azl, quote))}` : undefined);

  async function withdraw() {
    if (!pub || !address) return;
    setWd({ kind: "working" });
    try {
      // Fresh read right before sending: only the currently withdrawable amount, back to this wallet.
      const amount = (await pub.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "withdrawable", args: [address] })) as bigint;
      if (amount === 0n) { await load(true); setWd({ kind: "idle" }); return; }
      const r = await sendTx({ address: ADDR.depositVault, abi: depositAbi, functionName: "withdraw", args: [amount, address] });
      setWd({ kind: "done", hash: r.hash, amount });
      await load(true);
    } catch (e) {
      setWd(isUserRejection(e) ? { kind: "idle" } : { kind: "error", msg: errMsg(e) });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="wm-pill" data-testid="wallet-pill" aria-label="Your wallet">
        <Wallet className="size-4 text-ink" aria-hidden />
        <span className="tabular-nums">{s ? usd(s.usdc) : "…"}</span>
        <span className="hidden text-ink-64 lg:inline">USDC</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="wm-backdrop" />
        <Dialog.Popup className="wm-modal" data-testid="wallet-modal">
          <div className="wm-band">
            <span className="kicker text-brand">Your wallet</span>
            <BaseLogo h={12} className="ml-auto opacity-90" />
            <Dialog.Close className="wm-x" aria-label="Close"><X className="size-4" /></Dialog.Close>
          </div>

          <div className="px-6 pb-6 pt-5 sm:px-7">
            <Dialog.Title className="font-display text-[26px] leading-[1.1] text-ink">Balances</Dialog.Title>
            <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-64">
              <span className="font-mono text-ink" data-testid="wm-address" title={address}>{short(address)}</span>
              <button type="button" className="wm-copy" onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1400); }} aria-label="Copy address">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}<span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <span>on Base</span>
            </Dialog.Description>

            {readErr && !s && <p className="mt-4 text-[13px] text-ink-64">Couldn&rsquo;t read your balances just now. <button className="ulink text-ink" onClick={() => load(true)}>Try again</button></p>}

            <div className="kicker mt-6 text-ink-64">In your wallet</div>
            <div className="mt-2">
              <Row label="USDC" value={s ? usd(s.usdc) : "…"} testId="wm-usdc" />
              <Row label="ETH" sub="For network fees" value={s ? ethFmt(s.eth) : "…"} testId="wm-eth" />
              <Row label="AZL" sub="AZZLE token" value={s ? azlFmt(s.azl) : "…"} approx={v(s?.azl)} testId="wm-azl" />
            </div>

            <div className="kicker mt-6 flex items-center justify-between text-ink-64"><span>AZZLE deposit</span><span>{MARKET === "micro" ? "Micro" : "Standard"} market</span></div>
            <div className="mt-2">
              <Row label="Total" value={s ? `${azlFmt(s.deposit)} AZL` : "…"} approx={v(s?.deposit)} testId="wm-deposit" />
              <Row label="Reserved" sub="Held for a live order" value={s ? `${azlFmt(s.reserved)} AZL` : "…"} approx={v(s?.reserved)} testId="wm-reserved" />
              <Row label="Available" sub={s && s.floorHeld > 0n ? `${azlFmt(s.floorHeld)} AZL of it stays as the entry floor until your live order ends` : undefined} value={s ? `${azlFmt(s.available)} AZL` : "…"} approx={v(s?.available)} testId="wm-available" />
            </div>

            <div className="wm-window mt-5" data-testid="wm-withdraw" data-state={wd.kind === "idle" ? status : wd.kind}>
              {wd.kind === "done" ? (
                <>
                  <p className="text-[14px] text-ink"><b>Done.</b> {azlFmt(wd.amount)} AZL is back in your wallet.</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                    <a className="ulink inline-flex items-center gap-1 text-ink" href={`${BASESCAN}/tx/${wd.hash}`} target="_blank" rel="noreferrer">View on Basescan <ArrowUpRight className="size-3.5" /></a>
                    <a className="ulink inline-flex items-center gap-1 text-ink" href={UNISWAP_AZL_USDC} target="_blank" rel="noreferrer">Swap AZL to USDC on Uniswap <ArrowUpRight className="size-3.5" /></a>
                  </div>
                </>
              ) : wd.kind === "working" ? (
                <p className="flex items-center gap-3 text-[14px] text-ink"><Spinner /> Withdrawing on Base…</p>
              ) : status === "withdrawable" ? (
                <>
                  <button type="button" onClick={withdraw} className="btn-ink kicker inline-flex h-11 w-full items-center justify-center gap-2 bg-ink px-4 text-paper" data-testid="wm-withdraw-btn">
                    Withdraw my deposit · {azlFmt(s!.withdrawable)} AZL
                  </button>
                  <p className="mt-2 text-[12px] leading-[1.5] text-ink-64">
                    {v(s!.withdrawable) ? `${v(s!.withdrawable)} right now. ` : ""}It comes back to this wallet as AZL; no cooldown. Swap it to USDC on Uniswap afterwards if you like.
                    {wd.kind === "error" && <span className="mt-1 block text-destructive">That didn&rsquo;t go through: {wd.msg.slice(0, 140)}</span>}
                  </p>
                </>
              ) : status === "reserved" ? (
                <p className="text-[13px] leading-[1.55] text-ink-64"><b className="text-ink">Reserved by an active order.</b> It unlocks when that order is completed, cancelled or resolved. Then you can withdraw it here.</p>
              ) : status === "empty" ? (
                <p className="text-[13px] leading-[1.55] text-ink-64"><b className="text-ink">Nothing to withdraw.</b> Your AZZLE deposit is empty. It fills up when you place an order.</p>
              ) : (
                <p className="flex items-center gap-3 text-[13px] text-ink-64"><Spinner /> Reading your deposit…</p>
              )}
            </div>

            {s && s.azl > 0n && wd.kind !== "done" && (
              <p className="mt-3 text-[12px] text-ink-64">Have AZL in your wallet? <a className="ulink text-ink" href={UNISWAP_AZL_USDC} target="_blank" rel="noreferrer">Swap it to USDC on Uniswap ↗</a></p>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-rule pt-4 text-[13px]">
              <Link href="/faq#cost" className="ulink text-ink-64" onClick={() => setOpen(false)}>What the deposit is for</Link>
              <button type="button" className="kicker ulink text-ink" onClick={() => { setOpen(false); onSignOut(); }} data-testid="wm-signout">Sign out</button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PrivyWallet() {
  const { logout } = usePrivy();
  const { disconnect } = useDisconnect();
  return <WalletPill onSignOut={() => { logout().catch(() => {}); disconnect(); }} />;
}
function PlainWallet() {
  const { disconnect } = useDisconnect();
  return <WalletPill onSignOut={() => disconnect()} />;
}
export function HeaderWallet() {
  return PRIVY_APP_ID ? <PrivyWallet /> : <PlainWallet />;
}
