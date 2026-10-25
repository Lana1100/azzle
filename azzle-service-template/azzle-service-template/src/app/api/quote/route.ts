import { json, fail } from "@/lib/server/http";
import { liveQuote } from "@/lib/server/onchain.mjs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return json(await liveQuote()); } catch (e: any) { return fail(502, e.shortMessage || e.message); }
}
