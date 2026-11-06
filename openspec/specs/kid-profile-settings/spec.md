# Kid Profile Settings Specification

## Purpose

Gives kids a self-service settings page for their own profile,
reachable from the kids portal header, starting with picking their
avatar from a preset set of emoji.

## Requirements

### Requirement: Header avatar opens profile settings

The profile avatar in the kids portal header SHALL navigate to
`/kids/<profileId>/settings` for every viewer allowed to see the
feed — a matching kid session, a kid-locked device, or a managing
parent. It SHALL NOT link to the `/kids` picker.

#### Scenario: Kid session opens own settings

- **WHEN** a signed-in kid taps the avatar in the portal header
- **THEN** the app navigates to their own `/kids/<profileId>/settings`
  page

#### Scenario: Locked device opens settings

- **WHEN** a kid-locked device (matching `activeProfileId`, no
  session) taps the avatar in the portal header
- **THEN** the app navigates to `/kids/<profileId>/settings` without
  hitting a login redirect

### Requirement: Settings page access matches feed access

`/kids/<profileId>/settings` SHALL render only for viewers who pass
the same `canViewProfile` check as the profile's feed, and SHALL
redirect everyone else the same way the feed does.

#### Scenario: Unauthorized visitor is bounced

- **WHEN** an anonymous device without a matching `activeProfileId`
  requests `/kids/<profileId>/settings`
- **THEN** the request redirects exactly as the feed page would

#### Scenario: Other profile's kid session is bounced

- **WHEN** a kid session bound to a different profile requests the
  settings URL
- **THEN** `proxy.ts` redirects to that session's own feed

### Requirement: Avatar is chosen from a preset emoji set

The settings page SHALL offer a preset set of emoji avatars, and the
save action SHALL persist the choice to `profiles.avatar`. The server
action SHALL validate the submitted value against the preset list —
arbitrary strings MUST NOT be stored. The write SHALL be gated by
`assertCanEditKidData` (matching kid session, matching
`activeProfileId`, or managing parent) and SHALL NOT require
`requireParentUnlocked`, so a locked kid device can use it.

#### Scenario: Kid picks a new avatar

- **WHEN** a kid selects a preset emoji and saves
- **THEN** `profiles.avatar` updates and the header shows the new
  avatar after the next render

#### Scenario: Forged avatar value is rejected

- **WHEN** the action receives a value outside the preset list
- **THEN** it returns an error and `profiles.avatar` is unchanged

### Requirement: Display name stays parent-managed

The settings page SHALL show the profile's display name but SHALL
offer no control to edit it.

#### Scenario: No name editing control

- **WHEN** a kid opens the settings page
- **THEN** the name is visible as text and there is no name input

### Requirement: Native builds get a manual update check

The settings page SHALL show a "Check for updates" row only when
running inside the native Android shell; web browsers SHALL NOT
render it. Tapping it SHALL run a forced update check and report
the outcome inline: a newer version SHALL show its versionName and
an Update action that opens the manifest's `apkUrl` in the system
browser; an up-to-date result SHALL say so; a failed or skipped
check SHALL say the check failed.

#### Scenario: Kid on the APK taps Check for updates

- **WHEN** a kid opens `/kids/<profileId>/settings` inside the
  installed APK and taps the button
- **THEN** a checking state shows, then the real manifest outcome
  renders inline (ignoring the hourly throttle)

#### Scenario: Row hidden on web

- **WHEN** the same settings page is opened in a browser
- **THEN** no update row renders
