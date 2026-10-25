import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { service, priceLabel } from "@/lib/service";

const TITLE = `${service.name} — ${service.copy.heroTitle || service.persona.tagline}`;
const DESC = `${service.persona.tagline} ${priceLabel} sits in AZZLE escrow on Base until you approve.`;
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: TITLE,
  description: DESC,
  openGraph: { title: TITLE, description: DESC, type: "website", url: "/", siteName: service.name, ...(service.brand.ogImage ? { images: [service.brand.ogImage] } : {}) },
  twitter: { card: service.brand.ogImage ? "summary_large_image" : "summary", title: TITLE, description: DESC, ...(service.brand.ogImage ? { images: [service.brand.ogImage] } : {}) },
};
export const viewport = { themeColor: service.brand.paper };

// Brand tokens from the service config become CSS variables (see globals.css).
const hex = (v: string, d: string) => (/^#[0-9a-fA-F]{3,8}$/.test(v || "") ? v : d);
const brandVars = {
  "--brand-ink": hex(service.brand.ink, "#18181B"),
  "--brand-paper": hex(service.brand.paper, "#FAFAF9"),
  "--brand-accent": hex(service.brand.accent, "#4F46E5"),
  "--brand-accent-ink": hex(service.brand.accentInk, "#FFFFFF"),
  "--radius": /^[0-9.]+(rem|px)$/.test(service.brand.radius || "") ? service.brand.radius : "0.75rem",
} as React.CSSProperties;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={brandVars} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <SiteHeader />
          <main className="min-h-[70vh]">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
