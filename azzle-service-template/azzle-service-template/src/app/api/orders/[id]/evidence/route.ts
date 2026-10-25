import { json, fail } from "@/lib/server/http";
import { updateOrder } from "@/lib/server/store.mjs";
import { storage } from "@/lib/server/storage.mjs";
import { hashText, APP_TAG } from "@/lib/azzle-core.mjs";
export const dynamic = "force-dynamic";

// Stores the customer's dispute statement; returns keccak256 of the exact JSON, which goes on-chain in openDispute().
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const reason = String(b?.reason || "").trim().slice(0, 4000);
  if (reason.length < 10) return fail(400, "describe the problem (10+ chars)");
  const doc = JSON.stringify({ app: APP_TAG, order: id, by: b?.by || null, reason, at: new Date().toISOString() });
  const hash = hashText(doc);
  try {
    await (await storage()).put(`evidence/${id}/${hash}.json`, Buffer.from(doc), "application/json");
    await updateOrder(id, (o: any) => { o.evidence = [...(o.evidence || []), { hash, at: new Date().toISOString() }]; });
  } catch (e: any) { return fail(404, e.message); }
  return json({ hash, doc });
}
