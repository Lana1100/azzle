// Preview generation for "file" deliverables: watermarked, low-res copies the customer can review before approving.
// Needs ffmpeg (worker machine / VPS; not available on Vercel serverless, where the worker CLI uploads the preview).
// "text" deliverables use textExcerpt() (server-side, no ffmpeg). "url" deliverables use an uploaded screenshot or none.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import service from "../../config/service.mjs";

const FONT = process.env.WATERMARK_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const LABEL = () => service.deliverable?.watermarkText || "PREVIEW";
const FOOTER = () => service.deliverable?.watermarkFooter || `${service.name} preview - approve to unlock full quality`;

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}: ${err.slice(-800)}`))));
  });
}

export async function sha256File(path) {
  return "0x" + crypto.createHash("sha256").update(await fs.readFile(path)).digest("hex");
}

function filters(label) {
  const txt = (s) => String(s).replace(/[:\\']/g, " ");
  const tile = (x, y) => `drawtext=fontfile=${FONT}:text='${txt(label)}':fontcolor=white@0.28:fontsize=h/9:x=${x}:y=${y}:borderw=2:bordercolor=black@0.18`;
  return ["scale=640:-2", tile("(w-tw)/2", "(h-th)/2"), tile("w*0.04", "h*0.08"), tile("w-tw-w*0.04", "h-th-h*0.08"),
    `drawtext=fontfile=${FONT}:text='${txt(FOOTER())}':fontcolor=white@0.85:fontsize=h/26:x=(w-tw)/2:y=h-th-12:box=1:boxcolor=black@0.45:boxborderw=6`].join(",");
}

/** Video: 640px wide, low bitrate, tiled watermark + footer. */
export async function makeVideoPreview(input, output, label = LABEL()) {
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", filters(label), "-c:v", "libx264", "-preset", "veryfast", "-crf", "34", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "64k", output]);
  return output;
}
/** Image: 640px wide JPEG with the same watermark. */
export async function makeImagePreview(input, output, label = LABEL()) {
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", filters(label), "-frames:v", "1", "-q:v", "6", output]);
  return output;
}
/** Picks the right renderer from the MIME type. Returns the preview's content type. */
export async function makePreview(input, output, mime = service.deliverable?.mime || "") {
  if (mime.startsWith("image/")) { await makeImagePreview(input, output); return "image/jpeg"; }
  await makeVideoPreview(input, output); return "video/mp4";
}

/** Text deliverables: the first N characters (cut at a word), so the customer can judge tone before approving. */
export function textExcerpt(text, n = service.deliverable?.previewChars || 600) {
  const s = String(text || "");
  // Never more than 30% of the whole text, so a short deliverable is not fully revealed by its preview.
  n = Math.max(1, Math.min(n, Math.floor(s.length * 0.3)));
  const cut = s.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return { excerpt: (at > n * 0.6 ? cut.slice(0, at) : cut) + " …", truncated: true, totalChars: s.length };
}
