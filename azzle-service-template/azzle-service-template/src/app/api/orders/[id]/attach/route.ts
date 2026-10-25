import { json, fail, publicOrder } from "@/lib/server/http";
import { getOrder, updateOrder } from "@/lib/server/store.mjs";
import { verifyAttach } from "@/lib/server/onchain.mjs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => null);
  if (!b?.taskId || !/^0x[0-9a-fA-F]{64}$/.test(b?.postTx || "")) return fail(400, "taskId and postTx required");
  const o = await getOrder(id).catch(() => null);
  if (!o) return fail(404, "not found");
  if (o.taskId && o.taskId !== String(b.taskId)) return fail(409, "order already attached to " + o.taskId);
  try {
    const v = await verifyAttach(id, b.taskId, b.postTx);
    const saved = await updateOrder(id, (cur: any) => {
      if (cur.taskId && cur.taskId !== String(b.taskId)) throw new Error("order already attached to " + cur.taskId);
      Object.assign(cur, { taskId: String(b.taskId), poster: v.poster, postTx: b.postTx, scopeTx: b.scopeTx || cur.scopeTx || null, scoped: v.scoped, postedUsd6: v.amountUsd6, totalAmount: v.totalAmount });
    });
    return json(publicOrder(saved));
  } catch (e: any) {
    return fail(400, e.shortMessage || e.message);
  }
}
