import { json, fail, isOps } from "@/lib/server/http";
import { syncOrders } from "@/lib/server/onchain.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Vercel Cron (vercel.json) or any scheduler. Vercel sends "Authorization: Bearer $CRON_SECRET" automatically.
// In production a CRON_SECRET (or the ops token) is required; locally it is open for convenience.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = isOps(req) || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed && (secret || process.env.NODE_ENV === "production")) return fail(401, "unauthorized");
  try { return json(await syncOrders()); } catch (e: any) { return fail(502, e.shortMessage || e.message); }
}
