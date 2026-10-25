// Order store on top of the blob storage (JSON documents), so the same code runs on a VPS disk or R2/S3.
import crypto from "node:crypto";
import { storage } from "./storage.mjs";
import { isOrderId, ORDER_PREFIX } from "../order-schema.mjs";

export function newOrderId() {
  return ORDER_PREFIX + "_" + crypto.randomBytes(10).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
}
const key = (id) => {
  if (!isOrderId(id)) throw new Error("bad order id");
  return `orders/${id}.json`;
};

// Optimistic concurrency: getOrder remembers the record's ETag (non-enumerable, never serialized) and saveOrder
// writes with If-Match, so two concurrent writers can't silently overwrite each other (blob driver; local/S3 ignore it).
const ETAG = Symbol.for("azzle-service.etag");
const setEtag = (o, etag) => { if (etag) Object.defineProperty(o, ETAG, { value: etag, enumerable: false, configurable: true, writable: true }); return o; };

export async function getOrder(id) {
  const s = await storage();
  const r = await s.get(key(id));
  return r ? setEtag(JSON.parse(r.body.toString("utf8")), r.etag) : null;
}
export async function saveOrder(order) {
  const s = await storage();
  order.updatedAt = new Date().toISOString();
  const etag = order[ETAG];
  const r = await s.put(key(order.id), Buffer.from(JSON.stringify(order, null, 2)), "application/json",
    etag ? { ifMatch: etag } : { ifNoneExists: true });
  setEtag(order, r?.etag);
  return order;
}
// Returned by an updateOrder() mutator to skip the write (nothing to change after re-reading the fresh record).
export const NO_WRITE = Symbol.for("azzle-service.no-write");
// Read-modify-write with retry on a concurrent change: every attempt re-reads the latest record (and its ETag) and
// re-applies fn, so a concurrent writer's fields (status poll, cron sync, uploads) are merged, never overwritten.
// Keep fn quick and side-effect free (it may run more than once); do slow work (uploads, chain reads) before calling.
export async function updateOrder(id, fn, tries = 8) {
  for (let i = 0; ; i++) {
    const o = await getOrder(id);
    if (!o) throw new Error("order not found");
    const r = await fn(o);
    if (r === NO_WRITE) return o;
    const n = r || o;
    if (n !== o) setEtag(n, o[ETAG]);
    try { return await saveOrder(n); }
    catch (e) {
      if (e?.code !== "PRECONDITION_FAILED" || i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, Math.min(1000, 40 * 2 ** i) + Math.random() * 120));
    }
  }
}
export async function listOrders() {
  const s = await storage();
  const keys = (await s.list("orders/")).filter((k) => k.endsWith(".json"));
  const out = [];
  for (let i = 0; i < keys.length; i += 16) {
    const rs = await Promise.all(keys.slice(i, i + 16).map((k) => s.get(k).catch(() => null)));
    for (const r of rs) if (r) try { out.push(JSON.parse(r.body.toString("utf8"))); } catch {}
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export const sha256Hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");
