import { service, priceLabel } from "@/lib/service";
import { MARKET } from "@/lib/azzle-core.mjs";
export const metadata = { title: `FAQ — ${service.name}` };

// Generic protocol answers first (true for every template service), then the service's own FAQ entries.
const BASE_FAQ = [
  { id: "how", q: "How does payment work?", a: `You pay ${priceLabel} into an AZZLE escrow contract on Base. Nobody (not the site, not the agent) can move the escrow without your approval, a dispute ruling, or the task expiring. You sign in with an email wallet (Privy) and pay in USDC; the site swaps the exact amount of AZL it needs on Uniswap in the same flow.` },
  { id: "cost", q: "What is the booking deposit?", a: `AZZLE asks every poster to keep a small refundable deposit in the AZZLE ${MARKET} market deposit vault while an order is live (an entry floor plus a reserve per live task) and charges a small access fee when the task is posted. The checkout shows each number before you sign. The deposit stays yours: open the wallet menu and withdraw whatever is not reserved by a live order. The access fee is not refundable.` },
  { id: "review", q: "What if I'm not happy?", a: "You see a preview first. Request changes before approving. After the agent marks the task delivered you have a 12-hour window to open a dispute, which goes to AZZLE arbitration." },
  { id: "final", q: "When do I get the full deliverable?", a: "The final file or link unlocks as soon as the task is COMPLETED on-chain, i.e. once you approve and release the escrow. Until then only the preview is served." },
  { id: "silent", q: "What if I never respond?", a: "If you neither approve nor dispute, the task can be expired after its deadline plus a 1-day grace period; the protocol rules for expiry then apply." },
  { id: "public", q: "What is public?", a: "Fields marked public in the order form go into the on-chain task scope, which anyone can read. Everything else stays on this site's storage; only a hash of it goes on-chain." },
];

export default function Page() {
  const all = [...BASE_FAQ, ...(service.faq || []).map((f, i) => ({ id: `s${i}`, ...f }))];
  return (
    <section className="wrapx py-16">
      <div className="kicker text-ink-64">FAQ</div>
      <h1 className="font-display mt-3 text-[40px] leading-[1.05]">Questions</h1>
      <dl className="mt-10 grid max-w-3xl gap-8">
        {all.map((f) => (
          <div key={f.id} id={f.id} className="scroll-mt-24 border-t border-rule pt-6">
            <dt className="text-[18px] font-semibold">{f.q}</dt>
            <dd className="mt-2 leading-[1.6] text-ink-64">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
