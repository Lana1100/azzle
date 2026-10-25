import { json, fail, isOps } from "@/lib/server/http";
import { listOrders } from "@/lib/server/store.mjs";
export const dynamic = "force-dynamic";
// ?all=1 includes archived orders; ?since=ISO returns only orders created after that time.
export async function GET(req: Request) {
  if (!isOps(req)) return fail(401, "ops token required");
  const u = new URL(req.url);
  const since = u.searchParams.get("since");
  let list = await listOrders();
  if (u.searchParams.get("all") !== "1") list = list.filter((o: any) => !o.archived);
  if (since) list = list.filter((o: any) => (o.createdAt || "") > since);
  return json(list);
}
