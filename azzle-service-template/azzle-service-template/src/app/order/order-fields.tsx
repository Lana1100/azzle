"use client";
// Renders the order form from service.orderFields. Values are plain strings, except "colors" (string[]).
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { OrderField } from "@/lib/service";

export type FieldValues = Record<string, string | string[]>;

export function initialValues(fields: OrderField[], params?: URLSearchParams | null): FieldValues {
  const v: FieldValues = {};
  for (const f of fields) {
    const fromUrl = params?.get(f.name) ?? (f.scrape ? params?.get("url") : null);
    v[f.name] = f.type === "colors" ? (f.default ? [f.default] : []) : fromUrl || f.default || (f.type === "select" ? f.options?.[0]?.value || "" : "");
  }
  return v;
}

export function OrderFields({ fields, values, onChange, errors }: { fields: OrderField[]; values: FieldValues; onChange: (v: FieldValues) => void; errors?: Record<string, string> }) {
  const set = (name: string, val: string | string[]) => onChange({ ...values, [name]: val });
  return (
    <>
      {fields.map((f, idx) => {
        const id = `f-${f.name}`;
        const label = (
          <Label htmlFor={id}>
            {f.label}
            {!f.required && <span className="text-muted-foreground"> (optional{f.public ? "" : ", private"})</span>}
            {f.required && !f.public && <span className="text-muted-foreground"> (private)</span>}
          </Label>
        );
        const help = (f.help || errors?.[f.name]) && (
          <p className={`text-xs ${errors?.[f.name] ? "text-destructive" : "text-muted-foreground"}`}>{errors?.[f.name] || f.help}</p>
        );
        if (f.type === "textarea") return (
          <div key={f.name} className="grid gap-1.5">{label}
            <Textarea id={id} rows={3} required={f.required} maxLength={f.maxLength || 2000} value={values[f.name] as string} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />{help}</div>
        );
        if (f.type === "select") return (
          <div key={f.name} className="grid gap-1.5">{label}
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={id}>
              {(f.options || []).map((o) => (
                <button type="button" key={o.value} role="radio" aria-checked={values[f.name] === o.value} onClick={() => set(f.name, o.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${values[f.name] === o.value ? "border-ink bg-accent text-ink" : "text-ink-64"}`}>{o.label}</button>
              ))}
            </div>{help}</div>
        );
        if (f.type === "colors") {
          const list = (values[f.name] as string[]) || [];
          const max = Math.min(f.max || 4, 4);
          return (
            <div key={f.name} className="grid gap-1.5">{label}
              <div className="flex items-center gap-2">
                {list.map((c, i) => (
                  <input key={i} type="color" value={c} aria-label={`${f.label} ${i + 1}`} className="size-9 cursor-pointer rounded-md border bg-transparent p-0.5"
                    onChange={(e) => set(f.name, list.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                {list.length < max && <Button type="button" size="sm" variant="outline" onClick={() => set(f.name, [...list, "#0a0b0d"])}>+ add</Button>}
                {list.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => set(f.name, list.slice(0, -1))}>remove</Button>}
              </div>{help}</div>
          );
        }
        return (
          <div key={f.name} className="grid gap-1.5">{label}
            <Input id={id} type={f.type === "url" ? "url" : f.type === "email" ? "email" : "text"} required={f.required} autoFocus={idx === 0 && !values[f.name]}
              maxLength={f.maxLength || (f.type === "url" ? 500 : 200)} value={values[f.name] as string} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />{help}</div>
        );
      })}
    </>
  );
}

/** Read-only list of what the customer entered (step 2). */
export function FieldSummary({ fields, values }: { fields: OrderField[]; values: FieldValues }) {
  return (
    <div className="grid gap-1 text-sm text-ink-64">
      {fields.map((f) => {
        const v = values[f.name];
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
        const shown = f.type === "select" ? f.options?.find((o) => o.value === v)?.label || String(v) : f.type === "colors" ? null : String(v);
        return (
          <div key={f.name} className="min-w-0">
            {f.label}{f.public ? "" : " (private)"}:{" "}
            {f.type === "colors" ? <span className="inline-flex gap-1 align-middle">{(v as string[]).map((c) => <span key={c} className="inline-block size-4 rounded border" style={{ background: c }} title={c} />)}</span>
              : <span className="break-words text-ink">{shown}</span>}
          </div>
        );
      })}
    </div>
  );
}
