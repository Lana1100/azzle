"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectButton } from "@/components/connect-button";
import { TxStep } from "@/components/tx-step";
import { sendTx, errMsg } from "@/lib/tx";
import { ADDR, registryAbi, confirmationTemplate, fmtAzl, taskRef } from "@/lib/client-azzle";
import { KeyRound, RefreshCw, Upload } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { service } from "@/lib/service";
import { summarize } from "@/lib/order-schema.mjs";

// Public address of the agent (worker) wallet; only used to show/enable the claim + markDelivered buttons.
const WORKER = (process.env.NEXT_PUBLIC_WORKER_ADDRESS || service.agentWallet || "").trim();
const DTYPE = service.deliverable.type;
const LANES: { key: string; title: string; match: (o: any) => boolean }[] = [
  { key: "claim", title: "To claim", match: (o) => o.chain?.stateName === "POSTED" },
  { key: "fund", title: "Waiting for customer funding", match: (o) => o.chain?.stateName === "CLAIMED" },
  { key: "produce", title: "Produce & deliver", match: (o) => o.chain?.stateName === "ACTIVE" && o.chain?.deliveredAt === "0" },
  { key: "review", title: "Customer reviewing", match: (o) => o.chain?.stateName === "ACTIVE" && o.chain?.deliveredAt !== "0" },
  { key: "done", title: "Closed", match: (o) => ["COMPLETED", "CANCELLED", "RESOLVED", "DISPUTED"].includes(o.chain?.stateName) },
  { key: "draft", title: "Drafts (not posted)", match: (o) => !o.taskId && !o.test },
  { key: "test", title: "Test orders (not customers)", match: (o) => !o.taskId && !!o.test },
];

