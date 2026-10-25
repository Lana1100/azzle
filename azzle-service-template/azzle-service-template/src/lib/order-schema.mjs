// Schema-driven order fields (browser + Node). The service config's `orderFields` is the only schema:
// the order form renders from it, the API validates with it, and the scope builder splits public/private with it.
import { keccak256, toBytes } from "viem";
import service from "../config/service.mjs";

export const FIELDS = service.orderFields || [];
export const ORDER_PREFIX = String(service.orderIdPrefix || "ord").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "ord";
const ID_RE = new RegExp(`^${ORDER_PREFIX}_[a-z0-9]{6,32}$`);
export const isOrderId = (id) => typeof id === "string" && ID_RE.test(id);

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const DEFAULT_MAX = { text: 200, textarea: 2000, url: 2048, email: 254 };

/** Validate + normalize raw input (JSON body or form state). Returns { values, errors } (errors keyed by field name). */
export function validateOrderInput(raw = {}) {
  const values = {}, errors = {};
  for (const f of FIELDS) {
    let v = raw[f.name];
    if (f.type === "colors") {
      const list = (Array.isArray(v) ? v : String(v || "").split(/[,\s]+/)).map((c) => String(c).trim()).filter(Boolean);
      const bad = list.find((c) => !HEX.test(c));
      if (bad) { errors[f.name] = `${bad} is not a #RRGGBB color`; continue; }
      if (list.length > (f.max || 4)) { errors[f.name] = `At most ${f.max || 4} colors`; continue; }
      if (f.required && !list.length) { errors[f.name] = `${f.label} is required`; continue; }
      values[f.name] = list.map((c) => c.toUpperCase());
      continue;
    }
    v = v == null ? "" : String(v).trim();
    if (!v && f.default != null) v = String(f.default);
    if (!v) { if (f.required) errors[f.name] = `${f.label} is required`; else values[f.name] = ""; continue; }
    const max = f.maxLength || DEFAULT_MAX[f.type] || 200;
    if (v.length > max) { errors[f.name] = `${f.label} is too long (max ${max} characters)`; continue; }
    if (f.type === "url") {
      let u; try { u = new URL(v); } catch { errors[f.name] = "Enter a full link starting with https://"; continue; }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) { errors[f.name] = "Only plain http(s) links"; continue; }
      v = u.toString();
    } else if (f.type === "email" && !EMAIL.test(v)) { errors[f.name] = "Enter a valid email"; continue; }
    else if (f.type === "select" && !(f.options || []).some((o) => o.value === v)) { errors[f.name] = `Pick one of the ${f.label} options`; continue; }
    values[f.name] = v;
  }
  return { values, errors };
}

/** Fields that go into the on-chain scope in clear text (public:true). */
export function publicFields(values) {
  const out = {};
  for (const f of FIELDS) if (f.public && values[f.name] != null && values[f.name] !== "") out[f.name] = values[f.name];
  return out;
}

/** Canonical string of the private (off-chain) values: stable key order, so the same order always hashes the same. */
export function privateCanonical(values) {
  const priv = {};
  for (const f of FIELDS) if (!f.public && values[f.name] != null && values[f.name] !== "" && !(Array.isArray(values[f.name]) && !values[f.name].length)) priv[f.name] = values[f.name];
  return Object.keys(priv).length ? JSON.stringify(priv) : "";
}
/** keccak256 of the private values (goes into the scope as privateKeccak), or null when there are none. */
export const privateHash = (values) => { const c = privateCanonical(values); return c ? keccak256(toBytes(c)) : null; };

/** The first url field marked scrape:true: the brief builder fetches it. */
export const scrapeField = () => FIELDS.find((f) => f.type === "url" && f.scrape);
/** One-line human summary of an order (alerts, ops list). */
export function summarize(values) {
  return FIELDS.filter((f) => f.public && values?.[f.name]).map((f) => `${f.name}=${Array.isArray(values[f.name]) ? values[f.name].join(" ") : values[f.name]}`).join(" ");
}
