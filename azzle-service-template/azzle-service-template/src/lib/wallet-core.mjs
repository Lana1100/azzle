// Wallet + AZZLE deposit reads for the header wallet modal (browser + Node). Plain ESM so tools/*.mjs can test it.
// Source of truth: AgentDepositVaultV2.sol
//   available(a)    = deposits[a] - reserved[a]                       (unreserved)
//   withdrawable(a) = available(a) - (activeTaskReservations[a] > 0 ? latchedEntryFloor[a] : 0)
//   withdraw(amount, recipient): amount <= withdrawable(msg.sender); no cooldown, no timelock; pays AZL to recipient.
import { encodeFunctionData } from "viem";
import { ADDR, depositAbi, erc20Abi } from "./azzle-core.mjs";

/** usd6 value of an AZL amount at the live quote (same math as checkout: AZL * ETH/USD / AZL-per-ETH). */
export const azlToUsd6 = (azl, quote) =>
  quote && quote.azlPerEth > 0n ? (BigInt(azl) * quote.ethUsdWad) / (quote.azlPerEth * 10n ** 12n) : null;

export async function readWalletState(client, account) {
  const rd = (address, abi, functionName) => client.readContract({ address, abi, functionName, args: [account] });
  const [usdc, eth, azl, deposit, reserved, available, withdrawable, active, floor, pending] = await Promise.all([
    rd(ADDR.usdc, erc20Abi, "balanceOf"),
    client.getBalance({ address: account }),
    rd(ADDR.azl, erc20Abi, "balanceOf"),
    rd(ADDR.depositVault, depositAbi, "deposits"),
    rd(ADDR.depositVault, depositAbi, "reserved"),
    rd(ADDR.depositVault, depositAbi, "available"),
    rd(ADDR.depositVault, depositAbi, "withdrawable"),
    rd(ADDR.depositVault, depositAbi, "activeTaskReservations"),
    rd(ADDR.depositVault, depositAbi, "latchedEntryFloor"),
    rd(ADDR.depositVault, depositAbi, "pendingPayouts").catch(() => 0n),
  ]);
  // Part of `available` that stays locked as the entry floor while an order is live.
  const floorHeld = available > withdrawable ? available - withdrawable : 0n;
  return { usdc, eth, azl, deposit, reserved, available, withdrawable, activeOrders: active, floor, floorHeld, pending };
}

/** What the modal should say about the deposit. */
export function depositStatus(s) {
  if (!s) return "loading";
  if (s.deposit === 0n) return "empty";
  if (s.withdrawable > 0n) return "withdrawable";
  if (s.reserved > 0n || s.activeOrders > 0n) return "reserved";
  return "empty";
}

/** withdraw(amount, recipient): the whole currently withdrawable amount, back to the same wallet. */
export function buildWithdraw(account, amount) {
  if (!amount || BigInt(amount) <= 0n) throw new Error("nothing to withdraw");
  return {
    to: ADDR.depositVault,
    data: encodeFunctionData({ abi: depositAbi, functionName: "withdraw", args: [BigInt(amount), account] }),
    args: [BigInt(amount), account],
  };
}
