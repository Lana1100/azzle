#!/usr/bin/env node
// Fork-only test of the wallet-modal withdraw path against the real AZZLE V2 micro contracts on an ANVIL FORK of Base.
// Fresh random customer key; no real funds, no project keys. Run: bash tools/fork-start.sh && node tools/withdraw-fork.test.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";
import { ADDR, registryAbi, gatewayAbi, erc20Abi, twapAbi, quoteUsd, posterReadiness, fmtAzl } from "../src/lib/azzle-core.mjs";
import { readWalletState, depositStatus, buildWithdraw, azlToUsd6 } from "../src/lib/wallet-core.mjs";
import { publicClient, walletClient, sendVerified } from "./lib/chain.mjs";
import { assertFork, setEth } from "./lib/fork.mjs";

const pub = publicClient(process.env.RPC_URL || "http://127.0.0.1:8545");
await assertFork(pub);
const ok = (c, m) => { if (!c) throw new Error("ASSERT FAILED: " + m); console.log("  ✓ " + m); };
const me = privateKeyToAccount(generatePrivateKey());
const w = walletClient(me, pub.transport.url);
await setEth(pub, me.address, parseEther("1"));
const azlBal = () => pub.readContract({ address: ADDR.azl, abi: erc20Abi, functionName: "balanceOf", args: [me.address] });

let s = await readWalletState(pub, me.address);
ok(s.deposit === 0n && depositStatus(s) === "empty", "fresh wallet: deposit empty -> 'nothing to withdraw'");
let threw = false; try { buildWithdraw(me.address, 0n); } catch { threw = true; }
ok(threw, "buildWithdraw refuses 0");

// Fund the deposit exactly like checkout's ETH path (gateway.fundWithEth), sized for one task + 30%.
const q = await quoteUsd(pub, 5_000_000n);
const r0 = await posterReadiness(pub, me.address, q.azlWei);
const azlPerEth = await pub.readContract({ address: ADDR.twapAdapter, abi: twapAbi, functionName: "azlPerEth" });
const ethIn = (r0.collateralShortfall * 10n ** 18n * 130n) / (azlPerEth * 100n) + 1n;
const minOut = (ethIn * azlPerEth * 90n) / (10n ** 18n * 100n);
const deadline = (await pub.getBlock()).timestamp + 600n;
await sendVerified(pub, w, { address: ADDR.paymentGateway, abi: gatewayAbi, functionName: "fundWithEth", args: [minOut, deadline], value: ethIn }, () => {});
s = await readWalletState(pub, me.address);
ok(s.deposit > 0n && s.reserved === 0n && s.withdrawable === s.available && s.available === s.deposit, `funded: deposit ${fmtAzl(s.deposit)} AZL, all withdrawable (no order live)`);
ok(depositStatus(s) === "withdrawable", "status 'withdrawable'");
console.log(`    ≈ $${Number(azlToUsd6(s.deposit, q)) / 1e6} at the live quote`);

// Post a task: collateral gets reserved and the entry floor is held back.
const posted = await sendVerified(pub, w, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "post", args: [q.azlWei, deadline + 7n * 86400n] }, () => {});
const taskId = posted.events.find((e) => e.eventName === "TaskPosted").args.taskId;
const live = await readWalletState(pub, me.address);
ok(live.reserved > 0n && live.activeOrders === 1n, `order live: reserved ${fmtAzl(live.reserved)} AZL, 1 active reservation`);
ok(live.withdrawable === (live.available > live.floor ? live.available - live.floor : 0n), `withdrawable = available - entry floor (${fmtAzl(live.withdrawable)} = ${fmtAzl(live.available)} - ${fmtAzl(live.floor)})`);
ok(["reserved", "withdrawable"].includes(depositStatus(live)), `status while live: ${depositStatus(live)}`);
// Over-withdraw must revert.
let reverted = false;
try { await pub.simulateContract({ account: me, address: ADDR.depositVault, abi: (await import("../src/lib/azzle-core.mjs")).depositAbi, functionName: "withdraw", args: [live.withdrawable + 1n, me.address] }); } catch { reverted = true; }
ok(reverted, "withdraw(withdrawable + 1) reverts while the order is live");

// Cancel the (unclaimed) order: reservation released, everything left withdrawable again. No cooldown.
await sendVerified(pub, w, { address: ADDR.taskRegistry, abi: registryAbi, functionName: "cancel", args: [taskId] }, () => {});
const after = await readWalletState(pub, me.address);
ok(after.reserved === 0n && after.activeOrders === 0n && after.withdrawable === after.available, `cancelled: reserved 0, withdrawable ${fmtAzl(after.withdrawable)} AZL (deposit ${fmtAzl(after.deposit)}; ${fmtAzl(s.deposit - after.deposit)} AZL went to fees)`);

// The modal's exact call: withdraw(withdrawable, self), immediately after cancel (no waiting).
const before = await azlBal();
const tx = buildWithdraw(me.address, after.withdrawable);
const { receipt } = await sendVerified(pub, w, { address: ADDR.depositVault, abi: (await import("../src/lib/azzle-core.mjs")).depositAbi, functionName: "withdraw", args: tx.args }, () => {});
ok(receipt.status === "success", "withdraw mined");
const end = await readWalletState(pub, me.address);
ok((await azlBal()) - before === after.withdrawable, `wallet AZL +${fmtAzl(after.withdrawable)} (exact)`);
ok(end.deposit === 0n && end.withdrawable === 0n && depositStatus(end) === "empty", "deposit now empty -> 'nothing to withdraw'");
console.log("\nWITHDRAW FORK TEST PASSED");
