// Read-only tests of the USDC -> AZL just-in-time route against live Base (eth_call only, never sends).
// Run: node --test tools/swap.test.mjs   (RPC_URL overrides https://mainnet.base.org)
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, keccak256, encodeAbiParameters, pad, toHex, parseAbi, decodeFunctionData } from "viem";
import { base } from "viem/chains";
import { ADDR, quoteUsd } from "../src/lib/azzle-core.mjs";
import {
  UNI, WETH, AZL_POOL_KEY, AZL_POOL_ID, quoteBudgetSwap, quoteUsdcForExactAzl, quoteAzlForUsdc, buildRouterExecute,
  buildPayWithUsdcCalls, applyBuffer, universalRouterAbi, permit2Abi,
} from "../src/lib/swap-core.mjs";

const RPC = process.env.RPC_URL || "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(RPC, { timeout: 60_000 }) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const TEST = "0x00000000000000000000000000000000c0ffee20"; // fake, keyless account used only in eth_call overrides

const mapSlot = (key, slot) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, BigInt(slot)]));
const nestedSlot = (key, parent) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [key, parent]));
// FiatTokenV2_2: balanceAndBlacklistStates @ slot 9. Permit2 AllowanceTransfer.allowance @ slot 1 (owner => token => spender)
function overrides({ usdc, permit2Amount, expiration }) {
  const permitSlot = nestedSlot(UNI.universalRouter, nestedSlot(ADDR.usdc, mapSlot(TEST, 1)));
  const packed = (BigInt(expiration) << 160n) | BigInt(permit2Amount);
  return [
    { address: ADDR.usdc, stateDiff: [{ slot: mapSlot(TEST, 9), value: pad(toHex(usdc), { size: 32 }) }] },
    { address: UNI.permit2, stateDiff: [{ slot: permitSlot, value: pad(toHex(packed), { size: 32 }) }] },
  ];
}

let budget;
test("pool key hashes to the protocol-pinned AZL/WETH v4 pool", () => {
  const id = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [AZL_POOL_KEY.currency0, AZL_POOL_KEY.currency1, AZL_POOL_KEY.fee, AZL_POOL_KEY.tickSpacing, AZL_POOL_KEY.hooks]));
  assert.equal(id, AZL_POOL_ID);
});

test("budget AZL from the protocol oracle ($5)", async () => {
  budget = (await quoteUsd(client, 5_000_000n)).azlWei;
  assert.ok(budget > 10n ** 24n, "budget should be millions of AZL");
  console.log("  $5 budget =", budget / 10n ** 18n, "AZL");
});

test("buffer math", () => {
  assert.equal(applyBuffer(5_000_000n, 100n), 5_050_000n);
  assert.equal(applyBuffer(1n, 100n), 2n); // rounds up
  assert.throws(() => applyBuffer(1n, 500n));
});

test("exact-out and exact-in quotes agree", async () => {
  const { usdcIn } = await quoteUsdcForExactAzl(client, budget);
  const { azlOut } = await quoteAzlForUsdc(client, usdcIn);
  // re-quoting exact-out USDC as exact-in must land within 0.1% of the target
  const diff = azlOut > budget ? azlOut - budget : budget - azlOut;
  assert.ok(diff * 1000n <= budget, `round-trip drift ${diff}`);
  console.log("  exact USDC for budget:", Number(usdcIn) / 1e6);
});

let q;
test("quoteBudgetSwap: buffered USDC covers the budget, low impact", async () => {
  q = await quoteBudgetSwap(client, budget);
  assert.ok(q.expectedAzlOut >= budget);
  assert.ok(q.usdcIn >= q.usdcExact && q.usdcIn <= (q.usdcExact * 10_201n) / 10_000n);
  assert.ok(q.priceImpactBps < 200, `impact ${q.priceImpactBps} bps`);
  console.log(`  USDC in ${Number(q.usdcIn) / 1e6} (exact ${Number(q.usdcExact) / 1e6}), leftover ${q.expectedLeftoverAzl / 10n ** 18n} AZL, impact ${q.priceImpactBps} bps`);
});

