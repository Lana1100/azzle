import { errMsg } from "@/lib/tx";

export type Friendly = { kind: "rejected" | "funds" | "network" | "stuck" | "price" | "other"; title: string; body: string; raw: string };

/** Turn a wallet / RPC error into plain words. Pure presentation: never changes what was sent. */
export function friendlyError(e: any): Friendly {
  const raw = errMsg(e);
  const all = [raw, e?.message, e?.details, e?.cause?.message, e?.cause?.shortMessage].filter(Boolean).join(" ").toLowerCase();
  const code = e?.code ?? e?.cause?.code ?? e?.cause?.cause?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request|request rejected|cancelled by user|user cancel/.test(all))
    return { kind: "rejected", raw, title: "No problem, nothing was sent.", body: "You closed or declined the wallet request. No money moved. Hit the button again whenever you're ready." };
  if (/chain ?mismatch|does not match the target chain|wrong network|unsupported chain|switch.*chain/.test(all))
    return { kind: "network", raw, title: "Your wallet is on the wrong network.", body: "This shop runs on Base. Switch your wallet to Base, then try again. Nothing was sent." };
  if (/insufficient|exceeds balance|transfer amount exceeds|not enough|need .* usdc, wallet has/.test(all))
    return { kind: "funds", raw, title: "Not enough in the wallet yet.", body: "Your wallet needs a bit more USDC (or ETH for the network fee) on Base. Top up, hit refresh, and try again. Nothing was sent." };
  if (/price moved/.test(all))
    return { kind: "price", raw, title: "The price moved a little.", body: "The market shifted since we quoted you, so we stopped before asking you to sign. Refresh for a new quote." };
  if (/timed? ?out|timeout|did not succeed|pending|replacement|nonce|dropped/.test(all))
    return { kind: "stuck", raw, title: "Base is taking its time.", body: "Your wallet may still be waiting on the network. Check the activity tab in your wallet before signing again, so you don't pay twice. Then refresh this page." };
  return { kind: "other", raw, title: "That didn't go through.", body: "Nothing changed on your order. Try again, or refresh the page. The technical message is below if you need it." };
}
