import { Loader2 } from "lucide-react";
/** Neutral busy indicator (replace with your own brand spinner). */
export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 aria-hidden className={`size-4 animate-spin ${className}`} />;
}
