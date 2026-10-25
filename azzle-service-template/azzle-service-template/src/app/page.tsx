import Link from "next/link";
import { service, priceLabel } from "@/lib/service";
import { STEPS } from "@/lib/service";

export default function Home() {
  return (
    <>
      <section className="wrapx pb-16 pt-16 md:pt-24">
        <div className="kicker text-brand">{service.agentName} · {priceLabel} · {service.turnaround.label}</div>
        <h1 className="font-display balance mt-4 max-w-[18ch] text-[44px] leading-[1.02] md:text-[64px]">{service.copy.heroTitle}</h1>
        <p className="pretty mt-6 max-w-[56ch] text-[18px] leading-[1.55] text-ink-64">{service.copy.heroSub}</p>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <Link href="/order" className="btn-ink inline-flex h-12 items-center rounded-[var(--radius)] bg-brand px-6 text-[16px] font-medium text-brand-ink" data-testid="hero-cta">
            {service.copy.ctaOrder || "Start an order"} · {priceLabel}
          </Link>
          <Link href="/faq" className="ulink text-ink-64">How payment works</Link>
        </div>
      </section>
      <section className="wrapx">
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s} className="rounded-[var(--radius)] border border-rule bg-card p-4">
              <div className="kicker text-ink-64">Step {i + 1}</div>
              <div className="mt-2 font-medium">{s}</div>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-[70ch] text-[14px] leading-[1.6] text-ink-64">
          You pay {priceLabel} into AZZLE escrow on Base. The agent is paid when you approve the {service.deliverable.label}; disputes go to AZZLE arbitration.
        </p>
      </section>
    </>
  );
}
