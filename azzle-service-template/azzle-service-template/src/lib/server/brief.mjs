// Brief builder: turns an order (schema-driven fields) into the structured job brief the agent works from.
// If the service has a url field marked scrape:true, that link is fetched (SSRF-safe: every redirect hop is
// re-checked against private/internal addresses) and summarized: GitHub repos via the API, other sites via HTML.
import dns from "node:dns/promises";
import net from "node:net";
import service from "../../config/service.mjs";
import { FIELDS, scrapeField } from "../order-schema.mjs";

const UA = process.env.BRIEF_USER_AGENT || `AgentServiceBriefBot/1.0 (+${(process.env.NEXT_PUBLIC_SITE_URL || "https://example.com").replace(/\/$/, "")})`;
const MAX_BYTES = 2_000_000;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("::ffff:127.") || ip === "::";
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Not a valid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs");
  if (u.username || u.password) throw new Error("No credentials in URL");
  const host = u.hostname;
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("URL must resolve to a public host");
  return u;
}

async function fetchText(url, accept = "text/html,*/*") {
  // follow redirects manually so every hop is re-checked against private/internal addresses (SSRF)
  let r, cur = url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(cur);
    r = await fetch(cur, { headers: { "user-agent": UA, accept }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) break;
    if (hop >= 5) throw new Error("too many redirects");
    cur = new URL(loc, cur).toString();
  }
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { text: buf.subarray(0, MAX_BYTES).toString("utf8"), finalUrl: cur, contentType: r.headers.get("content-type") || "" };
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || "") : "";
}
const abs = (u, base) => { try { return new URL(u, base).toString(); } catch { return null; } };

export function parseGithub(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(url);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : null;
}

async function githubBrief(gh, url) {
  const api = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
  const headers = { "user-agent": UA, accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(api, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const repo = await r.json();
  let readme = "";
  const rr = await fetch(`${api}/readme`, { headers: { ...headers, accept: "application/vnd.github.raw" }, signal: AbortSignal.timeout(15000) });
  if (rr.ok) readme = (await rr.text()).slice(0, 60_000);
  const headings = [...readme.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 30);
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g), ...readme.matchAll(/<img[^>]+src=["']([^"']+)/gi)]
    .map((m) => abs(m[1], `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${repo.default_branch}/`))
    .filter(Boolean).filter((u) => !/shields\.io|badge/i.test(u)).slice(0, 12);
  return {
    kind: "github",
    title: repo.name,
    tagline: repo.description || "",
    homepage: repo.homepage || null,
    stars: repo.stargazers_count,
    language: repo.language,
    topics: repo.topics || [],
    license: repo.license?.spdx_id || null,
    logo: repo.owner?.avatar_url || null,
    ogImage: `https://opengraph.githubassets.com/1/${gh.owner}/${gh.repo}`,
    images,
    headings,
    text: readme.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 8000),
    themeColor: null,
    sourceUrl: url,
  };
}

async function webBrief(url) {
  const { text: html, finalUrl } = await fetchText(url);
  const title = meta(html, "og:title") || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/gi)]
    .map((m) => abs(m[0].match(/href=["']([^"']+)/i)?.[1] || "", finalUrl)).filter(Boolean);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => strip(m[1])).filter((s) => s && s.length < 160).slice(0, 30);
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)/gi)].map((m) => abs(m[1], finalUrl)).filter((u) => u && !u.startsWith("data:")).slice(0, 12);
  const body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || html;
  return {
    kind: "website",
    title,
    tagline: meta(html, "og:description") || meta(html, "description"),
    homepage: finalUrl,
    logo: icons.sort((a, b) => (/apple-touch|svg/.test(b) ? 1 : 0) - (/apple-touch|svg/.test(a) ? 1 : 0))[0] || abs("/favicon.ico", finalUrl),
    ogImage: abs(meta(html, "og:image") || meta(html, "twitter:image"), finalUrl),
    images,
    headings,
    text: strip(body.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")).slice(0, 8000),
    themeColor: meta(html, "theme-color") || null,
    sourceUrl: url,
  };
}

/** The brief: every field (incl. private ones: the brief is ops-only), plus the scraped source if any. */
export async function buildBrief(order) {
  const sf = scrapeField();
  const url = sf ? order.fields?.[sf.name] : null;
  let source = null;
  if (url) {
    const gh = parseGithub(url);
    source = gh ? await githubBrief(gh, url) : await webBrief(url);
  }
  let brief = { orderId: order.id, createdAt: new Date().toISOString(), service: service.appTag, deliverable: service.deliverable, fields: order.fields || {}, source };
  // Optional, pure hook from the service config (e.g. the CB20 example adds a storyboard). Never let it break intake.
  if (typeof service.brief?.extend === "function") {
    try { brief = { ...brief, ...(service.brief.extend(brief) || {}) }; } catch (e) { brief.extendError = String(e?.message || e); }
  }
  return brief;
}

/** Short summary stored on the order record (shown to the customer in step 2). */
export function briefSummary(brief) {
  const s = brief.source;
  return { status: "ready", title: s?.title || service.name, tagline: s?.tagline || "", logo: s?.logo || null, kind: s?.kind || "fields" };
}

const fmtVal = (v) => (Array.isArray(v) ? v.join(", ") : v) || "—";
export function briefMarkdown(brief) {
  const s = brief.source;
  const lines = [
    `# ${service.name} brief — ${s?.title || brief.orderId}`, "",
    `- Order: ${brief.orderId}`,
    `- Deliverable: ${brief.deliverable?.label || "—"} (${brief.deliverable?.type || "?"})`,
    ...FIELDS.map((f) => `- ${f.label}${f.public ? "" : " (private)"}: ${fmtVal(brief.fields?.[f.name])}`),
  ];
  if (s) {
    lines.push("", `## Source: ${s.sourceUrl} (${s.kind})`, "", `- Logo: ${s.logo || "—"}`, `- OG image: ${s.ogImage || "—"}`, s.themeColor ? `- Theme color: ${s.themeColor}` : "",
      "", "## Tagline", s.tagline || "—", "", "## Headings", s.headings.map((h) => "- " + h).join("\n") || "—",
      "", "## Images", s.images.map((i) => "- " + i).join("\n") || "—", "", "## Source text (truncated)", s.text.slice(0, 3000));
  }
  if (brief.extraMarkdown) lines.push("", String(brief.extraMarkdown));
  return lines.filter((l) => l !== "").join("\n").replace(/\n(#+ )/g, "\n\n$1") + "\n";
}
