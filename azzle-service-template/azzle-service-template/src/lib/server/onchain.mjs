import { markChainAlerts, sendOrderAlert } from "./notify.mjs";
// Server-side chain reads + order<->task sync (indexer). Read-only: the server never holds a key.
import { createPublicClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { ADDR, registryAbi, scopeAbi, readTask, parseScope, APP_TAGS, quoteUsd, fmtAzl, PRICE_USD6 } from "../azzle-core.mjs";
import { updateOrder, NO_WRITE } from "./store.mjs";

export const SERVER_RPC = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
let _pub;
export function serverClient() {
  if (!_pub) _pub = createPublicClient({ chain: base, transport: http(SERVER_RPC, { timeout: 30_000 }), batch: { multicall: true } });
  return _pub;
}

export async function listSiteTasks(pub, { fromId = 1n } = {}) {
  const count = await pub.readContract({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "taskCount" });
  const ids = [];
  for (let i = BigInt(fromId); i <= count; i++) ids.push(i);
  const scopes = await Promise.all(ids.map((id) => pub.readContract({ address: ADDR.taskScopeRegistry, abi: scopeAbi, functionName: "scopeOf", args: [id] }).catch(() => "")));
  const out = [];
  for (let k = 0; k < ids.length; k++) {
    const scope = parseScope(scopes[k]);
    if (!scope || !APP_TAGS.includes(scope.app)) continue;
    out.push({ ...(await readTask(pub, ids[k])), scope });
  }
  return { count, tasks: out };
}

export const taskJson = (t) => t && JSON.parse(JSON.stringify(t, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Verify a poster's claim "task N belongs to order X": tx receipt has TaskPosted(N) from the poster, scope (if published) names X. */
export async function verifyAttach(orderId, taskId, postTx) {
  const pub = serverClient();
  const receipt = await pub.getTransactionReceipt({ hash: postTx });
  if (receipt.status !== "success") throw new Error("post tx failed");
  let posted;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== ADDR.taskRegistry.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: registryAbi, data: l.data, topics: l.topics });
      if (e.eventName === "TaskPosted") posted = e.args;
    } catch {}
  }
  if (!posted || posted.taskId !== BigInt(taskId)) throw new Error("TaskPosted not found in tx");
  const scope = parseScope(await pub.readContract({ address: ADDR.taskScopeRegistry, abi: scopeAbi, functionName: "scopeOf", args: [BigInt(taskId)] }).catch(() => ""));
  if (scope && scope.order !== orderId) throw new Error("scope belongs to another order");
  return { poster: posted.poster, amountUsd6: posted.amountUsd6.toString(), totalAmount: posted.totalAmount.toString(), scoped: !!scope };
}

/** Indexer pass: attach site-tagged tasks to orders and cache their state. Idempotent. */
export async function syncOrders() {
  const pub = serverClient();
  const { count, tasks } = await listSiteTasks(pub);
  const changed = [];
  for (const t of tasks) {
    // Re-read + merge (retried on a concurrent write) so the sync never clobbers e.g. a deliverable upload.
    let events = [], change = null, o;
    try {
      o = await updateOrder(t.scope.order, (cur) => {
        events = []; change = null;
        if (cur.taskId && cur.taskId !== t.id.toString()) return NO_WRITE; // first verified task wins
        if (cur.poster && cur.poster.toLowerCase() !== t.poster.toLowerCase()) return NO_WRITE;
        const prev = cur.chain?.state;
        const prevChain = cur.chain;
        cur.taskId = t.id.toString();
        cur.poster = t.poster;
        cur.chain = { ...taskJson(t), syncedAt: new Date().toISOString() };
        if (prev !== t.state) change = { order: cur.id, ref: t.ref, from: prev ?? null, to: t.stateName };
        events = markChainAlerts(cur, prevChain, cur.chain);
      });
    } catch (e) { if (/not found|bad order id/.test(String(e?.message))) continue; throw e; }
    if (change) changed.push(change);
    for (const ev of events) await sendOrderAlert(o, ev);
  }
  return { taskCount: count.toString(), siteTasks: tasks.length, changed };
}

export async function liveQuote() {
  const q = await quoteUsd(serverClient(), PRICE_USD6);
  return { ...taskJson(q), azlFormatted: fmtAzl(q.azlWei) };
}
