// Just-in-time USDC -> AZL route (browser + Node). Plain ESM so tools/*.mjs and tests can import it.
// Route = the same fixed route the AZZLE protocol's own BaseAzlExactInputExecutor uses:
//   USDC --Uniswap v3 USDC/WETH 0.05% (0xd0b53D92...)--> WETH --Uniswap v4 AZL/WETH (Bankr/Doppler hook, poolId
//   0xaa7a43...)--> AZL, executed through the Base Universal Router (0x6fF5693b...) with Permit2.
// Exact-input with a small USDC buffer; minimum AZL out = the exact AZL the escrow needs, so the swap either
// delivers at least that amount straight to the customer's wallet or reverts. No contract of ours ever holds funds.
import { parseAbi, encodeAbiParameters, encodeFunctionData, concat, maxUint256 } from "viem";
import { ADDR } from "./azzle-core.mjs";

export const UNI = {
  universalRouter: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  v4Quoter: "0x0d5e0f971ed27fbff6c2837bf31316121532048d",
  v3QuoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  v3UsdcWethPool: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
  v3Fee: 500,
};
export const WETH = "0x4200000000000000000000000000000000000006";
export const AZL_POOL_KEY = {
  currency0: WETH,
  currency1: ADDR.azl,
  fee: 0x800000, // dynamic-fee flag (fee set by the hook)
  tickSpacing: 200,
  hooks: "0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544",
};
export const AZL_POOL_ID = "0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad";

export const DEFAULT_BUFFER_BPS = 100n; // 1% extra USDC in; leftover AZL stays in the customer's wallet
export const MAX_BUFFER_BPS = 200n; // hard cap (2%)
export const QUOTE_TTL_SEC = 60;

export const v4QuoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutputSingle(QuoteExactSingleParams params) returns (uint256 amountIn, uint256 gasEstimate)",
]);
export const v3QuoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle(QuoteExactOutputSingleParams params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
export const permit2Abi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);
export const universalRouterAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const erc20 = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const registryFundAbi = parseAbi(["function fund(uint256 taskId,uint256 amount)"]);

// Universal Router command + V4Router action bytes (Base deployment, same as BaseAzlExactInputExecutor)
export const CMD = { V3_SWAP_EXACT_IN: "0x00", V4_SWAP: "0x10" };
export const ACT = { SWAP_EXACT_IN_SINGLE: "0x06", SETTLE: "0x0b", TAKE_ALL: "0x0f" };
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002"; // UR ActionConstants.ADDRESS_THIS
const CONTRACT_BALANCE = 1n << 255n; // UR ActionConstants.CONTRACT_BALANCE
const OPEN_DELTA = 0n; // V4Router: amountIn 0 = use the full open credit

async function sim(client, address, abi, functionName, args) {
  const { result } = await client.simulateContract({ address, abi, functionName, args });
  return result;
}

/** AZL -> WETH (v4) and WETH -> USDC (v3) exact-output quotes: the USDC that buys exactly `azlOut`. */
export async function quoteUsdcForExactAzl(client, azlOut) {
  const [wethIn] = await sim(client, UNI.v4Quoter, v4QuoterAbi, "quoteExactOutputSingle", [
    { poolKey: AZL_POOL_KEY, zeroForOne: true, exactAmount: BigInt(azlOut), hookData: "0x" },
  ]);
  const [usdcIn] = await sim(client, UNI.v3QuoterV2, v3QuoterAbi, "quoteExactOutputSingle", [
    { tokenIn: ADDR.usdc, tokenOut: WETH, amount: wethIn, fee: UNI.v3Fee, sqrtPriceLimitX96: 0n },
  ]);
  return { usdcIn, wethIn };
}

