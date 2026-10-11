import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, type ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { findDockHost, mountDockHost, syncBrowserBounds } from "@/lib/dock-host";
import { useWorkbench, type Workbench } from "@/lib/use-workbench";
import { useRepl, type Repl } from "@/lib/repl";
import {
  ConsolePane, GraphicsPane, InspectPane, NeedsPatchedDesktop, PermissionsPane, ToolButton, blockedRequests, levelCounts,
} from "@/components/workbench/panes";

type Props = ExperimentalPluginBrowserToolbarActionProps;
type Pane = "console" | "permissions" | "graphics" | "inspect";

const STORAGE = { open: "bb-workbench:open", height: "bb-workbench:height", pane: "bb-workbench:pane" } as const;
const MIN_HEIGHT = 140;
const DEFAULT_HEIGHT = 280;
const MAX_FRACTION = 0.7;

function readStored<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
const isPane = (value: string): value is Pane => ["console", "permissions", "graphics", "inspect"].includes(value);

function BrowserWorkbench(props: Props) {
  const { experimental_page: page, tabId, url } = props;
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpenState] = useState(() => readStored(STORAGE.open, raw => raw === "1", false));
  const [pane, setPaneState] = useState<Pane>(() => readStored(STORAGE.pane, raw => (isPane(raw) ? raw : null), "console"));
  const [host, setHost] = useState<{ element: HTMLElement; root: HTMLElement } | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [seenSequence, setSeenSequence] = useState(0);
  const workbench = useWorkbench(page, tabId, open);
  const repl = useRepl(page, tabId);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    store(STORAGE.open, next ? "1" : "0");
  }, []);
  const setPane = useCallback((next: Pane) => {
    setPaneState(next);
    store(STORAGE.pane, next);
  }, []);

  // Mount the dock host beside BB's page area while open.
  useLayoutEffect(() => {
    if (!open) return;
    const found = findDockHost(anchor.current);
    if (!found.ok) {
      console.warn("[browser-workbench] bottom dock unavailable, using dialog:", found.reason);
      setHostError(found.reason);
      return;
    }
    setHostError(null);
    const mounted = mountDockHost(found.pageArea);
    setHost({ element: mounted.element, root: found.root });
    return () => {
      setHost(null);
      mounted.dispose();
    };
  }, [open, tabId]);

  // Unseen errors are counted by sequence, so the bounded native buffer evicting
  // old entries can't hide new ones.
  const entries = workbench.snapshot?.console ?? [];
  const latestSequence = entries.at(-1)?.sequence ?? 0;
  const viewingConsole = open && pane === "console";
  useEffect(() => setSeenSequence(0), [tabId]);
  useEffect(() => {
    if (viewingConsole) setSeenSequence(previous => Math.max(previous, latestSequence));
  }, [viewingConsole, latestSequence]);
  const unseenErrors = entries.filter(entry => entry.level === "error" && entry.sequence > seenSequence).length;
  const blocked = workbench.snapshot ? blockedRequests(workbench.snapshot).length : 0;

  const panel = (
    <WorkbenchPanel
      {...props}
      workbench={workbench}
      repl={repl}
      pane={pane}
      onPane={setPane}
      onClose={() => setOpen(false)}
    />
  );

  return (
    <span ref={anchor} className="flex items-center">
      <button
        type="button"
        aria-label="Browser Workbench"
        aria-pressed={open}
        title="Browser Workbench — console, permissions, graphics"
        onClick={() => setOpen(!open)}
        className={cn(
          "relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
          open && "bg-state-active text-foreground",
        )}
      >
        <Icon name="PanelBottom" fallback="Terminal" className="size-4" aria-hidden />
        {unseenErrors > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-[3px] text-[9px] font-semibold tabular-nums text-destructive-foreground">
            {unseenErrors > 99 ? "99+" : unseenErrors}
          </span>
        ) : blocked > 0 ? (
          <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning" aria-label="Blocked permission requests" />
        ) : null}
      </button>
      {open && host && createPortal(<DockFrame root={host.root} element={host.element}>{panel}</DockFrame>, host.element)}
      {open && hostError && (
        <Dialog open onOpenChange={next => !next && setOpen(false)}>
          <DialogContent className="flex h-[70vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Browser Workbench</DialogTitle>
              <DialogDescription>Shown as a dialog because the bottom dock couldn't attach: {hostError}</DialogDescription>
            </DialogHeader>
            {panel}
            <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-subtle-foreground">
              Bottom dock unavailable in this BB build ({hostError}), so Workbench opened as a dialog.
            </p>
          </DialogContent>
        </Dialog>
      )}
    </span>
  );
}

