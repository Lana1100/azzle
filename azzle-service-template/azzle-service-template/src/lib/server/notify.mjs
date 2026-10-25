// Pluggable order notifier: webhook (JSON POST, optional HMAC signature), email (Resend or FormSubmit), console.
// Never throws, never blocks a customer request (Vercel waitUntil keeps the function alive for the send).
//
// Env (all optional; with none set, events are only logged):
//   NOTIFY_WEBHOOK_URL       POST target, receives {event, order, chain, text, site, at}
//   NOTIFY_WEBHOOK_SECRET    if set, header x-notify-signature: sha256=<hex HMAC of the raw body>
//   NOTIFY_EMAIL_TO          ops inbox
//   NOTIFY_EMAIL_PROVIDER    "resend" | "formsubmit" (default: resend if RESEND_API_KEY is set, else formsubmit)
//   RESEND_API_KEY, NOTIFY_EMAIL_FROM   for Resend (from must be a verified sender/domain)
//   NOTIFY_FORMSUBMIT_ID     FormSubmit alias of NOTIFY_EMAIL_TO (after activating the form once); falls back to the raw address
import crypto from "node:crypto";
import service from "../../config/service.mjs";
import { summarize } from "../order-schema.mjs";

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");

// One-shot on-chain events, decided from the cached chain snapshot (order.chain).
export const CHAIN_EVENTS = {
  funded: (c) => { try { const tot = BigInt(c.totalAmount || 0), f = BigInt(c.funded || 0); return tot > 0n && f >= tot; } catch { return false; } },
  delivered: (c) => !!c.deliveredAt && String(c.deliveredAt) !== "0",
  approved: (c) => c.stateName === "COMPLETED",
  disputed: (c) => c.stateName === "DISPUTED",
};

function chainLine(c) {
  if (!c) return "not on-chain yet (no task attached)";
  const bits = [`task #${c.id ?? "?"}`, `state ${c.stateName ?? c.state}`];
  if (c.totalAmount) bits.push(`funded ${c.funded ?? 0}/${c.totalAmount} wei`);
  if (c.deliveredAt && String(c.deliveredAt) !== "0") bits.push(`deliveredAt ${new Date(Number(c.deliveredAt) * 1000).toISOString()}`);
  if (c.worker && !/^0x0{40}$/i.test(c.worker)) bits.push(`worker ${c.worker}`);
  return bits.join(", ");
}

export function alertText(o, event, note) {
  return [
    note ? `NOTE: ${note}` : null,
    `Order: ${o.id}  event: ${event}`,
    `Service: ${service.name} — $${(Number(o.priceUsd6 || 0) / 1e6).toFixed(2)} ${service.deliverable.label}`,
    `Fields: ${summarize(o.fields) || "—"}`,
    `Brief: ${o.brief?.status || "?"}${o.brief?.title ? ` — "${o.brief.title}"` : ""}`,
    `Created: ${o.createdAt}`,
    `On-chain: ${chainLine(o.chain)}`,
    o.test ? "Flag: test order" : null,
    site() ? `Order page: ${site()}/order/${o.id}` : null,
  ].filter(Boolean).join("\n");
}

async function timed(url, init, ms = 10_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// Only non-sensitive order data leaves the server: private fields (notes etc.) are never sent to the webhook.
const webhookOrder = (o) => ({ id: o.id, createdAt: o.createdAt, priceUsd6: o.priceUsd6, publicFields: o.publicFields, taskId: o.taskId || null, test: !!o.test });

export const providers = {
  async webhook(o, event, text) {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    if (!url) return "skip";
    const body = JSON.stringify({ event, service: service.appTag, order: webhookOrder(o), chain: o.chain || null, text, site: site(), at: new Date().toISOString() });
    const headers = { "content-type": "application/json" };
    if (process.env.NOTIFY_WEBHOOK_SECRET) headers["x-notify-signature"] = "sha256=" + crypto.createHmac("sha256", process.env.NOTIFY_WEBHOOK_SECRET).update(body).digest("hex");
    const r = await timed(url, { method: "POST", headers, body });
    if (!r.ok) throw new Error(`webhook ${r.status}`);
    return "sent";
  },
  async email(o, event, text) {
    const to = process.env.NOTIFY_EMAIL_TO;
    if (!to) return "skip";
    const subject = `[${service.name} order] ${o.id} ${event}`;
    const provider = process.env.NOTIFY_EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? "resend" : "formsubmit");
    if (provider === "resend") {
      if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL_FROM) throw new Error("resend needs RESEND_API_KEY + NOTIFY_EMAIL_FROM");
      const r = await timed("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.NOTIFY_EMAIL_FROM, to: [to], subject, text }),
      });
      if (!r.ok) throw new Error(`resend ${r.status}`);
      return "sent";
    }
    const id = process.env.NOTIFY_FORMSUBMIT_ID || encodeURIComponent(to);
    const r = await timed(`https://formsubmit.co/ajax/${id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json", ...(site() ? { referer: site() + "/", origin: site() } : {}),
        // FormSubmit sits behind Cloudflare, which challenges non-browser user agents from cloud IPs.
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      },
      body: JSON.stringify({ _subject: subject, _template: "basic", _captcha: "false", message: text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) !== "true") throw new Error(`formsubmit ${r.status}: ${j.message || "unknown"}`);
    return "sent";
  },
};

/**
 * Fire-and-forget fan-out to every configured provider. Test orders are skipped unless force.
 * @param {any} o
 * @param {string} event
 * @param {{ force?: boolean, note?: string }} [opts]
 */
export function sendOrderAlert(o, event, { force = false, note } = {}) {
  if (!o || (o.test && !force)) return null;
  const text = alertText(o, event, note);
  const p = Promise.allSettled(Object.entries(providers).map(async ([name, fn]) => {
    const r = await fn(o, event, text);
    if (r === "sent") console.log(`notify ${name}: ${o.id} ${event}`);
    return r;
  })).then((rs) => {
    rs.forEach((r, i) => r.status === "rejected" && console.error(`notify ${Object.keys(providers)[i]} failed: ${o.id} ${event}: ${r.reason?.message || r.reason}`));
    if (rs.every((r) => r.status === "fulfilled" && r.value === "skip")) console.log(`order event (no notifier configured): ${o.id} ${event}`);
  });
  try { globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil?.(p); } catch {}
  return p;
}

/**
 * Which on-chain events newly happened (prev -> next chain snapshot); marks them on the order (o.alerts) so each is
 * sent once. Call inside updateOrder's mutator; send only after the save succeeded.
 */
export function markChainAlerts(o, prevChain, nextChain) {
  if (!o || o.test || !nextChain) return [];
  const out = [];
  for (const [ev, cond] of Object.entries(CHAIN_EVENTS)) {
    if (o.alerts?.[ev]) continue;
    if (!cond(nextChain)) continue;
    if (prevChain && cond(prevChain)) continue;
    o.alerts = { ...(o.alerts || {}), [ev]: new Date().toISOString() };
    out.push(ev);
  }
  return out;
}
