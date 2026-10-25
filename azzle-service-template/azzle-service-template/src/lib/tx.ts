"use client";
import {
  simulateContract, writeContract, waitForTransactionReceipt, getAccount, getCapabilities, sendCalls, waitForCallsStatus,
  call, sendTransaction, estimateGas, getTransaction, getTransactionCount,
} from "wagmi/actions";
import { decodeEventLog, type Abi, type Hex } from "viem";
import { base } from "wagmi/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { registryAbi, scopeAbi } from "@/lib/azzle-core.mjs";

export type RawCall = { to: `0x${string}`; data: Hex; value?: bigint; label?: string; key?: string };
type Sponsored = (tx: { to: `0x${string}`; data: Hex; value?: bigint }) => Promise<Hex>;

// Set by <PrivyBridge/> when the active wallet is a Privy embedded wallet and sponsorship is on.
let sponsored: { address: string; send: Sponsored } | null = null;
export function setSponsoredSender(s: typeof sponsored) { sponsored = s; }

/** Presentation only: a friendly title for the wallet confirmation screen (used by the Privy embedded wallet). */
export type TxUi = { title: string; description?: string; step?: string } | null;
let txUi: TxUi = null;
export function setTxUi(u: TxUi) { txUi = u; }
export function getTxUi() { return txUi; }
export function sponsorActive() {
  const a = getAccount(wagmiConfig).address;
  return !!(sponsored && a && sponsored.address.toLowerCase() === a.toLowerCase());
}

function decodeEvents(logs: readonly { data: Hex; topics: readonly Hex[] }[]) {
  const events: { eventName: string; args: any }[] = [];
  for (const l of logs) {
    for (const abi of [registryAbi, scopeAbi]) {
      try { events.push(decodeEventLog({ abi, data: l.data, topics: l.topics as any }) as any); break; } catch {}
    }
  }
  return events;
}

// ---- Reliability: the public Base RPC is load-balanced, so a node can briefly lag the one that served the receipt. ----
const CONFIRMATIONS = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: any) => [e?.shortMessage, e?.details, e?.message, e?.cause?.message, e?.cause?.shortMessage, e?.cause?.cause?.message].filter(Boolean).join(" ");
export function isUserRejection(e: any) {
  const code = e?.code ?? e?.cause?.code ?? e?.cause?.cause?.code;
  return code === 4001 || /user rejected|user denied|rejected the request|request rejected|cancelled by user|user cancel|user exited|closed the modal/i.test(errText(e));
}
// Errors raised BEFORE anything is broadcast, typically by a lagging node (stale nonce / stale allowance at gas estimate).
const PRE_BROADCAST = /nonce too low|nonce has already been used|header not found|missing trie node|unknown block|failed to estimate|estimate ?gas|gas required exceeds|execution reverted|insufficient allowance|exceeds allowance|allowanceexpired|insufficientallowance|transfer_from_failed|rate limit|429/i;
// Never resend on these: the tx may already be in the mempool.
const MAYBE_SENT = /already known|replacement|underpriced|timed? ?out|timeout/i;

/** One automatic, silent retry after ~2 s. Preflight (nothing signed) retries any non-rejection error; sends only pre-broadcast errors. */
async function retryOnce<T>(fn: () => Promise<T>, onlyPreBroadcast: boolean): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (isUserRejection(e)) throw e;
    const t = errText(e);
    if (onlyPreBroadcast && (!PRE_BROADCAST.test(t) || MAYBE_SENT.test(t))) throw e;
    await sleep(2000);
    return fn();
  }
}

/** The Privy email (embedded) wallet. External wallets keep their own prompts and fill their own nonce/gas. */
const isEmbedded = () => !!getAccount(wagmiConfig).connector?.id?.startsWith("io.privy.wallet");
const lastNonce = new Map<string, number>();

/** Embedded wallet: fill nonce + gas from OUR RPC (already caught up after confirm), so Privy never fills them from a stale node. */
async function embeddedTxParams(c: { to: `0x${string}`; data: Hex; value?: bigint }) {
  const account = getAccount(wagmiConfig).address!;
  const [pending, gas] = await Promise.all([
    getTransactionCount(wagmiConfig, { address: account, blockTag: "pending", chainId: base.id }),
    estimateGas(wagmiConfig, { account, to: c.to, data: c.data, value: c.value ?? 0n, chainId: base.id } as any),
  ]);
  const last = lastNonce.get(account.toLowerCase());
  return { nonce: last != null ? Math.max(pending, last + 1) : pending, gas: (gas * 13n) / 10n };
}

