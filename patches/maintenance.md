# BB customization maintenance — 2026-10-11

## Verified local foundation

The shared repository is `/home/shamanic/Projects/bb`. The installed-source checkout is `/home/shamanic/Projects/bb-bbd`. The launcher pins `normal-0.44.0-bf0f1e03f` and disables BB desktop automatic updates. This is a maintained source stack, not an automatic patch-replay service.

The Browser Workbench candidate preserves:

| Change | Revision |
|---|---|
| BB desktop 0.44.0 | `0baa605b32a0` |
| VCS driver foundation | `cea1a611bca6` |
| Native Jujutsu workspace support | `7aac6d6effe4` |
| mise-managed Codex CLI updates | `bf0f1e03f42e689b4cd0fae31fe533f2473ea28e` |
| ACP tool classification SDK hook | `b01b32b5ef2c1b624b2c9c107e3ee1ecf1b49c0d` |
| Reloadable Cursor image preview | `6cc018f39c20ec5cdcc3df9a23209f8d098c9f65` |
| Native Linux WebGPU/Vulkan | `51c26262` |

ACP/Cursor and WebGPU are combined in the companion patch's base; the browser extension is a separate descendant. The installed-source checkout also held an uncommitted image-copy/lightbox change. It is now preserved separately as `customizations/image-clipboard`, change `nlzmrvsu`, and distributed as `installed-image-copy.patch`. The source checkout was not changed. Generated public icon deltas and any plugin changes outside these revisions still need provenance checks before replacing a whole installation.

## What exists elsewhere

`/home/shamanic/dev/codex-desktop-linux/docs/updater.md` describes a Codex Desktop updater that checks upstream, rebuilds a native package with its wrapper, waits for the app to exit and retains rollback. This is separate from BB. The installed BB `provider-codex` is builtin and reports its update source as pinned. The known BB Codex patch enables mise-managed CLI updates; that fact alone does not establish desktop patch replay. The user's recollection of a separate provider patch updater is not yet resolved by this inventory.

## Required automatic-update behavior

1. Fetch a specific upstream release into the existing repository and create an isolated JJ candidate.
2. Replay the ordered customization changes. Stop on conflicts or unsupported contracts; retain the running build.
3. Build using pinned Node/pnpm and run the feature acceptance checks. Mandatory: real JJ workspace discovery, status/diff, bookmarks and workspace provisioning; native browser allow/deny/revoke; provider compatibility; WebGPU adapter; preserved installed overlays.
4. Package one self-contained candidate with source and artifact hashes. Retain the previous accepted build.
5. Switch the launcher atomically only after verification, when the desktop and affected services can restart. Verify the running build and roll back on failed startup. Never silently fall back to stock BB and lose JJ.

The included preparation script implements checksum-checked candidate creation and fail-on-conflict patch application; `--verify` also runs the manifest checks and native smoke. Scheduled update discovery, complete replay of all historical overlays, whole-build acceptance, atomic activation and automatic rollback are not implemented by this plugin. They should extend the existing custom-build workflow, not live as an untracked second updater.

## Upstream path

Jujutsu already has an open discussion: https://github.com/get-bb/bb/issues/3333 (earlier issue #2185 was referenced there). Prefer contributing the existing VCS/JJ implementation to that discussion over opening a duplicate.

BB's current CONTRIBUTING.md requires feature discussion/sign-off before a PR and contributor approval. Prepare browser permission handling and console access as host capabilities, with Workbench as one plugin client. Graphics startup profiles can be a separate follow-up if maintainers want a smaller first change. Keep origin checks, reload/revocation behavior, bounded logs and SDK/CLI coverage in the native proposal.

The draft in `upstream-proposal.md` is local only. No issue, comment, PR or message has been sent.
