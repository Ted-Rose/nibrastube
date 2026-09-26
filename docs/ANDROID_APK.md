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

| Trigger | Output |
|---|---|
| Push to `android` branch or manual dispatch | Debug APK → workflow artifact `nibrastube-debug-apk` (30d) |
| Tag `v*` push | Signed `nibrastube.apk` attached to the GitHub release |

The stable sideload URL (used by the landing-page link shown on
Android browsers):
`https://github.com/Ted-Rose/nibrastube/releases/latest/download/nibrastube.apk`

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
