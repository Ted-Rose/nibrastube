# Design

## Context

`checkForAppUpdate()` (lib/app-update.ts) is a never-throws typed
union used only by `AppUpdateBanner` for the launch-time auto check.
The CI publishes `nibrastube.apk` (fixed name) + `update.json` on
the rolling `continuous` prerelease; the manifest's `apkUrl` is
what a phone downloads when the banner's Update button fires.

## Goals / Non-Goals

**Goals:**

- Kill the "problem parsing the package" race: never point a
  manifest or download link at a re-uploaded asset.
- Make the publish un-stallable: retag via API, non-fatal, after
  the publish.
- Prove installability before publishing: emulator install test
  as the `continuous` gate, including the over-the-top update leg
  and a negative control.
- On-device manual re-check for support/debugging.
- Stop debug builds nagging about the release channel.

**Non-Goals:**

- Silent/in-app installs — sideload always requires user consent;
  the flow stays "open APK URL → user confirms".
- Update telemetry — Sentry is DSN-gated off in prod today; adding
  breadcrumbs would report nothing. Revisit if the DSN ships.
- Emulator gate for `v*` tag or debug builds — kept main-only to
  keep non-main CI fast.
- A second update channel for `v*` milestones — phones only ever
  poll `continuous/update.json` (unchanged).

## Decisions

- **`{force}` option, not a separate function.** One entry point
  keeps the typed-union contract; force bypasses both the throttle
  read AND the stamp, so manual checks never disturb the hourly
  cadence. Alternative (a `checkForUpdatesManually` wrapper that
  clears localStorage first) — rejected: it would couple manual
  checks to throttle internals and still stamp.
- **Debug-build skip on versionName.** `App.getInfo().version` is
  the only reliable signal baked into the APK — debug artifacts get
  `-PversionName=debug-r<N>` in CI, local gradlew builds keep the
  default `1.0`. The skip applies to automatic checks only: a
  manual check on a dev build still runs the real flow.
  Alternative (a build-time flag reaching JS) — rejected: the
  WebView loads a remote URL, so no bundle-time flag can exist.
- **`useSyncExternalStore` for the native-platform gate.** The
  settings row must render nothing during SSR (server snapshot
  `false`) and appear after hydration on-device — that is exactly
  the three-argument form's job. A `useEffect` + `setState` trips
  the react-hooks "no sync setState in effects" lint.
- **Versioned assets + fixed asset, not fixed-only.** The fixed
  `nibrastube.apk` stays for the stable sideload URL and humans;
  `update.json` and the resolved install link point at
  `nibrastube-<run>.apk`, which exists atomically or not at all.
  `update.json` uploads in a separate, later step — it is the
  commit point of the publish.
- **Prune keeps the newest two versioned assets.** A phone can hold
  the previous manifest for up to an hour (throttle window);
  deleting the asset it references recreates the parse failure the
  change exists to fix.
- **Menu link resolves via `api.github.com`.** It is the only
  GitHub host that sends ACAO, so a browser `fetch` can list the
  release's assets; the chosen `browser_download_url` is navigated
  to, never fetched — no CORS needed on the APK bytes. The fixed
  URL remains the initial/fallback href.
- **Retag via `gh api` PATCH on `git/refs/tags/continuous`.**
  `git push` is refused for commits touching workflow files. The
  step POST-creates the ref when absent, runs last, and is
  `continue-on-error` — the release is bound to the tag name, not
  to where the git ref points, so a retag failure is cosmetic.
- **Emulator gate downloads the *advertised* APK for the update
  leg.** Resolving the live `update.json` gives a genuinely older
  build; a missing manifest or failed fetch skips the leg rather
  than failing the gate.
- **versionName `<latest-tag>+<run>` via `git describe`** with a
  package.json-version fallback — human-honest ordering next to
  `v*` milestones; versionCode stays `run_number` (monotonic is
  all the updater needs).

## Risks / Trade-offs

- First publish after merge runs the new pipeline end-to-end for
  the first time — the emulator job adds ~3-6 min to main CI.
  Mitigation: the job is main-only and the failure mode is a
  red check, not a broken release (nothing is published early).
- `api.github.com` rate-limits anonymous callers (60/hr/IP) — the
  menu link falls back to the fixed asset URL; worst case the user
  gets the fixed name, same as today.
- A future literal `v1.0` tag would produce versionName `1.0`,
  which the debug-skip treats as a dev build → that release would
  not auto-prompt. Accepted: tag convention is `v*` and real
  milestones are expected to be `v1.0.0`-style; documented in the
  code comment.
