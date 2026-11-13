# Tasks

## 1. Go/no-go spike (manual, on the supervised device)

- [ ] 1.1 On a debug APK build, set `android.overrideUserAgent` in
      `capacitor.config.ts` to a Chrome-Android UA string without
      the `; wv)` marker, add `accounts.google.com`,
      `accounts.youtube.com`, `myaccount.google.com` to
      `server.allowNavigation`, `npx cap sync`, install.
- [ ] 1.2 In the WebView, navigate to
      `https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com`
      and complete sign-in as the chosen Google account (kid's
      supervised account preferred — expect the parent-permission
      gate).
- [ ] 1.3 Verify: sign-in page renders (no
      `disallowed_useragent`), flow stays in-app (no Chrome
      handoff), session persists across app force-stop/relaunch.
- [ ] 1.4 Verify: play a video via the app's watch page, then check
      the signed-in account's YouTube watch history on another
      device — the video is recorded.
- [ ] 1.5 STOP if the spike fails (Google re-blocks embedded
      sign-in): document the failure in this change and do NOT
      proceed with the remaining tasks.

## 2. Capacitor configuration

- [ ] 2.1 Commit the spike-verified `android.overrideUserAgent`
      and `server.allowNavigation` entries in
      `capacitor.config.ts`.
- [ ] 2.2 Verify at runtime (remote WebView debug) that
      `CookieManager.getInstance().acceptThirdPartyCookies(
      webView)` returns true — expected already true via
      `CapacitorCordovaCookieManager`.

## 3. Session-status Capacitor plugin (native)

- [ ] 3.1 Add a `@CapacitorPlugin` in `android/app/src/main/java/
      com/nibrastube/app/` exposing `isConnected()` — reads
      `CookieManager.getCookie("https://www.youtube.com")` and
      reports presence of Google session cookies (e.g. `SID`,
      `LOGIN_INFO`).
- [ ] 3.2 Expose `disconnect()` — expires the Google-domain
      cookies via `CookieManager.setCookie` with past-expiry
      values; MUST NOT call `removeAllCookies` (preserves the
      app's own `session` cookie).
- [ ] 3.3 Register the plugin in `MainActivity` and add the
      TypeScript wrapper under `lib/`.

## 4. Parent-facing connect surface

- [ ] 4.1 Add a parent-gated "Connect YouTube" entry (parent
      profiles/settings area) that navigates the WebView to the
      Google sign-in URL and then reports `isConnected()`.
- [ ] 4.2 Show session status (connected / not connected) and a
      disconnect action wired to the plugin.
- [ ] 4.3 Handle failure UX: sign-in errors, security challenges,
      and expired sessions all land on a plain status message.

## 5. Docs & validation

- [ ] 5.1 Update `docs/ANDROID_APK.md` — connect flow, re-auth
      expectations, the Family Link consequence (youtube.com must
      stay unblocked; recommended offset = Chrome app-level
      limit), and the fragility caveat (Google may re-block
      embedded sign-in at any time).
- [ ] 5.2 Update `AGENTS.md` Android section if the layout/config
      notes change.
- [ ] 5.3 `openspec validate --all --strict`; `npm run typecheck`;
      `npm run lint`.
