#!/usr/bin/env node
// End-to-end protocol test on an ANVIL FORK of Base mainnet using the real AZZLE V2 micro contracts.
// Scenarios: A happy path (approve = complete), B rejection (openDispute -> arbitration timeout refund),
// C no approval (poster silent -> expire after deadline + delivery grace).
// Customer AND worker are fresh random keys created in memory for this run: no project keys are ever loaded.
// Run: bash tools/fork-start.sh && node tools/e2e-fork.test.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";
import {
  ADDR, registryAbi, scopeAbi, gatewayAbi, erc20Abi, depositAbi, escrowAbi, arbitrationAbi, twapAbi,
  quoteUsd, posterReadiness, readTask, buildScope, hashText, fmtAzl, fmtUsd6, taskRef, RESOLUTION_NAMES, PRICE_USD6,
} from "../src/lib/azzle-core.mjs";
import { publicClient, walletClient, sendVerified } from "./lib/chain.mjs";
import { assertFork, setEth, giveAzl, warp } from "./lib/fork.mjs";

const pub = publicClient(process.env.RPC_URL || "http://127.0.0.1:8545");
await assertFork(pub);
const log = (...a) => console.log(...a);
const ok = (c, m) => { if (!c) throw new Error("ASSERT FAILED: " + m); log("  ✓ " + m); };

const customer = privateKeyToAccount(generatePrivateKey());
const worker = privateKeyToAccount(generatePrivateKey());
const cW = walletClient(customer, pub.transport.url);
const wW = walletClient(worker, pub.transport.url);
const bal = (a) => pub.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const avail = (a) => pub.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "available", args: [a] });
const nowTs = async () => (await pub.getBlock()).timestamp;

log(`fork block ${await pub.getBlockNumber()} | customer ${customer.address} | worker ${worker.address}`);

// --- price ---
const q = await quoteUsd(pub, PRICE_USD6);
const PRICE = q.azlWei;
log(`${fmtUsd6(PRICE_USD6)} quote: ${fmtAzl(PRICE)} AZL (twap azlPerEth ${q.azlPerEth}, ETH/USD ${Number(q.ethUsdWad) / 1e18}); oracle par check ${fmtUsd6(q.parCheckUsd6)}`);

// --- funding the parties (fork only) ---
await setEth(pub, customer.address, parseEther("1"));
await setEth(pub, worker.address, parseEther("1"));
await giveAzl(pub, customer.address, PRICE * 3n + 10n ** 18n);
log(`customer AZL ${fmtAzl(await bal(customer.address))} (test stand-in for a Uniswap buy)`);

async function topUpCollateral(acct, wallet, tasks) {
  const r = await posterReadiness(pub, acct.address, 0n);
  ok(!r.intakePaused, "gateway intake open");
  const need = r.entryRequired ?? (r.requiredCollateral + (r.quote.liveTaskReserve + r.quote.accessFee) * BigInt(tasks - 1));
  const azlPerEth = await pub.readContract({ address: ADDR.twapAdapter, abi: twapAbi, functionName: "azlPerEth" });
  const short = need > r.available ? need - r.available : 0n;
  if (!short) return;
  const ethIn = (short * 10n ** 18n * 130n) / (azlPerEth * 100n) + 1n; // +30% for haircut/slippage
  const minOut = (ethIn * azlPerEth * 90n) / (10n ** 18n * 100n);
  const deadline = (await nowTs()) + 600n;
  log(`  fundWithEth(${minOut} minAzlOut, deadline) value ${Number(ethIn) / 1e18} ETH for ${tasks} task(s)`);
  await sendVerified(pub, wallet, { address: ADDR.paymentGateway, abi: gatewayAbi, functionName: "fundWithEth", args: [minOut, deadline], value: ethIn });
  const a = await avail(acct.address);
  ok(a >= need, `deposit available ${fmtAzl(a)} >= needed ${fmtAzl(need)}`);
}

async function postTask(orderId, days = 7) {
  const deadline = (await nowTs()) + BigInt(days) * 86400n;
  const { events } = await sendVerified(pub, cW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "post", args: [PRICE, deadline] });
  const ev = events.find((e) => e.eventName === "TaskPosted");
  ok(ev && ev.args.poster === customer.address, `TaskPosted ${taskRef(ev.args.taskId)} usd6 ${fmtUsd6(ev.args.amountUsd6)}`);
  const id = ev.args.taskId;
  const scope = buildScope({ orderId, fields: { sourceUrl: "https://example.com" }, privateHash: hashText("private notes"), siteUrl: "http://localhost:3000" });
  await sendVerified(pub, cW, { address: ADDR.taskScopeRegistry, abi: scopeAbi, functionName: "publish", args: [id, scope] });
  ok((await pub.readContract({ address: ADDR.taskScopeRegistry, abi: scopeAbi, functionName: "scopeOf", args: [id] })) === scope, "scope published + readable");
  return id;
}
async function claimFundDeliver(id) {
  await sendVerified(pub, wW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "claim", args: [id] });
  ok((await readTask(pub, id)).stateName === "CLAIMED", "CLAIMED by worker");
  await sendVerified(pub, cW, { address: ADDR.azl, abi: erc20Abi, functionName: "approve", args: [ADDR.escrowVault, PRICE] });
  await sendVerified(pub, cW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "fund", args: [id, PRICE] });
  let t = await readTask(pub, id);
  ok(t.stateName === "ACTIVE" && t.funded === PRICE, "fully funded -> ACTIVE");
  ok((await pub.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "allowance", args: [customer.address, ADDR.escrowVault] })) === 0n, "exact approval consumed (allowance 0)");
  await sendVerified(pub, wW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "markDelivered", args: [id] });
  t = await readTask(pub, id);
  ok(t.deliveredAt > 0n && t.stateName === "ACTIVE" && t.released === 0n, "markDelivered: deliveredAt set, still ACTIVE, no escrow moved");
}

