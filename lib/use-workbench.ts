import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { browserWorkbenchSnapshotSchema, type BrowserWorkbenchAction, type BrowserWorkbenchSnapshot } from "./native";

type Page = ExperimentalPluginBrowserToolbarActionProps["experimental_page"];
export type NativeWorkbenchCall = (action: BrowserWorkbenchAction) => Promise<unknown>;
type DesktopWorkbenchBridge = { browser?: { experimental_workbench?: (request: { tabId: string; action: BrowserWorkbenchAction }) => Promise<unknown> } };

// Prefer the page handle (patched app frontend). When only the desktop shell is
// patched — the frontend is served by the running server and stays stock until
// that restarts — call the desktop preload bridge directly with this tab's id.
export function resolveNativeWorkbench(page: Page, tabId: string): NativeWorkbenchCall | null {
  if (page && "experimental_workbench" in page && typeof page.experimental_workbench === "function") {
    return page.experimental_workbench.bind(page) as NativeWorkbenchCall;
  }
  const bridge = (window as unknown as { bbDesktop?: DesktopWorkbenchBridge }).bbDesktop?.browser;
  const call = bridge?.experimental_workbench;
  return page && call ? action => call.call(bridge, { tabId, action }) : null;
}

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 4000;

/** Native snapshot for one tab: fast polling while the dock is open, slow for the toolbar badge. */
export function useWorkbench(page: Page, tabId: string, active: boolean) {
  const call = resolveNativeWorkbench(page, tabId);
  const available = call !== null;
  const [snapshot, setSnapshot] = useState<BrowserWorkbenchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setSnapshot(null);
    setError(null);
  }, [tabId]);

  useEffect(() => {
    const resolved = resolveNativeWorkbench(page, tabId);
    if (!resolved) return;
    const native: NativeWorkbenchCall = resolved;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      const request = generation.current;
      try {
        const value = browserWorkbenchSnapshotSchema.parse(await native({ kind: "snapshot" }));
        if (!disposed && request === generation.current) {
          setSnapshot(value);
          setError(null);
        }
      } catch (cause) {
        if (!disposed && request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) timer = setTimeout(refresh, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [page, tabId, active]);

  const run = useCallback(async (action: BrowserWorkbenchAction) => {
    const native = resolveNativeWorkbench(page, tabId);
    if (!native) return;
    const request = ++generation.current;
    setPending(true);
    setError(null);
    try {
      const value = browserWorkbenchSnapshotSchema.parse(await native(action));
      if (request === generation.current) setSnapshot(value);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setPending(false);
    }
  }, [page, tabId]);

  return { available, snapshot, error, pending, run };
}

export type Workbench = ReturnType<typeof useWorkbench>;
