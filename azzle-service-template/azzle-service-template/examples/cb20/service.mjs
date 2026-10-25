// Example: CB20, a launch-video agent (the service this template was extracted from; live at cb20.fun).
// Activate with `npm run use-example cb20` (copies this config into src/config/services/ and the public
// assets into public/). Shows a "file" deliverable with an ffmpeg-watermarked preview, a select + colors
// field, and a brief.extend hook that adds a storyboard.
//
// IMPORTANT: appTag is "cb20-example", NOT the live "cb20" tag, so a copy of this example never lists or
// syncs the real CB20 shop's on-chain tasks. Pick your own unique tag before taking real orders.
/** @type {import("../../src/config/service-types").ServiceConfig} */
const service = {
  appTag: "cb20-example",
  legacyAppTags: [],
  kind: "launch-video",
  orderIdPrefix: "lr",
  market: "micro",
  priceUsd: 5,
  turnaround: { label: "usually within 48 hours", deadlineDays: 7 },

  name: "CB20",
  agentName: "CB20",
  persona: { tagline: "An AI video agent with a moustache. Paste a repo, get a launch video.", voice: "showbiz host, short punchy lines" },

  deliverable: {
    type: "file",
    label: "launch video",
    mime: "video/mp4",
    ext: "mp4",
    preview: "watermark", // the worker CLI renders a 640px watermarked MP4 with ffmpeg before upload
    scopeHint: "30-60s MP4 launch video",
    watermarkText: "CB20 PREVIEW",
    watermarkFooter: "CB20 preview - approve to unlock full quality",
  },

  orderFields: [
    { name: "sourceUrl", type: "url", label: "Your GitHub repo, docs or website", placeholder: "https://github.com/you/project", required: true, public: true, scrape: true },
    { name: "aspect", type: "select", label: "Format", public: true, default: "16:9",
      options: [{ value: "16:9", label: "16:9 landscape" }, { value: "9:16", label: "9:16 vertical" }] },
    { name: "brandColors", type: "colors", label: "Brand colors", max: 4, help: "Up to 4 hex colors." },
    { name: "notes", type: "textarea", label: "Notes for CB20", placeholder: "e.g. make the intro faster, show the CLI demo…", maxLength: 2000 },
  ],

  brand: { ink: "#1E1328", paper: "#F3EBDD", accent: "#E3A92B", accentInk: "#1E1328", radius: "0.75rem", logo: "/logo.png", ogImage: "/og.jpg" },

  copy: {
    heroTitle: "Launch videos for $5.",
    heroSub: "Paste a GitHub repo, docs or website and CB20 makes your launch video. The $5 sits in AZZLE escrow on Base until you approve it.",
    orderTitle: "Book CB20",
    orderSub: "Tell CB20 what to make a video about.",
    ctaOrder: "Book a video",
    previewNote: "Watermarked preview. The clean full-resolution file unlocks when you approve.",
    approveCta: "I like it. Release the $5",
    finalReady: "Your video is ready.",
    footer: "CB20 is an AI video agent. Payments run through AZZLE escrow on Base.",
  },

  faq: [
    { q: "What do I get for $5?", a: "A 30–60 second launch video (MP4, 16:9 or 9:16) made from your GitHub repo, docs or website, plus change requests before you approve." },
  ],

  // Pure, synchronous: derives a storyboard skeleton from the scraped source. Never does I/O.
  brief: {
    extend(brief) {
      const s = brief.source || { headings: [] };
      const features = (s.headings || []).filter((h) => !/install|license|contributing|table of contents|getting started|usage|faq|changelog|sponsor/i.test(h)).slice(0, 4);
      const storyboard = {
        durationSec: 45,
        aspect: brief.fields?.aspect || "16:9",
        beats: [
          { t: "0-5s", beat: "Hook", text: s.tagline || s.title || "" },
          { t: "5-12s", beat: "Problem", text: "Pain the product removes (derive from intro text)" },
          { t: "12-35s", beat: "Product", text: features.length ? features.join(" · ") : "Key features from the source" },
          { t: "35-45s", beat: "CTA", text: s.homepage || s.sourceUrl || "" },
        ],
        palette: [...(brief.fields?.brandColors || []), s.themeColor].filter(Boolean),
      };
      return {
        storyboard,
        extraMarkdown: `## Storyboard (${storyboard.durationSec}s, ${storyboard.aspect})\n${storyboard.beats.map((x) => `- **${x.t} ${x.beat}:** ${x.text}`).join("\n")}`,
      };
    },
  },
};
export default service;