/** Receipt + confirmations, then wait until our RPC has seen the tx (account nonce advanced) before the next step reads state. */
async function confirm(hash: Hex) {
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, confirmations: CONFIRMATIONS, chainId: base.id });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  try {
    const tx = await getTransaction(wagmiConfig, { hash, chainId: base.id });
    lastNonce.set(receipt.from.toLowerCase(), tx.nonce);
    for (let k = 0; k < 10; k++) {
      const n = await getTransactionCount(wagmiConfig, { address: receipt.from, blockTag: "latest", chainId: base.id });
      if (n > tx.nonce) break;
      await sleep(1000);
    }
  } catch { /* best effort: the confirmations above already cover the common case */ }
  return { hash, receipt, events: decodeEvents(receipt.logs as any) };
}

/** simulate -> sign -> wait for the mined receipt (+confirmations) -> verify status -> decode registry/scope events (Bankr rule: verify receipts). */
export async function sendTx(req: { address: `0x${string}`; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }) {
  const { request } = await retryOnce(() => simulateContract(wagmiConfig, req as any), false);
  if (sponsorActive() || isEmbedded()) {
    const { encodeFunctionData } = await import("viem");
    const data = encodeFunctionData({ abi: req.abi as Abi, functionName: req.functionName, args: req.args as any });
    return sendData({ to: req.address, data, value: req.value });
  }
  return confirm(await retryOnce(() => writeContract(wagmiConfig, request as any), true));
}

async function sendData(c: { to: `0x${string}`; data: Hex; value?: bigint }) {
  if (sponsorActive()) return confirm(await retryOnce(() => sponsored!.send(c), true));
  if (isEmbedded()) {
    return confirm(await retryOnce(async () => {
      const p = await embeddedTxParams(c);
      return sendTransaction(wagmiConfig, { to: c.to, data: c.data, value: c.value ?? 0n, chainId: base.id, nonce: p.nonce, gas: p.gas });
    }, true));
  }
  return confirm(await retryOnce(() => sendTransaction(wagmiConfig, { to: c.to, data: c.data, value: c.value ?? 0n, chainId: base.id }), true));
}

/** One raw call: eth_call preflight (catches reverts before any wallet prompt; one silent retry for a lagging node), then send + verify. */
export async function sendRaw(c: RawCall) {
  const account = getAccount(wagmiConfig).address;
  await retryOnce(() => call(wagmiConfig, { account, to: c.to, data: c.data, value: c.value ?? 0n, chainId: base.id }), false);
  return sendData(c);
}

/** Does the connected wallet do atomic EIP-5792 batches on Base (Base Account, 7702 MetaMask, ...)? */
export async function canBatch() {
  if (sponsorActive()) return false; // Privy sponsorship is per-transaction
  try {
    const caps: any = await getCapabilities(wagmiConfig, { chainId: base.id } as any);
    const c = caps?.[base.id] ?? caps;
    const s = c?.atomic?.status ?? (c?.atomicBatch?.supported ? "supported" : undefined);
    return s === "supported" || s === "ready";
  } catch { return false; }
}

/**
 * Run an ordered list of calls: one atomic wallet_sendCalls when the wallet supports it (one signature, all-or-nothing),
 * otherwise one transaction at a time, each preflighted and confirmed before the next. `onStep` reports progress.
 */
export async function runCalls(calls: RawCall[], onStep?: (i: number, total: number, label?: string) => void) {
  if (calls.length > 1 && (await canBatch())) {
    onStep?.(0, 1, "One signature for the whole batch");
    const { id } = await sendCalls(wagmiConfig, { calls: calls.map(({ to, data, value }) => ({ to, data, value: value ?? 0n })), chainId: base.id, forceAtomic: true } as any);
    const res: any = await waitForCallsStatus(wagmiConfig, { id, timeout: 180_000 });
    if (res.status !== "success") throw new Error(`batch ${id} did not succeed (${res.status})`);
    const logs = (res.receipts ?? []).flatMap((r: any) => r.logs ?? []);
    return { batched: true, hashes: (res.receipts ?? []).map((r: any) => r.transactionHash), events: decodeEvents(logs) };
  }
  const hashes: Hex[] = [], events: any[] = [];
  for (let i = 0; i < calls.length; i++) {
    onStep?.(i, calls.length, calls[i].label);
    const r = await sendRaw(calls[i]);
    hashes.push(r.hash); events.push(...r.events);
  }
  return { batched: false, hashes, events };
}

export const errMsg = (e: any) => e?.shortMessage || e?.details || e?.message || String(e);
