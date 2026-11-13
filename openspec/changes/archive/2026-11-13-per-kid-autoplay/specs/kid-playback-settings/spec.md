# Spec Delta

## Purpose

Parent-managed, per-kid playback settings: which transitions may
start YouTube playback without a tap on the player's native play
button, chosen per profile.

## ADDED Requirements

### Requirement: Per-profile autoplay preferences with safe defaults

Each kid profile SHALL carry two independent playback preferences,
both defaulting to disabled for existing and new profiles:

- `autoplayOnOpen` — whether a video starts playing by itself when
  the watch page opens.
- `autoplayOnNext` — whether the next video starts playing by
  itself when the current video ends.

#### Scenario: New profile defaults to manual playback

- **WHEN** a profile is created (or an existing profile has never
  been configured)
- **THEN** both preferences read `false` and every video requires
  a tap on the player to start

#### Scenario: Preferences are independent

- **WHEN** `autoplayOnOpen` is enabled and `autoplayOnNext` is
  disabled
- **THEN** the first video plays automatically but the video after
  it loads paused

### Requirement: Parent-managed toggles on the profile card

The `/parent/profiles` page SHALL expose one switch per preference
on each kid's card, and each switch SHALL persist through a
zod-validated server action gated by a parent session,
`requireParentUnlocked`, and `assertCanManageProfile`.

#### Scenario: Parent enables a preference

- **WHEN** a parent flips a toggle on a kid's card
- **THEN** the preference is saved for that profile only and the
  toggle reflects the saved state

#### Scenario: Unauthenticated or unmanaged writes rejected

- **WHEN** the action is called without a parent session, without
  the parent unlock, or for a profile the parent does not manage
- **THEN** it performs no write

### Requirement: Watch page honors the preferences

The kids watch page SHALL start playback without a tap only where
the profile's preferences allow it:

- Initial page load SHALL autoplay only when `autoplayOnOpen` is
  enabled.
- Automatic advance after a video ends SHALL autoplay only when
  `autoplayOnNext` is enabled; otherwise the next video loads
  paused awaiting a tap.
- User-initiated navigation (swipe gestures, explicit next/back
  controls) SHALL always play regardless of preferences.

#### Scenario: Both disabled — fully manual session

- **WHEN** a kid with both preferences disabled opens a video and
  it ends
- **THEN** the first video waited for a tap and the next video is
  loaded paused, never playing on its own

#### Scenario: Auto-advance respects next-toggle

- **WHEN** a kid with `autoplayOnNext` disabled watches a video to
  its end
- **THEN** the queued next video loads paused instead of starting
  on its own

#### Scenario: Manual nav always plays

- **WHEN** a kid swipes to another video with both preferences
  disabled
- **THEN** the swiped video starts playing because the gesture is
  user-initiated
