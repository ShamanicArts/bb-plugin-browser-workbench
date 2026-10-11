import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { browserPermissionSchema, type BrowserPermission, type BrowserWorkbenchSnapshot } from "@/lib/native";
import { probeExpression, probeSchema, type Probe } from "@/lib/probe";
import type { Workbench } from "@/lib/use-workbench";
import type { Repl, ReplEntry } from "@/lib/repl";
import { ReplValueView } from "@/components/workbench/repl-value";
import { previewSummary } from "@/lib/repl-format";

type ConsoleEntry = BrowserWorkbenchSnapshot["console"][number];
type Level = ConsoleEntry["level"];

// --- shared atoms ---------------------------------------------------------

export function ToolButton({ icon, label, onClick, disabled, active, title }: {
  icon?: string; label?: string; onClick: () => void; disabled?: boolean; active?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors",
        "hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        active && "bg-state-active text-foreground",
      )}
    >
      {icon && <Icon name={icon} fallback="Circle" className="size-3.5" aria-hidden />}
      {label && <span>{label}</span>}
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled, label }: {
  value: T; options: { value: T; label: string; tone?: "allow" | "block" }[]; onChange: (value: T) => void; disabled?: boolean; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md border border-border bg-surface-recessed p-0.5">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              "h-5 rounded-[5px] px-2 text-[11px] font-medium transition-colors disabled:opacity-50",
              selected
                ? option.tone === "allow" ? "bg-success/15 text-success" : option.tone === "block" ? "bg-destructive/15 text-destructive-text" : "bg-surface-raised text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1.5 px-6 text-center">
      <Icon name={icon} fallback="Circle" className="size-5 text-subtle-foreground" aria-hidden />
      <p className="text-xs font-medium text-foreground">{title}</p>
      {children && <p className="max-w-md text-[11px] text-muted-foreground">{children}</p>}
    </div>
  );
}

function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{children}</h3>
      {aside}
    </div>
  );
}

export function NeedsPatchedDesktop() {
  return (
    <Empty icon="ElectricPlugs" title="This BB desktop has no Workbench extension">
      Console capture, permissions and graphics profiles need the patched BB desktop shell. Inspect still works.
    </Empty>
  );
}

// --- console --------------------------------------------------------------

const LEVELS: { level: Level; label: string; className: string; icon: string }[] = [
  { level: "error", label: "Errors", className: "text-destructive-text", icon: "CircleX" },
  { level: "warning", label: "Warnings", className: "text-warning-text", icon: "AlertTriangle" },
  { level: "info", label: "Info", className: "text-muted-foreground", icon: "Info" },
  { level: "debug", label: "Debug", className: "text-subtle-foreground", icon: "Bug" },
];

export function levelCounts(entries: readonly ConsoleEntry[]): Record<Level, number> {
  const counts: Record<Level, number> = { error: 0, warning: 0, info: 0, debug: 0 };
  for (const entry of entries) counts[entry.level]++;
  return counts;
}

