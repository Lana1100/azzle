"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { ConnectButton, short } from "@/components/connect-button";
import { TxStep, type Progress } from "@/components/tx-step";
import { Disclosure, TechBlock, TopUpHelp, StepRail } from "@/components/checkout-ui";
import { sendTx, runCalls, sponsorActive, errMsg, setTxUi } from "@/lib/tx";
import { quoteBudgetSwap, readPayState, buildPayWithUsdcCalls, UNI } from "@/lib/client-swap";
import {
  ADDR, MARKET, PRICE_USD6, registryAbi, erc20Abi, arbitrationAbi, readTask, taskActions, confirmationTemplate, fmtAzl, fmtUsd6, taskRef, BASESCAN,
} from "@/lib/client-azzle";
import { Check, Circle, ExternalLink, RefreshCw, X } from "lucide-react";
import { Spinner } from "@/components/spinner";
import { service, priceLabel } from "@/lib/service";
import { DeliverableView } from "./deliverable-view";

const NAME = service.agentName;
const P = priceLabel;
const DL = service.deliverable.label;
const SCRAPE = service.orderFields.find((f) => f.scrape);

type Step = { key: string; label: string; hint: string };
const FLOW: Step[] = [
  { key: "POSTED", label: "Booked", hint: `Your brief is with ${NAME}` },
  { key: "CLAIMED", label: `${NAME} accepted`, hint: `Then you put the ${P} in escrow` },
  { key: "ACTIVE", label: `${P} in escrow`, hint: `${NAME} is working on it` },
  { key: "DELIVERED", label: "Preview ready", hint: "Review it, ask for changes, approve" },
  { key: "COMPLETED", label: "Approved", hint: `${NAME} is paid, the full ${DL} is yours` },
];
const BADGE: Record<number, string> = { 1: `Waiting for ${NAME}`, 2: `Your turn: pay ${P}`, 3: "In progress", 4: "Disputed", 5: "Done", 6: "Cancelled", 7: "Resolved" };

/** Friendly names for the pay-the-price calls (keys from buildPayWithUsdcCalls). Presentation only. */
const PAY_SIG: Record<string, { label: string; why: string }> = {
  "usdc-approve": { label: "Approve USDC", why: "For exactly the amount shown. Never more." },
  "permit2-approve": { label: "Allow this one payment", why: "A one-time permission that expires in minutes." },
  swap: { label: "Convert your USDC for the escrow", why: "At the live price. Any extra stays in your wallet." },
  "azl-approve": { label: "Approve the escrow", why: `For exactly ${P}. Never more.` },
  fund: { label: `Lock ${P} in escrow`, why: `Held safely until you approve the ${DL}.` },
};
const BATCH_SIG = { label: `Pay ${P} into escrow`, why: "One confirmation. The money waits in escrow until you approve." };

function stageIndex(t: any) {
  if (!t) return -1;
  if (t.state === 5) return 4;
  if (t.state === 3 && t.deliveredAt > 0n) return 3;
  return { 1: 0, 2: 1, 3: 2 }[t.state as 1 | 2 | 3] ?? -1;
}

