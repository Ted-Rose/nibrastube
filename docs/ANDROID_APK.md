# Android APK (Capacitor wrapper)

NibrasTube is packaged for Android as a **Capacitor 8 shell**. The app
is server-rendered Next.js, so there are no bundled web assets — the
WebView loads the deployed site via `server.url` in
`capacitor.config.ts`. Everything (auth cookies, Pusher, YouTube
embeds) behaves exactly like the browser because it *is* the same
HTTPS origin.

## Prerequisite: deployed URL

`server.url` must point at a live HTTPS deployment of this app (e.g.
Cloud Run / App Engine on your GCP project). Set it:

- locally: `CAPACITOR_SERVER_URL=https://your-domain npx cap sync android`
- CI: repo **variable** `APP_URL` (Settings → Secrets and variables →
  Actions → Variables)

Until set, the config falls back to `https://nibrastube.example.com`
— fine for building, useless at runtime.

## Repo layout

- `capacitor.config.ts` — appId `com.nibrastube.app`, `server.url`
- `capacitor-www/` — placeholder `webDir` (required by `cap sync`,
  never rendered at runtime)
- `android/` — generated Android project (committed; gradle wrapper
  included, Java 21 / compileSdk 36)
- `.github/workflows/android-release.yml` — CI builds

## Builds

- Push to `android`, tag `v*`, or dispatch on a non-`main` ref →
  debug APK (versionName `debug-r<run>`), uploaded as workflow
  artifact `nibrastube-debug-apk` (30d); skipped on `main` runs
  (push or dispatch), which publish only the release below
- Tag `v*` push → signed `nibrastube-<ver>.apk` + a fixed-name
  `nibrastube.apk` attached to that tag's GitHub release (the
  versioned name avoids Downloads filename collisions; the fixed
  name keeps `releases/latest/download/nibrastube.apk` working)
- Push to `main` → signed `nibrastube.apk` + `nibrastube-<run>.apk`
  + `update.json` on the rolling `continuous` prerelease, gated by
  an emulator install test

