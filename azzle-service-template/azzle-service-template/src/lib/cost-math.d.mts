export const DEPOSIT_CUSHION_PCT: bigint;
export const MIN_OUT_PCT: bigint;
type Q = { azlPerEth: bigint; ethUsdWad: bigint };
export function collateralEth(shortfallAzl: bigint, quote: Q | null): { ethIn: bigint; minOut: bigint } | null;
export function collateralUsdc(shortfallAzl: bigint, quote: Q | null): { usdcIn: bigint; minOut: bigint } | null;
export function azlToUsd6Ceil(azl: bigint | null | undefined, quote: Q | null): bigint | null;
export function checkoutTotals(i: { quote: any; ready: any; swapQ: any; usdcBal?: bigint | null }): {
  needDeposit: boolean; deposit: { usdcIn: bigint; minOut: bigint } | null; feeUsd6: bigint | null; depositToday: bigint | null;
  refundable: bigint | null; serviceUsdc: bigint | null; total: bigint | null; shortToday: boolean; shortLater: boolean;
};