/** Sizes the dock host and provides the drag-to-resize handle. */
function DockFrame({ root, element, children }: { root: HTMLElement; element: HTMLElement; children: ReactNode }) {
  const [height, setHeight] = useState(() => readStored(STORAGE.height, raw => (Number.isFinite(Number(raw)) ? Number(raw) : null), DEFAULT_HEIGHT));
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const clamp = useCallback((value: number) => {
    const max = Math.max(MIN_HEIGHT, Math.round(root.clientHeight * MAX_FRACTION));
    return Math.min(max, Math.max(MIN_HEIGHT, Math.round(value)));
  }, [root]);

  useLayoutEffect(() => {
    const apply = () => {
      const next = `${clamp(height)}px`;
      if (element.style.height === next) return;
      element.style.height = next;
      syncBrowserBounds();
    };
    apply();
    // The 70% cap depends on the browser area, so re-apply it when that resizes.
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    return () => observer.disconnect();
  }, [element, root, height, clamp]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: clamp(height) };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setHeight(clamp(drag.current.startHeight + (drag.current.startY - event.clientY)));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    store(STORAGE.height, String(clamp(height)));
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-background text-foreground">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Workbench"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => { setHeight(DEFAULT_HEIGHT); store(STORAGE.height, String(DEFAULT_HEIGHT)); }}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none hover:bg-ring/30"
      />
      {children}
    </div>
  );
}

const PANES: { id: Pane; label: string; icon: string }[] = [
  { id: "console", label: "Console", icon: "Terminal" },
  { id: "permissions", label: "Permissions", icon: "SecurityCheck" },
  { id: "graphics", label: "Graphics", icon: "Palette" },
  { id: "inspect", label: "Inspect", icon: "Target" },
];

function WorkbenchPanel({ experimental_page: page, url, workbench, repl, pane, onPane, onClose }: Props & {
  workbench: Workbench; repl: Repl; pane: Pane; onPane: (pane: Pane) => void; onClose: () => void;
}) {
  const snapshot = workbench.snapshot;
  const counts = levelCounts(snapshot?.console ?? []);
  const blocked = snapshot ? blockedRequests(snapshot).length : 0;
  const origin = snapshot?.origin && snapshot.origin !== "null" ? snapshot.origin : url;

  const badge = (id: Pane) => {
    if (id === "console" && counts.error > 0) return <span className="rounded-full bg-surface-destructive px-1.5 text-[10px] tabular-nums text-destructive-text">{counts.error}</span>;
    if (id === "console" && counts.warning > 0) return <span className="rounded-full bg-warning/15 px-1.5 text-[10px] tabular-nums text-warning-text">{counts.warning}</span>;
    if (id === "permissions" && blocked > 0) return <span className="size-1.5 rounded-full bg-warning" />;
    if (id === "graphics" && snapshot?.graphics?.restartRequired) return <span className="size-1.5 rounded-full bg-warning" />;
    return null;
  };

  const clearConsole = () => {
    repl.clear();
    if (workbench.available) void workbench.run({ kind: "clear-console" });
  };

  let body;
  if (pane === "inspect") body = <InspectPane page={page} url={url} />;
  else if (pane === "console" && !workbench.available) body = <ConsolePane entries={[]} repl={repl} onClear={clearConsole} />;
  else if (!workbench.available) body = <NeedsPatchedDesktop />;
  else if (!snapshot) body = <div className="flex flex-1 items-center justify-center text-xs text-subtle-foreground">{workbench.error ?? "Connecting to this tab…"}</div>;
  else if (pane === "console") body = <ConsolePane entries={snapshot.console} repl={repl} onClear={clearConsole} />;
  else if (pane === "permissions") body = <PermissionsPane snapshot={snapshot} workbench={workbench} />;
  else body = <GraphicsPane snapshot={snapshot} workbench={workbench} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-surface-recessed px-1.5">
        <div role="tablist" aria-label="Workbench" className="flex items-center gap-0.5">
          {PANES.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={pane === item.id}
              onClick={() => onPane(item.id)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                pane === item.id ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              <Icon name={item.icon} fallback="Circle" className="size-3.5" aria-hidden />
              {item.label}
              {badge(item.id)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          <span className="mr-1 min-w-0 truncate font-mono text-[11px] text-subtle-foreground" title={origin}>{origin}</span>
          {pane === "console" && (
            <ToolButton icon="Clean" title="Clear console (Ctrl+L)" disabled={workbench.pending} onClick={clearConsole} />
          )}
          {workbench.available && (
            <ToolButton icon="Code" label="DevTools" title="Open DevTools for this tab" disabled={workbench.pending} onClick={() => void workbench.run({ kind: "open-devtools" })} />
          )}
          <ToolButton icon="X" title="Close Workbench" onClick={onClose} />
        </div>
      </div>
      {workbench.error && snapshot && (
        <p role="alert" className="shrink-0 border-b border-surface-destructive-border bg-surface-destructive px-3 py-1 text-[11px] text-destructive-text">{workbench.error}</p>
      )}
      {body}
    </div>
  );
}

export default definePluginApp(app => {
  app.slots.experimental_browserToolbarAction({ id: "workbench", title: "Browser Workbench", component: BrowserWorkbench });
});
