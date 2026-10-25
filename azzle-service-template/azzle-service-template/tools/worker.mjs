#!/usr/bin/env node
// Worker CLI for the agent that fulfils this service's orders.
//
//   node tools/worker.mjs orders [--all] [--since=ISO]   # site orders (needs OPS_TOKEN, never loads a key)
//   node tools/worker.mjs archive <order_id> [reason]    # hide a test/spam order from /ops (OPS_TOKEN)
//   node tools/worker.mjs readiness                      # worker deposit vs claim requirement (key: address only)
//   node tools/worker.mjs list [--funded]                # this service's on-chain tasks + what the worker can do
//   node tools/worker.mjs brief <v2:market:N>            # save the job brief (incl. private fields) to jobs/<order>/
//   node tools/worker.mjs claim <v2:market:N> [--send]
//   node tools/worker.mjs deliver <v2:market:N> <file|text.md|https://url> [--preview=img] [--note=…] [--send]
//
// Default is a DRY RUN: it prints the confirmation template and stops. --send broadcasts, but only to a
// local anvil/hardhat fork, unless --i-confirm-mainnet is also passed (only after the operator approved that
// exact transaction).
// Env: WORKER_KEY_FILE (required for key commands; there is no default path), RPC_URL, SITE_URL, OPS_TOKEN
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ADDR, MARKET, registryAbi, parseTaskRef, readTask, taskActions, confirmationTemplate, fmtAzl, posterReadiness, depositAbi,
  POSTER_DISPUTE_GRACE_WINDOW,
} from "../src/lib/azzle-core.mjs";
import { publicClient, walletClient, loadAccount, assertSendAllowed, sendVerified, listSiteTasks, RPC } from "./lib/chain.mjs";
import { makePreview, sha256File } from "../src/lib/server/preview.mjs";
import { summarize } from "../src/lib/order-schema.mjs";
import service from "../src/config/service.mjs";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]));
const opt = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [cmd, ...args] = argv.filter((a) => !a.startsWith("--"));
const SITE = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const OPS = process.env.OPS_TOKEN || "";
const DTYPE = service.deliverable?.type || "file";

const pub = publicClient();
let _account;
function acct() {
  if (_account) return _account;
  const f = process.env.WORKER_KEY_FILE;
  if (!f) throw new Error("WORKER_KEY_FILE is required (path to a JSON file with {address, privateKey}). The CLI never prints it.");
  return (_account = loadAccount(f));
}
const now = async () => Number((await pub.getBlock()).timestamp);

