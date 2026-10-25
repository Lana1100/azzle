import { json, fail, isOps } from "@/lib/server/http";
import { updateOrder } from "@/lib/server/store.mjs";
export const dynamic = "force-dynamic";
// Ops: hide an order from the backstage lists (test orders, spam). Records are kept, never hard-deleted;
// an order that already has an on-chain task can't be archived. {unarchive:true} restores it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOps(req)) return fail(401, "ops token required");
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const o = await updateOrder(id, (o: any) => {
      if (o.taskId && !b.unarchive) throw Object.assign(new Error("order has an on-chain task; not archiving"), { status: 409 });
      if (b.unarchive) delete o.archived;
      else o.archived = { at: new Date().toISOString(), reason: String(b.reason || "archived").slice(0, 200) };
      if (b.test === true) o.test = true;
      o.history = [...(o.history || []), { at: new Date().toISOString(), event: b.unarchive ? "unarchived" : `archived: ${o.archived.reason}` }];
    });
    return json({ id: o.id, archived: o.archived || null, test: !!o.test });
  } catch (e: any) {
    return fail(e.status || (/not found/.test(e.message) ? 404 : 400), e.message);
  }
}