test("built call list: exact approvals, correct targets and order", () => {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const calls = buildPayWithUsdcCalls({ taskId: 7n, azlAmount: budget, usdcIn: q.usdcIn, deadline });
  assert.deepEqual(calls.map((c) => c.key), ["usdc-approve", "permit2-approve", "swap", "azl-approve", "fund"]);
  assert.deepEqual(calls.map((c) => c.to), [ADDR.usdc, UNI.permit2, UNI.universalRouter, ADDR.azl, ADDR.taskRegistry]);
  const p2 = decodeFunctionData({ abi: permit2Abi, data: calls[1].data });
  assert.equal(p2.args[2], q.usdcIn);
  const skip = buildPayWithUsdcCalls({ taskId: 7n, azlAmount: budget, usdcIn: q.usdcIn, deadline, state: { usdcToPermit2: q.usdcIn, azlToEscrow: budget } });
  assert.deepEqual(skip.map((c) => c.key), ["permit2-approve", "swap", "fund"]);
  const now = Number(deadline) - 600;
  const skip2 = buildPayWithUsdcCalls({ taskId: 7n, azlAmount: budget, usdcIn: q.usdcIn, deadline, state: { usdcToPermit2: q.usdcIn, azlToEscrow: budget, permit2Amount: q.usdcIn, permit2Expiration: now + 300, now } });
  assert.deepEqual(skip2.map((c) => c.key), ["swap", "fund"]);
  const expiring = buildPayWithUsdcCalls({ taskId: 7n, azlAmount: budget, usdcIn: q.usdcIn, deadline, state: { usdcToPermit2: q.usdcIn, azlToEscrow: budget, permit2Amount: q.usdcIn, permit2Expiration: now + 60, now } });
  assert.deepEqual(expiring.map((c) => c.key), ["permit2-approve", "swap", "fund"]);
  const tooSmall = buildPayWithUsdcCalls({ taskId: 7n, azlAmount: budget, usdcIn: q.usdcIn, deadline, state: { usdcToPermit2: q.usdcIn, azlToEscrow: budget, permit2Amount: q.usdcIn - 1n, permit2Expiration: now + 300, now } });
  assert.deepEqual(tooSmall.map((c) => c.key), ["permit2-approve", "swap", "fund"]);
});

test("Universal Router execute simulates on live Base (eth_call + state overrides) and delivers >= budget AZL", async () => {
  const block = await client.getBlock();
  const deadline = block.timestamp + 600n;
  const ex = buildRouterExecute({ usdcIn: q.usdcIn, minAzlOut: budget, deadline });
  const so = overrides({ usdc: q.usdcIn, permit2Amount: q.usdcIn, expiration: deadline + 60n });
  // sanity: overrides took effect
  const bal = await client.readContract({ address: ADDR.usdc, abi: erc20, functionName: "balanceOf", args: [TEST], stateOverride: so });
  assert.equal(bal, q.usdcIn);
  // also USDC.allowance(TEST, Permit2) is required by Permit2.transferFrom -> USDC.transferFrom; set slot 10
  const allowSlot = nestedSlot(UNI.permit2, mapSlot(TEST, 10));
  so[0].stateDiff.push({ slot: allowSlot, value: pad(toHex(q.usdcIn), { size: 32 }) });
  const { result } = await client.simulateContract({
    account: TEST, address: UNI.universalRouter, abi: universalRouterAbi, functionName: "execute",
    args: [ex.commands, ex.inputs, ex.deadline], stateOverride: so,
  });
  assert.equal(result, undefined);
  // measure the AZL actually delivered with a multicall-free trick: simulate again with too-high minimum -> must revert
  const tooHigh = buildRouterExecute({ usdcIn: q.usdcIn, minAzlOut: (q.expectedAzlOut * 103n) / 100n, deadline });
  await assert.rejects(client.simulateContract({
    account: TEST, address: UNI.universalRouter, abi: universalRouterAbi, functionName: "execute",
    args: [tooHigh.commands, tooHigh.inputs, tooHigh.deadline], stateOverride: so,
  }));
});

test("without Permit2 allowance the swap reverts (no silent pulls)", async () => {
  const block = await client.getBlock();
  const deadline = block.timestamp + 600n;
  const ex = buildRouterExecute({ usdcIn: q.usdcIn, minAzlOut: budget, deadline });
  const so = overrides({ usdc: q.usdcIn, permit2Amount: 0n, expiration: 0n });
  await assert.rejects(client.simulateContract({
    account: TEST, address: UNI.universalRouter, abi: universalRouterAbi, functionName: "execute",
    args: [ex.commands, ex.inputs, ex.deadline], stateOverride: so,
  }));
});
