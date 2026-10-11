// Bottom-dock placement inside BB's browser tab.
//
// The page is a native Electron view drawn over the HTML, so anything placed on
// top of the page area is hidden. BB sizes that view from its page-area element
// (`[data-app-browser] > div.relative.flex-1`) with a ResizeObserver. Inserting
// our host as the next flex sibling shrinks the page area; BB then shrinks the
// native view and the dock occupies the freed space.
//
// This depends on BB internals. When the structure isn't found, `findDockHost`
// returns a reason and the caller falls back to a dialog.

export const BOUNDS_SYNC_EVENT = "bb:browser-view-bounds-sync";
const HOST_ATTRIBUTE = "data-bb-workbench-dock";
const PLUGIN_ID = "browser-workbench";

export type DockHostResult =
  | { ok: true; root: HTMLElement; pageArea: HTMLElement }
  | { ok: false; reason: string };

export function findDockHost(anchor: Element | null): DockHostResult {
  if (anchor === null) return { ok: false, reason: "toolbar action not mounted" };
  const root = anchor.closest<HTMLElement>("[data-app-browser]");
  if (root === null) return { ok: false, reason: "no [data-app-browser] ancestor around the toolbar" };
  const pageArea = Array.from(root.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.hasAttribute(HOST_ATTRIBUTE) &&
      child.classList.contains("relative") &&
      child.classList.contains("flex-1"),
  );
  if (pageArea === undefined) return { ok: false, reason: "browser page area (div.relative.flex-1) not found" };
  return { ok: true, root, pageArea };
}

/** Create the dock element right after the page area; returns a disposer. */
export function mountDockHost(pageArea: HTMLElement): { element: HTMLElement; dispose: () => void } {
  const element = document.createElement("div");
  element.setAttribute(HOST_ATTRIBUTE, "");
  // The portal leaves BB's plugin wrapper; these put it back in the plugin's CSS scope.
  element.setAttribute("data-bb-plugin-root", "");
  element.setAttribute("data-bb-plugin", PLUGIN_ID);
  element.style.cssText = "flex:none;position:relative;display:flex;flex-direction:column;min-height:0";
  pageArea.after(element);
  syncBrowserBounds();
  return {
    element,
    dispose() {
      element.remove();
      syncBrowserBounds();
    },
  };
}

export function syncBrowserBounds(): void {
  window.dispatchEvent(new Event(BOUNDS_SYNC_EVENT));
}
