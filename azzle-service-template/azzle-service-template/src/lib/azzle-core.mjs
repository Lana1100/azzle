// Shared AZZLE V2 protocol core (browser + Node). Plain ESM so tools/*.mjs can import it.
// Source of truth: contracts/src/v2/TaskRegistryV2.sol, EscrowVaultV2.sol, AgentDepositVaultV2.sol,
// TaskScopeRegistryV2.sol, AzlPaymentGateway.sol, AzlUsdOracle.sol (AZZLE repo) and the Bankr
// azzle skill's reviewed pins (src/config/base-8453-{micro,standard}-v2-pinned.json). No invented functions.
// Everything service-specific (app tag, kind, market, price, scope fields) comes from src/config/service.mjs.
import { parseAbi, keccak256, toBytes } from "viem";
import microPin from "../config/base-8453-micro-v2-pinned.json" with { type: "json" };
import standardPin from "../config/base-8453-standard-v2-pinned.json" with { type: "json" };
import service from "../config/service.mjs";

export const SERVICE = service;
export const MARKET = service.market === "standard" ? "standard" : "micro";
export const MANIFEST = MARKET === "standard" ? standardPin : microPin;
export const CHAIN_ID = 8453;
export const APP_TAG = service.appTag;
// Scope tags this shop recognises (add old tags to legacyAppTags if you ever rename)
export const APP_TAGS = [service.appTag, ...(service.legacyAppTags || [])];
export const SCOPE_KIND = service.kind;
export const SCOPE_VERSION = 1;
/** Service price in USDC/USD 6-decimals units (what goes into escrow, paid in AZL at the live quote). */
export const PRICE_USD6 = BigInt(Math.round(Number(service.priceUsd) * 1e6));
export const DEADLINE_DAYS = Math.min(30, Math.max(1, Number(service.turnaround?.deadlineDays || 7)));

export const ADDR = {
  taskRegistry: MANIFEST.taskRegistry,
  escrowVault: MANIFEST.escrowVault,
  depositVault: MANIFEST.depositVault,
  pricingPolicy: MANIFEST.pricingPolicy,
  usdOracle: MANIFEST.usdOracle,
  twapAdapter: MANIFEST.twapAdapter,
  paymentGateway: MANIFEST.paymentGateway,
  taskScopeRegistry: MANIFEST.taskScopeRegistry,
  arbitrationModule: MANIFEST.arbitrationModule,
  stakingVault: MANIFEST.stakingVault,
  azl: MANIFEST.external.azl,
  usdc: MANIFEST.external.usdc,
  ethUsdFeed: MANIFEST.external.ethUsdFeed,
};

export const DEPLOYMENT_BLOCK = BigInt(MANIFEST.deploymentBlock);

export const STATE_NAMES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];
export const RESOLUTION_NAMES = ["NONE", "POSTER_WINS", "WORKER_WINS", "SPLIT", "MUTUAL"];

// Protocol constants (TaskRegistryV2.sol)
export const MAX_TASK_DURATION = 30n * 86400n;
export const FUNDING_WINDOW = 86400n;
export const DELIVERY_GRACE_WINDOW = 86400n;
export const POSTER_DISPUTE_GRACE_WINDOW = 43200n;

export const registryAbi = parseAbi([
  "function post(uint256 totalAmount,uint64 deadline) returns (uint256 taskId)",
  "function claim(uint256 taskId)",
  "function fund(uint256 taskId,uint256 amount)",
  "function markDelivered(uint256 taskId)",
  "function release(uint256 taskId,uint256 amount)",
  "function complete(uint256 taskId)",
  "function cancel(uint256 taskId)",
  "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId,bytes32 evidenceHash)",
  "function taskCount() view returns (uint256)",
  "function taskState(uint256 taskId) view returns (uint8)",
  "function tasks(uint256 taskId) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint64 fundingDeadline,uint64 deliveredAt,uint8 state)",
  "function resolutions(uint256 taskId) view returns (uint8)",
  "function maxTaskUsd6() view returns (uint256)",
  "function openTaskCapUsd6() view returns (uint256)",
  "function openTaskTotalUsd6() view returns (uint256)",
  "function posterOpenTaskTotalUsd6(address) view returns (uint256)",
  "event TaskPosted(uint256 indexed taskId,address indexed poster,uint256 totalAmount,uint256 amountUsd6,uint64 deadline)",
  "event TaskClaimed(uint256 indexed taskId,address indexed worker)",
  "event TaskFunded(uint256 indexed taskId,uint256 amount)",
  "event TaskActivated(uint256 indexed taskId)",
  "event TaskDelivered(uint256 indexed taskId,uint64 deliveredAt)",
  "event TaskReleased(uint256 indexed taskId,uint256 amount)",
  "event TaskCompleted(uint256 indexed taskId)",
  "event TaskCancelled(uint256 indexed taskId)",
  "event TaskDisputed(uint256 indexed taskId,address indexed opener,bytes32 evidenceHash)",
  "event TaskResolved(uint256 indexed taskId,uint8 resolution,address defaultingParty)",
]);

