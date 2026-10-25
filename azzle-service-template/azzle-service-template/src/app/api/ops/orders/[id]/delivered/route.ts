import { json, fail, isOps } from "@/lib/server/http";
import { updateOrder } from "@/lib/server/store.mjs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOps(req)) return fail(401, "ops token required");
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const o = await updateOrder(id, (o: any) => {
    o.deliveredTx = b.tx || null;
    o.history = [...(o.history || []), { at: new Date().toISOString(), event: "markDelivered", tx: b.tx || null }];
  }).catch(() => null);
  return o ? json({ ok: true }) : fail(404, "not found");
}
