# Spec Delta

## Purpose

Defines the sideload update channel for the Android APK: the
`update.json` manifest contract on the rolling `continuous`
prerelease, the on-device check semantics (automatic throttled vs
manual forced, debug-build skip), and the publish invariants that
keep installs un-corrupted.

## ADDED Requirements

### Requirement: Update manifest contract

The rolling `continuous` prerelease SHALL carry an `update.json`
asset with `versionCode` (positive integer), `versionName`
(string), `apkUrl`, `releaseUrl`, and `publishedAt`. `apkUrl` SHALL
point at a versioned `nibrastube-<run>.apk` asset on that release —
never at the re-uploaded fixed-name asset — and clients SHALL
reject manifests whose `apkUrl` is not `https:` on `github.com` or
`*.githubusercontent.com`.

#### Scenario: Manifest advertises a versioned asset

- **WHEN** a `main` push publishes the `continuous` release
- **THEN** `update.json.apkUrl` ends in
  `nibrastube-<github.run_number>.apk` and that asset exists on the
  same release

#### Scenario: Untrusted manifest URL rejected

- **WHEN** the fetched manifest's `apkUrl` is not HTTPS on an
  allowed GitHub host
- **THEN** the check resolves to an error outcome and no URL is
  opened

### Requirement: Automatic checks are throttled, manual checks are not

Automatic update checks SHALL run at most once per hour per device,
stamping the throttle only after a fully-validated check. Checks
invoked manually (force) SHALL bypass the throttle read and stamp
entirely and SHALL report every outcome — update available, up to
date, or failed — to the caller.

#### Scenario: Manual check re-reads the live manifest

- **WHEN** a user triggers a manual check within the throttle
  window
- **THEN** the manifest is fetched and the real outcome is
  reported, not "skipped"

#### Scenario: Automatic check inside the throttle window

- **WHEN** an automatic check runs less than one hour after a
  successful check
- **THEN** it resolves to "skipped" without fetching

### Requirement: Debug and dev builds skip automatic checks

APKs whose `versionName` marks them as non-release builds SHALL be
excluded from automatic update prompts; manual checks on those
builds SHALL still run the real flow.

#### Scenario: Debug build never auto-nags

- **WHEN** an automatic check runs on a build whose versionName
  begins with `debug-` or is the gradlew default `1.0`
- **THEN** it resolves to "skipped" and no update UI appears

### Requirement: Publish ordering keeps installs uncorrupted

A `continuous` publish SHALL be gated by an emulator install test
(fresh install of the built APK, over-the-top `install -r` over the
currently advertised APK, and a truncated-APK negative control that
must be rejected). The publish SHALL upload APK bytes before
`update.json`, SHALL keep the newest two versioned APK assets, and
SHALL move the `continuous` git tag via the git-refs API as a
non-fatal final step.

#### Scenario: Emulator gate blocks a bad build

- **WHEN** the built APK fails to install or the truncated control
  installs successfully
- **THEN** the publish job does not run and `update.json` still
  points at the previous build

#### Scenario: Manifest never points at a missing asset

- **WHEN** an installed app polls `update.json` during a publish
- **THEN** the manifest it receives references an asset that is
  already fully uploaded (or the previous manifest's still-pruned-
  last asset)

#### Scenario: Retag failure cannot stall the release

- **WHEN** moving the `continuous` tag fails (e.g. the pushed
  commit touched workflow files)
- **THEN** the release assets and `update.json` are already
  published; the failed retag only marks the run yellow

### Requirement: Continuous versionName tracks milestones

The `versionName` of a `continuous` build SHALL be
`<latest v* tag>+<run_number>` so it never reads as a downgrade
beside a tagged release; `versionCode` SHALL remain the monotonic
workflow run number.

#### Scenario: Continuous build after a v1.x tag

- **WHEN** `main` builds after tag `v1.2.0` exists
- **THEN** `versionName` is `v1.2.0+<run>`, ordering above `1.2.0`