async function api(p, init = {}) {
  if (!OPS) throw new Error("OPS_TOKEN required");
  const r = await fetch(SITE + p, { ...init, headers: { "x-ops-token": OPS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`);
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text();
}

async function guardSend() {
  if (!flags.has("--send")) return false;
  const g = await assertSendAllowed(pub, { confirmMainnet: flags.has("--i-confirm-mainnet") });
  console.log(`Broadcasting to ${g.isFork ? "LOCAL FORK" : "BASE MAINNET"} (${g.version})`);
  return true;
}

async function scopeOf(id) {
  const { tasks } = await listSiteTasks(pub, { fromId: id });
  const s = tasks.find((x) => x.id === id)?.scope;
  if (!s) throw new Error(`task ${id} is not a ${service.appTag} task`);
  return s;
}

async function orders() {
  const since = opt("since");
  const qs = new URLSearchParams({ ...(flags.has("--all") ? { all: "1" } : {}), ...(since ? { since } : {}) });
  const list = await api(`/api/ops/orders?${qs}`);
  console.log(`${SITE} | ${list.length} order(s)${since ? ` since ${since}` : ""}`);
  for (const o of list) {
    const st = o.taskId ? `${o.chain?.stateName || "?"} task ${o.taskId}` : "not posted";
    console.log(`${o.id}  ${o.createdAt}  ${st.padEnd(20)} ${summarize(o.fields || {})}${o.test ? "  [TEST]" : ""}${o.archived ? "  [archived]" : ""}  brief ${o.brief?.status || "?"}`);
  }
  if (!list.length) console.log("(no orders)");
}

async function list(onlyFunded) {
  const me = acct().address;
  const ts = await now();
  const { count, tasks } = await listSiteTasks(pub);
  console.log(`RPC ${RPC} | ${MARKET} registry ${ADDR.taskRegistry} | taskCount ${count} | worker ${me}`);
  for (const t of tasks) {
    if (onlyFunded && !(t.state === 3 && t.funded === t.totalAmount && t.deliveredAt === 0n)) continue;
    const a = taskActions(t, ts, me);
    const mine = t.worker.toLowerCase() === me.toLowerCase();
    console.log(`${t.ref.padEnd(16)} ${t.stateName.padEnd(9)} ${fmtAzl(t.totalAmount)} AZL funded ${fmtAzl(t.funded)} order ${t.scope.order}` +
      `${mine ? " [mine]" : ""}${a.canClaim ? " -> claim" : ""}${a.canDeliver ? " -> deliver" : ""}`);
  }
  if (!tasks.length) console.log(`(no ${service.appTag} tasks)`);
}

async function readiness() {
  const me = acct().address;
  const r = await posterReadiness(pub, me, 0n);
  console.log(`worker ${me}\n ETH ${Number(r.ethBal) / 1e18}\n AZL ${fmtAzl(r.azlBal)}\n deposit available ${fmtAzl(r.available)} AZL\n claim needs ~${fmtAzl(r.requiredCollateral)} AZL (current quote; the task's latched quote applies at claim)\n shortfall ${fmtAzl(r.collateralShortfall)} AZL\n gateway intakePaused ${r.intakePaused}`);
}

async function brief(ref) {
  const id = parseTaskRef(ref);
  const s = await scopeOf(id);
  const dir = path.join(process.cwd(), "jobs", s.order);
  await fs.mkdir(dir, { recursive: true });
  const md = await api(`/api/ops/orders/${s.order}/brief?format=md`);
  await fs.writeFile(path.join(dir, "brief.md"), md, { mode: 0o600 });
  console.log(`brief -> ${path.join(dir, "brief.md")} (contains private fields; keep it out of git)`);
}

async function claim(ref) {
  const id = parseTaskRef(ref);
  const me = acct().address;
  const t = await readTask(pub, id);
  const a = taskActions(t, await now(), me);
  const q = await pub.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "taskQuotes", args: [id] });
  const avail = await pub.readContract({ address: ADDR.depositVault, abi: depositAbi, functionName: "available", args: [me] });
  console.log(confirmationTemplate({
    target: { key: `taskRegistry (${MARKET})`, address: ADDR.taskRegistry }, method: "claim(uint256)", args: `${id} (${t.ref})`,
    expected: "POSTED -> CLAIMED; worker collateral reserved; 1-day funding window starts",
    irreversible: `reserves ~${fmtAzl(q[0] + q[1] + q[2])} AZL of worker deposit (available ${fmtAzl(avail)}); access fee ${fmtAzl(q[2])} AZL unless an Action Credit is spent`,
  }));
  if (!a.canClaim) throw new Error(`cannot claim: state ${t.stateName}`);
  if (!(await guardSend())) return console.log("(dry run: add --send)");
  await sendVerified(pub, walletClient(acct()), { address: ADDR.taskRegistry, abi: registryAbi, functionName: "claim", args: [id] });
  const after = await readTask(pub, id);
  if (after.stateName !== "CLAIMED" || after.worker.toLowerCase() !== me.toLowerCase()) throw new Error("post-state check failed");
  console.log(`verified: ${after.ref} CLAIMED by ${after.worker}; poster must fund by ${new Date(Number(after.fundingDeadline) * 1000).toISOString()}`);
}

/** Uploads one deliverable version to the site (by type), returns its sha256. */
async function upload(order, id, input) {
  const up = `/api/ops/orders/${order}/deliverable`;
  const fd = new FormData();
  fd.set("taskId", String(id));
  const pv = opt("preview");
  if (DTYPE === "url") {
    fd.set("url", input);
    if (opt("note")) fd.set("note", opt("note"));
    if (pv) fd.set("preview", new Blob([await fs.readFile(pv)], { type: pv.endsWith(".png") ? "image/png" : "image/jpeg" }), path.basename(pv));
    return (await api(up, { method: "POST", body: fd })).sha256;
  }
  if (DTYPE === "text") {
    fd.set("final", new Blob([await fs.readFile(input)], { type: "text/markdown" }), path.basename(input));
    return (await api(up, { method: "POST", body: fd })).sha256;
  }
  // file: make the preview locally (ffmpeg) unless one was given or the service has no preview
  const sha = await sha256File(input);
  const mode = service.deliverable?.preview || "none";
  let prev = pv || null;
  if (!prev && mode === "watermark") {
    prev = path.join(os.tmpdir(), `preview-${order}${(service.deliverable?.mime || "").startsWith("image/") ? ".jpg" : ".mp4"}`);
    await makePreview(input, prev);
  }
  const mime = service.deliverable?.mime || "application/octet-stream";
  const prevMime = prev ? (prev.endsWith(".jpg") ? "image/jpeg" : prev.endsWith(".png") ? "image/png" : "video/mp4") : undefined;
  const pre = await fetch(SITE + up, { method: "POST", headers: { "x-ops-token": OPS, "content-type": "application/json" }, body: JSON.stringify({ action: "presign", previewMime: prevMime }) });
  if (pre.ok) {
    const p = await pre.json();
    const pairs = [[p.driver === "blob" ? p.finalUpload : p.finalPut, input, mime], ...(prev ? [[p.driver === "blob" ? p.previewUpload : p.previewPut, prev, prevMime]] : [])];
    for (const [u, f, ct] of pairs) {
      if (p.driver === "blob") {
        const { put } = await import("@vercel/blob/client");
        await put(u.pathname, await fs.readFile(f), { access: u.access || "private", token: u.token, contentType: u.contentType, multipart: true });
      } else {
        const r = await fetch(u, { method: "PUT", headers: { "content-type": ct }, body: await fs.readFile(f) });
        if (!r.ok) throw new Error(`bucket PUT failed ${r.status}`);
      }
    }
    await api(up, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "commit", version: p.version, sha256: sha, previewMime: prevMime }) });
  } else {
    fd.set("sha256", sha);
    fd.set("final", new Blob([await fs.readFile(input)], { type: mime }), path.basename(input));
    if (prev) fd.set("preview", new Blob([await fs.readFile(prev)], { type: prevMime }), path.basename(prev));
    await api(up, { method: "POST", body: fd });
  }
  return sha;
}

