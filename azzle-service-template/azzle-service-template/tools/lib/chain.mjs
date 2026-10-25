// Node-side chain helpers for the worker CLI and fork tests. Keys are read from a file and never printed.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi, scopeAbi } from "../../src/lib/azzle-core.mjs";

export const RPC = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

export function publicClient(rpc = RPC) {
  return createPublicClient({ chain: base, transport: http(rpc, { timeout: 60_000 }), batch: { multicall: true } });
}

/** Loads the worker key from a JSON key file without ever printing it. */
export function loadAccount(keyFile) {
  const raw = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const pk = raw.privateKey || raw.private_key || raw.key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk || "")) throw new Error("key file has no privateKey");
  const account = privateKeyToAccount(pk);
  if (raw.address && raw.address.toLowerCase() !== account.address.toLowerCase()) throw new Error("key file address mismatch");
  return account;
}

export function walletClient(account, rpc = RPC) {
  return createWalletClient({ account, chain: base, transport: http(rpc, { timeout: 60_000 }) });
}

/** Refuse to send unless the RPC is a local anvil fork, or the caller explicitly confirmed mainnet. */
export async function assertSendAllowed(pub, { confirmMainnet = false } = {}) {
  let version = "";
  try { version = await pub.request({ method: "web3_clientVersion" }); } catch {}
  const isFork = /anvil|hardhat/i.test(version);
  if (!isFork && !confirmMainnet) {
    throw new Error(`Refusing to broadcast to ${RPC} (client "${version}"): not a local fork. Re-run with --i-confirm-mainnet after the operator approved this exact transaction.`);
  }
  return { isFork, version };
}

/** simulate -> send -> wait -> verify status, return decoded logs. */
export async function sendVerified(pub, wallet, req, log = console.log) {
  const { request } = await pub.simulateContract({ ...req, account: wallet.account });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
  const events = [];
  for (const l of receipt.logs) {
    for (const abi of [registryAbi, scopeAbi]) {
      try { events.push(decodeEventLog({ abi, data: l.data, topics: l.topics })); break; } catch {}
    }
  }
  log(`  mined ${hash} block ${receipt.blockNumber} gas ${receipt.gasUsed} events: ${events.map((e) => e.eventName).join(",") || "-"}`);
  return { hash, receipt, events };
}

export { listSiteTasks } from "../../src/lib/server/onchain.mjs";
