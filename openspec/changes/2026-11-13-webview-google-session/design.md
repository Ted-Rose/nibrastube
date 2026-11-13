# Design

## Context

See proposal.md — Why. Investigation findings that shape the
approach:

- YouTube watch history is a side-effect of playback on
  `youtube.com` under a signed-in cookie session. The Data API has
  no write-history endpoint, so OAuth tokens are useless for this —
  only cookies matter.
- Google deliberately rejects sign-in inside embedded WebViews
  (`403 disallowed_useragent`) — an anti-phishing policy, still
  enforced as of late 2025. The known workaround is overriding the
  WebView UA to a real browser UA (dropping the `; wv)` marker).
- Capacitor hands any navigation to a non-allow-listed host to
  `Intent.ACTION_VIEW` (`Bridge.launchIntent`), so
  `accounts.google.com` must be on `server.allowNavigation` or the
  sign-in page escapes to Chrome.
- Third-party cookies: Capacitor already calls
  `CookieManager.setAcceptThirdPartyCookies(webView, true)` via
  `CapacitorCordovaCookieManager` — the youtube.com session cookies
  will ride the embed iframe. Verify at runtime anyway.
- Supervised (Family Link) child accounts CAN sign in to Google
  websites in a web browser, with parent permission — a
  password-verified gate appears during the flow.
- WebView ≥139 enforces the Family Link site blocklist inside
  WebViews, so `youtube.com` must stay unblocked for embeds to
  load. This change therefore abandons the domain-block strategy.

## Goals / Non-Goals

**Goals:**

- Parent completes one Google sign-in inside the APK; the session
  persists in the WebView cookie store.
- Embed playback is attributed to that account's watch history.
- Parent can see connection state and disconnect.

**Non-Goals:**

- YouTube Data API integration / OAuth client — irrelevant to
  history (see Context) and out of scope.
- Auto-detecting history writes — attribution is verified on
  YouTube's side, not observable from the app.
- iOS.

## Decisions

### D1: WebView cookie sign-in, not OAuth

OAuth was rejected — tokens can't mint youtube.com cookies and
history isn't API-writable. The only mechanism is a real
accounts.google.com sign-in inside the WebView.

### D2: Which Google account

Prefer the **kid's supervised Google account**: history is then
inspectable via the family's existing YouTube supervision tooling,
and sign-in requires the parent's password anyway (supervised
sign-in gate) — which fits a parent-driven connect flow.
Fallback: a dedicated parent-owned account. The connect flow is
account-agnostic — decide at sign-in time, not in code.

### D3: UA override scope

`overrideUserAgent` in `capacitor.config.ts` applies to every
WebView request, not just sign-in pages — acceptable: a
Chrome-Android UA without `wv` is benign for all other surfaces.
Alternative (per-navigation UA switching in a custom
WebViewClient) adds complexity for no benefit.

### D4: Sign-in entry point

Parent-only surface (behind `parentUnlocked`/PIN) that navigates
the WebView to `accounts.google.com` sign-in with a `continue` to
`youtube.com`. Native side gets `accounts.google.com`,
`accounts.youtube.com`, `myaccount.google.com` on
`server.allowNavigation` so redirects stay in-app.

### D5: Session status via native CookieManager bridge

Cross-origin JS cannot read youtube.com sign-in state, but native
`CookieManager.getCookie("https://www.youtube.com")` can — a tiny
`@CapacitorPlugin` in `android/` exposes `isConnected()` (presence
of session cookies like `SID`/`LOGIN_INFO`) and `disconnect()`
(remove the Google-cookie domains' cookies via expired-cookie
writes; do NOT `removeAllCookies` — that would kill the app's own
`session` cookie).

## Risks / Trade-offs

- **UA spoof is ToS-gray and brittle** → Google can re-block
  embedded sign-in by fingerprinting beyond UA at any time; treat
  the feature as best-effort, degrade gracefully to "not
  connected" status. Task 1 is a manual go/no-go spike before
  building UI.
- **Google security challenges** (unusual-activity prompts,
  CAPTCHA, device verification) may recur → connect surface must
  surface failures plainly; re-auth is a normal event, not an
  edge case.
- **youtube.com must stay unblocked in Family Link** → the kid can
  browse YouTube directly in Chrome. Mitigation: set an
  app-level limit/block on Chrome itself in Family Link (the
  in-app handoff then lands on a blocked app — desired UX); cost:
  the APK-update `window.open(..., "_system")` download flow also
  lands there. Documented in ANDROID_APK.md.
- **Supervised-account web sign-in may hit extra gates** → spike
  (task 1) verifies the flow end-to-end on the real supervised
  device before any UI work.
- **Session expiry** → Google sessions can be revoked; the status
  surface reports disconnected and the parent re-runs connect.

## Migration Plan

- `main` currently serves youtube.com embeds again (revert PR #77),
  which is the required baseline — no data migration.
- Ship behind a debug APK first: the spike proves the flow on the
  supervised device before the release path.
- Rollback = revert the config/UI commit; no state to clean up
  beyond WebView cookies (disconnect handles that).