const fmtTime = (s: bigint | number) => new Date(Number(s) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function OrderStatus({ id }: { id: string }) {
  const pub = usePublicClient();
  const { address } = useAccount();
  const [order, setOrder] = useState<any>(null);
  const [task, setTask] = useState<any>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [now, setNow] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [azlBal, setAzlBal] = useState<bigint>(0n);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState<any>(null);
  const [swapQ, setSwapQ] = useState<any>(null);
  const [swapErr, setSwapErr] = useState<string | null>(null);
  const [progress, setProgressState] = useState<Progress>(null);
  const setProgress = (p: Progress) => { setProgressState(p); setTxUi(p ? { title: p.label, description: p.why, step: p.n > 1 ? `Step ${p.i + 1} of ${p.n}` : undefined } : null); };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/${id}`, { cache: "no-store" });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error);
      setOrder(o);
      if (o.taskId && pub) {
        const [t, b] = await Promise.all([readTask(pub, BigInt(o.taskId)), pub.getBlock()]);
        setTask(t); setNow(b.timestamp);
        if (t.state === 4 || t.state === 7) {
          const [d, rw] = await Promise.all([
            pub.readContract({ address: ADDR.arbitrationModule, abi: arbitrationAbi, functionName: "disputes", args: [t.id] }),
            pub.readContract({ address: ADDR.arbitrationModule, abi: arbitrationAbi, functionName: "rulingWindow" }),
          ]) as any;
          const cutoff = d[6] !== 0n ? d[6] : d[5] + rw;
          setDispute({ evidenceDeadline: d[5], rulingDeadline: d[6], status: Number(d[7]), outcome: Number(d[8]), cutoff });
        }
        if (address) {
          const [a, bal] = await Promise.all([
            pub.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "allowance", args: [address, ADDR.escrowVault] }),
            pub.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          ]) as any;
          setAllowance(a); setAzlBal(bal);
          const left = t.totalAmount - t.funded;
          if (left > 0n && (t.state === 2 || t.state === 3) && t.poster.toLowerCase() === address.toLowerCase()) {
            const ps = await readPayState(pub, address);
            setPay(ps);
            const buy = left > bal ? left - bal : 0n;
            if (buy > 0n) {
              try { setSwapQ({ ...(await quoteBudgetSwap(pub, buy)), buy }); setSwapErr(null); } catch (e) { setSwapQ(null); setSwapErr(errMsg(e)); }
            } else setSwapQ(null);
          }
        }
      }
      setLoadErr(null);
    } catch (e) { setLoadErr(errMsg(e)); }
  }, [id, pub, address]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  if (loadErr && !order) return (
    <div className="wrapx grid max-w-xl gap-4 py-24 text-center" data-testid="not-found">
      <h1 className="font-display text-[44px] leading-none">We can&apos;t find that order.</h1>
      <p className="text-ink-64">Check the link from your booking. If you just booked, give it a moment and refresh.</p>
      <div className="flex justify-center gap-3"><Button size="lg" onClick={load}><RefreshCw /> Try again</Button><Link href="/order"><Button size="lg" variant="outline">Start a new order</Button></Link></div>
      <details className="text-xs text-ink-64"><summary className="cursor-pointer">Technical message</summary>{loadErr}</details>
    </div>
  );
  if (!order) return <div className="grid place-items-center py-32"><Spinner className="size-8 text-ink" /></div>;

  const acts = task ? taskActions(task, now, address) : null;
  const stage = stageIndex(task);
  const isPoster = task && address && task.poster.toLowerCase() === address.toLowerCase();
  const remaining = task ? task.totalAmount - task.funded : 0n;
  const terminal = task && [4, 6, 7].includes(task.state);

  const ref = task ? taskRef(task.id) : null;

  /** Fresh quote -> exact approvals -> Uniswap swap (AZL lands in YOUR wallet) -> exact AZL approve -> fund(). Batched when the wallet can. */
  async function payWithUsdc() {
    const left = BigInt(task.totalAmount) - BigInt(task.funded);
    const held: bigint = await pub!.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as any;
    const buy = left > held ? left - held : 0n;
    const q = await quoteBudgetSwap(pub!, buy);
    const ps = await readPayState(pub!, address!);
    if (ps.usdcBal < q.usdcIn) throw new Error(`Need ${fmtUsd6(q.usdcIn)} USDC, wallet has ${fmtUsd6(ps.usdcBal)}.`);
    if (swapQ && q.usdcIn > (swapQ.usdcIn * 102n) / 100n) throw new Error(`Price moved: now ${fmtUsd6(q.usdcIn)} USDC (was ${fmtUsd6(swapQ.usdcIn)}). Refresh to accept.`);
    const deadline = (await pub!.getBlock()).timestamp + 600n;
    const calls = buildPayWithUsdcCalls({ taskId: task.id, azlAmount: left, buyAzl: buy, usdcIn: q.usdcIn, deadline, state: ps });
    try {
      await runCalls(calls, (i: number, n: number) => setProgress(n === 1 && calls.length > 1 ? { i: 0, n: 1, ...BATCH_SIG } : { i, n, ...(PAY_SIG[calls[i].key ?? ""] ?? { label: calls[i].label, why: "" }) }));
    } finally { setProgress(null); }
    await load();
  }
  const regT = { key: `taskRegistry (${MARKET})`, address: ADDR.taskRegistry };

  const usd = (v: bigint) => fmtUsd6(v);
  const payNeed: bigint | null = swapQ ? swapQ.usdcIn : null;
  const usdcShort = !!(pay && payNeed != null && pay.usdcBal < payNeed);
  const holdsEnough = azlBal >= remaining;
  const delivered = task?.deliveredAt > 0n;
  const rail = !task ? 3 : task.state === 5 ? 4 : task.state >= 3 && task.state !== 6 ? 4 : 3;

  // ---- Technical templates: only inside "How the escrow works" ----
  const payTemplate = swapQ ? [
    `You pay        ${fmtUsd6(swapQ.usdcIn)} USDC  (quote ${fmtUsd6(swapQ.usdcExact)} + ${Number(swapQ.bufferBps) / 100}% buffer)`,
    `Escrow gets    ${fmtAzl(remaining)} AZL  (= the ${fmtUsd6(PRICE_USD6)} latched at post)`,
    `Leftover       ~${fmtAzl(swapQ.expectedLeftoverAzl)} AZL stays in your wallet`,
    `Price impact   ${(swapQ.priceImpactBps / 100).toFixed(2)}%   Gas: ${sponsorActive() ? `covered by ${service.name}` : "paid in ETH, shown by your wallet"}`,
    `Route          Uniswap v3 USDC/WETH 0.05% -> v4 WETH/AZL (same route AZZLE's gateway uses)`,
    "",
    confirmationTemplate({ target: { key: "USDC", address: ADDR.usdc }, method: "approve(address,uint256)", args: `spender Permit2 ${UNI.permit2}, exact ${fmtUsd6(swapQ.usdcIn)} (skipped if already approved)`, expected: "Permit2 may move this much USDC", irreversible: "none" }),
    "",
    confirmationTemplate({ target: { key: "Permit2", address: UNI.permit2 }, method: "approve(address token,address spender,uint160 amount,uint48 expiration)", args: `USDC -> Universal Router ${UNI.universalRouter}, ${fmtUsd6(swapQ.usdcIn)}, expires in ~11 min`, expected: "one-time allowance for the swap", irreversible: "none" }),
    "",
    confirmationTemplate({ target: { key: "Uniswap Universal Router", address: UNI.universalRouter }, method: "execute(bytes,bytes[],uint256)", args: `V3_SWAP_EXACT_IN ${fmtUsd6(swapQ.usdcIn)} USDC -> WETH; V4_SWAP WETH -> AZL, min out ${fmtAzl(swapQ.buy)} AZL to you; deadline now+10min`, token: `USDC from you -> AZL to you`, expected: `at least ${fmtAzl(swapQ.buy)} AZL in your wallet, or the whole swap reverts`, irreversible: "swap executes at market within the minimum" }),
  ].join("\n") : swapErr ? `Quote failed: ${swapErr}` : "";
  const fundTemplate = task ? [
    confirmationTemplate({ target: { key: "AZL token", address: ADDR.azl }, method: "approve(address spender,uint256 amount)", args: `spender escrowVault ${ADDR.escrowVault}, amount ${fmtAzl(remaining)} AZL (exact, not unlimited)`, expected: "allowance set to exactly the escrow amount", irreversible: "none" }),
    "",
    confirmationTemplate({ target: regT, method: "fund(uint256 taskId,uint256 amount)", args: `taskId ${ref}, amount ${fmtAzl(remaining)} AZL`, token: `AZL -> escrowVault, ${fmtAzl(remaining)}`, expected: `CLAIMED -> ACTIVE; ${P} locked in escrow until you approve, dispute, or the task expires`, irreversible: "only your approval (or an arbitration ruling) pays the agent" }),
  ].join("\n") : "";
  const otherTemplates = task ? [
    confirmationTemplate({ target: regT, method: "complete(uint256 taskId)", args: `taskId ${ref}`, expected: `ACTIVE -> COMPLETED; escrow pays ${fmtAzl(task.funded - task.released)} AZL to agent ${short(task.worker)}; your collateral is released`, irreversible: "payment is final" }),
    confirmationTemplate({ target: regT, method: "openDispute(uint256 taskId,bytes32 evidenceHash)", args: `taskId ${ref}, evidenceHash keccak256(your statement, stored by this site)`, expected: "ACTIVE -> DISPUTED; escrow frozen; ArbitrationModuleV2 opens a 3-day evidence + 2-day ruling window", irreversible: "if no arbitrator rules, timeout refunds 100% to you; an arbitrator may also rule for the agent" }),
    confirmationTemplate({ target: regT, method: "cancel(uint256 taskId)", args: `taskId ${ref}`, expected: "-> CANCELLED (nothing is funded yet)", irreversible: "the access fee already paid at post is not refunded" }),
    confirmationTemplate({ target: regT, method: "expire(uint256 taskId)", args: `taskId ${ref}`, expected: "-> CANCELLED; unreleased escrow refunds to the poster; defaulting party's fees apply per protocol", irreversible: "final" }),
    confirmationTemplate({ target: { key: "arbitrationModule", address: ADDR.arbitrationModule }, method: "timeout(uint256 taskId)", args: `taskId ${ref}`, expected: "DISPUTED -> RESOLVED (MUTUAL); 100% of escrow refunded to the poster", irreversible: "final" }),
  ].join("\n\n") : "";

  const fundWithHeld = async () => {
    // Fresh on-chain read (not the value from the last page load), so an approval that already landed is never asked again.
    const allow: bigint = await pub!.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "allowance", args: [address!, ADDR.escrowVault] }) as any;
    const n = allow < remaining ? 2 : 1;
    try {
      if (allow < remaining) { setProgress({ i: 0, n, ...PAY_SIG["azl-approve"] }); await sendTx({ address: ADDR.azl, abi: erc20Abi, functionName: "approve", args: [ADDR.escrowVault, remaining] }); }
      setProgress({ i: n - 1, n, ...PAY_SIG.fund });
      await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "fund", args: [task.id, remaining] });
    } finally { setProgress(null); }
    await load();
  };

  // ---- The one thing to do now ----
  let next: { kicker: string; title: string; body: React.ReactNode; action?: React.ReactNode; tone?: "go" | "wait" | "stop" };
  if (!order.taskId) next = { kicker: "Not booked yet", title: "Finish your booking.", tone: "go",
    body: "This order was started but never booked, so nothing was charged.",
    action: <Link href={`/order?${new URLSearchParams(Object.entries(order.fields || {}).filter(([, v]) => typeof v === "string") as [string, string][]).toString()}`}><Button size="lg" className="h-14 w-full px-7 text-base sm:w-auto" data-testid="finish-booking">Finish booking</Button></Link> };
  else if (!task) next = { kicker: "Loading", title: "Tuning in…", body: "Reading your order from the network.", tone: "wait" };
  else if (task.state === 1) next = { kicker: "Booked", title: `${NAME} is reading your brief.`, tone: "wait",
    body: <>Nothing to do right now. When {NAME} accepts, this page asks you to put the {P} in escrow. It refreshes on its own, so you can close it and come back.</> };
  else if (task.state === 2 && !address) next = { kicker: "Your turn", title: `${NAME} accepted. Sign in to pay ${P}.`, tone: "go",
    body: "Use the same email or wallet you booked with.", action: <ConnectButton size="lg" /> };
  else if (task.state === 2 && !isPoster) next = { kicker: "Your turn", title: "Switch to the account you booked with.", tone: "stop",
    body: <>You are signed in as {short(address!)}, but this order was booked by {short(task.poster)}. Sign out and sign in again with the one you used.</>, action: <ConnectButton size="lg" /> };
  else if (task.state === 2 && acts?.canFund) next = { kicker: "Your turn", title: `${NAME} accepted. Put the ${P} in escrow.`, tone: "go",
    body: <>It waits in escrow until you approve the {DL}.</>,
    action: holdsEnough ? (
      <TxStep title={`Lock ${P} in escrow`} testId="fund-step" address={address} progress={progress}
        why={allowance < remaining ? "Two quick confirmations in your wallet." : "One confirmation in your wallet."} cta={`Lock ${P} in escrow`} onRun={fundWithHeld} />
    ) : (
      <div className="grid gap-4">
        <TxStep title={payNeed != null ? `Pay ${usd(payNeed)} USDC into escrow` : "Getting today's price…"} testId="fund-usdc-step" address={address} progress={progress}
          why={swapErr ? "We couldn't get a live price just now. Hit refresh in a moment." : "Includes a small price cushion; anything extra stays in your wallet. We walk you through each confirmation."}
          cta={payNeed != null ? `Pay ${usd(payNeed)} USDC` : "Getting price…"} disabled={payNeed == null || usdcShort} onRun={payWithUsdc} />
        {usdcShort && address && <TopUpHelp address={address} have={usd(pay.usdcBal)} need={usd(payNeed!)} />}
      </div>
    ) };
  else if (task.state === 3 && !delivered) next = { kicker: "In progress", title: `${NAME} is working on it.`, tone: "wait",
    body: `Your ${P} is in escrow. The preview shows up right here when it's ready. Nothing to do until then.` };
  else if (task.state === 3 && delivered && !isPoster) next = { kicker: "Preview ready", title: address ? "Switch to the account you booked with." : "Sign in to approve.", tone: "go",
    body: address ? <>This order was booked by {short(task.poster)}.</> : "Use the same email or wallet you booked with.", action: <ConnectButton size="lg" /> };
  else if (task.state === 3 && delivered) next = { kicker: "Preview ready", title: "Review it. Like it? Approve.", tone: "go",
    body: <>Approving pays {NAME} and unlocks the full {DL}. Want tweaks? Ask for changes below.{acts?.posterDisputeCutoff ? <> Not happy at all? You can dispute until {fmtTime(acts.posterDisputeCutoff)}.</> : null}</>,
    action: acts?.canComplete ? <TxStep title={`Approve and pay ${NAME} ${P}`} testId="complete-step" address={address} progress={progress} why="One confirmation. This is final."
      cta={service.copy.approveCta || `Approve and release the ${P}`} onRun={async () => { await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "complete", args: [task.id] }); await load(); }} /> : undefined };
  else if (task.state === 5) next = { kicker: "Done", title: service.copy.finalReady || `Your ${DL} is unlocked.`, tone: "go",
    body: `${NAME} has been paid. The full ${DL} is below.` };
  else if (task.state === 4) next = { kicker: "Disputed", title: `Your ${P} is frozen while it's reviewed.`, tone: "stop",
    body: dispute && now > dispute.cutoff ? `Nobody ruled in time, so you can take the full ${P} back now.` : <>An independent arbitrator looks at it. If nobody rules{dispute ? ` by ${fmtTime(dispute.cutoff)}` : " in time"}, you get 100% back.</>,
    action: dispute && now > dispute.cutoff ? <TxStep title={`Take your ${P} back`} testId="timeout-step" address={address} progress={progress} why="One confirmation."
      cta="Refund me" onRun={async () => { await sendTx({ address: ADDR.arbitrationModule, abi: arbitrationAbi, functionName: "timeout", args: [task.id] }); await load(); }} /> : undefined };
  else if (task.state === 6) next = { kicker: "Cancelled", title: "This order was cancelled.", tone: "stop", body: "Anything in escrow went back to the wallet that booked it." };
  else if (task.state !== 7) next = { kicker: "Checking", title: "Reading your order…", tone: "wait", body: "This takes a moment. It refreshes on its own." };
  else next = { kicker: "Resolved", title: "The dispute is settled.", tone: "stop",
    body: dispute ? `Outcome: ${["", "you won", `${NAME} won`, "split", "refunded"][dispute.outcome]}.` : "The arbitrator made a decision." };

  const tone = next.tone === "go" ? "border-ink bg-brand/10" : next.tone === "stop" ? "border-destructive/40 bg-destructive/5" : "border-ink/20";

  return (
    <div className="wrapx grid gap-8 pb-24 pt-10 md:pt-14 lg:grid-cols-12 lg:gap-6">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
        <div className="flex items-start gap-3">
          {order.brief?.logo && <img src={order.brief.logo} alt="" className="size-11 shrink-0 rounded-lg border bg-white object-contain" />}
          <div className="min-w-0 flex-1">
            <p className="kicker text-ink-64">{service.name} · Your order</p>
            <h1 className="font-display mt-2 break-words text-[32px] leading-tight md:text-[44px]">{order.brief?.title || DL.charAt(0).toUpperCase() + DL.slice(1)}</h1>
            {SCRAPE && order.fields?.[SCRAPE.name] && <a href={order.fields[SCRAPE.name]} target="_blank" rel="noreferrer noopener" className="block truncate text-sm text-ink-64 hover:underline">{order.fields[SCRAPE.name]}</a>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {task && <Badge variant={task.state === 5 ? "default" : terminal ? "destructive" : "secondary"} data-testid="state-badge">{BADGE[task.state] ?? task.stateName}</Badge>}
            <Button size="icon" variant="ghost" onClick={load} aria-label="Refresh"><RefreshCw /></Button>
          </div>
        </div>

        <StepRail current={rail} allDone={task?.state === 5} />

        <section className={`relative grid gap-4 rounded-2xl border-2 p-5 sm:p-7 ${tone}`} data-testid="next-action">
          <p className="kicker text-ink-64" data-testid="next-kicker">{next.kicker}</p>
          <h2 className="font-display text-[32px] leading-[1.05] text-ink md:text-[40px]" data-testid="next-title">{next.title}</h2>
          <div className="max-w-[56ch] text-[15px] leading-relaxed text-ink">{next.body}</div>
          {next.action && <div className="grid gap-3">{next.action}</div>}
        </section>

        {(order.deliverable || (task && task.state >= 1 && task.state <= 3)) && (
          <Card>
            <CardHeader>
              <CardTitle>{task?.state === 5 ? `Your ${DL}` : "Preview"}</CardTitle>
              <CardDescription>{task?.state === 5 ? "Unlocked. It's yours." : service.copy.previewNote || `The full ${DL} unlocks when you approve.`}</CardDescription>
            </CardHeader>
            <CardContent>
              {order.deliverable ? <DeliverableView id={id} d={order.deliverable} completed={task?.state === 5} /> : (
                <div className="grid min-h-40 place-items-center rounded-lg border border-dashed bg-muted/40 px-6 text-center text-sm text-ink-64">
                  {stage >= 2 ? `${NAME} is working on your ${DL}…` : `Your preview appears here after ${NAME} delivers.`}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {order.deliverable && task?.state === 3 && (
          <Card>
            <CardHeader><CardTitle>Ask for changes</CardTitle><CardDescription>{NAME} can upload a new version before you approve.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {(order.feedback || []).map((f: any, i: number) => <div key={i} className="rounded-lg bg-muted p-3 text-sm"><span className="text-xs text-ink-64">{new Date(f.at).toLocaleString()}</span><br />{f.text}</div>)}
              <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change?" className="min-h-24 text-base" />
              <Button size="lg" variant="outline" className="h-12 w-full sm:w-fit" disabled={!feedback.trim()} onClick={async () => {
                await fetch(`/api/orders/${id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: feedback }) });
                setFeedback(""); load();
              }}>Send to {NAME}</Button>
            </CardContent>
          </Card>
        )}

        {acts?.canPosterDispute && delivered && (
          <Disclosure title="Not happy? Open a dispute" testId="dispute-option">
            {acts.posterDisputeCutoff && <p>You can dispute until {fmtTime(acts.posterDisputeCutoff)} (12 hours after delivery). Your {P} freezes and an independent arbitrator decides. If nobody rules in time, you get 100% back.</p>}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`What is wrong with the ${DL}?`} className="min-h-24 text-base" />
            <TxStep title="Open a dispute" variant="destructive" testId="dispute-step" address={address} progress={progress} cta={`Dispute and freeze the ${P}`} disabled={reason.trim().length < 10}
              why="One confirmation. Write at least a sentence above first."
              onRun={async () => {
                const r = await fetch(`/api/orders/${id}/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, by: address }) });
                const j = await r.json(); if (!r.ok) throw new Error(j.error);
                await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "openDispute", args: [task.id, j.hash] });
                await load();
              }} />
          </Disclosure>
        )}

        {(acts?.canCancel || acts?.canExpire) && (
          <Disclosure title="Cancel this order" testId="cancel-option">
            {acts?.canCancel && (
              <TxStep title="Cancel the booking" variant="outline" testId="cancel-step" address={address} progress={progress} cta="Cancel order"
                why="Nothing has been paid into escrow yet. The small booking fee is not refunded; the rest of your deposit stays yours."
                onRun={async () => { await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "cancel", args: [task.id] }); await load(); }} />
            )}
            {acts?.canExpire && (
              <TxStep title="Close the expired order" variant="outline" testId="expire-step" address={address} progress={progress} cta="Close and refund"
                why="The deadline passed. Anything in escrow goes back to the wallet that booked."
                onRun={async () => { await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "expire", args: [task.id] }); await load(); }} />
            )}
          </Disclosure>
        )}

        <Disclosure title="How the escrow works" testId="escrow-explainer">
          <p><b className="text-ink">Your {P} never goes to {NAME} directly.</b> It sits in an escrow contract on Base, run by the AZZLE protocol, and is released only when you approve.</p>
          <p><b className="text-ink">Under the hood</b> the escrow runs on a token called AZL. When you pay in USDC, it is swapped to AZL on Uniswap at the live price (USDC approval, a short-lived Permit2 allowance, the swap, an exact AZL approval, then fund). Wallets that support batching (EIP-5792) do all of it in one confirmation.</p>
          {task && (
            <div className="grid gap-1.5 rounded-lg border border-ink/15 p-3 text-xs" data-testid="tech-kv">
              <KV k="Task" v={ref!} />
              <KV k="Escrow" v={`${fmtAzl(task.funded)} / ${fmtAzl(task.totalAmount)} AZL`} />
              <KV k="Released" v={`${fmtAzl(task.released)} AZL`} />
              <KV k="State" v={task.stateName} />
              <KV k="Poster" v={short(task.poster)} />
              <KV k={`Agent (${NAME})`} v={task.worker === "0x0000000000000000000000000000000000000000" ? "—" : short(task.worker)} />
              <KV k="Deadline" v={fmtTime(task.deadline)} />
              {acts?.canFund && <KV k="AZL in your wallet" v={`${fmtAzl(azlBal)} / ${fmtAzl(remaining)}`} />}
              {order.deliverable?.sha256 && <KV k="Deliverable sha256" v={`${order.deliverable.sha256.slice(0, 16)}…`} />}
              {order.postTx && <a className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" href={`${BASESCAN}/tx/${order.postTx}`} target="_blank" rel="noreferrer">Booking transaction <ExternalLink className="size-3" /></a>}
            </div>
          )}
          {acts?.canFund && (payTemplate || fundTemplate) && <><p className="font-medium text-ink">What your wallet signs to pay the {P}</p><TechBlock text={[!holdsEnough ? payTemplate : "", fundTemplate].filter(Boolean).join("\n\n")} /></>}
          {otherTemplates && <><p className="font-medium text-ink">Other actions</p><TechBlock text={otherTemplates} /></>}
        </Disclosure>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-span-4 lg:col-start-9 lg:h-fit">
        <Card>
          <CardHeader><CardTitle>Where it&apos;s at</CardTitle></CardHeader>
          <CardContent>
            <ol className="relative grid gap-0" data-testid="timeline">
              {FLOW.map((s, i) => {
                const done = stage >= i;
                const current = i === stage + 1 && !terminal;
                return (
                  <li key={s.key} className="group flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`grid size-7 place-items-center rounded-full ${done ? "bg-ink text-paper" : current ? "bg-brand text-brand-ink" : "bg-transparent text-ink-64 ring-1 ring-rule"}`}>
                        {done ? <Check className="size-4" /> : current ? <Spinner className="size-3.5" /> : <Circle className="size-2.5" />}
                      </span>
                      {i < FLOW.length - 1 && <span className={`mt-1 w-px flex-1 ${stage > i ? "bg-primary" : "bg-border"}`} />}
                    </div>
                    <div className="pb-5 pt-0.5 group-last:pb-0">
                      <div className={`text-sm font-medium ${done || current ? "" : "text-ink-64"}`}>{s.label}</div>
                      <div className="text-xs text-ink-64">{s.hint}</div>
                      {s.key === "DELIVERED" && delivered && <div className="text-xs text-ink-64">at {fmtTime(task.deliveredAt)}</div>}
                    </div>
                  </li>
                );
              })}
              {terminal && (
                <li className="mt-2 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <X className="size-4 shrink-0 text-destructive" />{BADGE[task.state]}
                </li>
              )}
            </ol>
          </CardContent>
        </Card>
        {address && <div className="px-1"><ConnectButton /></div>}
      </aside>
    </div>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span></div>;
