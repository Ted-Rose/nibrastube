# Song Reactions Specification

## Purpose

Per-profile like/dislike on catalog songs — the `/songs` sibling of
`video_reactions`. Kids react inside the `?song=` overlay player;
their likes feed the catalog's Liked tab and home shelf. Songs are
a shared registry (not whitelist-tied), so reactions gate on the
song being catalog-visible, not on a per-profile pin.

## Requirements

### Requirement: Reactions are per-(profile, song) rows

`song_reactions` SHALL hold one row per (profileId, songId) —
composite PK, cascade FKs to `profiles` and `songs`, `reaction`
text (`"like"`/`"dislike"`), `reactedAt` timestamptz. Writing the
same reaction twice clears the row; writing the other flips it.

#### Scenario: Toggling like

- **WHEN** a profile likes a song, likes it again, then dislikes it
- **THEN** the row is created, deleted, and recreated as `dislike`

### Requirement: The reacting profile resolves from kid context

`/songs` SHALL resolve the reacting profile as the kid session's
`profileId`, else the `activeProfileId` cookie (any session type).
Anonymous visitors and sessions with neither SHALL get no reaction
buttons, no Liked tab, and the `?view=liked` URL SHALL fall back to
the plain catalog.

#### Scenario: Parent without a lock sees no reaction UI

- **WHEN** a signed-in parent with no `activeProfileId` cookie
  opens `/songs?view=liked` or a `?song=` player
- **THEN** the Liked view is absent and the player shows no
  like/dislike buttons

### Requirement: Writes gate on catalog visibility

`/api/song-reactions` SHALL authorize exactly like
`/api/video-reactions` (kid session → own profile; else
`activeProfileId` match; else `assertCanManageProfile`) and SHALL
additionally require the song to exist with a compilation passing
the shared `visibleVideo` + `suitableVideo` gate — reacting to an
unimported, made-for-kids, 18+, or playback-blocked song SHALL
403.

#### Scenario: Reaction on a blocked compilation's song

- **WHEN** a profile POSTs a reaction for a song whose video row is
  `playback_blocked`
- **THEN** the route responds 403 `{ ok: false }` with no write

### Requirement: Song reaction writes are silent

`/api/song-reactions` SHALL NOT trigger Pusher or
`invalidateProfileFeed` — `/songs` reads are never
`unstable_cache`d and no `PusherListener` mounts there. It SHALL
`revalidatePath("/songs")` so the catalog re-renders fresh on the
next visit; the acting client holds optimistic state meanwhile.

#### Scenario: Like lands without a live refresh

- **WHEN** a kid taps 👍 in the overlay player
- **THEN** the button fills optimistically, the row is written, and
  no Pusher event or feed-cache invalidation fires

### Requirement: Liked surfaces list the profile's likes

With a resolved profile, `/songs` SHALL offer a "Liked" tab
(`?view=liked`) listing liked songs newest-reaction-first with the
shared sort chips and search, plus a "Liked" shelf on the catalog
home. Both SHALL inner-join the shared visibility gate, so a song
whose compilation turns unsuitable hides while its row survives.
Rows SHALL badge the viewer's reaction (heart/thumb-down) wherever
they render.

#### Scenario: Liked tab after reacting

- **WHEN** a kid likes two songs then opens `?view=liked`
- **THEN** both appear newest-first, each playable through the
  `?song=` overlay whose queue is the liked list
