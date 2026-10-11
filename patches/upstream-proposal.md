# Draft: Native browser permissions and developer diagnostics

Local draft only; no upstream submission has been made.

## Workflow

An agent builds a local audio/MIDI/WebGL/WebGPU application. The user opens it in BB's native browser and needs to grant microphone or MIDI access, revoke it later, and inspect errors from that exact tab.

## Observed behavior

On the tested custom BB desktop 0.44.0 baseline, `isAllowedBrowserPermission()` allows only sanitized clipboard writes. Both Electron permission handlers apply that fixed policy. Calling `getUserMedia({audio:true})` fails with `NotAllowedError`; there is no user control for granting it. The browser toolbar plugin hook supports page evaluation, but not host permission decisions or native console access.

This has been reproduced with BB's actual native view manager under Electron 44.3.0 in an isolated virtual display using fake media devices. It has not yet been reproduced against the latest upstream release; that check is required before filing as a current upstream bug.

## Proposed host capability

Expose bounded, scoped native browser controls through the toolbar SDK, desktop broker and CLI:

- Read and edit explicit tab-origin grants, with separate audio/video checks and no third-party inheritance.
- Reload on permission changes so revocation terminates existing streams.
- Read a bounded native console buffer, including early load errors, and clear it.
- Open DevTools for the selected browser tab on explicit user action.

A separate Browser Workbench plugin supplies the UI. Native host policy and enforcement remain in BB. Persistent site settings, prompts and device choosers can be designed with maintainers rather than pretending a plugin can implement those outside Electron.

The local prototype also includes desktop startup graphics profiles. Those can be split out of the first upstream proposal to keep permission/console review focused. WebGPU/WebGL selection inside an arbitrary application is not a browser-global renderer toggle.

## Verification

The native smoke test demonstrates microphone denied → allowed (one fake audio track) → revoked, with camera denied throughout. It also proves capture of an early page error and rejection of an edit for a stale origin. Policy tests cover origin/tab isolation, ambiguous media, MIDI versus SysEx and bounded logs. Scoped desktop and SDK/server/CLI tests and typechecks pass; desktop and standalone plugin builds pass. Production rollout and latest-upstream reproduction are separate from these local checks.

## Contribution coordination

Searches for browser permissions, microphone and DevTools did not identify an exact matching issue; repeat at filing time. Follow the current feature-issue/sign-off and approved-contributor requirements in CONTRIBUTING.md. Discuss desired native UX and contract scope before opening a PR.

For the separately maintained Jujutsu support, use existing issue https://github.com/get-bb/bb/issues/3333 rather than creating a duplicate.

> AGENT GENERATED
