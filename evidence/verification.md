# Local verification — 2026-10-11

Status: built and tested source candidate; not installed into the running BB desktop.

Native revision: `2ce2ef42bdb4ff6c845819f7835c86c1ccdeeb44` (JJ change `qyvxmzkwupznszxnrqkulkoxmyqlymtz`).

- Desktop build: 52 successful tasks.
- Cross-package type checking: 12 successful tasks; app/desktop checks repeated after preserving the installed clipboard customization.
- Desktop suite: 458 passed, 1 skipped.
- Image-lightbox suites: 7 passed.
- Host-workspace/Jujutsu suite: 161 passed, 1 skipped. Git mnemonic diff prefixes were disabled in the test environment only.
- Scoped contract/server/CLI suites: 6/25/4 tests passed.
- Plugin: build, type checking and 2 probe tests passed.
- Real Electron 44.3 native smoke on private Xvfb with fake media devices: default denial, microphone allowance, independent camera denial, microphone revocation and early console capture passed. See `native-smoke.json`.
- All three patch checksums verified. Replaying from the declared upstream revision produced an identical source tree to the tested native candidate. See `replay-check.json`. Its disposable replay workspace was subsequently removed; the receipt records the completed comparison.

The component screenshots use the plugin UI with a preview SDK shim and real native IPC on a private display. They are not screenshots of the user's running BB installation.

Physical MIDI/audio hardware, GPU rendering and a whole installation upgrade have not been accepted. Scheduled update discovery, automatic activation and rollback remain unimplemented. Generated installed icon changes and external plugin overlays still require provenance checks before replacing the running installation.
