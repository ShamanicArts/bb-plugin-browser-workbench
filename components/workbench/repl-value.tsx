import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ReplPreview, ReplValue } from "@/lib/repl";
import { leafText, previewSummary } from "@/lib/repl-format";

type Leaf = ReplPreview["properties"][number];

const tone = (type: string, subtype?: string) =>
  type === "string" ? "text-warning-text"
    : type === "number" || type === "bigint" || type === "boolean" ? "text-primary"
      : subtype === "null" || type === "undefined" ? "text-subtle-foreground"
        : type === "function" ? "text-foreground italic"
          : subtype === "node" ? "text-primary"
            : "text-foreground";

function nodeText(text: string) {
  return text.startsWith("#") ? text : `<${text}>`;
}

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex min-w-0 max-w-full items-start gap-0.5 text-left hover:bg-state-hover"
    >
      <Icon name="ChevronRight" fallback="Circle" className={cn("mt-[3px] size-3 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

function PreviewTree({ preview }: { preview: ReplPreview }) {
  const rows: { key: string; label: string; leaf?: Leaf; nested?: ReplPreview }[] = preview.entries
    ? preview.entries.map((entry, index) => ({
        key: String(index),
        label: entry.key ? `${previewSummary(entry.key)} =>` : String(index),
        nested: entry.value.type === "object" && entry.value.subtype !== "null" ? entry.value : undefined,
        leaf: entry.value.type === "object" && entry.value.subtype !== "null" ? undefined : { name: String(index), type: entry.value.type, subtype: entry.value.subtype, value: entry.value.description },
      }))
    : preview.properties.map(property => ({ key: property.name, label: property.name, leaf: property, nested: property.valuePreview }));
  return (
    <div className="ml-[5px] border-l border-border-hairline pl-3">
      {rows.map(row => (
        <PreviewRow key={row.key} label={row.label} leaf={row.leaf} nested={row.nested} />
      ))}
      {preview.overflow && <div className="text-subtle-foreground">…</div>}
    </div>
  );
}

function PreviewRow({ label, leaf, nested }: { label: string; leaf?: Leaf; nested?: ReplPreview }) {
  const [open, setOpen] = useState(false);
  const name = <span className="text-primary/80">{label}</span>;
  if (nested && (nested.properties.length > 0 || (nested.entries?.length ?? 0) > 0)) {
    return (
      <div>
        <Disclosure open={open} onToggle={() => setOpen(!open)}>
          {name}: <span className="text-muted-foreground">{previewSummary(nested)}</span>
        </Disclosure>
        {open && <PreviewTree preview={nested} />}
      </div>
    );
  }
  const text = nested ? previewSummary(nested) : leaf ? leafText(leaf) : "";
  return (
    <div className="truncate pl-[14px]">
      {name}: <span className={tone(leaf?.type ?? "object", leaf?.subtype)}>{text}</span>
    </div>
  );
}

export function ReplValueView({ value }: { value: ReplValue }) {
  const [open, setOpen] = useState(false);
  const preview = value.preview;
  if (value.subtype === "node") return <span className={tone(value.type, value.subtype)}>{nodeText(value.text)}</span>;
  if (!preview || value.subtype === "error" || (preview.properties.length === 0 && !preview.entries?.length)) {
    return <span className={cn("whitespace-pre-wrap break-words", tone(value.type, value.subtype))}>{value.text}</span>;
  }
  return (
    <div className="min-w-0">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        <span className="text-foreground">{previewSummary(preview)}</span>
      </Disclosure>
      {open && <PreviewTree preview={preview} />}
    </div>
  );
}
