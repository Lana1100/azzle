import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { publicFields } from "@/lib/order-schema.mjs";

export const json = (data: unknown, init?: ResponseInit) =>
  new NextResponse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
export const fail = (status: number, error: string) => json({ error }, { status });

export function isOps(req: Request) {
  const want = process.env.OPS_TOKEN;
  if (!want) return false;
  const got = req.headers.get("x-ops-token") || "";
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Public view of an order (anyone with the order link sees this): only public fields, no private values,
 * no storage keys, and never the final deliverable itself (that is gated in /api/orders/[id]/media).
 */
export function publicOrder(o: Record<string, any>) {
  const { fields, deliverable, brief, ...rest } = o;
  return {
    ...rest,
    fields: publicFields(fields || {}),
    hasPrivate: !!o.privateHash,
    brief: brief ? { status: brief.status, title: brief.title, tagline: brief.tagline, logo: brief.logo, error: brief.error } : null,
    deliverable: deliverable ? {
      type: deliverable.type, sha256: deliverable.sha256, uploadedAt: deliverable.uploadedAt, version: deliverable.version, bytes: deliverable.bytes,
      hasPreview: !!deliverable.previewKey, previewMime: deliverable.previewMime || null,
      excerpt: deliverable.excerpt || null, // text deliverables: server-cut excerpt (max 30% of the text)
    } : null,
  };
}

/** Best-effort per-IP limiter (per instance; on serverless put a WAF/edge rule in front for real abuse protection). */
const hits = new Map<string, number[]>();
export function rateLimited(req: Request, limit = Number(process.env.ORDER_RATE_LIMIT || 20), windowMs = 3600_000) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > limit;
}
