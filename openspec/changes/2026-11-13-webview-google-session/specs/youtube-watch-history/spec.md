# Spec Delta

## Purpose

The Android APK's WebView carries a signed-in Google session so
that YouTube embed playback inside the app is recorded in a
YouTube account's watch history, and the parent can manage that
session.

## ADDED Requirements

### Requirement: Persistent signed-in Google session in the WebView

The app SHALL let a parent establish a Google sign-in session in
the Android WebView's cookie store and SHALL persist it across app
restarts. While a session is present, YouTube IFrame playback in
the app SHALL be attributed to that Google account's watch
history.

#### Scenario: Sign-in persists across restarts

- **WHEN** a parent completes the connect flow, force-stops the
  app, and relaunches it
- **THEN** the session status still reports connected without a
  new sign-in

#### Scenario: Playback attributed to the account

- **WHEN** a kid watches a video on the watch page while the
  session is connected
- **THEN** that video appears in the connected account's YouTube
  watch history

#### Scenario: Third-party cookies active for embeds

- **WHEN** the YouTube embed iframe runs in third-party context
  under the app origin
- **THEN** the session cookies are sent with the iframe's requests
  so playback is signed-in

### Requirement: Google sign-in stays inside the WebView

Navigations to the Google sign-in hosts SHALL load inside the app
WebView and SHALL NOT be handed off to the system browser.
Navigations to any other off-domain host SHALL keep the existing
handoff behavior.

#### Scenario: Connect flow does not open Chrome

- **WHEN** the app navigates to a Google sign-in host
- **THEN** the page renders in the WebView and no `ACTION_VIEW`
  intent is fired

#### Scenario: Other external links still hand off

- **WHEN** a navigation targets a non-allow-listed host
- **THEN** it is delivered to the system browser as before

### Requirement: Non-embedded user agent on Google surfaces

The app WebView SHALL send a user-agent string that does not
identify it as an embedded WebView, so Google's sign-in surfaces
do not reject it with `disallowed_useragent`.

#### Scenario: Sign-in page renders

- **WHEN** the WebView loads a Google sign-in URL
- **THEN** the page renders instead of a 403
  `disallowed_useragent` error

### Requirement: Session status and disconnect

The parent-facing surface SHALL report whether a Google session is
present in the WebView cookie store and SHALL let the parent
disconnect, removing the Google session cookies while preserving
the app's own cookies.

#### Scenario: Status reflects reality

- **WHEN** the parent opens the connect surface
- **THEN** it shows connected only when the session cookies for
  youtube.com are present in the WebView cookie store

#### Scenario: Disconnect clears only Google cookies

- **WHEN** the parent disconnects
- **THEN** the Google session cookies are removed and the app's
  own `session` cookie remains valid
