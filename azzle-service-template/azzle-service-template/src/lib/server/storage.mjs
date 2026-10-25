// Pluggable blob storage: local disk (default, dev/VPS), Vercel Blob (private store, recommended on Vercel)
// or S3-compatible (AWS S3 / Cloudflare R2; optional, needs the @aws-sdk optional dependencies).
// STORAGE_DRIVER=local|s3|blob, DATA_DIR, S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
// BLOB_READ_WRITE_TOKEN (blob is picked automatically when STORAGE_DRIVER is unset and the token is present).
//
// Driver contract: put(key, body, contentType, {ifMatch?, ifNoneExists?}) -> {etag?}; get(key) -> {body, contentType, etag?}|null;
// head(key) -> {bytes}|null; list(prefix) -> keys; optional signedPut/signedGet (S3), clientUpload/stream (blob).
// A failed conditional write throws an error with code "PRECONDITION_FAILED".
import fs from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));

function localDriver() {
  const root = path.join(DATA_DIR, "blobs");
  const p = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("bad key");
    return full;
  };
  return {
    name: "local",
    async put(key, body, contentType) {
      await fs.mkdir(path.dirname(p(key)), { recursive: true });
      await fs.writeFile(p(key), body);
      await fs.writeFile(p(key) + ".meta.json", JSON.stringify({ contentType }));
    },
    async get(key) {
      try {
        const body = await fs.readFile(p(key));
        let contentType = "application/octet-stream";
        try { contentType = JSON.parse(await fs.readFile(p(key) + ".meta.json", "utf8")).contentType; } catch {}
        return { body, contentType };
      } catch { return null; }
    },
    async head(key) {
      try { return { bytes: (await fs.stat(p(key))).size }; } catch { return null; }
    },
    // Local disk has no presigned URLs: uploads go through the API (fine on a VPS), downloads are streamed.
    signedPut: null,
    signedGet: null,
    async list(prefix) {
      const dir = p(prefix);
      try { return (await fs.readdir(dir)).filter((f) => !f.endsWith(".meta.json")).map((f) => prefix.replace(/\/?$/, "/") + f); } catch { return []; }
    },
  };
}

async function s3Driver() {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined,
  });
  const Bucket = process.env.S3_BUCKET;
  return {
    name: "s3",
    async put(key, body, contentType) { await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType })); },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return { body: Buffer.from(await r.Body.transformToByteArray()), contentType: r.ContentType || "application/octet-stream" };
      } catch { return null; }
    },
    async head(key) {
      try { const r = await client.send(new HeadObjectCommand({ Bucket, Key: key })); return { bytes: Number(r.ContentLength || 0) }; } catch { return null; }
    },
    // Presigned URLs keep large files out of serverless request/response bodies (Vercel caps those at ~4.5 MB).
    async signedPut(key, contentType, expiresIn = 900) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), { expiresIn });
    },
    async signedGet(key, { expiresIn = 300, downloadName, contentType = "application/octet-stream" } = {}) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key, ResponseContentType: contentType,
        ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` } : {}) }), { expiresIn });
    },
    async list(prefix) {
      const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
      return (r.Contents || []).map((o) => o.Key);
    },
  };
}

// Vercel Blob, private store: nothing is ever reachable by URL without the server token. Files are served through
// our own routes (proxied stream), uploads from the worker CLI use short-lived client tokens scoped to one pathname.
async function blobDriver() {
  const sdk = await import("@vercel/blob");
  const { put, get, head, list, BlobPreconditionFailedError, BlobNotFoundError } = sdk;
  const access = "private";
  const isNotFound = (e) => e instanceof BlobNotFoundError || /not.?found|404/i.test(String(e?.message || ""));
  const toBuf = async (stream) => Buffer.from(await new Response(stream).arrayBuffer());
  return {
    name: "blob",
    async put(key, body, contentType, opts = {}) {
      const doPut = (ifMatch) => put(key, body, {
        access, contentType, addRandomSuffix: false, cacheControlMaxAge: 60,
        ...(ifMatch ? { ifMatch } : opts.ifNoneExists ? { allowOverwrite: false } : { allowOverwrite: true }),
      });
      try {
        const r = await doPut(opts.ifMatch);
        return { etag: r.etag };
      } catch (e) {
        // ETags read from GET headers may be quoted/weak while the API compares its own form: if the blob is in fact
        // unchanged, retry once with the API's ETag.
        if (opts.ifMatch && e instanceof BlobPreconditionFailedError) {
          const norm = (t) => String(t || "").replace(/^W\//, "").replace(/"/g, "");
          const h = await head(key).catch(() => null);
          if (h?.etag && norm(h.etag) === norm(opts.ifMatch) && h.etag !== opts.ifMatch) {
            try { return { etag: (await doPut(h.etag)).etag }; } catch (e2) { e = e2; }
          }
        }
        if (e instanceof BlobPreconditionFailedError || (opts.ifNoneExists && /already exists/i.test(String(e?.message)))) {
          const err = new Error("precondition failed: " + key); err.code = "PRECONDITION_FAILED"; throw err;
        }
        throw e;
      }
    },
    async get(key) {
      try {
        // JSON records change in place, so always read from origin; media keys are versioned and immutable.
        const r = await get(key, { access, useCache: !key.endsWith(".json") });
        if (!r || r.statusCode !== 200) return null;
        return { body: await toBuf(r.stream), contentType: r.blob.contentType || "application/octet-stream", etag: r.blob.etag };
      } catch (e) { if (isNotFound(e)) return null; throw e; }
    },
    async head(key) {
      try { const r = await head(key); return { bytes: Number(r.size || 0) }; } catch (e) { if (isNotFound(e)) return null; throw e; }
    },
    signedPut: null,
    signedGet: null,
    // Proxied, range-aware read for media (keeps private files private; the route decides who may see what).
    async stream(key, range) {
      try {
        const r = await get(key, { access, ...(range ? { headers: { range } } : {}) });
        if (!r || !r.stream) return null;
        return { stream: r.stream, status: r.headers.get("content-range") ? 206 : 200, headers: r.headers, size: r.blob.size, contentType: r.blob.contentType };
      } catch (e) { if (isNotFound(e)) return null; throw e; }
    },
    // One-pathname, 30-minute upload token for large files (Vercel caps function request bodies at ~4.5 MB).
    async clientUpload(key, contentType = "application/octet-stream") {
      const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
      const token = await generateClientTokenFromReadWriteToken({
        pathname: key, allowedContentTypes: [contentType], maximumSizeInBytes: 2 * 1024 ** 3,
        validUntil: Date.now() + 30 * 60_000, addRandomSuffix: false, allowOverwrite: true,
      });
      return { pathname: key, token, access, contentType };
    },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const r = await list({ prefix, cursor, limit: 1000 });
        out.push(...r.blobs.map((b) => b.pathname));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

export function driverName() {
  const d = process.env.STORAGE_DRIVER;
  if (d === "s3" || d === "blob" || d === "local") return d;
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

let _driver;
export async function storage() {
  if (!_driver) {
    const d = driverName();
    _driver = d === "s3" ? await s3Driver() : d === "blob" ? await blobDriver() : localDriver();
  }
  return _driver;
}
