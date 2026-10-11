import { useCallback, useRef, useState } from "react";
import type { ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

type Page = ExperimentalPluginBrowserToolbarActionProps["experimental_page"];

// Mirrors the desktop's `bbDesktopBrowserReplResultSchema` (patched desktop).
const leafSchema = z.object({
  name: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  value: z.string().optional(),
});
const previewBase = {
  type: z.string(),
  subtype: z.string().optional(),
  description: z.string().optional(),
  overflow: z.boolean(),
};
const nestedPreviewSchema = z.object({ ...previewBase, properties: z.array(leafSchema) });
const previewSchema = z.object({
  ...previewBase,
  properties: z.array(leafSchema.extend({ valuePreview: nestedPreviewSchema.optional() })),
  entries: z.array(z.object({ key: nestedPreviewSchema.optional(), value: nestedPreviewSchema })).optional(),
});
const valueSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  className: z.string().optional(),
  text: z.string(),
  preview: previewSchema.optional(),
});
const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: valueSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type ReplPreview = Omit<z.infer<typeof nestedPreviewSchema>, "properties"> & {
  properties: Array<z.infer<typeof leafSchema> & { valuePreview?: ReplPreview }>;
  entries?: Array<{ key?: ReplPreview; value: ReplPreview }>;
};
export type ReplValue = z.infer<typeof valueSchema>;
type ReplResult = z.infer<typeof resultSchema>;

export type ReplEntry = {
  id: number;
  time: number;
  doneTime?: number;
  input: string;
  state: "pending" | "ok" | "error";
  value?: ReplValue;
  error?: string;
  note?: string;
};

type DesktopReplBridge = {
  browser?: { experimental_workbenchRepl?: (request: { tabId: string; source: string }) => Promise<unknown> };
};

const HISTORY_KEY = "bb-workbench:repl-history";
const HISTORY_LIMIT = 100;
const MAX_ENTRIES = 200;

/** The patched desktop's DevTools-grade console (CDP replMode), when present. */
export function nativeRepl(tabId: string): ((source: string) => Promise<ReplResult>) | null {
  const browser = (window as unknown as { bbDesktop?: DesktopReplBridge }).bbDesktop?.browser;
  const call = browser?.experimental_workbenchRepl;
  if (!browser || !call) return null;
  return async source => resultSchema.parse(await call.call(browser, { tabId, source }));
}

