# Browser Workbench

A BB plugin for the current in-app browser tab: native permissions, a bounded live console, DevTools, graphics profiles and capability inspection. Open **Workbench** beside the address bar.

The plugin builds against BB Plugin SDK 0.5.29. Native controls require the companion desktop/app/server/host patch. On an unpatched desktop it provides capability inspection and explicitly reports the missing extension.

## Controls

- Separate microphone, camera, MIDI, MIDI SysEx, notifications, location, clipboard, fullscreen, pointer-lock and speaker-selection grants.
- Allow, block, or restore defaults. Grants belong to this tab and exact origin; they survive same-origin reload and clear on cross-origin navigation or tab close. Third-party frames do not inherit them. Changing a grant reloads the page to terminate existing streams.
- Native console messages, including early page errors: latest 200 entries, messages/source URLs capped at 2048 characters, refreshed every second while open. Clear/filter the console or open this tab's DevTools.
- A JavaScript console in the page, like DevTools': top-level `await`, `let`/`const` that persist between entries, `$_`, DevTools helpers such as `$()`/`$$()`/`copy()`, expandable object/array/Map/Set previews that never run getters, history (↑/↓) and Ctrl+L. Each entry runs exactly once, and runs on pages whose CSP blocks `eval`. It uses the desktop's debugger session for the tab (CDP `replMode`), attached only while an entry evaluates; an agent automating the tab shares its session. Evaluations waiting more than 30 seconds are reported and left running in the page. Without the desktop extension the console falls back to `page.evaluate`: still single-run and getter-safe, but `let`/`const` don't persist and CSP-strict pages accept plain expressions only.
- Permission requests the page made and was refused appear as a banner with **Allow & reload**; microphone and camera are reported separately.
- Desktop graphics profiles for the next start: normal, WebGL-only testing (disables Chromium's WebGPU service), WebGPU-only testing (disables WebGL). Experimental web-platform features are separately opt-in. These are desktop-wide startup settings, not a renderer switch inside arbitrary applications. A page must implement its own fallback. External launch flags still apply.
- Inspect actual WebGL/WebGL2 context availability, WebGPU adapter availability, queried permissions and device API availability. Inspection does not request a device or retain GPU contexts.

MIDI permission covers the API, not individual ports. Device selection belongs to the application; this version does not claim a per-MIDI-device access filter. Persistent site grants, native permission prompts, USB/HID/serial choosers and screen-share picking are future extensions.

## Trust model

Frontend BB plugins run as trusted code in the BB app. The desktop bridge this plugin uses (`bbDesktop.browser.experimental_workbench*`) checks that the tab belongs to the calling window, not that the caller is this plugin or that it targets its own toolbar's tab. Any installed frontend plugin can therefore read any same-window tab's console, change its device grants, reload it, run code in it, or change desktop graphics settings. Install only plugins you trust. Web pages themselves have no route to these controls.

## Development

```
npm install
npm test
npm run typecheck
bb plugin build
bb plugin install . --yes
```

Use the bundled `skills/browser-workbench/SKILL.md` for the native SDK/CLI interface. `patches/README.md` describes the native patch and its maintenance boundary. No update job, desktop restart or upstream publication is performed by installing this plugin.
