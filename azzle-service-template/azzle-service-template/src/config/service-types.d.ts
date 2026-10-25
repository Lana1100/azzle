export type FieldType = "url" | "text" | "textarea" | "select" | "colors" | "email";
export interface OrderField {
  name: string; type: FieldType; label: string; placeholder?: string; help?: string;
  required?: boolean; public?: boolean; scrape?: boolean; maxLength?: number; max?: number; default?: string;
  options?: { value: string; label: string }[];
}
export interface ServiceConfig {
  appTag: string; legacyAppTags?: string[]; kind: string; orderIdPrefix: string;
  market: "micro" | "standard"; priceUsd: number; turnaround: { label: string; deadlineDays: number };
  name: string; agentName: string; persona: { tagline: string; voice?: string };
  deliverable: { type: "file" | "url" | "text"; label: string; mime?: string; ext?: string; preview: "watermark" | "upload" | "excerpt" | "none"; previewChars?: number; scopeHint?: string; watermarkText?: string; watermarkFooter?: string };
  orderFields: OrderField[];
  brand: { ink: string; paper: string; accent: string; accentInk: string; radius?: string; logo?: string | null; ogImage?: string | null };
  copy: Record<string, string>;
  faq?: { q: string; a: string }[];
  /** Optional pure hook: extra keys merged into the brief (e.g. a storyboard). extraMarkdown is appended to brief.md. */
  brief?: { extend?: (brief: any) => Record<string, unknown> | void };
  /** Public address of the agent wallet (shown in the footer/ops). Prefer NEXT_PUBLIC_WORKER_ADDRESS. */
  agentWallet?: string;
  /** Optional labels for the 5 order steps (default: Details, Brief, Sign in, Pay, Review). */
  steps?: string[];
}
