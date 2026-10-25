// Deliverable records, per type (service.deliverable.type):
//   file: final = the uploaded file (mime/ext from config); preview = watermarked copy (ffmpeg) or an uploaded preview
//   text: final = UTF-8 text/markdown; preview = server-cut excerpt stored on the record (never the full text)
//   url:  final = JSON {url, note}; preview = optional uploaded screenshot (image)
// The final is only ever served by /api/orders/[id]/media?kind=final after a fresh on-chain read says COMPLETED.
import service from "../../config/service.mjs";
import { updateOrder } from "./store.mjs";

export const DTYPE = service.deliverable?.type || "file";
export const FINAL_MIME = DTYPE === "text" ? (service.deliverable?.mime || "text/markdown") + "; charset=utf-8" : DTYPE === "url" ? "application/json" : service.deliverable?.mime || "application/octet-stream";
export const FINAL_EXT = DTYPE === "text" ? service.deliverable?.ext || "md" : DTYPE === "url" ? "json" : service.deliverable?.ext || "bin";
const PREVIEW_EXT = { "video/mp4": "mp4", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function deliverableKeys(id, version, previewMime) {
  return {
    finalKey: `deliverables/${id}/v${version}-final.${FINAL_EXT}`,
    previewKey: previewMime ? `deliverables/${id}/v${version}-preview.${PREVIEW_EXT[previewMime] || "bin"}` : null,
  };
}
/** File name offered on download: <kind>-<order id>.<ext> */
export const downloadName = (id) => `${service.kind || "deliverable"}-${id}.${FINAL_EXT}`;

/** Record a version on the latest order record (re-read + merge, retried on a concurrent write). */
export async function commitDeliverable(id, deliverable, event) {
  return updateOrder(id, (cur) => {
    if (cur.chain?.stateName === "COMPLETED") throw Object.assign(new Error("already completed"), { status: 409 });
    if ((cur.deliverable?.version || 0) >= deliverable.version) throw Object.assign(new Error("bad version"), { status: 409 });
    cur.deliverable = { type: DTYPE, ...deliverable };
    cur.history = [...(cur.history || []), { at: new Date().toISOString(), event, sha256: deliverable.sha256 }];
  });
}
