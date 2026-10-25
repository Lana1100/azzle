// Neutral header + footer. Name, logo and copy come from the service config; contact from env.
import Link from "next/link";
import { service } from "@/lib/service";
import { HeaderWallet } from "@/components/wallet-menu";
import { BaseLogo } from "@/components/base-logo";

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";
const WORKER = process.env.NEXT_PUBLIC_WORKER_ADDRESS || service.agentWallet || "";
const BASESCAN = "https://basescan.org";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur">
      <div className="wrapx flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-display text-[18px] text-ink" data-testid="brand">
          {service.brand.logo ? (
            <img src={service.brand.logo} alt="" className="size-7 rounded-md object-contain" />
          ) : (
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand text-[13px] font-bold text-brand-ink">{service.name.slice(0, 1)}</span>
          )}
          {service.name}
        </Link>
        <nav className="ml-auto flex items-center gap-5 text-[14px]">
          <Link href="/faq" className="ulink hidden text-ink-64 sm:inline">FAQ</Link>
          <HeaderWallet />
          <Link href="/order" className="btn-ink inline-flex h-9 items-center rounded-[var(--radius)] bg-ink px-4 text-[14px] font-medium text-paper" data-testid="nav-order">
            {service.copy.ctaOrder || "Order"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="wrapx flex flex-wrap items-center gap-x-6 gap-y-3 py-8 text-[13px] text-ink-64">
        <span>{service.copy.footer || `${service.name} · paid through AZZLE escrow`}</span>
        <span className="inline-flex items-center gap-2">Runs on <span className="rounded bg-ink px-1.5 py-1"><BaseLogo h={11} /></span></span>
        <Link href="/faq" className="ulink">FAQ</Link>
        {CONTACT && <a href={`mailto:${CONTACT}`} className="ulink">{CONTACT}</a>}
        {WORKER && <a href={`${BASESCAN}/address/${WORKER}`} target="_blank" rel="noreferrer" className="ulink font-mono">agent {WORKER.slice(0, 6)}…{WORKER.slice(-4)}</a>}
      </div>
    </footer>
  );
}
