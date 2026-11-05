# Tasks

## 1. Update check library

- [x] 1.1 `lib/app-update.ts`: add `CheckOptions {force}` — force
      bypasses throttle read+stamp; keep never-throws typed union
- [x] 1.2 Skip automatic checks on debug/dev builds (versionName
      `debug-*` or `1.0`); manual checks unaffected

## 2. Kid settings row

- [x] 2.1 New `update-check-row.tsx` client component on
      `/kids/<profileId>/settings` — native-only (SSR snapshot
      false), force-check on tap, inline update/up-to-date/failed
      outcome, `window.open(apkUrl, "_system")`
- [x] 2.2 Mount it under `AvatarPicker` in the settings page

## 3. Publish pipeline hardening

- [x] 3.1 `write-update-json.mjs`: `APK_ASSET` env → `apkUrl`
      points at `nibrastube-<run>.apk`
- [x] 3.2 Workflow: versioned asset + `update.json` staged as
      artifact files (not job outputs); continuous versionName =
      `<latest v* tag>+<run>`
- [x] 3.3 New `install-test` job (main-only): artifact APK →
      emulator → fresh install, `install -r` over the currently
      advertised APK, truncated-APK negative control
- [x] 3.4 New `publish` job (`needs: install-test`): APK assets
      upload first, `update.json` last, prune versioned assets
      keeping newest two
- [x] 3.5 Retag `continuous` via `gh api` git-refs PATCH (POST if
      missing), `continue-on-error`, after the publish
- [x] 3.6 Debug builds get `-PversionName=debug-r<run>`
- [x] 3.7 `v*` releases attach `nibrastube-<ver>.apk` + fixed
      `nibrastube.apk`

## 4. Install link

- [x] 4.1 `app-install-menu.tsx`: resolve newest `nibrastube-<run>.
      apk` via `api.github.com` releases API; fixed-name URL stays
      as initial/fallback href

## 5. Docs + verification

- [x] 5.1 Update `docs/ANDROID_APK.md` (asset names, update flow,
      settings-page button, debug-skip) and `AGENTS.md`
- [x] 5.2 `npm run typecheck` + `npm run lint` clean
- [x] 5.3 `awk 'length > 79'` on every touched file — no violations
- [x] 5.4 `node scripts/write-update-json.mjs` dry-run — versioned
      `apkUrl` verified; workflow YAML parses

## Workflow follow-up

- Open a draft PR against `Ted-Rose/nibrastube` with UI + CI
  verification sections (rule 7).
- Post-merge: confirm the first main run publishes
  `nibrastube-<run>.apk` + `update.json` and the emulator gate is
  green; archive this change per openspec-archive-change.
