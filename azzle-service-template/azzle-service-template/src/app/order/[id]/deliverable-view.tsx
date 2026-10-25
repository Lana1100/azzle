"use client";
// Renders the preview (before approval) or the unlocked final (after COMPLETED) for each deliverable type.
// The server enforces the gate (media?kind=final returns 403 until the task is COMPLETED); this only picks the view.
import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { service } from "@/lib/service";

type D = { type: string; version: number; hasPreview: boolean; previewMime: string | null; excerpt: string | null } | null;

export function DeliverableView({ id, d, completed }: { id: string; d: D; completed: boolean }) {
  const type = service.deliverable.type;
  const v = d?.version || 0;
  const src = (kind: "preview" | "final") => `/api/orders/${id}/media?kind=${kind}&v=${v}`;
  const [final, setFinal] = useState<{ text?: string; url?: string; note?: string; err?: string } | null>(null);

  useEffect(() => {
    if (!completed || !d || type === "file") return;
    let off = false;
    fetch(src("final"), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return type === "url" ? r.json() : r.text().then((text) => ({ text }));
      })
      .then((j) => { if (!off) setFinal(j); })
      .catch((e) => { if (!off) setFinal({ err: String(e.message || e) }); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, v, type]);

  if (!d) return null;

  if (type === "file") {
    const mime = completed ? service.deliverable.mime || "" : d.previewMime || "";
    const url = completed ? src("final") : src("preview");
    if (!completed && !d.hasPreview) return <Empty text="The preview appears here soon." />;
    return (
      <div className="grid gap-3">
        {mime.startsWith("video/") ? (
          <video key={url} controls playsInline className="aspect-video w-full rounded-lg bg-black" data-testid="preview-video" src={`${url}#t=1`} />
        ) : mime.startsWith("image/") ? (
          <img src={url} alt="Deliverable preview" className="w-full rounded-lg border" data-testid="preview-image" />
        ) : (
          <p className="text-sm text-ink-64">{completed ? "Your file is ready to download." : "A preview file is available."}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-64">
          <span>Version {v}</span>
          {completed && <a href={`${src("final")}&download=1`}><Button size="sm"><Download /> Download</Button></a>}
          {!completed && !mime.startsWith("video/") && !mime.startsWith("image/") && <a className="ulink" href={url}>Open preview</a>}
        </div>
      </div>
    );
  }

  if (type === "text") {
    if (completed) return (
      <div className="grid gap-3">
        {final?.err ? <p className="text-sm text-destructive">{final.err}</p> : final?.text != null ? (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-4 font-sans text-[14px] leading-[1.6]" data-testid="final-text">{final.text}</pre>
        ) : <Empty text="Loading…" />}
        <div className="flex gap-3 text-xs text-ink-64"><span>Version {v}</span><a href={`${src("final")}&download=1`}><Button size="sm"><Download /> Download .{service.deliverable.ext || "md"}</Button></a></div>
      </div>
    );
    return d.excerpt ? (
      <div className="grid gap-2">
        <pre className="relative max-h-80 overflow-hidden whitespace-pre-wrap rounded-lg border bg-card p-4 font-sans text-[14px] leading-[1.6]" data-testid="preview-excerpt">
          {d.excerpt}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
        </pre>
        <span className="text-xs text-ink-64">Excerpt of version {v}. The full text unlocks when you approve.</span>
      </div>
    ) : <Empty text="The agent delivered; the full text unlocks when you approve." />;
  }

  // url
  if (completed) return final?.err ? <p className="text-sm text-destructive">{final.err}</p> : final?.url ? (
    <div className="grid gap-2" data-testid="final-url">
      <a href={final.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 break-all text-[16px] font-medium underline">{final.url} <ExternalLink className="size-4 shrink-0" /></a>
      {final.note && <p className="whitespace-pre-wrap text-sm text-ink-64">{final.note}</p>}
    </div>
  ) : <Empty text="Loading…" />;
  return d.hasPreview ? (
    <img src={src("preview")} alt="Screenshot of the delivered page" className="w-full rounded-lg border" data-testid="preview-image" />
  ) : <Empty text="Delivered. The link unlocks when you approve." />;
}

function Empty({ text }: { text: string }) {
  return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed bg-muted/40 px-6 text-center text-sm text-ink-64">{text}</div>;
}
