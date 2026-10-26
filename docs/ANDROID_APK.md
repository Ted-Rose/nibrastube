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

- Push to `android` branch or manual dispatch → debug APK,
  uploaded as workflow artifact `nibrastube-debug-apk` (30d)
- Tag `v*` push → signed `nibrastube.apk` attached to that tag's
  GitHub release
- Push to `main` → signed `nibrastube.apk` + `update.json` on the
  rolling `continuous` prerelease

The stable sideload URL (used by the landing-page link shown on
Android browsers) tracks the newest `main` build — host+repo
`https://github.com/Ted-Rose/nibrastube`, path
`/releases/download/continuous/nibrastube.apk`.

`releases/latest/download/nibrastube.apk` also works but tracks only
tagged `v*` milestones — the `continuous` release is a prerelease
with `make_latest: "false"`, so it never steals "latest".

## Rolling release + in-app updates

Every push to `main` (and a manual dispatch while on `main`) runs the
full signed-release path with `versionCode = github.run_number`
(monotonic) and `versionName = <pkg version>-r<run_number>`, then:

1. `aapt dump badging` verifies the APK's real `versionCode` equals
   the run number — the update check keys off it.
2. `scripts/write-update-json.mjs` writes `update.json`:

   ```json
   {
     "versionCode": 123,
     "versionName": "0.0.1-r123",
     "apkUrl": "https://github.com/<repo>/releases/download/" +
       "continuous/nibrastube.apk",
     "releaseUrl": "https://github.com/<repo>/releases/tag/continuous",
     "publishedAt": "<iso>"
   }
   ```

   (`apkUrl` shown split for line width — it's a single URL string.)

3. The `continuous` tag is force-moved to the built commit (it does
   not match `v*`, so it can't retrigger the workflow) and
   `action-gh-release` publishes both files as a prerelease.

On-device, `lib/app-update.ts` polls that manifest once per launch
(hourly `localStorage` throttle, stamped only after a successful
fetch — a transient failure doesn't suppress retries). The manifest
is fetched via `CapacitorHttp` (WebView `fetch` to github.com is
CORS-blocked) and validated before use: `versionCode` must be a
positive integer and `apkUrl` must be `https:` on `github.com` or
`*.githubusercontent.com`. When `versionCode` exceeds the installed
build (`App.getInfo().build`), `components/app-update-banner.tsx`
shows a one-tap card; Update opens the APK URL in the system browser
(`window.open(url, "_system")`) and Android installs over the top.

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
