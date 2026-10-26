// Neutral default service. Copy this file, edit it, and point src/config/service.mjs at it
// (or run `npm run use-example <name>`). Everything a customer sees and everything the protocol
// scope says about an order comes from here. See CUSTOMIZE.md for every field.
/** @type {import("../service-types").ServiceConfig} */
const service = {
  // Protocol identity. `appTag` is written into every on-chain scope JSON (TaskScopeRegistryV2) and is how
  // the indexer, the worker CLI and the cron sync find YOUR tasks among everyone else's. Keep it short,
  // lowercase and unique; never change it once real orders exist (old tasks would disappear from the shop).
  appTag: "lanaweb3",
  legacyAppTags: [],
  kind:  "web3-content", // scope "kind": what is being delivered
  orderIdPrefix: "ord", // order ids look like ord_x7k2…

  // AZZLE market: "micro" (small tasks) or "standard". Addresses come from the pinned manifests in src/config.
  market: "micro",
  priceUsd: 15, // what the customer pays into escrow, in USD (paid in AZL at the live oracle price)
  turnaround: { label: "within 48 hours", deadlineDays: 2 }, // label is copy; deadlineDays goes on-chain (max 30)

  name:  "Lana's Web3 Content Pack",
  agentName: "Lana's Content Agent",
  persona: {
    tagline: "An AI agent that does one job well, paid through onchain escrow.",
    voice: "plain, friendly, specific",
  },

  deliverable: {
    type: "text", // "file" | "url" | "text"
    label: "5-post Web3 content pack",
    // file only: mime + extension of the final file; preview strategy for files is "watermark" (ffmpeg, video/image) or "upload"
    mime: "text/markdown",
    ext: "md",
    preview: "excerpt", // text: "excerpt" | url: "none" | "upload" (worker uploads a screenshot) | file: "watermark" | "upload"
    previewChars: 600,
    scopeHint: "5 X posts, 2 alternative hooks, CTA, and 1 revision", // short line written into the on-chain scope's `deliver` field
  },

  // Order form. Field types: url | text | textarea | select | colors | email.
  // public:true fields go into the on-chain scope in clear text (anyone can read them!).
  // Private fields are stored off-chain; only a keccak256 of all private values goes on-chain.
  orderFields: [
    { name: "sourceUrl", type: "url", label: "Your product link", placeholder: "https://github.com/you/project", required: true, public: true, scrape: true,
      help: "A GitHub repo, docs page or website. The agent reads it to write the brief." },
    { name: "audience", type: "select", label: "Audience", default: "developers",
      options: [{ value: "developers", label: "Developers" }, { value: "founders", label: "Founders" }, { value: "consumers", label: "Consumers" }] },
    { name: "notes", type: "textarea", label: "Anything the agent should know", placeholder: "Tone, must-mention features, words to avoid…", maxLength: 2000 },
  ],

  // Brand tokens: CSS variables for the neutral theme (src/app/globals.css). Logo is a /public path or null.
  brand: { ink: "#18181B", paper: "#FAFAF9", accent: "#4F46E5", accentInk: "#FFFFFF", radius: "0.75rem", logo: null, ogImage: null },

  copy: {
    heroTitle: "Web3 content that gets your project noticed.",
    heroSub: "Get 5 natural X posts, 2 alternative hooks, a clear call to action, and 1 revision tailored to your project.",
    orderTitle: "Order",
    orderSub: "Tell the agent what it is working on.",
    ctaOrder: "Start an order",
    previewNote: "This is a preview. The full deliverable unlocks once you approve.",
    approveCta: "Approve and release payment",
    finalReady: "Your deliverable is unlocked.",
    footer: "Payments run through AZZLE escrow on Base.",
  },

  faq: [
    { q: "What do I pay?", a: "The service price goes into escrow and is only released to the agent when you approve. A small booking deposit also sits in your AZZLE deposit while the order is live; you can withdraw what is free of it from the wallet menu." },
    { q: "What if I don't like it?", a: "Request changes, or open a dispute within the review window. Disputes go to AZZLE arbitration." },
  ],
};
export default service;
