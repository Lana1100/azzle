import { json, fail, isOps } from "@/lib/server/http";
import { getOrder, updateOrder } from "@/lib/server/store.mjs";
import { storage } from "@/lib/server/storage.mjs";
import { buildBrief, briefMarkdown, briefSummary } from "@/lib/server/brief.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ops: GET the stored brief (?format=md for markdown). POST rebuilds it (e.g. after the source site changed).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOps(req)) return fail(401, "ops token required");
  const { id } = await params;
  const md = new URL(req.url).searchParams.get("format") === "md";
  const blob = await (await storage()).get(`briefs/${id}.${md ? "md" : "json"}`).catch(() => null);
  if (!blob) return fail(404, "no brief");
  return new Response(new Uint8Array(blob.body), { headers: { "content-type": md ? "text/markdown; charset=utf-8" : "application/json" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOps(req)) return fail(401, "ops token required");
  const { id } = await params;
  const o = await getOrder(id).catch(() => null);
  if (!o) return fail(404, "not found");
  let next: any;
  try {
    const brief = await buildBrief(o);
    const s = await storage();
    await s.put(`briefs/${id}.json`, Buffer.from(JSON.stringify(brief, null, 2)), "application/json");
    await s.put(`briefs/${id}.md`, Buffer.from(briefMarkdown(brief)), "text/markdown");
    next = briefSummary(brief);
  } catch (e: any) { next = { status: "failed", error: e.message }; }
  await updateOrder(id, (cur: any) => { cur.brief = next; });
  return json(next);
}
