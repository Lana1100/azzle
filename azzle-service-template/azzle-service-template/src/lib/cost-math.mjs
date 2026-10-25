// Honest checkout math (browser + Node, pure, no I/O). Every number the customer sees is derived from the
// live quote (quoteUsd) + poster readiness (posterReadiness) + the Uniswap swap quote, never from fallbacks.
// Units: AZL in wei (18 dp), USD/USDC in 6 dp, ETH in wei, quote.ethUsdWad = ETH/USD * 1e18, quote.azlPerEth = AZL wei per 1 ETH.

/** Deposit is sized at 130% of the collateral shortfall (cushion for the oracle haircut + slippage); minOut is 90% of the nominal AZL. */
export const DEPOSIT_CUSHION_PCT = 130n;
export const MIN_OUT_PCT = 90n;

const ceilCents = (usd6) => ((usd6 + 9_999n) / 10_000n) * 10_000n;

/** ETH alternative: value to send to paymentGateway.fundWithEth and its minAzlOut. */
export function collateralEth(shortfallAzl, quote) {
  if (!shortfallAzl || !quote) return null;
  const ethIn = (shortfallAzl * 10n ** 18n * DEPOSIT_CUSHION_PCT) / (quote.azlPerEth * 100n) + 1n;
  const minOut = (ethIn * quote.azlPerEth * MIN_OUT_PCT) / (10n ** 18n * 100n);
  return { ethIn, minOut };
}

/** USDC path: exact USDC to approve + pass to paymentGateway.fundWithUsdc (rounded UP to whole cents) and its minAzlOut. */
export function collateralUsdc(shortfallAzl, quote) {
  if (!shortfallAzl || !quote) return null;
  const usd6 = (shortfallAzl * quote.ethUsdWad * DEPOSIT_CUSHION_PCT) / (quote.azlPerEth * 10n ** 12n * 100n);
  const usdcIn = ceilCents(usd6);
  const minOut = (usdcIn * 10n ** 12n * quote.azlPerEth * MIN_OUT_PCT) / (quote.ethUsdWad * 100n);
  return { usdcIn, minOut };
}

/** AZL -> USD (6 dp) at the quote's par price, rounded up to cents (used to show the non-refundable access fee). */
export function azlToUsd6Ceil(azl, quote) {
  if (azl == null || !quote) return null;
  return ceilCents((BigInt(azl) * quote.ethUsdWad) / (quote.azlPerEth * 10n ** 12n));
}

/**
 * Everything the price box shows. `ready` = posterReadiness(), `swapQ` = quoteBudgetSwap() (USDC that buys the
 * escrow AZL right now), `usdcBal` = wallet USDC. Returns nulls (=> "…") until the inputs are known.
 */
export function checkoutTotals({ quote, ready, swapQ, usdcBal = null }) {
  const needDeposit = !!ready?.collateralShortfall;
  const dep = ready && quote ? collateralUsdc(ready.collateralShortfall, quote) : null;
  // The fee is waived when the poster spends an AZZLE Action Credit (posterReadiness already set requiredCollateral accordingly).
  const feeUsd6 = ready?.quote?.accessFee != null && quote ? (ready.creditWaives ? 0n : azlToUsd6Ceil(ready.quote.accessFee, quote)) : null;
  const depositToday = !ready ? null : needDeposit ? (dep?.usdcIn ?? null) : 0n;
  const refundable = depositToday != null && feeUsd6 != null && needDeposit ? (depositToday > feeUsd6 ? depositToday - feeUsd6 : 0n) : null;
  const serviceUsdc = ready && !ready.azlShortfall ? 0n : swapQ ? swapQ.usdcIn : null; // 0 = escrow AZL already in the wallet
  const total = depositToday != null && serviceUsdc != null ? depositToday + serviceUsdc : null;
  const shortToday = depositToday != null && usdcBal != null && needDeposit && usdcBal < depositToday;
  const shortLater = !shortToday && total != null && usdcBal != null && usdcBal < total;
  return { needDeposit, deposit: dep, feeUsd6, depositToday, refundable, serviceUsdc, total, shortToday, shortLater };
}