export function OpsDashboard() {
  const [token, setToken] = useState("");
  const [orders, setOrders] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setToken(localStorage.getItem("ops_token") || ""); }, []);

  const load = useCallback(async (tk = token) => {
    if (!tk) return;
    try {
      await fetch("/api/cron/sync", { headers: { "x-ops-token": tk } }).catch(() => {});
      const r = await fetch("/api/ops/orders", { headers: { "x-ops-token": tk }, cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setOrders(j); setErr(null);
    } catch (e) { setErr(errMsg(e)); setOrders(null); }
  }, [token]);
  useEffect(() => { if (token) load(token); }, [token, load]);

  if (!orders) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Ops sign-in</CardTitle><CardDescription>Enter the OPS_TOKEN for this deployment.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("t") as HTMLInputElement).value; localStorage.setItem("ops_token", v); setToken(v); load(v); }}>
              <Input name="t" type="password" placeholder="ops token" defaultValue={token} />
              <Button type="submit">Open</Button>
            </form>
            {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Ops · {service.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">worker {WORKER || "(set NEXT_PUBLIC_WORKER_ADDRESS)"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ConnectButton size="sm" />
          <Button variant="outline" size="sm" onClick={() => load()}><RefreshCw /> Sync</Button>
          <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem("ops_token"); setToken(""); setOrders(null); }}>Lock</Button>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="ops-stats">
        {LANES.slice(0, 5).map((l) => (
          <Card key={l.key} size="sm"><CardContent><div className="text-2xl font-semibold">{orders.filter(l.match).length}</div><div className="text-xs text-muted-foreground">{l.title}</div></CardContent></Card>
        ))}
      </div>
      <div className="grid gap-6">
        {LANES.map((l) => {
          const list = orders.filter(l.match);
          if (!list.length) return null;
          return (
            <section key={l.key}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{l.title}</h2>
              <div className="grid gap-2">
                {list.map((o) => <OrderRow key={o.id} o={o} token={token} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} reload={() => load()} />)}
              </div>
            </section>
          );
        })}
      </div>
      <Card className="mt-8">
        <CardHeader><CardTitle>Worker CLI</CardTitle><CardDescription>Dry-run by default. Mainnet sends need --send --i-confirm-mainnet.</CardDescription></CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{`export RPC_URL=… SITE_URL=${typeof window !== "undefined" ? window.location.origin : ""} OPS_TOKEN=… WORKER_KEY_FILE=/path/to/worker-key.json
node tools/worker.mjs orders          # site orders (OPS_TOKEN only, no key)
node tools/worker.mjs readiness       # worker deposit / credits (needs WORKER_KEY_FILE)
node tools/worker.mjs list            # open tasks tagged "${service.appTag}"
node tools/worker.mjs claim <taskRef> --send --i-confirm-mainnet
node tools/worker.mjs brief <taskRef> > brief.md
node tools/worker.mjs deliver <taskRef> <file|text|url> --send --i-confirm-mainnet`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function OrderRow({ o, token, open, onToggle, reload }: { o: any; token: string; open: boolean; onToggle: () => void; reload: () => void }) {
  const { address } = useAccount();
  const [brief, setBrief] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isWorker = !!WORKER && address?.toLowerCase() === WORKER.toLowerCase();
  const st = o.chain?.stateName;
  const ref = o.taskId ? taskRef(o.taskId) : null;
  const regT = { key: "taskRegistry (micro)", address: ADDR.taskRegistry };

  useEffect(() => {
    if (open && brief === null) fetch(`/api/ops/orders/${o.id}/brief?format=md`, { headers: { "x-ops-token": token } }).then((r) => r.text()).then(setBrief).catch(() => setBrief("(no brief)"));
  }, [open, brief, o.id, token]);

  async function upload() {
    setBusy(true); setMsg(null);
    try {
      const url = `/api/ops/orders/${o.id}/deliverable`;
      const hj = { "x-ops-token": token, "content-type": "application/json" };
      let j: any;
      if (DTYPE === "file" && file) {
        const mime = service.deliverable.mime || file.type || "application/octet-stream";
        // Bucket storage: presigned direct upload (no serverless body limit). Local disk: multipart through the API.
        const pre = await fetch(url, { method: "POST", headers: hj, body: JSON.stringify({ action: "presign" }) });
        if (pre.ok) {
          const p = await pre.json();
          if (p.driver === "blob") {
            const { put } = await import("@vercel/blob/client");
            await put(p.finalUpload.pathname, file, { access: "private", token: p.finalUpload.token, contentType: mime, multipart: true });
          } else {
            const put = await fetch(p.finalPut, { method: "PUT", headers: { "content-type": mime }, body: file });
            if (!put.ok) throw new Error(`bucket upload failed (${put.status}); check the bucket CORS rule`);
          }
          const r = await fetch(url, { method: "POST", headers: hj, body: JSON.stringify({ action: "commit", version: p.version }) });
          j = await r.json(); if (!r.ok) throw new Error(j.error);
          setMsg(`uploaded v${j.version} sha256 ${j.sha256?.slice(0, 12)}…`); reload(); return;
        }
      }
      const fd = new FormData();
      if (DTYPE === "file") { if (!file) throw new Error("pick a file"); fd.append("final", file); }
      else if (DTYPE === "text") fd.append("text", text);
      else fd.append("url", text);
      if (preview) fd.append("preview", preview);
      const r = await fetch(url, { method: "POST", headers: { "x-ops-token": token }, body: fd });
      j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(`uploaded v${j.version} sha256 ${j.sha256?.slice(0, 12)}…`); reload();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Card size="sm" data-testid={`ops-order-${o.id}`}>
      <CardContent>
        <button className="flex w-full flex-wrap items-center gap-3 text-left" onClick={onToggle}>
          {o.brief?.logo ? <img src={o.brief.logo} alt="" className="size-8 rounded-md border bg-white object-contain" /> : <div className="size-8 rounded-md bg-muted" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{o.brief?.title || summarize(o.fields) || o.id}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{o.id}{ref ? ` · ${ref}` : ""}{o.feedback?.length ? ` · ${o.feedback.length} feedback` : ""}</div>
          </div>
          {o.chain && <span className="font-mono text-xs">{fmtAzl(o.chain.funded)} / {fmtAzl(o.chain.totalAmount)} AZL</span>}
          <Badge variant={st === "COMPLETED" ? "default" : "secondary"}>{st || "DRAFT"}</Badge>
          {o.deliverable && <Badge variant="outline">v{o.deliverable.version}</Badge>}
        </button>
        {open && (
          <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Brief</div>
              <div className="grid gap-1 rounded-lg border p-2 text-sm">
                {service.orderFields.map((f) => {
                  const v = o.fields?.[f.name];
                  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
                  return <div key={f.name}><b>{f.label}{f.public ? "" : " (private)"}:</b>{" "}
                    {f.type === "colors" ? <span className="inline-flex gap-1 align-middle">{(v as string[]).map((c) => <span key={c} className="inline-block size-4 rounded border" style={{ background: c }} title={c} />)}</span> : String(v)}</div>;
                })}
              </div>
              {(o.feedback || []).map((f: any, i: number) => <div key={i} className="rounded-lg bg-accent p-2 text-sm"><b>Change request:</b> {f.text}</div>)}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-[11px]">{brief ?? "loading…"}</pre>
            </div>
            <div className="grid content-start gap-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Deliver</div>
              {DTYPE === "file" && <Input type="file" accept={service.deliverable.mime} onChange={(e) => setFile(e.target.files?.[0] || null)} />}
              {DTYPE === "text" && <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the deliverable (markdown)" />}
              {DTYPE === "url" && <Input type="url" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://… (final link)" />}
              {DTYPE !== "text" && service.deliverable.preview !== "none" && service.deliverable.preview !== "excerpt" && (
                <label className="grid gap-1 text-xs text-muted-foreground">Preview {DTYPE === "url" ? "screenshot" : "file"} (optional{DTYPE === "file" && service.deliverable.preview === "watermark" ? "; else rendered with ffmpeg where available" : ""})
                  <Input type="file" accept={DTYPE === "url" ? "image/*" : undefined} onChange={(e) => setPreview(e.target.files?.[0] || null)} /></label>
              )}
              <Button className="w-fit" disabled={busy || st === "COMPLETED" || (DTYPE === "file" ? !file : !text.trim())} onClick={upload}><Upload /> Upload version</Button>
              <p className="text-xs text-muted-foreground">Upload new versions any time before approval. The final stays locked until the task is COMPLETED on-chain.</p>
              {msg && <p className="text-xs">{msg}</p>}
              {isWorker && st === "POSTED" && (
                <TxStep title="Claim" testId="ops-claim" cta={`Claim ${ref}`} onRun={async () => { await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "claim", args: [BigInt(o.taskId)] }); reload(); }}
                  template={confirmationTemplate({ target: regT, method: "claim(uint256 taskId)", args: `taskId ${ref}`, expected: "POSTED -> CLAIMED; worker collateral reserved at the task's latched quote", irreversible: "access fee debited from worker deposit" })} />
              )}
              {isWorker && st === "ACTIVE" && o.chain?.deliveredAt === "0" && o.deliverable && (
                <TxStep title="Mark delivered" testId="ops-deliver" cta="markDelivered" onRun={async () => {
                  const r = await sendTx({ address: ADDR.taskRegistry, abi: registryAbi, functionName: "markDelivered", args: [BigInt(o.taskId)] });
                  await fetch(`/api/ops/orders/${o.id}/delivered`, { method: "POST", headers: { "x-ops-token": token, "content-type": "application/json" }, body: JSON.stringify({ tx: r.hash }) });
                  reload();
                }}
                  template={confirmationTemplate({ target: regT, method: "markDelivered(uint256 taskId)", args: `taskId ${ref}`, expected: "records deliveredAt (starts the customer's 12h dispute window); NO escrow moves", irreversible: "one-shot; cannot be undone" })} />
              )}
              {!isWorker && <p className="text-xs text-muted-foreground">Connect the agent wallet to claim / markDelivered here, or use the CLI below.</p>}
              <a href={`/order/${o.id}`} className="text-xs text-primary underline">Customer view →</a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