async function deliver(ref, input) {
  if (!input) throw new Error(`usage: deliver <ref> <${DTYPE === "url" ? "https://url" : DTYPE === "text" ? "text.md" : "file"}>`);
  const id = parseTaskRef(ref);
  const me = acct().address;
  const t = await readTask(pub, id);
  const s = await scopeOf(id);
  const a = taskActions(t, await now(), me);
  console.log(confirmationTemplate({
    target: { key: `taskRegistry (${MARKET})`, address: ADDR.taskRegistry }, method: "markDelivered(uint256)", args: `${id} (${t.ref})`,
    expected: "records deliveredAt only; state stays ACTIVE; NO escrow moves. Poster then has 12h to dispute; expiry is possible only after the deadline + 1-day grace",
    irreversible: "deliveredAt can be set once (later versions are site uploads only)",
    extra: `Deliverable (${DTYPE}): ${input} — stored off-chain by the site; the registry has no deliverable-hash field`,
  }));
  if (t.deliveredAt > 0n && t.state === 3) {
    // Revision: already marked delivered on-chain; just upload the new version.
    if (!flags.has("--send")) return console.log("(dry run: add --send to upload a new version)");
    const sha = await upload(s.order, id, input);
    return console.log(`uploaded revision for ${s.order} sha256 ${sha}`);
  }
  if (!a.canDeliver) throw new Error(`cannot deliver: state ${t.stateName}, funded ${fmtAzl(t.funded)}/${fmtAzl(t.totalAmount)}, deliveredAt ${t.deliveredAt}`);
  if (!(await guardSend())) return console.log("(dry run: add --send)");
  const sha = await upload(s.order, id, input);
  console.log(`uploaded deliverable for ${s.order} sha256 ${sha}`);
  const res = await sendVerified(pub, walletClient(acct()), { address: ADDR.taskRegistry, abi: registryAbi, functionName: "markDelivered", args: [id] });
  const after = await readTask(pub, id);
  if (after.deliveredAt === 0n || after.stateName !== "ACTIVE") throw new Error("post-state check failed");
  await api(`/api/ops/orders/${s.order}/delivered`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: res.hash }) });
  console.log(`verified: deliveredAt ${after.deliveredAt}; poster dispute cutoff ${new Date(Number(after.deliveredAt + POSTER_DISPUTE_GRACE_WINDOW) * 1000).toISOString()}`);
}

const USAGE = "usage: worker.mjs orders [--all] [--since=ISO] | archive <order_id> [reason] | readiness | list [--funded] | brief <ref> | claim <ref> [--send] | deliver <ref> <input> [--preview=img] [--note=…] [--send] [--i-confirm-mainnet]";
try {
  if (cmd === "orders") await orders();
  else if (cmd === "archive") console.log(await api(`/api/ops/orders/${args[0]}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: args.slice(1).join(" ") || "archived via CLI" }) }));
  else if (cmd === "list") await list(flags.has("--funded"));
  else if (cmd === "readiness") await readiness();
  else if (cmd === "brief") await brief(args[0]);
  else if (cmd === "claim") await claim(args[0]);
  else if (cmd === "deliver") await deliver(args[0], args[1]);
  else console.log(USAGE);
} catch (e) {
  console.error("error:", e.shortMessage || e.message);
  process.exit(1);
}