The "Get the app" menu link resolves the newest versioned
`nibrastube-<run>.apk` asset via `api.github.com` (the one GitHub
host that sends ACAO — the release *download* endpoints send none,
so a plain browser `fetch` can't read them). It falls back to the
fixed `/releases/download/continuous/nibrastube.apk` URL while the
API call is in flight or fails.

`releases/latest/download/nibrastube.apk` also works but tracks only
tagged `v*` milestones — the `continuous` release is a prerelease
with `make_latest: "false"`, so it never steals "latest".

## Rolling release + in-app updates

Every push to `main` (and a manual dispatch while on `main`) runs the
full signed-release path with `versionCode = github.run_number`
(monotonic) and `versionName = <latest v* tag>+<run_number>` (e.g.
`v0.1.0+22` — so continuous builds never read as downgrades next to
tagged releases), then:

1. `aapt dump badging` verifies the APK's real `versionCode` equals
   the run number — the update check keys off it.
2. `scripts/write-update-json.mjs` writes `update.json`:

   ```json
   {
     "versionCode": 123,
     "versionName": "v0.1.0+123",
     "apkUrl": "https://…/releases/download/continuous/nibrastube-123.apk",
     "releaseUrl": "https://github.com/<repo>/releases/tag/continuous",
     "publishedAt": "<iso>"
   }
   ```

   `apkUrl` points at `nibrastube-<run>.apk`, a versioned asset that
   is uploaded once and never re-uploaded. The fixed `nibrastube.apk`
   gets deleted+re-uploaded every publish, and phones that fetched it
   mid-publish got a 404 page or a truncated file — the "problem
   parsing the package" sideload failure.
3. An emulator job (`reactivecircus/android-emulator-runner`)
   gates the publish: fresh `adb install`, `adb install -r` of the
   new build over the APK `update.json` currently advertises, and a
   truncated-APK negative control that must be rejected — proof the
   gate can fail.
4. The publish job uploads the APK assets first and `update.json`
   last — the manifest is the commit point, so an app polling
   mid-publish never sees a manifest pointing at a
   not-yet-uploaded asset. It then prunes versioned assets older
   than the newest two (a phone can hold the previous manifest for
   up to an hour) and force-moves the `continuous` tag via the
   git-refs API (`gh api -X PATCH …/git/refs/tags/continuous`) —
   `git push` is refused whenever the built commit touches
   `.github/workflows/` because GITHUB_TOKEN lacks the `workflows`
   scope. The retag is last and `continue-on-error`: the release
   exists regardless of where the git ref points.

On-device, `lib/app-update.ts` polls that manifest once per launch
(hourly `localStorage` throttle, stamped only once the check
resolves to "update"/"current" — a fetch, validation, or
version-read failure doesn't suppress retries). The manifest
is fetched via `CapacitorHttp` (WebView `fetch` to github.com is
CORS-blocked) and validated before use: `versionCode` must be a
positive integer and `apkUrl` must be `https:` on `github.com` or
`*.githubusercontent.com`. When `versionCode` exceeds the installed
build (`App.getInfo().build`), `components/app-update-banner.tsx`
shows a one-tap card; Update opens the APK URL in the system browser
(`window.open(url, "_system")`) and Android installs over the top.
Debug/dev APKs (versionName `debug-*` or the gradlew default `1.0`)
skip the automatic check so a stale test build doesn't nag.

The kid settings page (`/kids/<profileId>/settings`) has a
native-only "Check for updates" row: `checkForAppUpdate({force:
true})` bypasses the throttle and reports every outcome inline —
the new version + Update button, "up to date", or "check failed" —
use it to verify the update flow on-device and to re-read the live
manifest when a sideload "didn't update".

Over-the-top installs REQUIRE the same signing key — both release
paths sign with the same keystore. Never uninstall the old APK first:
that wipes cookies/localStorage (the session).

**Known limitation:** APKs built before `@capacitor/app` shipped
(v0.1.0 era) can't read their own versionCode — the check fails
silently and no banner ever shows. They need one manual sideload of
any newer APK; after that, updates are automatic.

## Plugins and cap-sync drift

`@capacitor/app` (build info for the updater) and
`@capacitor/keyboard` (`resizeOnFullScreen` so the keyboard resizes
the edge-to-edge WebView — paired with
`android:windowSoftInputMode="adjustResize"` in the manifest) are the
installed plugins. After adding/removing any plugin, run
`npx cap sync android` and commit the `android/` changes — the
workflow fails the build if `git status --porcelain -- android/`
isn't clean after sync. `android/app/src/main/assets/` is gitignored
(it only holds generated cap-sync output: the baked `server.url`,
plugin manifest, copied `public/`).

Also in the manifest: `android:allowBackup="false"` — WebView
cookies/localStorage must not roam to other devices via Auto Backup.

Local builds need JDK 21 + Android SDK (`platforms;android-36`,
`build-tools;36.0.0`), then `cd android && ./gradlew assembleDebug`.

## Release signing secrets

Generate a PKCS12 keystore (no JKS needed — `apksigner` auto-detects):

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem \
  -days 10000 -nodes -subj "/CN=NibrasTube"
openssl pkcs12 -export -out release-key.p12 -inkey key.pem \
  -in cert.pem -name nibrastube
base64 -i release-key.p12 | pbcopy   # → GitHub secret
```

Repo secrets required for tagged releases:

- `ANDROID_KEYSTORE_BASE64` — base64 of `release-key.p12`
- `KEY_ALIAS` — e.g. `nibrastube`
- `KEYSTORE_PASSWORD` / `KEY_PASSWORD` — pkcs12 export password

Keep the `.p12` + passwords somewhere safe — losing the key means a
new `applicationId` forever.

## Iterating on Android code

`android-release.yml` also builds on pushes to an `android` working
branch: cut `android` from `main`, push experiments, grab the debug
APK artifact — no signing secrets needed.
