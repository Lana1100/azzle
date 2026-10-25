import { json, fail, publicOrder, rateLimited, isOps } from "@/lib/server/http";
import { sendOrderAlert } from "@/lib/server/notify.mjs";
import { newOrderId, saveOrder, updateOrder } from "@/lib/server/store.mjs";
import { buildBrief, briefMarkdown, briefSummary, assertPublicUrl } from "@/lib/server/brief.mjs";
import { storage } from "@/lib/server/storage.mjs";
import { validateOrderInput, publicFields, privateHash, FIELDS } from "@/lib/order-schema.mjs";
import { PRICE_USD6 } from "@/lib/azzle-core.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (rateLimited(req)) return fail(429, "too many orders from this address, try again later");
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail(400, "JSON body required");
  const { values, errors } = validateOrderInput(b.fields || {});
  // Every url field must resolve to a public host (SSRF guard; the scraped one is re-checked on every redirect hop).
  for (const f of FIELDS) if (f.type === "url" && values[f.name] && !errors[f.name]) {
    try { await assertPublicUrl(values[f.name]); } catch (e: any) { errors[f.name] = e.message; }
  }
  if (Object.keys(errors).length) return json({ error: Object.values(errors)[0], errors }, { status: 400 });
  const order: Record<string, any> = {
    id: newOrderId(), createdAt: new Date().toISOString(),
    fields: values, publicFields: publicFields(values), privateHash: privateHash(values),
    priceUsd6: PRICE_USD6.toString(), feedback: [], brief: { status: "pending" },
    // Smoke tests mark themselves; ops lists them separately. A paid (on-chain) order is always worked regardless.
    ...(b.test === true ? { test: true } : {}),
  };
  await saveOrder(order);
  let brief: any;
  try {
    const full = await buildBrief(order);
    const s = await storage();
    await s.put(`briefs/${order.id}.json`, Buffer.from(JSON.stringify(full, null, 2)), "application/json");
    await s.put(`briefs/${order.id}.md`, Buffer.from(briefMarkdown(full)), "text/markdown");
    brief = briefSummary(full);
  } catch (e: any) {
    brief = { status: "failed", error: e.message };
  }
  // Merge the brief into the latest record (the checkout may already be attaching a task while the brief builds).
  const saved = await updateOrder(order.id, (cur: any) => { cur.brief = brief; });
  // Ops-only: x-ops-token + alertTest:1 forces the alert even for a test order (production smoke test).
  const alertTest = (b.alertTest === 1 || b.alertTest === true) && isOps(req);
  sendOrderAlert(saved, alertTest && saved.test ? "new-test" : "new", alertTest ? { force: true, note: "ops alert test (smoke test order) - ignore" } : {});
  return json(publicOrder(saved), { status: 201 });
}
