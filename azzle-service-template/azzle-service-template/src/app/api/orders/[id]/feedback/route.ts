import { json, fail } from "@/lib/server/http";
import { updateOrder } from "@/lib/server/store.mjs";
export const dynamic = "force-dynamic";

// Off-chain revision request (no chain effect). the agent can upload a new version before the customer approves.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const text = String(b?.text || "").trim().slice(0, 2000);
  if (!text) return fail(400, "empty");
  try {
    const o = await updateOrder(id, (o: any) => { o.feedback = [...(o.feedback || []), { text, at: new Date().toISOString() }]; });
    return json({ feedback: o.feedback });
  } catch (e: any) { return fail(404, e.message); }
}
