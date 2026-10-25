import { fail, json } from "@/lib/server/http";
import { getOrder } from "@/lib/server/store.mjs";
import { storage } from "@/lib/server/storage.mjs";
import { serverClient } from "@/lib/server/onchain.mjs";
import { readTask } from "@/lib/azzle-core.mjs";
import { DTYPE, FINAL_MIME, downloadName } from "@/lib/server/deliverables.mjs";
export const dynamic = "force-dynamic";

// kind=preview: the preview (watermarked file / screenshot), available once a version is uploaded.
// kind=final: ONLY after a fresh on-chain read says the task is COMPLETED (customer approved, escrow released).
// Text previews are not served here: the excerpt is part of the public order JSON.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") === "final" ? "final" : "preview";
  const wantDownload = kind === "final" && !!u.searchParams.get("download");
  const o = await getOrder(id).catch(() => null);
  if (!o?.deliverable) return fail(404, "no deliverable yet");
  if (kind === "final") {
    if (!o.taskId) return fail(403, "not paid");
    const t = await readTask(serverClient(), BigInt(o.taskId));
    if (t.stateName !== "COMPLETED") return fail(403, `the final deliverable unlocks when the task is COMPLETED (now ${t.stateName})`);
  } else if (!o.deliverable.previewKey) return fail(404, "no preview for this deliverable");
  const key = kind === "final" ? o.deliverable.finalKey : o.deliverable.previewKey;
  const mime = kind === "final" ? FINAL_MIME : o.deliverable.previewMime || "application/octet-stream";
  const st = await storage();

  if (kind === "final" && DTYPE === "url") {
    const blob = await st.get(key);
    if (!blob) return fail(404, "missing deliverable");
    return json(JSON.parse(blob.body.toString("utf8")), { headers: { "cache-control": "private, no-store" } });
  }
  const dl = wantDownload ? downloadName(id) : undefined;
  if (st.signedGet) {
    // S3/R2: short-lived signed URL, so large files never pass through the serverless function
    return new Response(null, { status: 302, headers: { location: await st.signedGet(key, { downloadName: dl, contentType: mime }), "cache-control": "no-store" } });
  }
  if (st.stream) {
    // Vercel Blob (private store): proxy the bytes, range-aware; the blob URL itself is never handed out.
    const r = await st.stream(key, req.headers.get("range") || undefined);
    if (!r) return fail(404, "missing blob");
    const h: Record<string, string> = { "content-type": mime, "accept-ranges": "bytes", "cache-control": "private, no-store" };
    for (const k of ["content-length", "content-range", "etag", "last-modified"]) { const v = r.headers.get(k); if (v) h[k] = v; }
    if (dl) h["content-disposition"] = `attachment; filename="${dl}"`;
    return new Response(r.stream, { status: r.status, headers: h });
  }
  const blob = await st.get(key);
  if (!blob) return fail(404, "missing blob");
  const buf: Buffer = blob.body;
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "content-type": mime, "accept-ranges": "bytes", "cache-control": kind === "final" ? "private, no-store" : "private, max-age=60" };
  if (dl) headers["content-disposition"] = `attachment; filename="${dl}"`;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
    if (start >= buf.length || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${buf.length}` } });
    return new Response(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(buf), { headers: { ...headers, "content-length": String(buf.length) } });
}