// Fallback for desktops without the console extension: runs in the page's main
// world through `page.evaluate`. Input is compiled first and executed exactly
// once; only compile-time errors choose another strategy. Previews read own
// data properties only (getters are never invoked) and iterate a bounded number
// of items. `let`/`const` don't persist between entries in this mode.
export function fallbackExpression(source: string): string {
  return `(async () => {
  const source = ${JSON.stringify(source)};
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const compile = () => {
    try { new Function(source); return () => (0, eval)(source); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    try { return new AsyncFunction("return (" + source + "\\n)"); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    const trimmed = source.replace(/[;\\s]+$/, "");
    const cut = Math.max(trimmed.lastIndexOf(";"), trimmed.lastIndexOf("\\n"));
    if (cut > 0) {
      try { return new AsyncFunction(trimmed.slice(0, cut + 1) + "\\nreturn (" + trimmed.slice(cut + 1) + "\\n)"); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    return new AsyncFunction(source);
  };
  let run;
  try { run = compile(); }
  catch (error) {
    if (error instanceof EvalError) return { csp: true };
    return { ok: false, error: "Uncaught " + String(error && error.stack || error) };
  }
  const MAX_ITEMS = 50;
  const seen = new WeakSet();
  const quote = (s) => JSON.stringify(s.length > 200 ? s.slice(0, 200) + "…" : s);
  const tag = (v) => { try { return Object.prototype.toString.call(v).slice(8, -1); } catch { return "Object"; } };
  const own = (v, k) => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return !d ? undefined : "value" in d ? { value: d.value } : { accessor: true };
  };
  const preview = (v, depth) => {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return quote(v);
    if (t === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (t === "boolean") return String(v);
    if (t === "bigint") return v + "n";
    if (t === "symbol") return v.toString();
    if (t === "function") return "ƒ " + (own(v, "name")?.value || "anonymous") + "()";
    if (v instanceof Error) return depth === 0 ? String(v.stack || v) : v.name + ": " + v.message;
    if (typeof Element !== "undefined" && v instanceof Element) return "<" + v.localName + (v.id ? "#" + v.id : "") + [...v.classList].slice(0, 3).map(c => "." + c).join("") + ">";
    if (typeof Node !== "undefined" && v instanceof Node) return v.nodeName.toLowerCase();
    if (v === globalThis) return "Window";
    if (v instanceof Date) return isNaN(v) ? "Invalid Date" : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Promise) return "Promise {…}";
    if (seen.has(v)) return "[Circular]";
    const name = tag(v);
    if (depth > 2) return Array.isArray(v) ? "Array(" + v.length + ")" : name + " {…}";
    seen.add(v);
    try {
      if (v instanceof Map || v instanceof Set) {
        const items = [];
        for (const item of v) {
          if (items.length === MAX_ITEMS) { items.push("…"); break; }
          items.push(v instanceof Map ? preview(item[0], depth + 1) + " => " + preview(item[1], depth + 1) : preview(item, depth + 1));
        }
        return name + "(" + v.size + ") {" + items.join(", ") + "}";
      }
      const length = own(v, "length")?.value;
      if (Array.isArray(v) || ArrayBuffer.isView(v) || (typeof length === "number" && typeof v.item === "function")) {
        const count = Array.isArray(v) ? v.length : Number(length ?? v.length);
        const items = [];
        for (let i = 0; i < Math.min(count, MAX_ITEMS); i++) {
          const slot = ArrayBuffer.isView(v) ? { value: v[i] } : own(v, i) ?? (typeof v.item === "function" ? { value: v.item(i) } : undefined);
          items.push(!slot ? "empty" : slot.accessor ? "(...)" : preview(slot.value, depth + 1));
        }
        if (count > MAX_ITEMS) items.push("…");
        return (Array.isArray(v) ? "" : name) + "(" + count + ") [" + items.join(", ") + "]";
      }
      const keys = Object.keys(v);
      const shown = keys.slice(0, 30).map(k => {
        const slot = own(v, k);
        return (/^[A-Za-z_$][\\w$]*$/.test(k) ? k : quote(k)) + ": " + (!slot ? "undefined" : slot.accessor ? "(...)" : preview(slot.value, depth + 1));
      });
      if (keys.length > 30) shown.push("…");
      return (name === "Object" ? "" : name + " ") + "{" + shown.join(", ") + "}";
    } catch (error) { return "[unpreviewable: " + error + "]"; }
  };
  const describe = (v) => v === null ? "object" : typeof v;
  try {
    const value = await run();
    try { globalThis.$_ = value; } catch {}
    return { ok: true, value: { type: describe(value), text: preview(value, 0).slice(0, 20000) } };
  } catch (error) {
    return { ok: false, error: ("Uncaught " + (error instanceof Error ? String(error.stack || error) : preview(error, 1))).slice(0, 20000) };
  }
})()`;
}

const fallbackResultSchema = z.union([z.object({ csp: z.literal(true) }), resultSchema]);

function readHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function useRepl(page: Page, tabId: string) {
  const [entries, setEntries] = useState<ReplEntry[]>([]);
  const history = useRef<string[]>(readHistory());
  const nextId = useRef(1);
  const target = useRef({ page, tabId });
  target.current = { page, tabId };

  const update = useCallback((id: number, patch: Partial<ReplEntry>) => {
    setEntries(previous => previous.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const run = useCallback(async (input: string) => {
    const source = input.trim();
    if (!source) return;
    const { page: current, tabId: currentTab } = target.current;
    const id = nextId.current++;
    history.current = [...history.current.filter(item => item !== source), source].slice(-HISTORY_LIMIT);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.current)); } catch { /* storage unavailable */ }
    setEntries(previous => [...previous, { id, time: Date.now(), input: source, state: "pending" as const }].slice(-MAX_ENTRIES));
    const settle = (result: ReplResult, note?: string) =>
      update(id, result.ok ? { state: "ok", value: result.value, note, doneTime: Date.now() } : { state: "error", error: result.error, note, doneTime: Date.now() });
    try {
      const native = nativeRepl(currentTab);
      if (native) return settle(await native(source));
      if (!current) return settle({ ok: false, error: "No page: this console needs the BB desktop browser." });
      const result = fallbackResultSchema.parse(await current.evaluate(fallbackExpression(source), { world: "main" }));
      if (!("csp" in result)) return settle(result);
      // Nothing ran: the page's CSP rejected compilation. Plain expressions can
      // still run through the SDK's evaluate, which returns JSON only.
      const value = await current.evaluate(source, { world: "main" });
      settle({ ok: true, value: { type: "json", text: value === null ? "null" : JSON.stringify(value, null, 2) ?? "undefined" } },
        "This page's CSP blocks eval: plain expressions only, JSON result. Update the BB desktop for the full console.");
    } catch (cause) {
      settle({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [update]);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, history, run, clear };
}

export type Repl = ReturnType<typeof useRepl>;