export const scopeAbi = parseAbi([
  "function publish(uint256 taskId,string scope)",
  "function scopeOf(uint256 taskId) view returns (string)",
  "event ScopePublished(uint256 indexed taskId,bytes32 indexed scopeHash,string scope)",
]);

export const depositAbi = parseAbi([
  "function deposits(address) view returns (uint256)",
  "function reserved(address) view returns (uint256)",
  "function available(address) view returns (uint256)",
  "function withdrawable(address) view returns (uint256)",
  "function latchedEntryFloor(address) view returns (uint256)",
  "function taskQuotes(uint256 taskId) view returns (uint256 entryDeposit,uint256 liveTaskReserve,uint256 accessFee,uint256 exitCompensation,uint256 exitProtocolShare)",
  "function withdraw(uint256 amount,address recipient)",
  "function activeTaskReservations(address) view returns (uint256)",
  "function pendingPayouts(address) view returns (uint256)",
  "function claimPayout(address recipient)",
  "event Withdrawn(address indexed account,address indexed recipient,uint256 amount)",
]);

export const policyAbi = parseAbi([
  "function quoteTask() view returns ((uint256 entryDeposit,uint256 liveTaskReserve,uint256 accessFee,uint256 exitCompensation,uint256 exitProtocolShare))",
]);

export const oracleAbi = parseAbi([
  "function isValid() view returns (bool)",
  "function quoteAzlForUsd(uint256 usdAmount6) view returns (uint256)",
  "function quoteUsdForAzlPar(uint256 azlAmount) view returns (uint256)",
  "function quoteUsdForAzl(uint256 azlAmount) view returns (uint256)",
]);

export const twapAbi = parseAbi(["function azlPerEth() view returns (uint256)", "function isReady() view returns (bool)"]);
export const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

