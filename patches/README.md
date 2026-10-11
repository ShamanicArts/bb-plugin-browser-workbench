# Native companion patch

The plugin uses a small native control contract. The companion patch touches the Electron session handlers, native IPC, the toolbar SDK bridge, desktop broker, server/host protocol and CLI. Host protocol changes from 220 to 221. The desktop, app frontend, server and host daemon must be delivered together; dropping only a new plugin bundle into an old BB does not install the native feature.

`manifest.json` pins the tested base, patch checksum and verification commands. `maintained-base.patch` preserves the verified VCS/JJ, Codex, ACP/Cursor and WebGPU stack on upstream desktop 0.44.0; `installed-image-copy.patch` preserves the source checkout’s image-copy/lightbox change; `browser-workbench.patch` adds the new controls. All three are ordinary source patches. To prepare a disposable candidate in the existing JJ repository:

```
python3 scripts/prepare-native-patch.py \
  --source /home/shamanic/Projects/bb \
  --workspace /home/shamanic/dev/bb-stuff/browser-workbench-candidate
```

For a newer BB source revision, supply `--base REVISION`. Preparation verifies the bundle checksum, creates a separate JJ workspace and checks each ordered patch before applying it. An application conflict stops the process. It neither changes the source workspace nor installs/restarts BB. The candidate remains for inspection and normal JJ recovery. No Git staging or commits are used. Add `--verify` to run the manifest checks and native smoke automatically; use the pinned Node/pnpm toolchain and provide Xvfb.

This is automated **candidate preparation**, not a proven automatic BB updater. On updates, the preparation script first carries the existing VCS/JJ, Codex update, ACP/Cursor and WebGPU changes. `maintenance.md` records the observed stack and remaining deployment gaps. A patch applying cleanly is not acceptance: run the checks, native smoke and Jujutsu workspace tests, then verify a separately launched candidate. Preserve the last working build and activate only after verification at a controlled restart.

Graphics configuration is in the Electron user-data directory at `browser-workbench.json`. It is validated, written atomically and read before startup. Profiles are desktop-wide; no automatic restart occurs. Invalid configuration falls back to normal settings and reports a warning. Feature switches merge existing disabled features; external startup flags remain authoritative.

Run native acceptance with a virtual display (no windows on the user's desktop):

```
node scripts/smoke-native.mjs /path/to/patched/bb evidence/native-smoke.json
```

This needs Xvfb on PATH, or `BB_TEST_XVFB=/path/to/Xvfb`. It bundles the native smoke fixture against that checkout and uses its Electron dependency. The test uses fake media devices, verifies allow/deny/revoke and early console capture, and cleans its private profile/display. GPU hardware performance and physical MIDI device selection are not established by this test.
