# Plan — Automatic APK deployment (rolling release + in-app updater)

Status: not implemented

Source: `Bible Research/docs/learnings/android-apk-wrapper.md` —
replicates the reactive-bible sideload-update pipeline for nibrastube.

## Goal

Every merge to `main` automatically publishes a signed
`nibrastube.apk` plus an `update.json` manifest on a fixed
`continuous` GitHub **prerelease**. Installed APKs poll the manifest
once per app launch (hourly throttle) and show a one-tap update
banner; the user confirms and Android installs over the top (same
signing key — never uninstall, or cookies/localStorage are wiped).

## Current state (already in place — do not rebuild)

- `android/` Capacitor 8 project committed;
  `capacitor.config.ts` `server.url` ← `CAPACITOR_SERVER_URL`
  (CI: `APP_URL` repo variable = `https://redzi.vercel.app`).
- `.github/workflows/android-release.yml`: debug APK artifact on
  `android` branch + `workflow_dispatch`; signed release APK on `v*`
  tags attached to that tag's release. Signing secrets already set:
  `ANDROID_KEYSTORE_BASE64`, `KEY_ALIAS`, `KEYSTORE_PASSWORD`,
  `KEY_PASSWORD`. `permissions: contents: write` already set.
- `v0.1.0` release exists (marked Latest) with `nibrastube.apk`.
- `components/app-install-menu.tsx` links
  `releases/latest/download/nibrastube.apk`.
- `versionCode`/`versionName` already injectable via
  `./gradlew -PversionCode=... -PversionName=...`
  (`android/app/build.gradle`); `github.run_number` is monotonic.

## Gaps this plan closes

1. No rolling release — updates ship only when someone tags `v*`.
2. No `update.json` manifest and nothing reads one on-device.
3. No in-app update check / update UX.
4. `android:allowBackup="true"` (WebView cookie/localStorage backup
   would roam to other devices — learnings §8).
5. No cap-sync drift check; generated `android/app/src/main/assets/`
   is untracked-but-unignored, so any local `cap sync` dirties git.
6. No `windowSoftInputMode`/keyboard handling (learnings §5).

## Work packages

### WP1 — `.gitignore`

Add `android/app/src/main/assets/` — it only holds `cap sync`
output (`capacitor.config.json` with the baked server URL,
`capacitor.plugins.json`, copied `public/`). Ignoring it keeps
`git status` clean locally and lets WP2's drift check scan all of
`android/`.

### WP2 — `.github/workflows/android-release.yml` rework

Keep existing triggers; add `main`:

```yaml
on:
  workflow_dispatch:
  push:
    tags: ['v*']
    branches: [android, main]

concurrency:
  group: android-apk-${{ github.ref }}
  cancel-in-progress: true
```

After `npx cap sync android`, add a drift check (learnings §9):

```yaml
- name: Verify committed android/ matches plugins
  run: |
    if [ -n "$(git status --porcelain -- android/)" ]; then
      git status --porcelain -- android/
      echo "run 'npx cap sync android' and commit the result"
      exit 1
    fi
```

Release-path changes (shared build + sign steps already exist):

- Make the `assembleRelease`/sign steps run for BOTH
  `refs/tags/v*` and `refs/heads/main` (same secrets, same PKCS12
  keystore — sideload updates REQUIRE the same signing key).
- For `main` builds use `-PversionCode=${{ github.run_number }}`
  and `-PversionName=<pkg version>-r<run_number>`.
- After signing a `main` build, verify the APK's real versionCode
  matches the manifest value (learnings §2):

  ```bash
  BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
  VC=$("$BT/aapt" dump badging nibrastube.apk \
    | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")
  test "$VC" = "${{ github.run_number }}"
  ```

- Generate `update.json` via a checked-in
  `scripts/write-update-json.mjs` reading `VERSION_CODE`,
  `VERSION_NAME`, `GITHUB_REPOSITORY` from env, writing:

  ```json
  {
    "versionCode": 123,
    "versionName": "0.0.1-r123",
    "apkUrl":
      "https://github.com/<repo>/releases/download/continuous/nibrastube.apk",
    "releaseUrl":
      "https://github.com/<repo>/releases/tag/continuous",
    "publishedAt": "<iso>"
  }
  ```

