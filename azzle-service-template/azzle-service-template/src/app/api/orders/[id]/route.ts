import { json, fail, publicOrder } from "@/lib/server/http";
import { getOrder, updateOrder } from "@/lib/server/store.mjs";
import { serverClient, taskJson } from "@/lib/server/onchain.mjs";
import { readTask } from "@/lib/azzle-core.mjs";
import { markChainAlerts, sendOrderAlert } from "@/lib/server/notify.mjs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let o;
  try { o = await getOrder(id); } catch { return fail(400, "bad id"); }
  if (!o) return fail(404, "not found");
  if (o.taskId) {
    try {
      const pub = serverClient();
      const [t, block] = await Promise.all([readTask(pub, BigInt(o.taskId)), pub.getBlock()]);
      const chain = { ...taskJson(t), syncedAt: new Date().toISOString(), chainNow: block.timestamp.toString() };
      o.chain = chain;
      // Merge only the chain snapshot (+ alert marks) into the latest record, so a poll never clobbers a concurrent
      // write such as a deliverable upload.
      let events: string[] = [];
      const saved = await updateOrder(id, (cur: any) => {
        events = markChainAlerts(cur, cur.chain, chain);
        cur.chain = chain;
      });
      o = saved;
      for (const ev of events) sendOrderAlert(o, ev);
    } catch {}
  }
  return json(publicOrder(o));
}