/** Full-route exact-input quote: USDC in -> AZL out. */
export async function quoteAzlForUsdc(client, usdcIn) {
  const [wethOut] = await sim(client, UNI.v3QuoterV2, v3QuoterAbi, "quoteExactInputSingle", [
    { tokenIn: ADDR.usdc, tokenOut: WETH, amountIn: BigInt(usdcIn), fee: UNI.v3Fee, sqrtPriceLimitX96: 0n },
  ]);
  const [azlOut] = await sim(client, UNI.v4Quoter, v4QuoterAbi, "quoteExactInputSingle", [
    { poolKey: AZL_POOL_KEY, zeroForOne: true, exactAmount: wethOut, hookData: "0x" },
  ]);
  return { azlOut, wethOut };
}

export const applyBuffer = (usdcIn, bufferBps = DEFAULT_BUFFER_BPS) => {
  const b = BigInt(bufferBps);
  if (b < 0n || b > MAX_BUFFER_BPS) throw new Error(`buffer ${b} bps outside 0..${MAX_BUFFER_BPS}`);
  return (BigInt(usdcIn) * (10_000n + b) + 9_999n) / 10_000n; // round up
};

/**
 * Quote the USDC needed for `azlNeeded`, add the buffer, re-quote the buffered amount through the full route and
 * report price impact against a $1 probe (both include the same pool fees, so this isolates depth impact).
 */
export async function quoteBudgetSwap(client, azlNeeded, { bufferBps = DEFAULT_BUFFER_BPS } = {}) {
  const azl = BigInt(azlNeeded);
  if (azl <= 0n) throw new Error("nothing to buy");
  const exact = await quoteUsdcForExactAzl(client, azl);
  const usdcIn = applyBuffer(exact.usdcIn, bufferBps);
  const [fwd, probe] = await Promise.all([quoteAzlForUsdc(client, usdcIn), quoteAzlForUsdc(client, 1_000_000n)]);
  if (fwd.azlOut < azl) throw new Error("route quote below the escrow amount; refresh and retry");
  // impact = 1 - (azlOut/usdcIn) / (probeAzl/1 USDC), in bps
  const impactBps = Number(10_000n - (fwd.azlOut * 1_000_000n * 10_000n) / (usdcIn * probe.azlOut));
  return {
    azlNeeded: azl, usdcExact: exact.usdcIn, usdcIn, bufferBps: BigInt(bufferBps), expectedAzlOut: fwd.azlOut,
    expectedLeftoverAzl: fwd.azlOut - azl, wethMid: fwd.wethOut, priceImpactBps: Math.max(0, impactBps),
    probeAzlPerUsdc: probe.azlOut, quotedAt: Math.floor(Date.now() / 1000),
  };
}

/** Universal Router calldata: V3 USDC->WETH (paid by user via Permit2, WETH kept in router) then V4 WETH->AZL to the user. */
export function buildRouterExecute({ usdcIn, minAzlOut, deadline }) {
  const path = concat([ADDR.usdc, `0x${UNI.v3Fee.toString(16).padStart(6, "0")}`, WETH]);
  const v3Input = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
    [ADDRESS_THIS, BigInt(usdcIn), 0n, path, true], // intermediate min 0: the final AZL minimum guards the whole route
  );
  const actions = concat([ACT.SETTLE, ACT.SWAP_EXACT_IN_SINGLE, ACT.TAKE_ALL]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [WETH, CONTRACT_BALANCE, false]);
  const swap = encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "poolKey", type: "tuple", components: [
        { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
      { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" },
      { name: "hookData", type: "bytes" }] }],
    [{ poolKey: AZL_POOL_KEY, zeroForOne: true, amountIn: OPEN_DELTA, amountOutMinimum: BigInt(minAzlOut), hookData: "0x" }],
  );
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ADDR.azl, BigInt(minAzlOut)]);
  const v4Input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [settle, swap, take]]);
  const commands = concat([CMD.V3_SWAP_EXACT_IN, CMD.V4_SWAP]);
  return { commands, inputs: [v3Input, v4Input], deadline: BigInt(deadline) };
}

