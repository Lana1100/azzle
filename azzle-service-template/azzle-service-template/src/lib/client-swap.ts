"use client";
// Typed re-export of the shared USDC -> AZL route core.
import * as s from "@/lib/swap-core.mjs";
export const {
  UNI, WETH, AZL_POOL_KEY, AZL_POOL_ID, DEFAULT_BUFFER_BPS, QUOTE_TTL_SEC, quoteBudgetSwap, quoteUsdcForExactAzl,
  quoteAzlForUsdc, buildRouterExecute, buildPayWithUsdcCalls, readPayState, applyBuffer,
} = s as any;