function formatTime(time: number): string {
  const date = new Date(time);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function shortSource(source: string, line: number): string {
  if (!source) return "";
  let label = source;
  try {
    const url = new URL(source);
    label = url.pathname.split("/").filter(Boolean).pop() || url.host;
  } catch { /* not a URL */ }
  return line > 0 ? `${label}:${line}` : label;
}

/** Collapse consecutive identical messages into one row with a repeat count. */
function collapse(entries: readonly ConsoleEntry[]) {
  const rows: { entry: ConsoleEntry; count: number }[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (last && last.entry.level === entry.level && last.entry.message === entry.message && last.entry.source === entry.source && last.entry.line === entry.line) {
      last.count++;
      last.entry = entry;
    } else {
      rows.push({ entry, count: 1 });
    }
  }
  return rows;
}

type TimelineRow =
  | { type: "log"; time: number; key: string; entry: ConsoleEntry; count: number }
  | { type: "input"; time: number; key: string; entry: ReplEntry }
  | { type: "result"; time: number; key: string; entry: ReplEntry };

export function ConsolePane({ entries, repl, onClear }: { entries: readonly ConsoleEntry[]; repl: Repl; onClear: () => void }) {
  const [hidden, setHidden] = useState<ReadonlySet<Level>>(() => new Set<Level>(["debug"]));
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const counts = useMemo(() => levelCounts(entries), [entries]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const logs: TimelineRow[] = collapse(entries.filter(entry =>
      !hidden.has(entry.level) && (!needle || `${entry.message} ${entry.source}`.toLowerCase().includes(needle))))
      .map(({ entry, count }) => ({ type: "log", time: entry.time, key: `log-${entry.sequence}`, entry, count }));
    const inputs: TimelineRow[] = repl.entries
      .filter(entry => !needle || `${entry.input} ${entry.error ?? ""} ${entry.value ? (entry.value.preview ? previewSummary(entry.value.preview) : entry.value.text) : ""}`.toLowerCase().includes(needle))
      .flatMap((entry): TimelineRow[] => [
        { type: "input", time: entry.time, key: `in-${entry.id}`, entry },
        // Results sort by completion, so logs printed while the code ran come first.
        { type: "result", time: entry.doneTime ?? Number.MAX_SAFE_INTEGER, key: `out-${entry.id}`, entry },
      ]);
    return [...logs, ...inputs].sort((a, b) => a.time - b.time);
  }, [entries, hidden, query, repl.entries]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [rows]);

  const toggle = (level: Level) => setHidden(previous => {
    const next = new Set(previous);
    if (next.has(level)) next.delete(level); else next.add(level);
    return next;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-hairline px-2 py-1">
        <div className="relative min-w-0 max-w-64 flex-1">
          <Icon name="Search" fallback="Circle" className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter"
            aria-label="Filter console"
            className="h-6 w-full rounded-md border border-border bg-surface-recessed pl-6 pr-2 text-xs text-foreground placeholder:text-subtle-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {LEVELS.map(({ level, label, className, icon }) => (
          <button
            key={level}
            type="button"
            aria-pressed={!hidden.has(level)}
            onClick={() => toggle(level)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors hover:bg-state-hover",
              hidden.has(level) ? "text-subtle-foreground line-through decoration-subtle-foreground/50" : "text-foreground",
            )}
          >
            <Icon name={icon} fallback="Circle" className={cn("size-3", !hidden.has(level) && className)} aria-hidden />
            {label}
            <span className="tabular-nums text-subtle-foreground">{counts[level]}</span>
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        role="log"
        aria-label="Browser console"
        onScroll={event => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto font-mono text-[11.5px] leading-[1.45]"
      >
        {rows.length === 0 ? (
          <Empty icon="Terminal" title={entries.length === 0 ? "No console messages yet" : "No messages match the filter"}>
            {entries.length === 0 ? "Messages from this tab appear here, including errors thrown while the page loads. Run JavaScript in the page below." : undefined}
          </Empty>
        ) : rows.map(row => {
          if (row.type === "input") return <ReplInputRow key={row.key} entry={row.entry} />;
          if (row.type === "result") return <ReplResultRow key={row.key} entry={row.entry} />;
          const { entry, count } = row;
          const meta = LEVELS.find(item => item.level === entry.level)!;
          return (
            <div
              key={row.key}
              className={cn(
                "group flex gap-2 border-b border-border-hairline px-3 py-[3px]",
                entry.level === "error" && "bg-surface-destructive",
                entry.level === "warning" && "bg-warning/5",
              )}
            >
              <Icon name={meta.icon} fallback="Circle" className={cn("mt-[3px] size-3 shrink-0", meta.className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <span className={cn("whitespace-pre-wrap break-words", entry.level === "error" ? "text-destructive-text" : entry.level === "warning" ? "text-warning-text" : "text-foreground")}>
                  {entry.message}
                </span>
                {count > 1 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-state-active px-1 align-[1px] text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </div>
              <span className="shrink-0 truncate text-right text-[10.5px] text-subtle-foreground" title={entry.source ? `${entry.source}:${entry.line}` : undefined}>
                {shortSource(entry.source, entry.line)}
                <span className="ml-2 opacity-0 transition-opacity group-hover:opacity-100">{formatTime(entry.time)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <ConsolePrompt
        repl={repl}
        onClear={onClear}
        onSubmit={() => { stick.current = true; }}
      />
    </div>
  );
}

function ReplInputRow({ entry }: { entry: ReplEntry }) {
  return (
    <div className="flex gap-2 border-b border-border-hairline px-3 py-[3px]">
      <Icon name="ChevronRight" fallback="Circle" className="mt-[3px] size-3 shrink-0 text-primary" aria-hidden />
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-foreground">{entry.input}</pre>
    </div>
  );
}

function ReplResultRow({ entry }: { entry: ReplEntry }) {
  return (
    <div className={cn("flex gap-2 border-b border-border-hairline px-3 py-[3px]", entry.state === "error" && "bg-surface-destructive")}>
      <Icon
        name={entry.state === "pending" ? "Loading" : entry.state === "error" ? "CircleX" : "ChevronLeft"}
        fallback="Circle"
        className={cn("mt-[3px] size-3 shrink-0", entry.state === "error" ? "text-destructive-text" : "text-subtle-foreground", entry.state === "pending" && "animate-spin")}
        aria-hidden
      />
      <div className="min-w-0 flex-1 font-mono">
        {entry.state === "pending" ? <span className="text-subtle-foreground">…</span>
          : entry.state === "error" ? <pre className="whitespace-pre-wrap break-words font-mono text-destructive-text">{entry.error}</pre>
            : entry.value && <ReplValueView value={entry.value} />}
        {entry.note && <div className="pt-0.5 font-sans text-[11px] text-warning-text">{entry.note}</div>}
      </div>
    </div>
  );
}

function ConsolePrompt({ repl, onClear, onSubmit }: { repl: Repl; onClear: () => void; onSubmit: () => void }) {
  const [draft, setDraft] = useState("");
  const cursor = useRef<number | null>(null); // index into history while browsing
  const stash = useRef("");
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  const recall = (direction: -1 | 1) => {
    const items = repl.history.current;
    if (items.length === 0) return false;
    if (cursor.current === null) {
      if (direction === 1) return false;
      stash.current = draft;
      cursor.current = items.length - 1;
    } else {
      const next = cursor.current + direction;
      if (next >= items.length) {
        cursor.current = null;
        setDraft(stash.current);
        return true;
      }
      cursor.current = Math.max(0, next);
    }
    setDraft(items[cursor.current] ?? "");
    return true;
  };

  return (
    <div className="flex shrink-0 items-start gap-2 border-t border-border bg-surface-recessed px-3 py-1.5">
      <Icon name="ChevronRight" fallback="Circle" className="mt-[3px] size-3.5 shrink-0 text-primary" aria-hidden />
      <textarea
        ref={input}
        rows={1}
        value={draft}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Run JavaScript in this page"
        placeholder="Run JavaScript in this page — Enter to run, Shift+Enter for a new line, ↑ for history"
        onChange={event => { setDraft(event.target.value); cursor.current = null; }}
        onKeyDown={event => {
          const element = event.currentTarget;
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!draft.trim()) return;
            onSubmit();
            void repl.run(draft);
            setDraft("");
            cursor.current = null;
          } else if (event.key === "ArrowUp" && !element.value.slice(0, element.selectionStart).includes("\n")) {
            if (recall(-1)) event.preventDefault();
          } else if (event.key === "ArrowDown" && !element.value.slice(element.selectionEnd).includes("\n")) {
            if (recall(1)) event.preventDefault();
          } else if (event.key === "l" && event.ctrlKey) {
            event.preventDefault();
            onClear();
          }
        }}
        className="min-h-5 flex-1 resize-none bg-transparent font-mono text-[12px] leading-5 text-foreground placeholder:text-subtle-foreground focus:outline-none"
      />
    </div>
  );
}

// --- permissions ----------------------------------------------------------

const PERMISSION_GROUPS: { title: string; items: { permission: BrowserPermission; label: string; hint?: string }[] }[] = [
  {
    title: "Media",
    items: [
      { permission: "microphone", label: "Microphone" },
      { permission: "camera", label: "Camera" },
      { permission: "speaker-selection", label: "Speaker selection", hint: "Choose audio outputs" },
    ],
  },
  {
    title: "MIDI",
    items: [
      { permission: "midi", label: "MIDI", hint: "Whole API, not individual ports" },
      { permission: "midiSysex", label: "MIDI SysEx" },
    ],
  },
  {
    title: "Other",
    items: [
      { permission: "notifications", label: "Notifications" },
      { permission: "geolocation", label: "Location" },
      { permission: "clipboard-read", label: "Clipboard read" },
      { permission: "clipboard-sanitized-write", label: "Clipboard write" },
      { permission: "fullscreen", label: "Fullscreen" },
      { permission: "pointerLock", label: "Pointer lock" },
    ],
  },
];

const DECISIONS = [
  { value: "default" as const, label: "Default" },
  { value: "allow" as const, label: "Allow", tone: "allow" as const },
  { value: "block" as const, label: "Block", tone: "block" as const },
];

function timeAgo(time: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** Denied requests for the current origin (older desktops report full URLs and "media"). */
export function blockedRequests(snapshot: BrowserWorkbenchSnapshot) {
  return snapshot.denied
    .filter(item => originOf(item.origin) === snapshot.origin)
    .map(item => ({ ...item, permission: item.permission === "media" ? "microphone or camera" : item.permission }));
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function PermissionsPane({ snapshot, workbench }: { snapshot: BrowserWorkbenchSnapshot; workbench: Workbench }) {
  const origin = snapshot.origin;
  const editable = origin !== "null" && !workbench.pending;
  const byPermission = new Map(snapshot.permissions.map(item => [item.permission, item]));
  const blocked = blockedRequests(snapshot);

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-3">
      {blocked.length > 0 && (
        <div className="mx-3 mt-3 rounded-md border border-surface-destructive-border bg-surface-destructive">
          <div className="flex items-center gap-1.5 px-2.5 pt-2 text-xs font-medium text-destructive-text">
            <Icon name="AlertTriangle" fallback="Circle" className="size-3.5" aria-hidden />
            This page asked for access and was blocked
          </div>
          <ul className="px-2.5 pb-2 pt-1">
            {[...new Map(blocked.map(item => [item.permission, item])).values()].map(item => {
              const parsed = browserPermissionSchema.safeParse(item.permission);
              return (
                <li key={item.permission} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                  <span className="text-foreground">{item.permission} <span className="text-subtle-foreground">· {timeAgo(item.time)}</span></span>
                  {parsed.success && (
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => void workbench.run({ kind: "set-permission", origin, permission: parsed.data, decision: "allow" })}
                      className="h-5 rounded-[5px] bg-success/15 px-2 text-[11px] font-medium text-success hover:bg-success/25 disabled:opacity-50"
                    >
                      Allow & reload
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {PERMISSION_GROUPS.map(group => (
        <section key={group.title}>
          <SectionLabel>{group.title}</SectionLabel>
          <div className="mx-3 divide-y divide-border-hairline rounded-md border border-border">
            {group.items.map(({ permission, label, hint }) => {
              const state = byPermission.get(permission);
              if (!state) return null;
              return (
                <div key={permission} className="flex items-center gap-3 px-2.5 py-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", state.allowed ? "bg-success" : "bg-subtle-foreground/40")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-foreground">{label}</div>
                    {hint && <div className="text-[11px] text-subtle-foreground">{hint}</div>}
                  </div>
                  <span className={cn("text-[11px]", state.allowed ? "text-success" : "text-subtle-foreground")}>
                    {state.allowed ? "Allowed" : "Blocked"}
                  </span>
                  <Segmented
                    label={label}
                    value={state.decision}
                    options={DECISIONS}
                    disabled={!editable}
                    onChange={decision => void workbench.run({ kind: "set-permission", origin, permission, decision })}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className="flex items-center justify-between gap-3 px-3 pt-3">
        <p className="text-[11px] text-muted-foreground">
          Grants apply to <span className="font-mono text-foreground">{origin}</span> in this tab. Changing one reloads the page so revoked streams stop. Embedded third-party frames stay blocked.
        </p>
        <ToolButton icon="RotateCcw" label="Reset all" disabled={!editable} onClick={() => void workbench.run({ kind: "reset-permissions", origin })} />
      </div>
    </div>
  );
}

// --- graphics -------------------------------------------------------------

const PROFILES = [
  { value: "default" as const, label: "Normal" },
  { value: "webgl-only" as const, label: "WebGL only" },
  { value: "webgpu-only" as const, label: "WebGPU only" },
];

const PROFILE_HELP: Record<(typeof PROFILES)[number]["value"], string> = {
  default: "Both WebGL and WebGPU are available; the page picks its renderer.",
  "webgl-only": "Disables Chromium's WebGPU service, to test a page's WebGL fallback.",
  "webgpu-only": "Disables WebGL, to check a page doesn't silently fall back to it.",
};

export function GraphicsPane({ snapshot, workbench }: { snapshot: BrowserWorkbenchSnapshot; workbench: Workbench }) {
  const graphics = snapshot.graphics;
  if (!graphics) return <Empty icon="Palette" title="Graphics profiles aren't available on this desktop" />;
  const requested = graphics.requested;
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-3">
      {graphics.restartRequired && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning-text">
          <Icon name="ArrowReloadHorizontal" fallback="Circle" className="size-3.5 shrink-0" aria-hidden />
          Restart the BB desktop app to apply these settings. Your server and agents keep running.
        </div>
      )}
      <SectionLabel>Renderer profile</SectionLabel>
      <div className="mx-3 rounded-md border border-border px-2.5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Graphics profile"
            value={requested.profile}
            options={PROFILES}
            disabled={workbench.pending}
            onChange={profile => void workbench.run({ kind: "set-graphics", settings: { ...requested, profile } })}
          />
          <span className="text-[11px] text-subtle-foreground">
            Running now: <span className="text-foreground">{PROFILES.find(item => item.value === graphics.active.profile)?.label}</span>
          </span>
        </div>
        <p className="pt-1.5 text-[11px] text-muted-foreground">{PROFILE_HELP[requested.profile]}</p>
      </div>
      <SectionLabel>Features</SectionLabel>
      <label className="mx-3 flex cursor-pointer items-center gap-3 rounded-md border border-border px-2.5 py-2">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={requested.experimentalWebPlatform}
          disabled={workbench.pending}
          onChange={event => void workbench.run({ kind: "set-graphics", settings: { ...requested, experimentalWebPlatform: event.target.checked } })}
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-foreground">Experimental web-platform features</div>
          <div className="text-[11px] text-subtle-foreground">Chromium's experimental APIs, for every tab, from the next launch.</div>
        </div>
        <span className="text-[11px] text-subtle-foreground">Running: {graphics.active.experimentalWebPlatform ? "on" : "off"}</span>
      </label>
      {graphics.warning && <p className="px-3 pt-2 text-[11px] text-warning-text">{graphics.warning}</p>}
      <p className="px-3 pt-3 text-[11px] text-muted-foreground">
        Profiles apply to the whole desktop app at its next start, not to one tab. Launch flags passed to BB still win.
      </p>
    </div>
  );
}

// --- inspect --------------------------------------------------------------

type Page = ExperimentalPluginBrowserToolbarActionProps["experimental_page"];

function stateTone(value: string): string {
  if (/^(Available|Adapter available|granted)$/.test(value)) return "text-success";
  if (/^(denied|Unavailable|No adapter|API unavailable)$/.test(value) || /failed/i.test(value)) return "text-destructive-text";
  if (/Fallback|prompt/.test(value)) return "text-warning-text";
  return "text-muted-foreground";
}

export function InspectPane({ page, url }: { page: Page; url: string }) {
  const [result, setResult] = useState<Probe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setResult(null);
    setError(null);
    setRunning(false);
  }, [url, page]);

  async function inspect() {
    if (!page || running) return;
    const request = ++generation.current;
    setRunning(true);
    setError(null);
    try {
      const value = probeSchema.parse(await page.evaluate(probeExpression));
      if (request === generation.current) setResult(value);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setRunning(false);
    }
  }

  const rows: { group: string; items: [string, string][] }[] = result ? [
    { group: "Graphics", items: [["WebGL", result.webgl], ["WebGL 2", result.webgl2], ["WebGPU", result.webgpu]] },
    { group: "Device APIs", items: [["Media devices", result.media ? "Available" : "Unavailable"], ["Web MIDI", result.midi ? "Available" : "Unavailable"]] },
    { group: "Page-reported permissions", items: result.permissions.map(item => [item.name, item.state] as [string, string]) },
  ] : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-3">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          disabled={!page || running}
          onClick={() => void inspect()}
          className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Icon name="Target" fallback="Search" className="size-3.5" aria-hidden />
          {running ? "Inspecting…" : result ? "Inspect again" : "Inspect this page"}
        </button>
        <span className="text-[11px] text-subtle-foreground">Read-only: no device prompts, GPU contexts are released.</span>
      </div>
      {!page && <p className="px-3 pt-2 text-xs text-muted-foreground">Page inspection needs the BB desktop browser.</p>}
      {error && <p role="alert" className="px-3 pt-2 text-xs text-destructive-text">{error}</p>}
      {result && (
        <>
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground">{result.origin}</span> · {result.secure ? "secure context" : "insecure context — many device APIs are disabled"}
          </p>
          <div className="grid gap-x-3 px-3 sm:grid-cols-3">
            {rows.map(section => (
              <section key={section.group}>
                <h3 className="pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{section.group}</h3>
                <dl className="divide-y divide-border-hairline rounded-md border border-border">
                  {section.items.map(([name, value]) => (
                    <div key={name} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                      <dt className="text-foreground">{name}</dt>
                      <dd className={stateTone(value)}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="px-3 pt-3 text-[11px] text-muted-foreground">
            Capability checks, not the page's active renderer. What the page reports can differ from BB's native permission policy.
          </p>
        </>
      )}
    </div>
  );
}
