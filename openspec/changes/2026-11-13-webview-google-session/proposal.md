# Proposal

## Why

The parent wants YouTube-side watch history for what kids watch in
the app. YouTube records history only for playback on `youtube.com`
surfaces under a signed-in cookie session — there is no Data API to
write history, and `youtube-nocookie.com` embeds are
cookie-free by design (the nocookie experiment was reverted in
PR #77 for this reason). The app's Capacitor WebView holds no Google
session today, and Google deliberately blocks sign-in inside
embedded WebViews (`disallowed_useragent`). This change makes the
APK's WebView carry a persistent signed-in Google session so embed
plays land in a YouTube account's watch history.

## What Changes

- **Capacitor config**: `android.overrideUserAgent` set to a
  Chrome-Android UA string without the `; wv)` marker so Google
  sign-in pages render inside the WebView instead of returning 403
  `disallowed_useragent`; `server.allowNavigation` extended to the
  Google sign-in hosts so the flow stays in-app instead of handing
  off to Chrome via `Intent.ACTION_VIEW`.
- **Parent-facing "Connect YouTube" entry point** (behind the
  parent gate): navigates the WebView to Google sign-in, parent
  completes it once, session persists in the WebView cookie store.
- **Native session status/disconnect bridge**: a minimal Capacitor
  plugin that reads `CookieManager` for the youtube.com session
  cookies to report connected/expired state, and clears the Google
  cookies on disconnect.
- **Embeds stay on `www.youtube.com`** (post-revert) — no embed
  change needed; third-party cookies are already enabled by
  Capacitor's cordova cookie manager but must be verified.
- **Accepted consequence**: `youtube.com` must remain *unblocked*
  in Family Link for embeds to work (WebView ≥139 enforces the
  supervised blocklist on navigations), so the block-the-domain
  strategy from PR #76 is abandoned; mitigation for the
  Chrome-escape hole is documented in design.md.

## Capabilities

### New Capabilities

- `youtube-watch-history`: the Android WebView carries a
  persistent signed-in Google session, YouTube playback inside the
  app is attributed to that account's watch history, and the
  parent can connect, check, and disconnect the session.

### Modified Capabilities

(none)

## Impact

- `capacitor.config.ts` — `overrideUserAgent`,
  `server.allowNavigation`
- `android/app/src/main/java/com/nibrastube/app/` — MainActivity +
  new session-status plugin
- Parent settings UI — new connect/status/disconnect surface
- `docs/ANDROID_APK.md`, `AGENTS.md` — documented behavior and
  operational notes (re-auth, fragility)
- Family Link ops: `youtube.com`/`youtu.be` stay unblocked;
  recommended offset is an app-level limit/block on Chrome itself
