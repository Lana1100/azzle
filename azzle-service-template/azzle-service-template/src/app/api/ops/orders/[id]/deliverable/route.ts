import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { json, fail, isOps } from "@/lib/server/http";
import { getOrder, sha256Hex } from "@/lib/server/store.mjs";
import { storage } from "@/lib/server/storage.mjs";
import { makePreview, textExcerpt } from "@/lib/server/preview.mjs";
import { DTYPE, FINAL_MIME, deliverableKeys, commitDeliverable } from "@/lib/server/deliverables.mjs";
import service from "@/config/service.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PREVIEW_MODE = service.deliverable?.preview || "none";
const sameSha = (claimed: unknown, sha: string) => !claimed || String(claimed).toLowerCase().replace(/^0x/, "") === sha.replace(/^0x/, "");

/** ffmpeg watermark (VPS / worker machine only). Returns null when ffmpeg is missing. */
async function renderPreview(finalBuf: Buffer): Promise<{ buf: Buffer; mime: string } | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prev-"));
  try {
    const isImg = (service.deliverable?.mime || "").startsWith("image/");
    const out = path.join(dir, isImg ? "prev.jpg" : "prev.mp4");
    await fs.writeFile(path.join(dir, "in"), finalBuf);
    const mime = await makePreview(path.join(dir, "in"), out);
    return { buf: await fs.readFile(out), mime };
  } catch { return null; } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

// Upload a version of the deliverable. Allowed until the task is COMPLETED. Multipart fields by type:
//   file: final=<file> [preview=<file>] [sha256]   (no preview + preview:"watermark" => rendered here if ffmpeg exists)
//   text: text=<string> | final=<file .md/.txt>    (excerpt cut server-side)
//   url:  url=<https://…> [note] [preview=<screenshot image>]
// JSON {action:"presign"|"commit"} = direct-to-storage upload for big files (file type only; Vercel Blob or S3).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOps(req)) return fail(401, "ops token required");
  const { id } = await params;
  const o = await getOrder(id).catch(() => null);
  if (!o) return fail(404, "not found");
  if (o.chain?.stateName === "COMPLETED") return fail(409, "already completed");
  if ((req.headers.get("content-type") || "").includes("application/json")) return direct(req, o);
  const fd = await req.formData();
  const version = (o.deliverable?.version || 0) + 1;
  const s = await storage();
  let finalBuf: Buffer, preview: { buf: Buffer; mime: string } | null = null;
  const extra: Record<string, unknown> = {};

  const pv = fd.get("preview") as File | null;
  if (pv && typeof pv !== "string" && pv.size) preview = { buf: Buffer.from(await pv.arrayBuffer()), mime: pv.type || "application/octet-stream" };

  if (DTYPE === "text") {
    const f = fd.get("final") as File | null;
    const text = f && typeof f !== "string" ? await f.text() : String(fd.get("text") || "");
    if (!text.trim()) return fail(400, "text required");
    finalBuf = Buffer.from(text, "utf8");
    if (PREVIEW_MODE === "excerpt") extra.excerpt = textExcerpt(text);
    preview = null; // never store a separate text preview: the excerpt is the preview
  } else if (DTYPE === "url") {
    let u: URL;
    try { u = new URL(String(fd.get("url") || "")); } catch { return fail(400, "url required"); }
    if (!/^https?:$/.test(u.protocol)) return fail(400, "url must be http(s)");
    finalBuf = Buffer.from(JSON.stringify({ url: u.toString(), note: String(fd.get("note") || "").slice(0, 2000) }), "utf8");
    if (preview && !preview.mime.startsWith("image/")) return fail(400, "url preview must be an image (screenshot)");
  } else {
    const final = fd.get("final") as File | null;
    if (!final || typeof final === "string" || final.size === 0) return fail(400, "final file required");
    finalBuf = Buffer.from(await final.arrayBuffer());
    if (!preview && PREVIEW_MODE === "watermark") {
      preview = await renderPreview(finalBuf);
      if (!preview) return fail(501, "no preview uploaded and ffmpeg is not available here: upload a watermarked preview too (the worker CLI does this)");
    }
    if (!preview && PREVIEW_MODE === "upload") return fail(400, "this service requires an uploaded preview");
  }
  const sha = sha256Hex(finalBuf);
  if (!sameSha(fd.get("sha256"), sha)) return fail(400, "sha256 mismatch");
  const k = deliverableKeys(id, version, preview?.mime);
  await s.put(k.finalKey, finalBuf, FINAL_MIME);
  if (preview && k.previewKey) await s.put(k.previewKey, preview.buf, preview.mime);
  const deliverable = { ...k, previewMime: preview?.mime || null, sha256: sha, version, bytes: finalBuf.length, uploadedAt: new Date().toISOString(), ...extra };
  // The upload can take a while; status polls and the cron sync may have rewritten the record meanwhile, so merge
  // into the latest copy instead of saving the stale one read at the start.
  try { await commitDeliverable(id, deliverable, `deliverable v${version} uploaded`); }
  catch (e: any) { return fail(e.status || 500, e.message); }
  return json(deliverable);
}