// ================= A: approve =================
log("\n[A] happy path: post -> publish -> claim -> fund -> markDelivered -> complete");
await topUpCollateral(customer, cW, 3);
await topUpCollateral(worker, wW, 3);
const A = await postTask("ord_e2ehappy01");
await claimFundDeliver(A);
const wBefore = await bal(worker.address) + await pub.readContract({ address: ADDR.escrowVault, abi: escrowAbi, functionName: "pendingPayouts", args: [worker.address] });
await sendVerified(pub, cW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "complete", args: [A] });
const wAfter = await bal(worker.address) + await pub.readContract({ address: ADDR.escrowVault, abi: escrowAbi, functionName: "pendingPayouts", args: [worker.address] });
ok((await readTask(pub, A)).stateName === "COMPLETED", "COMPLETED");
ok(wAfter - wBefore === PRICE, `worker received exactly ${fmtAzl(PRICE)} AZL from escrow`);

// ================= B & C setup before any time warp (post/fund need a fresh oracle) =================
log("\n[B] reject: ... -> openDispute (within 12h) -> arbitration timeout -> refund");
const B = await postTask("ord_e2edispute1");
await claimFundDeliver(B);
log("\n[C] silent poster: ... -> deadline + 1d -> expire");
const C = await postTask("ord_e2eexpire01", 2);
await claimFundDeliver(C);

const evidence = JSON.stringify({ order: "ord_e2edispute1", reason: "Deliverable does not match brief", at: new Date().toISOString() });
const cBalB = await bal(customer.address);
await sendVerified(pub, cW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "openDispute", args: [B, hashText(evidence)] });
ok((await readTask(pub, B)).stateName === "DISPUTED", "DISPUTED (escrow frozen)");
const d = await pub.readContract({ address: ADDR.arbitrationModule, abi: arbitrationAbi, functionName: "disputes", args: [B] });
log(`  arbitrator ${d[2]} evidenceDeadline ${d[5]} rulingDeadline ${d[6]}`);
const cutoff = (d[6] !== 0n ? d[6] : d[5] + 172800n);
await warp(pub, cutoff - (await nowTs()) + 2n);
await sendVerified(pub, cW, { address: ADDR.arbitrationModule, abi: arbitrationAbi, functionName: "timeout", args: [B] });
const tB = await readTask(pub, B);
const res = await pub.readContract({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "resolutions", args: [B] });
const refundB = (await bal(customer.address)) + (await pub.readContract({ address: ADDR.escrowVault, abi: escrowAbi, functionName: "pendingPayouts", args: [customer.address] })) - cBalB;
ok(tB.stateName === "RESOLVED" && RESOLUTION_NAMES[Number(res)] === "MUTUAL", `RESOLVED/${RESOLUTION_NAMES[Number(res)]}`);
ok(refundB === PRICE, `customer refunded ${fmtAzl(refundB)} AZL`);

const tC0 = await readTask(pub, C);
const nowC = await nowTs();
const target = (tC0.deadline > tC0.deliveredAt + 86400n ? tC0.deadline : tC0.deliveredAt + 86400n) + 2n;
if (target > nowC) await warp(pub, target - nowC);
const pend = (a) => pub.readContract({ address: ADDR.escrowVault, abi: escrowAbi, functionName: "pendingPayouts", args: [a] });
const cBalC = (await bal(customer.address)) + (await pend(customer.address));
const wAvailC = await avail(worker.address);
await sendVerified(pub, wW, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "expire", args: [C] });
const refundC = (await bal(customer.address)) + (await pend(customer.address)) - cBalC;
const tC = await readTask(pub, C);
ok(tC.stateName === "CANCELLED", "expired -> CANCELLED");
ok(refundC === PRICE, `escrow refunded poster ${fmtAzl(refundC)} AZL`);
log(`  worker deposit available ${fmtAzl(wAvailC)} -> ${fmtAzl(await avail(worker.address))} (access-fee compensation + released reservation)`);

log(`\nALL SCENARIOS PASSED on anvil fork (chainId ${await pub.getChainId()}). Tasks: ${taskRef(A)}, ${taskRef(B)}, ${taskRef(C)}`);
log(`customer deposit withdrawable later: ${fmtAzl(await pub.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "withdrawable", args: [customer.address] }))} AZL`);
