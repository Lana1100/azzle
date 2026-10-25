// Anvil-only helpers. These cheatcodes do not exist on a real chain; every function refuses to run elsewhere.
import { parseAbi } from "viem";
import { ADDR } from "../../src/lib/azzle-core.mjs";

export const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b"; // Uniswap v4 PoolManager on Base (holds AZL)

export async function assertFork(pub) {
  const v = await pub.request({ method: "web3_clientVersion" });
  if (!/anvil/i.test(v)) throw new Error(`not an anvil fork: ${v}`);
}
export async function setEth(pub, addr, wei) {
  await assertFork(pub);
  await pub.request({ method: "anvil_setBalance", params: [addr, "0x" + BigInt(wei).toString(16)] });
}
/** Test-only stand-in for "customer bought AZL on Uniswap": impersonate the PoolManager and transfer AZL. */
export async function giveAzl(pub, to, amount) {
  await assertFork(pub);
  await pub.request({ method: "anvil_impersonateAccount", params: [POOL_MANAGER] });
  await setEth(pub, POOL_MANAGER, 10n ** 18n);
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [to, amount] });
  const hash = await pub.request({ method: "eth_sendTransaction", params: [{ from: POOL_MANAGER, to: ADDR.azl, data }] });
  await pub.request({ method: "anvil_stopImpersonatingAccount", params: [POOL_MANAGER] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("AZL transfer failed");
}
export async function warp(pub, seconds) {
  await assertFork(pub);
  await pub.request({ method: "evm_increaseTime", params: ["0x" + BigInt(seconds).toString(16)] });
  await pub.request({ method: "evm_mine", params: [] });
}