// Direct-to-storage upload (file type), used on serverless where request bodies are capped (~4.5 MB on Vercel):
//   {action:"presign", previewMime?} -> {version, finalKey, previewKey, finalUpload|finalPut, previewUpload|previewPut}
//   the worker uploads both files, then {action:"commit", version, sha256, previewMime?} records the deliverable.
async function direct(req: Request, o: any) {
  if (DTYPE !== "file") return fail(400, "direct upload is for file deliverables; post text/url as multipart");
  const body = await req.json().catch(() => ({}));
  const s = await storage();
  if (!s.signedPut && !s.clientUpload) return fail(409, "storage driver has no presigned uploads; use multipart upload");
  const previewMime = typeof body.previewMime === "string" ? body.previewMime : (service.deliverable?.mime || "").startsWith("image/") ? "image/jpeg" : "video/mp4";
  if (body.action === "presign") {
    const version = (o.deliverable?.version || 0) + 1;
    const k = deliverableKeys(o.id, version, previewMime);
    if (s.clientUpload) {
      // Vercel Blob: per-file client tokens (one pathname each, 30 min); the worker uploads with @vercel/blob/client put().
      return json({ version, ...k, previewMime, driver: "blob", finalUpload: await s.clientUpload(k.finalKey, FINAL_MIME), previewUpload: await s.clientUpload(k.previewKey, previewMime) });
    }
    return json({ version, ...k, previewMime, finalPut: await s.signedPut(k.finalKey, FINAL_MIME), previewPut: await s.signedPut(k.previewKey, previewMime) });
  }
  if (body.action === "commit") {
    const version = Number(body.version);
    if (!Number.isInteger(version) || version !== (o.deliverable?.version || 0) + 1) return fail(400, "bad version");
    const k = deliverableKeys(o.id, version, previewMime);
    const fh = await s.head(k.finalKey);
    if (!fh) return fail(400, "final not uploaded");
    const blob = await s.get(k.finalKey);
    const sha = sha256Hex(blob!.body);
    if (!sameSha(body.sha256, sha)) return fail(400, "sha256 mismatch");
    let hasPreview = !!(await s.head(k.previewKey!));
    if (!hasPreview && PREVIEW_MODE === "watermark") {
      const p = await renderPreview(blob!.body);
      if (!p) return fail(501, "no preview uploaded and ffmpeg is not available here: upload a watermarked preview too (the worker CLI does this)");
      await s.put(k.previewKey!, p.buf, p.mime);
      hasPreview = true;
    }
    if (!hasPreview && PREVIEW_MODE === "upload") return fail(400, "this service requires an uploaded preview");
    const deliverable = { ...k, previewKey: hasPreview ? k.previewKey : null, previewMime: hasPreview ? previewMime : null, sha256: sha, version, bytes: fh.bytes, uploadedAt: new Date().toISOString() };
    try { await commitDeliverable(o.id, deliverable, `deliverable v${version} uploaded (direct)`); }
    catch (e: any) { return fail(e.status || 500, e.message); }
    return json(deliverable);
  }
  return fail(400, "unknown action");
}
