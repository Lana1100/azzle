import Link from "next/link";
export default function NotFound() {
  return (
    <section className="wrapx py-28">
      <div className="kicker text-ink-64">Error 404</div>
      <h1 className="font-display mt-3 text-[44px] leading-[1]">Page not found.</h1>
      <p className="mt-4 text-ink-64">That page doesn&apos;t exist, or the order link is mistyped.</p>
      <div className="mt-8 flex gap-6"><Link href="/" className="ulink">Home</Link><Link href="/order" className="ulink">Start an order →</Link></div>
    </section>
  );
}