/**
 * Ordered calls for "pay the escrow with USDC": [USDC.approve(Permit2, exact)] [Permit2.approve(USDC, UR, exact, exp)]
 * UR.execute(swap) AZL.approve(escrowVault, exact) TaskRegistry.fund(taskId, exact). Approvals are exact, never unlimited.
 * `state` = current allowances so already-satisfied approvals are skipped.
 */
export function buildPayWithUsdcCalls({ taskId, azlAmount, buyAzl = azlAmount, usdcIn, deadline, state = {} }) {
  // azlAmount = what goes into escrow; buyAzl = what the swap must deliver (azlAmount minus AZL already held)
  const exp = Number(deadline) + 60; // Permit2 allowance expires right after the swap deadline
  const calls = [];
  if ((state.usdcToPermit2 ?? 0n) < BigInt(usdcIn))
    calls.push({ key: "usdc-approve", label: "Approve USDC to Permit2 (exact)", to: ADDR.usdc,
      data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [UNI.permit2, BigInt(usdcIn)] }) });
  // Skip the Permit2 approval when an unexpired one already covers this swap (e.g. a retry after a failed swap).
  // Needs >= 2 minutes of validity left; `state.now` = chain time (defaults to deadline - 600, the caller's convention).
  const now = Number(state.now ?? Number(deadline) - 600);
  const p2ok = state.permit2Amount != null && BigInt(state.permit2Amount) >= BigInt(usdcIn) && Number(state.permit2Expiration ?? 0) > now + 120;
  if (!p2ok)
    calls.push({ key: "permit2-approve", label: "Permit2: let the Universal Router pull that USDC once", to: UNI.permit2,
      data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [ADDR.usdc, UNI.universalRouter, BigInt(usdcIn), exp] }) });
  const ex = buildRouterExecute({ usdcIn, minAzlOut: buyAzl, deadline });
  calls.push({ key: "swap", label: "Swap USDC -> AZL (Uniswap)", to: UNI.universalRouter,
    data: encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [ex.commands, ex.inputs, ex.deadline] }) });
  if (taskId != null) {
    if ((state.azlToEscrow ?? 0n) < BigInt(azlAmount))
      calls.push({ key: "azl-approve", label: "Approve AZL to escrow (exact)", to: ADDR.azl,
        data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [ADDR.escrowVault, BigInt(azlAmount)] }) });
    calls.push({ key: "fund", label: "Fund the escrow", to: ADDR.taskRegistry,
      data: encodeFunctionData({ abi: registryFundAbi, functionName: "fund", args: [BigInt(taskId), BigInt(azlAmount)] }) });
  }
  return calls.map((c) => ({ ...c, value: 0n }));
}

export async function readPayState(client, account) {
  const [usdcBal, usdcToPermit2, azlToEscrow, azlBal, ethBal, usdcToGateway, p2] = await Promise.all([
    client.readContract({ address: ADDR.usdc, abi: erc20, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: ADDR.usdc, abi: erc20, functionName: "allowance", args: [account, UNI.permit2] }),
    client.readContract({ address: ADDR.azl, abi: erc20, functionName: "allowance", args: [account, ADDR.escrowVault] }),
    client.readContract({ address: ADDR.azl, abi: erc20, functionName: "balanceOf", args: [account] }),
    client.getBalance({ address: account }),
    client.readContract({ address: ADDR.usdc, abi: erc20, functionName: "allowance", args: [account, ADDR.paymentGateway] }),
    client.readContract({ address: UNI.permit2, abi: permit2Abi, functionName: "allowance", args: [account, ADDR.usdc, UNI.universalRouter] }),
  ]);
  const [permit2Amount, permit2Expiration] = p2;
  return { usdcBal, usdcToPermit2, azlToEscrow, azlBal, ethBal, usdcToGateway, permit2Amount, permit2Expiration: Number(permit2Expiration) };
}

export { maxUint256 };
