"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, usePublicClient } from "wagmi";
import { base } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ConnectButton } from "@/components/connect-button";
import { PRIVY_APP_ID } from "@/lib/wagmi";
import { TxStep, type Progress } from "@/components/tx-step";
import { StepRail, STEPS, Disclosure, TechBlock, TopUpHelp, PriceLine, CopyAddress } from "@/components/checkout-ui";
import { sendTx, runCalls, sponsorActive, errMsg, canBatch, setTxUi, type RawCall } from "@/lib/tx";
import { quoteBudgetSwap, readPayState } from "@/lib/client-swap";
import { encodeFunctionData } from "viem";
import {
  ADDR, MARKET, PRICE_USD6, DEADLINE_DAYS, registryAbi, scopeAbi, gatewayAbi, erc20Abi, quoteUsd, posterReadiness, confirmationTemplate, buildScope,
  fmtAzl, fmtUsd6,
} from "@/lib/client-azzle";
import * as costMath from "@/lib/cost-math.mjs";
import { Check, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { service, priceLabel } from "@/lib/service";
import { OrderFields, FieldSummary, initialValues, type FieldValues } from "./order-fields";

const { checkoutTotals, collateralEth: ethFor } = costMath as any;
const NAME = service.agentName;
const SCRAPE = service.orderFields.find((f) => f.scrape);

/** Plain-language label + reason for each signature in the booking checkout. */
const SIG = {
  approve: { label: "Approve USDC", why: "Lets the booking take exactly the amount shown. Never more." },
  deposit: { label: "Pay your booking deposit", why: "It reserves your slot. It stays in your AZZLE deposit for your next order, or you withdraw it from your wallet." },
  depositBatch: { label: "Approve and pay your deposit", why: "One confirmation for the exact amount shown." },
  bookBatch: { label: `Pay your deposit and book ${NAME}`, why: "One confirmation: the exact deposit, then your slot is reserved." },
  depositEth: { label: "Pay your booking deposit with ETH", why: "It reserves your slot. It stays in your AZZLE deposit for your next order, or you withdraw it from your wallet." },
  post: { label: `Book ${NAME}`, why: "Reserves your slot." },
  publish: { label: `Send your brief to ${NAME}`, why: `So ${NAME} can find your order. Private fields stay private (only a hash goes on-chain).` },
};

function StepHead({ n, title, done, active }: { n: number; title: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-ink text-paper" : active ? "bg-brand text-brand-ink" : "text-ink-64 ring-1 ring-ink/25"}`}>
        {done ? <Check className="size-4" /> : n}
      </span>
      <span className="min-w-0">
        <span aria-hidden className="kicker block text-[10px] leading-none text-ink-64 md:text-[11px]">Step {n}</span>
        <span className={`font-display mt-1 block text-[22px] leading-tight ${active || done ? "text-ink" : "text-ink-64"}`}>{title}</span>
      </span>
    </div>
  );
}

const usd = (v: bigint) => fmtUsd6(v);

export function OrderFlow() {
  const sp = useSearchParams();
  const router = useRouter();
  const pub = usePublicClient();
  const { address, isConnected, chainId, connector } = useAccount();
  const embedded = !!connector?.id?.startsWith("io.privy.wallet");
  const wrongNet = isConnected && chainId != null && chainId !== base.id;

  const [values, setValues] = useState<FieldValues>(() => initialValues(service.orderFields, sp));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<any>(null);
  const [briefOk, setBriefOk] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [quote, setQuote] = useState<any>(null);
  const [ready, setReady] = useState<any>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [swapQ, setSwapQ] = useState<any>(null); // USDC that buys the service price in AZL right now (Uniswap quote)
  const [pay, setPay] = useState<any>(null);
  const [batch, setBatch] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);

  async function refresh() {
    if (!pub) return;
    setLoadingQ(true);
    try {
      const q = await quoteUsd(pub, PRICE_USD6);
      setQuote(q);
      const [r, sq, ps, b] = await Promise.all([
        address ? posterReadiness(pub, address, q.azlWei) : null,
        quoteBudgetSwap(pub, q.azlWei).catch(() => null),
        address ? readPayState(pub, address) : null,
        address ? canBatch() : false,
      ]);
      setReady(r); setSwapQ(sq); setPay(ps); setBatch(!!b);
    } catch (e) { setErr(errMsg(e)); } finally { setLoadingQ(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [pub, address]);

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setErr(null); setFieldErrors({});
    try {
      const r = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fields: values }) });
      const j = await r.json();
      if (!r.ok) { if (j.errors) setFieldErrors(j.errors); throw new Error(j.error); }
      setOrder(j); setBriefOk(false);
    } catch (e) { setErr(errMsg(e)); } finally { setCreating(false); }
  }

  // The service price is only needed at fund() time (after the agent accepts); it can be paid in USDC then, swapped just in time.
  // All display + call amounts come from src/lib/cost-math.mjs (unit-tested): deposit = 130% of the collateral shortfall,
  // rounded up to cents, minOut 90%; the access fee shows as $0 when staking credits waive it.
  const usdcBal: bigint | null = pay?.usdcBal ?? null;
  const t = useMemo(() => checkoutTotals({ quote, ready, swapQ, usdcBal }), [quote, ready, swapQ, usdcBal]);
  const collateralUsdc: { usdcIn: bigint; minOut: bigint } | null = t.deposit;
  const collateralEth = useMemo(() => (ready?.collateralShortfall ? ethFor(ready.collateralShortfall, quote) : null), [ready, quote]);
  const { needDeposit, feeUsd6, depositToday, refundable, total, shortToday, shortLater } = t;
  const serviceUsdc: bigint | null = t.serviceUsdc;
  const needGas = ready && !sponsorActive() && ready.ethBal === 0n;

  const needApprove = needDeposit && (pay?.usdcToGateway ?? 0n) < (collateralUsdc?.usdcIn ?? 0n);
  // Wallets that batch (EIP-5792) confirm deposit + booking at once; the brief needs the new task id, so it is a 2nd confirmation.
  const plan = needDeposit
    ? (batch ? [SIG.bookBatch, SIG.publish] : [...(needApprove ? [SIG.approve] : []), SIG.deposit, SIG.post, SIG.publish])
    : [SIG.post, SIG.publish];

  const step = !order ? 0 : !briefOk ? 1 : !isConnected ? 2 : 3;
  const canPay = step === 3 && !!quote?.oracleValid && !!ready && !wrongNet && !shortToday
    && (!needDeposit || (!!collateralUsdc && !ready.intakePaused));

  const deadlineFor = async () => (await pub!.getBlock()).timestamp + BigInt(DEADLINE_DAYS * 86400);
  // Public fields + keccak of the private ones, exactly as the server computed them for this order.
  const scope = order ? buildScope({ orderId: order.id, fields: order.fields || {}, privateHash: order.privateHash || null, siteUrl: typeof window !== "undefined" ? window.location.origin : "" }) : "";

  /** Progress shown on the page and, for the email wallet, on its confirmation screen. Presentation only. */
  function prog(p: Progress) {
    setProgress(p);
    setTxUi(p ? { title: p.label, description: p.why, step: p.n > 1 ? `Step ${p.i + 1} of ${p.n}` : undefined } : null);
  }
  async function topUpEth() {
    const deadline = (await pub!.getBlock()).timestamp + 600n;
    prog({ i: 0, n: 1, ...SIG.depositEth });
    try {
      await sendTx({ address: ADDR.paymentGateway, abi: gatewayAbi, functionName: "fundWithEth", args: [collateralEth!.minOut, deadline], value: collateralEth!.ethIn });
    } finally { prog(null); }
    await refresh();
  }
  /** Same exact-amount approve + fundWithUsdc calls as before. */
  async function depositCalls(): Promise<RawCall[]> {
    const deadline = (await pub!.getBlock()).timestamp + 600n;
    const calls: RawCall[] = [];
    // Fresh on-chain allowance (not the cached page state): skip the approve when an exact-or-larger one already landed.
    const allowed: bigint = await pub!.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [address!, ADDR.paymentGateway] }) as any;
    if (allowed < collateralUsdc!.usdcIn)
      calls.push({ label: "Approve USDC (exact)", key: "approve", to: ADDR.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ADDR.paymentGateway, collateralUsdc!.usdcIn] }) });
    calls.push({ label: "Deposit via AZZLE gateway", key: "deposit", to: ADDR.paymentGateway, data: encodeFunctionData({ abi: gatewayAbi, functionName: "fundWithUsdc", args: [collateralUsdc!.usdcIn, collateralUsdc!.minOut, deadline] }) });
    return calls;
  }
  async function publishAndAttach(taskId: bigint, postHash: string, i: number, n: number) {
    prog({ i, n, ...SIG.publish });
    const s = await sendTx({ address: ADDR.taskScopeRegistry, abi: scopeAbi, functionName: "publish", args: [taskId, scope] });
    const r = await fetch(`/api/orders/${order.id}/attach`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: taskId.toString(), postTx: postHash, scopeTx: s.hash }) });
    if (!r.ok) throw new Error((await r.json()).error);
    router.push(`/order/${order.id}`);
  }
  function postedTaskId(events: { eventName: string; args: any }[]) {
    const ev = events.find((e) => e.eventName === "TaskPosted");
    if (!ev || ev.args.poster.toLowerCase() !== address!.toLowerCase()) throw new Error("TaskPosted not found in receipt");
    return ev.args.taskId as bigint;
  }
  /** One "Pay" button: deposit (only if short), book, attach the brief. */
  async function payAndBook() {
    const n = plan.length;
    try {
      if (needDeposit) {
        const ps = await readPayState(pub!, address!);
        if (ps.usdcBal < collateralUsdc!.usdcIn) throw new Error(`Need ${usd(collateralUsdc!.usdcIn)} USDC, wallet has ${usd(ps.usdcBal)}.`);
      }
      if (needDeposit && batch) {
        // Atomic: approve (exact) + deposit + post in one confirmation. All-or-nothing, so the post can't run without the deposit.
        const fresh = await quoteUsd(pub!, PRICE_USD6);
        const deadline = await deadlineFor();
        const calls = [...(await depositCalls()),
          { label: "Post task", key: "post", to: ADDR.taskRegistry, data: encodeFunctionData({ abi: registryAbi, functionName: "post", args: [fresh.azlWei, deadline] }) }];
        prog({ i: 0, n, ...SIG.bookBatch });
        const res = await runCalls(calls);
        if (!res.batched) throw new Error("wallet did not batch; refresh and try again");
        await publishAndAttach(postedTaskId(res.events), res.hashes[res.hashes.length - 1], 1, n);
        return;
      }
      let i = 0;
      if (needDeposit) {
        const calls = await depositCalls();
        await runCalls(calls, (k) => prog({ i: k, n, ...(calls[k].key === "approve" ? SIG.approve : SIG.deposit) }));
        i = calls.length;
        await refresh();
        const q = await quoteUsd(pub!, PRICE_USD6);
        const r = await posterReadiness(pub!, address!, q.azlWei);
        if (r.collateralShortfall > 0n) throw new Error("Your deposit landed, but the price moved and it is a little short now. Refresh for a new quote.");
      }
      const fresh = await quoteUsd(pub!, PRICE_USD6);
      const deadline = await deadlineFor();
      prog({ i, n, ...SIG.post });
      const p = await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "post", args: [fresh.azlWei, deadline] });
      await publishAndAttach(postedTaskId(p.events), p.hash, i + 1, n);
    } finally { prog(null); }
  }

  const escrowTemplate = order && quote && address ? [
    confirmationTemplate({ target: { key: `taskRegistry (${MARKET})`, address: ADDR.taskRegistry }, method: "post(uint256 totalAmount,uint64 deadline)",
      args: `totalAmount ${fmtAzl(quote.azlWei)} AZL (= ${fmtUsd6(PRICE_USD6)} at par), deadline now+${DEADLINE_DAYS}d`,
      expected: `new task in POSTED; ${fmtUsd6(PRICE_USD6)} USD quote latched; your collateral reserved`, irreversible: `access fee ~${fmtAzl(ready?.quote?.accessFee || 0n)} AZL debited from deposit to the protocol treasury` }),
    "",
    confirmationTemplate({ target: { key: "taskScopeRegistry", address: ADDR.taskScopeRegistry }, method: "publish(uint256 taskId,string scope)",
      args: scope, expected: `public, write-once brief tag so ${NAME} can find this order`, irreversible: "scope text is public and cannot be changed (private fields are only hashed)" }),
    "",
    `Next: ${NAME} claims -> you fund ${fmtAzl(quote.azlWei)} AZL into escrowVault ${ADDR.escrowVault}: from AZL you hold, or swapped from ~${swapQ ? fmtUsd6(swapQ.usdcIn) : priceLabel} USDC just in time.`,
  ].join("\n") : "";
  const depositTemplate = collateralUsdc ? confirmationTemplate({ target: { key: "paymentGateway", address: ADDR.paymentGateway }, method: "approve + fundWithUsdc(uint256,uint256,uint256)",
    args: `exactUsdcIn ${fmtUsd6(collateralUsdc.usdcIn)}, minAzlOut ${fmtAzl(collateralUsdc.minOut)} AZL, deadline now+10min`, token: `USDC ${ADDR.usdc} -> spender paymentGateway, exact ${fmtUsd6(collateralUsdc.usdcIn)} (not unlimited)`,
    expected: "USDC swapped to AZL and credited to your AZZLE deposit", irreversible: "swap executes at market" }) : "";

  const priceBox = (
    <PriceBox quote={quote} ready={ready} signedIn={!!address} needDeposit={needDeposit} depositToday={depositToday}
      refundable={refundable} feeUsd6={feeUsd6} serviceUsdc={serviceUsdc} total={total} />
  );

  return (
    <div className="wrapx grid gap-8 pb-24 pt-10 md:pt-14 lg:grid-cols-12 lg:gap-6">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
        <div>
          <p className="kicker text-ink-64">{service.name} · {priceLabel} · {service.turnaround.label}</p>
          <h1 className="font-display mt-4 text-[40px] leading-[1] text-ink md:text-[60px]">{service.copy.orderTitle || "Order"}<span className="text-brand">.</span></h1>
          <p className="mt-4 max-w-[48ch] text-[18px] leading-snug text-ink-64">{service.copy.orderSub} The {priceLabel} waits in escrow until you approve.</p>
        </div>

        <StepRail current={step} />

        {/* 1 Details */}
        <Card>
          <CardHeader><StepHead n={1} title={STEPS[0]} done={!!order} active={step === 0} />
            {step === 0 && SCRAPE?.help && <CardDescription>{SCRAPE.help}</CardDescription>}</CardHeader>
          <CardContent>
            {!order ? (
              <form className="grid gap-4" onSubmit={createOrder}>
                <OrderFields fields={service.orderFields} values={values} onChange={setValues} errors={fieldErrors} />
                <Button type="submit" size="lg" className="h-14 w-full px-7 text-base sm:w-fit" disabled={creating} data-testid="link-submit">
                  {creating && <Spinner />}{creating ? `${NAME} is reading your details…` : `Next: ${STEPS[1].toLowerCase()}`}
                </Button>
                {err && <p className="text-sm text-destructive">That didn&apos;t work: {err}</p>}
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink-64">{SCRAPE ? String(values[SCRAPE.name] || "") : order.id}</span>
                <Button size="sm" variant="ghost" onClick={() => { setOrder(null); setBriefOk(false); }}>Change</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2 Check the brief */}
        <Card className={step < 1 ? "opacity-60" : ""}>
          <CardHeader><StepHead n={2} title={STEPS[1]} done={briefOk} active={step === 1} /></CardHeader>
          {order && (
            <CardContent className="grid gap-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3" data-testid="brief-summary">
                {order.brief?.logo && <img src={order.brief.logo} alt="" className="size-10 rounded-md bg-white object-contain" />}
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{order.brief?.status === "ready" && order.brief.title ? order.brief.title : `${NAME} will read this when it starts`}</div>
                  <div className="truncate text-muted-foreground">{order.brief?.tagline || (SCRAPE ? String(values[SCRAPE.name] || "") : "")}</div>
                </div>
              </div>
              <FieldSummary fields={service.orderFields} values={values} />
              <p className="text-xs text-ink-64">Fields without &ldquo;private&rdquo; go into the public on-chain task scope.</p>
              {!briefOk && <Button size="lg" className="h-14 w-full px-7 text-base sm:w-fit" onClick={() => setBriefOk(true)} data-testid="brief-ok">Looks right, continue</Button>}
            </CardContent>
          )}
        </Card>

        {/* 3 Sign in */}
        <Card className={step < 2 ? "opacity-60" : ""}>
          <CardHeader><StepHead n={3} title={STEPS[2]} done={step > 2 && !wrongNet} active={step === 2 || wrongNet} />
            {step >= 2 && <CardDescription>{PRIVY_APP_ID ? "Use your email and we'll set up a wallet for you in seconds. Already have a crypto wallet? Use that." : "Sign in with a Base Account (passkey, no extension) or any browser wallet."}</CardDescription>}</CardHeader>
          {step >= 2 && <CardContent><ConnectButton size="lg" /></CardContent>}
        </Card>

        {/* 4 Pay */}
        <Card className={step < 3 ? "opacity-60" : ""}>
          <CardHeader><StepHead n={4} title={STEPS[3]} active={step === 3} /></CardHeader>
          {step >= 3 && (
            <CardContent className="grid gap-5">
              <div className="lg:hidden">{priceBox}</div>

              {shortToday && address && <TopUpHelp address={address} have={usd(usdcBal!)} need={usd(depositToday!)} />}
              {needGas && address && (
                <div className="grid gap-2 rounded-lg border border-brand bg-brand/10 p-4 text-sm text-ink" data-testid="gas-help">
                  <div className="font-semibold">Add a little ETH for the network fee.</div>
                  <p className="text-ink-64">Every step is a transaction on Base, and Base charges a network fee of a few cents, paid in ETH. Your wallet has none yet. About $1 of ETH covers the whole order with room to spare. Your wallet also needs the USDC for the payment.</p>
                  <div className="text-ink-64">Your wallet&rsquo;s address on Base. If you signed in with email, this is the wallet we set up for you:</div>
                  <CopyAddress address={address} />
                  <ol className="ml-4 grid list-decimal gap-1 text-ink-64">
                    <li>Copy the address above.</li>
                    <li>From an exchange like Coinbase, withdraw a little <b className="text-ink">ETH</b> and the <b className="text-ink">USDC</b> you need to this address. Choose <b className="text-ink">Base</b> as the network. Sending from another wallet works too, as long as it&rsquo;s on Base.</li>
                    <li>Wait a minute, then hit refresh below.</li>
                  </ol>
                  <p className="text-xs text-ink-64">Only send on the Base network. Funds sent on another network (like Ethereum mainnet) won&rsquo;t show up here.</p>
                </div>
              )}
              {ready?.intakePaused && needDeposit && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Bookings are paused for a moment on the escrow network. Nothing to do on your side; try again a little later.</p>}
              {quote && !quote.oracleValid && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Live prices are refreshing. Give it a minute, then hit refresh.</p>}

              {address && quote && (
                <TxStep testId="pay-primary" address={address} progress={progress} disabled={!canPay}
                  title={needDeposit && depositToday != null ? `Pay ${usd(depositToday)} USDC now to book` : `Book ${NAME}`}
                  why={<>{embedded ? (plan.length === 1 ? "One click. We send it on Base for you." : `One click. We run the ${plan.length} steps on Base for you and show each one here.`) : plan.length === 1 ? "One confirmation in your wallet." : `${plan.length} quick confirmations in your wallet. We walk you through each one.`}{" "}
                    {serviceUsdc != null && serviceUsdc > 0n && <>The {usd(serviceUsdc)} for the {service.deliverable.label} goes into escrow once {NAME} accepts.</>}</>}
                  cta={needDeposit && depositToday != null ? `Pay ${usd(depositToday)} USDC` : `Book ${NAME}`}
                  onRun={payAndBook} />
              )}
              {ready && usdcBal != null && (
                <div className="flex items-center justify-between gap-3 px-1 text-sm text-ink-64" data-testid="readiness">
                  <span>Your wallet: <span className="text-ink">{usd(usdcBal)} USDC</span></span>
                  <Button variant="ghost" size="sm" onClick={refresh} disabled={loadingQ}><RefreshCw className={loadingQ ? "animate-spin" : ""} /> Refresh</Button>
                </div>
              )}
              {shortLater && address && (
                <div className="grid gap-2 rounded-lg border border-ink/15 p-4 text-sm text-ink-64" data-testid="topup-later">
                  <div>You can book now. Before paying for the {service.deliverable.label}, top up to <b className="text-ink">{usd(total!)}</b> USDC on Base. Same address:</div>
                  <CopyAddress address={address} />
                </div>
              )}

              <p className="rounded-lg bg-ink p-4 text-sm leading-relaxed text-paper" data-testid="whats-next">
                <b>What happens next:</b> {NAME} accepts your brief, then your order page asks you to put the {priceLabel} in escrow. You review a preview, ask for changes if you like, and approve. Only then does {NAME} get paid.
              </p>

              {needDeposit && collateralEth && !ready.intakePaused && (
                <Disclosure title="Pay with ETH instead" testId="eth-option">
                  <TxStep title={`Pay the deposit with ${(Number(collateralEth.ethIn) / 1e18).toFixed(5)} ETH`} testId="topup-eth" variant="outline" address={address} progress={progress}
                    why="One confirmation. Then the Pay button above only needs to book."
                    cta={`Pay ${(Number(collateralEth.ethIn) / 1e18).toFixed(5)} ETH`} onRun={topUpEth} />
                </Disclosure>
              )}
            </CardContent>
          )}
        </Card>

        {/* 5 */}
        <Card className="opacity-60">
          <CardHeader><StepHead n={5} title={STEPS[4]} />
            <CardDescription>On your order page. Approve and the full {service.deliverable.label} unlocks. Not happy? Ask for changes, or open a dispute within 12 hours of delivery.</CardDescription></CardHeader>
        </Card>

        <Disclosure title="How the escrow works" testId="escrow-explainer">
          <p><b className="text-ink">Your {priceLabel} never goes to {NAME} directly.</b> It sits in an escrow contract on Base, run by the AZZLE protocol. {NAME} gets it when you press Approve (or by an arbitration ruling).</p>
          <p><b className="text-ink">The booking deposit</b> is AZZLE collateral. It stops spam orders, and stays in your AZZLE deposit for your next order, or withdraw it anytime from your wallet (top right). While an order is live, the part reserved for it is locked until the order ends; there is no cooldown. A small part of it is the protocol access fee, which goes to the AZZLE treasury (not {NAME}) and is not refunded.</p>
          <p><b className="text-ink">Not happy with it?</b> Open a dispute within 12 hours of delivery. The escrow freezes and an arbitrator decides. If nobody rules in time, you get 100% back.</p>
          <p><b className="text-ink">Under the hood</b> the escrow runs on a token called AZL. Your USDC is swapped to AZL on Uniswap at the live price, straight into your wallet and then into escrow. Approvals (USDC, Permit2, AZL) are always for the exact amount, never unlimited. Wallets that support batching (EIP-5792) confirm several steps at once. {NAME} never holds your money.</p>
          {quote && (
            <TechBlock text={[
              `${fmtUsd6(PRICE_USD6)} = ${fmtAzl(quote.azlWei)} AZL`,
              `AZL/ETH (2h TWAP, Uniswap v4): ${(Number(quote.azlPerEth) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
              `ETH/USD (Chainlink): $${(Number(quote.ethUsdWad) / 1e18).toFixed(2)}`,
              `AZL = ${fmtUsd6(PRICE_USD6)} x AZL/ETH / ETH/USD (round up)`,
              `Oracle par check: ${quote.parCheckUsd6 != null ? fmtUsd6(quote.parCheckUsd6) : "oracle invalid"}`,
              swapQ ? `Swap: Uniswap quote ${fmtUsd6(swapQ.usdcExact)} + ${Number(swapQ.bufferBps) / 100}% buffer = ${fmtUsd6(swapQ.usdcIn)}; price impact ${(swapQ.priceImpactBps / 100).toFixed(2)}%; leftover AZL stays in your wallet` : "",
              collateralUsdc ? `Deposit sized at 130% of the collateral shortfall (${fmtAzl(ready.collateralShortfall)} AZL); unused part stays in your AZZLE deposit.` : "",
              `Contracts: task registry ${ADDR.taskRegistry}, escrow ${ADDR.escrowVault}, gateway ${ADDR.paymentGateway}`,
            ].filter(Boolean).join("\n")} />
          )}
          {(depositTemplate || escrowTemplate) && (
            <>
              <p className="font-medium text-ink">What your wallet signs at booking</p>
              <TechBlock text={[depositTemplate, escrowTemplate].filter(Boolean).join("\n\n")} />
            </>
          )}
          {collateralEth && ready?.collateralShortfall > 0n && (
            <TechBlock text={confirmationTemplate({ target: { key: "paymentGateway", address: ADDR.paymentGateway }, method: "fundWithEth(uint256 minAzlOut,uint256 deadline) payable",
              args: `minAzlOut ${fmtAzl(collateralEth.minOut)} AZL, deadline now+10min`, token: `value ${(Number(collateralEth.ethIn) / 1e18).toFixed(6)} ETH (no approval)`,
              expected: `ETH swapped to AZL and credited to your AZZLE deposit (needs ${fmtAzl(ready.collateralShortfall)})`, irreversible: "swap executes at market; what you pay stays in your AZZLE deposit for your next order or withdrawal (minus fees spent)" })} />
          )}
        </Disclosure>
      </div>

      <aside className="hidden min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-span-4 lg:col-start-9 lg:flex lg:h-fit lg:pt-[214px]">
        {priceBox}
      </aside>
    </div>
  );
}

function PriceBox({ quote, ready, signedIn, needDeposit, depositToday, refundable, feeUsd6, serviceUsdc, total }: {
  quote: any; ready: any; signedIn: boolean; needDeposit: boolean; depositToday: bigint | null; refundable: bigint | null;
  feeUsd6: bigint | null; serviceUsdc: bigint | null; total: bigint | null;
}) {
  return (
    <Card data-testid="quote-card" className="border-ink/30">
      <CardContent className="grid gap-4 py-1">
        <div>
          <div className="kicker text-ink-64">Total</div>
          {total != null ? (
            <div className="mt-2 flex items-baseline gap-2" data-testid="line-total">
              <span className="font-display text-[54px] leading-none text-ink">{usd(total)}</span><span className="text-sm text-ink-64">USDC</span>
            </div>
          ) : (
            <div className="mt-2" data-testid="line-total">
              <span className="font-display text-[54px] leading-none text-ink">{priceLabel}</span>
              <div className="mt-1 text-sm text-ink-64">{signedIn || !quote ? "Working out your total…" : `for the ${service.deliverable.label}. Your exact total, including the booking deposit, shows after you sign in.`}</div>
            </div>
          )}
          {depositToday != null && serviceUsdc != null && (
            <div className="mt-2 text-sm text-ink-64">{depositToday > 0n && serviceUsdc > 0n ? <>{usd(depositToday)} now to book, {usd(serviceUsdc)} when {NAME} accepts.</> : depositToday > 0n ? <>All of it now, to book. The {priceLabel} is already in your wallet.</> : <>All of it when {NAME} accepts.</>}</div>
          )}
        </div>
        <Disclosure title="What's in this" testId="price-breakdown">
          <div className="grid gap-3" data-testid="usdc-totals">
            <PriceLine label={`The ${service.deliverable.label}`} sub={serviceUsdc === 0n ? `${priceLabel}, already covered by funds in your wallet. Held in escrow until you approve.` : `${priceLabel}, held in escrow until you approve. Includes a small price cushion; anything extra stays in your wallet.`}
              value={serviceUsdc != null ? usd(serviceUsdc) : "…"} testId="line-service" />
            {needDeposit || !ready ? (
              <>
                <PriceLine label="Booking deposit" sub="Stays in your AZZLE deposit for your next order, or withdraw it from your wallet." value={refundable != null ? usd(refundable) : signedIn ? "…" : "after sign-in"} testId="line-deposit" />
                <PriceLine label="Booking fee" sub={`Non-refundable. Goes to the escrow network, not ${NAME}.`} value={feeUsd6 != null ? usd(feeUsd6) : signedIn ? "…" : "after sign-in"} testId="line-fee" />
              </>
            ) : (
              <PriceLine label="Booking deposit" sub={`Already covered. The booking fee${feeUsd6 != null ? ` (${usd(feeUsd6)}, non-refundable)` : ""} comes out of your existing deposit.`} value={usd(0n)} testId="line-deposit" />
            )}
            <PriceLine strong label="Total" value={total != null ? usd(total) : "…"} />
            <div className="text-xs text-ink-64">Plus the network fee{sponsorActive() ? `, which ${service.name} covers for you` : ", a tiny amount your wallet shows before you confirm"}.</div>
          </div>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
