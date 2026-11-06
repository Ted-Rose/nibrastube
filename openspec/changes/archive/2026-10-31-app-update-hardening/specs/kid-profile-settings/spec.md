# Spec Delta

## ADDED Requirements

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
