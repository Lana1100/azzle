/* The official Base lockup (square mark + "base" wordmark), served unmodified from
   /base-logo.svg. White wordmark: it lives on ink surfaces only. */
const W = 702, H = 179;

export function BaseLogo({ h = 20, className = "" }: { h?: number; className?: string }) {
  return (
    <img src="/base-logo.svg" alt="Base" width={Math.round((h * W) / H)} height={h} className={`inline-block shrink-0 align-middle ${className}`} style={{ height: h, width: "auto" }} />
  );
}