export const gatewayAbi = parseAbi([
  "function intakePaused() view returns (bool)",
  "function fundWithUsdc(uint256 exactUsdcIn,uint256 minAzlOut,uint256 deadline) returns (uint256)",
  "function fundWithEth(uint256 minAzlOut,uint256 deadline) payable returns (uint256)",
  "function maxExecutionDeviationBps() view returns (uint16)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address to,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

export const stakingAbi = parseAbi([
  "function stakingActive() view returns (bool)",
  "function creditsOf(address) view returns (uint256)",
]);

export const arbitrationAbi = parseAbi([
  "function disputes(uint256 taskId) view returns (uint256 taskId,address opener,address arbitrator,bytes32 posterEvidence,bytes32 workerEvidence,uint64 evidenceDeadline,uint64 rulingDeadline,uint8 status,uint8 outcome,uint256 slashed)",
  "function submitEvidence(uint256 taskId,bytes32 evidenceHash)",
  "function timeout(uint256 taskId)",
  "function rulingWindow() view returns (uint64)",
]);

export const escrowAbi = parseAbi([
  "function pendingPayouts(address) view returns (uint256)",
  "function claimPayout(address recipient)",
]);

export const taskRef = (id) => `v2:${MARKET}:${id}`;
export function parseTaskRef(ref) {
  const m = /^v2:(standard|micro):(\d+)$/.exec(String(ref));
  if (!m) throw new Error(`Invalid task ref ${ref}: must be v2:${MARKET}:N`);
  if (m[1] !== MARKET) throw new Error(`Task ${ref} is not in the ${MARKET} market`);
  return BigInt(m[2]);
}

/** Public, immutable scope JSON published via TaskScopeRegistryV2.publish. It is the only
 *  protocol-level place to tag a task with this site's identifier (post() takes no metadata).
 *  `fields` holds ONLY the order fields marked public:true in the service config (anyone can read them);
 *  private values are represented by a single keccak256 (`privateKeccak`). */
export function buildScope({ orderId, fields = {}, privateHash, siteUrl }) {
  const scope = {
    app: APP_TAG,
    v: SCOPE_VERSION,
    kind: SCOPE_KIND,
    order: orderId,
    fields,
    privateKeccak: privateHash || null,
    deliver: `${service.deliverable?.scopeHint || service.deliverable?.label || "deliverable"}; review at ${(siteUrl || "")}/order/${orderId}`,
  };
  const s = JSON.stringify(scope);
  if (new TextEncoder().encode(s).length > 8192) throw new Error("scope exceeds 8192 bytes");
  return s;
}

export function parseScope(s) {
  try {
    const j = JSON.parse(s);
    if (j && APP_TAGS.includes(j.app) && j.kind === SCOPE_KIND && typeof j.order === "string") return j;
  } catch {}
  return null;
}

export const hashText = (t) => keccak256(toBytes(t));

/**
 * Price quote for a USD target in AZL at PAR, from the same sources the protocol oracle uses:
 * twapAdapter.azlPerEth() (2h TWAP of the Uniswap v4 AZL/WETH pool, poolId in the manifest)
 * x Chainlink ETH/USD (manifest external.ethUsdFeed). Cross-checked with usdOracle.quoteUsdForAzlPar.
 */
export async function quoteUsd(client, usd6) {
  const [ready, azlPerEth, dec, round, valid] = await Promise.all([
    client.readContract({ address: ADDR.twapAdapter, abi: twapAbi, functionName: "isReady" }),
    client.readContract({ address: ADDR.twapAdapter, abi: twapAbi, functionName: "azlPerEth" }),
    client.readContract({ address: ADDR.ethUsdFeed, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: ADDR.ethUsdFeed, abi: feedAbi, functionName: "latestRoundData" }),
    client.readContract({ address: ADDR.usdOracle, abi: oracleAbi, functionName: "isValid" }),
  ]);
  const ethUsdWad = BigInt(round[1]) * 10n ** BigInt(18 - Number(dec));
  // AZL = usd6 * 1e12 (to wad) * azlPerEth / ethUsdWad, rounded up
  const num = BigInt(usd6) * 10n ** 12n * azlPerEth;
  const azlWei = (num + ethUsdWad - 1n) / ethUsdWad;
  const parCheckUsd6 = valid
    ? await client.readContract({ address: ADDR.usdOracle, abi: oracleAbi, functionName: "quoteUsdForAzlPar", args: [azlWei] })
    : null;
  return {
    usd6: BigInt(usd6),
    azlWei,
    azlPerEth,
    ethUsdWad,
    ethUsdUpdatedAt: Number(round[3]),
    twapReady: ready,
    oracleValid: valid,
    parCheckUsd6,
    source: {
      twap: `${ADDR.twapAdapter}.azlPerEth() (Uniswap v4 AZL/WETH pool TWAP, poolId ${MANIFEST.external.poolId})`,
      ethUsd: `${ADDR.ethUsdFeed}.latestRoundData() (Chainlink ETH/USD on Base)`,
      check: `${ADDR.usdOracle}.quoteUsdForAzlPar()`,
    },
  };
}

/** Collateral the poster needs in the AZZLE deposit ledger to call post() (AgentDepositVaultV2.reserveTask). */
export async function posterReadiness(client, account, escrowAzl) {
  const [quote, available, floor, azlBal, ethBal, paused, stakingActive, credits] = await Promise.all([
    client.readContract({ address: ADDR.pricingPolicy, abi: policyAbi, functionName: "quoteTask" }),
    client.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "available", args: [account] }),
    client.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "latchedEntryFloor", args: [account] }),
    client.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    client.getBalance({ address: account }),
    client.readContract({ address: ADDR.paymentGateway, abi: gatewayAbi, functionName: "intakePaused" }),
    client.readContract({ address: ADDR.stakingVault, abi: stakingAbi, functionName: "stakingActive" }),
    client.readContract({ address: ADDR.stakingVault, abi: stakingAbi, functionName: "creditsOf", args: [account] }).catch(() => 0n),
  ]);
  const creditWaives = stakingActive && credits > 0n;
  const entry = quote.entryDeposit > floor ? quote.entryDeposit : floor;
  const fee = creditWaives ? 0n : quote.accessFee;
  const requiredCollateral = entry + quote.liveTaskReserve + fee;
  const collateralShortfall = requiredCollateral > available ? requiredCollateral - available : 0n;
  const azlShortfall = escrowAzl && escrowAzl > azlBal ? escrowAzl - azlBal : 0n;
  return { quote, available, floor, azlBal, ethBal, intakePaused: paused, stakingActive, credits, creditWaives, requiredCollateral, collateralShortfall, azlShortfall };
}