- Move the `continuous` tag to the built commit, then publish
  (learnings §2: retag needs `contents: write` — already granted;
  pushing the tag does NOT retrigger this workflow since
  `continuous` doesn't match `v*`):

  ```yaml
  - name: Retag continuous
    if: github.ref == 'refs/heads/main'
    run: |
      git tag -f continuous
      git push -f origin refs/tags/continuous

  - name: Publish continuous prerelease
    if: github.ref == 'refs/heads/main'
    uses: softprops/action-gh-release@v2
    with:
      tag_name: continuous
      name: Continuous build
      body: Automated build of ${{ github.sha }}
      prerelease: true
      make_latest: "false"
      files: |
        nibrastube.apk
        update.json
  ```

- `prerelease: true` + `make_latest: "false"` keeps
  `releases/latest` on real milestones (`v0.1.0`) while
  `releases/download/continuous/...` is a stable URL for the
  updater (learnings §2).
- Keep the `v*` tag release path and the `android`-branch/dispatch
  debug artifact exactly as they are.
- Gate every release step on
  `if: github.ref == 'refs/heads/main'` (a manual dispatch on main
  also publishes — intended escape hatch for fixing a broken
  release).

### WP3 — Android manifest hardening
(`android/app/src/main/AndroidManifest.xml`)

- `android:allowBackup="true"` → `"false"` (learnings §8).
- Add `android:windowSoftInputMode="adjustResize"` to the
  `MainActivity` `<activity>` element (learnings §5).
- Keep all XML comments OUTSIDE element start-tags (learnings §4 —
  a comment inside `<application ...>` breaks ManifestMerger).
- Parse-check after editing:
  `python3 -c "import xml.etree.ElementTree as ET; \
  ET.parse('android/app/src/main/AndroidManifest.xml')"`.

### WP4 — Capacitor plugins

- `npm install @capacitor/app @capacitor/keyboard` (8.x line —
  core is `^8.5.2`; `@capacitor/app` latest is 8.1.2).
- `capacitor.config.ts`: add
  `plugins: { Keyboard: { resizeOnFullScreen: true } }`
  (learnings §5 — `adjustResize` alone doesn't shrink the WebView
  on edge-to-edge targetSdk 36).
- Run `npx cap sync android` and commit every resulting change
  under `android/` (`capacitor.settings.gradle` gains the plugin
  includes). With WP1's gitignore, generated `assets/` output
  stays untracked — correct.
- `CapacitorHttp` needs no install (`@capacitor/core`) and no
  config — do NOT enable the fetch patch; we call it directly.

### WP5 — In-app update check

`lib/app-update.ts` (client-only module; all Capacitor calls behind
`Capacitor.isNativePlatform()` so web users never touch it):

- `MANIFEST_URL` =
  `https://github.com/Ted-Rose/nibrastube/releases/download/`
  + `continuous/update.json` (one string literal in code)
- `checkForAppUpdate(): Promise<UpdateCheck>` returning a typed
  union — `{kind:"update",apkUrl,versionCode,versionName}` |
  `{kind:"current"}` | `{kind:"skipped"}` (non-native / throttled)
  | `{kind:"error"}` — never throws (learnings §2).
- Hourly throttle via `localStorage`
  (`nibrastube:update-checked-at`); stamp ONLY after a successful
  fetch — a transient failure must not suppress retries
  (learnings §2 + §6).
- Fetch the manifest with `CapacitorHttp.get` (learnings §1 —
  WebView `fetch` to github.com is CORS-blocked; `CapacitorHttp`
  runs on the native stack).
- Validate the manifest before trusting it (learnings §2):
  `versionCode` positive integer; `apkUrl` parses as `https:` on
  `github.com` or `*.githubusercontent.com` — anything else →
  `{kind:"error"}`. A compromised manifest must not smuggle
  `javascript:`/`intent:` URLs into `window.open`.
- `App.getInfo().build` → `parseInt` = installed versionCode;
  wrap in try/catch — APKs built before `@capacitor/app` was added
  (i.e. v0.1.0) reject → `{kind:"error"}` (silent; known
  limitation, see below).
- `versionCode > installed` → `{kind:"update"}`.

`components/app-update-banner.tsx` (`"use client"`):

- `useEffect` on mount → `checkForAppUpdate()` → on
  `{kind:"update"}` render a fixed bottom card (kids chrome:
  `rounded-3xl`, `font-black`, safe-area padding): "New app
  version" + Update button + ✕ dismiss (React state only — comes
  back next launch).
- Update click → `window.open(apkUrl, "_system")` (learnings §2 —
  hands the APK URL to the OS browser; install then requires the
  user's Android consent — by design).
- Mount in `app/layout.tsx` next to `<PwaRegister />`; returns
  null on web and when no update — no hydration risk.

`components/app-install-menu.tsx`:

- Point `APK_URL` at
  `releases/download/continuous/nibrastube.apk` so the
  "Install Android app" link always serves the newest build
  (matching its existing comment's intent). `releases/latest`
  remains the milestone channel.

### WP6 — Docs

- `docs/ANDROID_APK.md`: builds table gains
  "push to `main` → signed APK + `update.json` on `continuous`
  prerelease"; document the manifest contract and the update UX;
  note v0.1.0-era installs can't self-update (no `@capacitor/app`
  baked in) and need one manual sideload.
- `AGENTS.md` "Android APK" section: mention every `main` merge
  ships a signed APK to `continuous`; `android` branch debug flow
  unchanged; add `@capacitor/app`/`@capacitor/keyboard` to the
  plugin list note.

## Verification

- `npm run typecheck && npm run lint` (required).
- `npm run build` — infra-level change.
- `npx cap sync android` clean + `git status --porcelain android/`
  empty (excluding gitignored assets).
- XML parse-check the manifest (command in WP3).
- The `main`-push release path can't fully run pre-merge; the
  merge itself is the first real run — then verify with
  `gh release view continuous --repo Ted-Rose/nibrastube`
  (assets: `nibrastube.apk`, `update.json`) and
  `gh api .../update.json` contents. Failed first run →
  `gh workflow run android-release.yml` after fixing.
- PR body must include a UI verification section (AGENTS.md rule
  7): install current APK → banner appears when newer
  `versionCode` exists → Update opens system browser → install
  over the top preserves session (stay logged in).
