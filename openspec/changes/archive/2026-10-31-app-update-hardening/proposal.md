# Proposal

## Why

The sideload update flow shipped in #41 has accumulated known
failure modes (from the sibling `reactive-bible` project's learnings
doc, which this repo's updater was modeled on):

- `update.json` points at the fixed-name `nibrastube.apk` asset,
  which is deleted+re-uploaded every publish — phones fetching it
  mid-publish get a 404 page or a truncated file: the "problem
  parsing the package" sideload failure.
- The `Retag continuous` step runs `git push -f` BEFORE the publish
  step. The push is refused whenever the built commit touches
  `.github/workflows/` (GITHUB_TOKEN lacks the `workflows` scope),
  and since it gates the publish, one bad push stalls the rolling
  release entirely.
- Continuous `versionName` (`0.0.1-r<N>`) reads as a downgrade once
  any `v1.x` milestone tag ships.
- There is no manual "check for updates" affordance — a sideload
  that "didn't update" has no on-device re-check path.
- There is no install test: a corrupt publish reaches phones
  ungated.
- Debug/branch APKs share the release channel's `update.json` and
  nag testers to "update" onto unrelated builds.

## What Changes

- `lib/app-update.ts` gains a `{force}` option: manual checks
  bypass the hourly throttle and report every outcome; automatic
  checks keep their semantics and additionally skip on debug/dev
  builds (versionName `debug-*` or the gradlew default `1.0`).
- New native-only "Check for updates" row on the kid settings page
  (`/kids/<profileId>/settings`) reporting update / up-to-date /
  failed inline.
- `android-release.yml` split into build → install-test → publish:
  an emulator job gates `continuous` publishes (fresh install,
  over-the-top update over the currently advertised APK, and a
  truncated-APK negative control). The publish uploads
  `nibrastube-<run>.apk` (versioned, never re-uploaded) before
  `update.json` (the commit point, flipped last), prunes old
  versioned assets, and moves the `continuous` tag via the
  git-refs API — non-fatal, after the publish.
- Continuous `versionName` becomes `<latest v* tag>+<run>`
  (e.g. `v0.1.0+22`); `v*` tag releases also attach a versioned
  `nibrastube-<ver>.apk`.
- The "Get the app" menu link resolves the newest versioned asset
  via `api.github.com`, falling back to the fixed name.
- `scripts/write-update-json.mjs` takes `APK_ASSET` so `apkUrl`
  points at the versioned asset.

## Capabilities

### New Capabilities

- `app-update`: the sideload update contract — manifest shape,
  throttle/manual-check semantics, debug-build skip, and the
  publish invariants (versioned assets, commit-point ordering,
  install-test gate).

### Modified Capabilities

- `kid-profile-settings`: the settings page gains a native-only
  manual update-check row.

## Impact

- Code: `lib/app-update.ts`, `components/app-update-banner.tsx`
  callers unchanged, new
  `app/kids/[profileId]/settings/update-check-row.tsx`,
  `components/app-install-menu.tsx`,
  `scripts/write-update-json.mjs`,
  `.github/workflows/android-release.yml`, `docs/ANDROID_APK.md`,
  `AGENTS.md`.
- Whitelist-safety impact: none — this touches the app-update
  channel and CI only, never what a kid can see or watch.