export async function readTask(client, taskId) {
  const t = await client.readContract({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "tasks", args: [BigInt(taskId)] });
  const [poster, worker, totalAmount, funded, released, deadline, fundingDeadline, deliveredAt, state] = t;
  return { id: BigInt(taskId), ref: taskRef(taskId), poster, worker, totalAmount, funded, released, deadline, fundingDeadline, deliveredAt, state: Number(state), stateName: STATE_NAMES[Number(state)] };
}

/** What each party can do right now, mirroring the require() guards in TaskRegistryV2. */
export function taskActions(t, nowSec, who) {
  const now = BigInt(nowSec);
  const isPoster = who && t.poster.toLowerCase() === who.toLowerCase();
  const isWorker = who && t.worker.toLowerCase() === who.toLowerCase();
  const timely = t.deliveredAt !== 0n && t.deliveredAt <= t.deadline;
  const active = t.state === 3;
  const fullyFunded = t.funded === t.totalAmount;
  return {
    canClaim: t.state === 1 && !isPoster && now <= t.deadline,
    canFund: isPoster && (t.state === 2 || t.state === 3) && t.funded < t.totalAmount && now <= t.deadline && (t.state === 3 || now <= t.fundingDeadline),
    canCancel: isPoster && (t.state === 1 || t.state === 2) && t.funded === 0n,
    canDeliver: isWorker && active && t.deliveredAt === 0n && fullyFunded && t.released < t.funded && now <= t.deadline,
    canComplete: isPoster && active && fullyFunded,
    canPosterDispute: isPoster && active && fullyFunded && t.funded > t.released && (!timely || now <= t.deliveredAt + POSTER_DISPUTE_GRACE_WINDOW),
    canWorkerDispute: isWorker && active && fullyFunded && t.funded > t.released,
    posterDisputeCutoff: timely ? t.deliveredAt + POSTER_DISPUTE_GRACE_WINDOW : null,
    canExpire: ![4, 5, 6, 7, 0].includes(t.state) && (now > t.deadline || (t.state === 2 && t.funded < t.totalAmount && now > t.fundingDeadline)) && (!timely || t.funded === t.released || now > t.deliveredAt + DELIVERY_GRACE_WINDOW),
  };
}

/** Bankr skill confirmation template (references/onboarding.md). */
export function confirmationTemplate({ target, method, args, token, expected, irreversible, extra }) {
  const lines = [
    `Network: Base (${CHAIN_ID})`,
    `Target: ${target.key} ${target.address}`,
    `Method: ${method}`,
    `Arguments: ${args}`,
  ];
  if (token) lines.push(`Token/spender/amount: ${token}`);
  lines.push(`Expected state change: ${expected}`);
  lines.push(`Irreversible effects: ${irreversible}`);
  if (extra) lines.push(extra);
  return lines.join("\n");
}

export const fmtAzl = (wei, dp = 0) => {
  const whole = BigInt(wei) / 10n ** 18n;
  const frac = (BigInt(wei) % 10n ** 18n).toString().padStart(18, "0").slice(0, dp);
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dp ? "." + frac : "");
};
export const fmtUsd6 = (v) => "$" + (Number(v) / 1e6).toFixed(2);
