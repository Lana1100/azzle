"use client";
// Typed re-export of the shared core for client components.
import * as core from "@/lib/azzle-core.mjs";
export const {
  ADDR, CHAIN_ID, MARKET, PRICE_USD6, DEADLINE_DAYS, registryAbi, scopeAbi, erc20Abi, gatewayAbi, arbitrationAbi, depositAbi, escrowAbi,
  quoteUsd, posterReadiness, readTask, taskActions, confirmationTemplate, buildScope, fmtAzl, fmtUsd6, taskRef, hashText,
  STATE_NAMES, POSTER_DISPUTE_GRACE_WINDOW, DELIVERY_GRACE_WINDOW,
} = core as any;
export const UNISWAP_AZL = `https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${(core as any).ADDR.azl}`;
export const UNISWAP_AZL_USDC = `https://app.uniswap.org/swap?chain=base&inputCurrency=${(core as any).ADDR.azl}&outputCurrency=${(core as any).ADDR.usdc}`;
export const BASESCAN = "https://basescan.org";
