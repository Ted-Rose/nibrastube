# Spec Delta

## Purpose

Defines the stale-while-revalidate caching layer for the kids
portal so repeat navigations serve instantly instead of paying a
serial database round trip per click, while whitelist mutations
still take effect for every device on the very next read.

## ADDED Requirements

### Requirement: Kids feed reads are served from a bounded cache

Read queries that populate the kids portal feed and the watch
page queue SHALL be cached with a TTL of roughly 10 minutes. A
cache hit SHALL return the stored rows without querying the
database; a miss or expired entry SHALL recompute and store the
result for the next reader.

#### Scenario: Repeat feed visit is instant

- **WHEN** a kid navigates to a feed view whose identical read
  was computed within the TTL
- **THEN** the rows are served from cache with no database query
  for that read

#### Scenario: Expired entry recomputes

- **WHEN** a cached feed entry is older than the TTL
- **THEN** the next read recomputes it from the database and
  stores the fresh result

### Requirement: Cache entries are scoped per profile and params

Cached feed data SHALL be keyed by the profile and the full query
parameters of the read (view, sort, filters, cursor), so one
profile's or one filter combination's data is never served to
another.

#### Scenario: Two profiles never share feed rows

- **WHEN** profile A's feed is cached and a device requests
  profile B's feed
- **THEN** profile B's read computes its own data and cannot
  return rows cached for profile A

### Requirement: Content mutations invalidate the profile's cache

Every mutation that changes what a profile's feed or watch page
may contain — pin, unpin, channel approve/un-approve, reactions,
channel-sync inserts, profile edits — SHALL invalidate that
profile's cached feed entries before responding, so the next
read on any device sees fresh data.

#### Scenario: Pin appears on the next read

- **WHEN** a parent pins a video for a profile and a cached feed
  entry exists for that profile
- **THEN** the next feed read on any device recomputes and
  includes the pinned video

### Requirement: Recommendations and watch progress stay live

The For-You ranking query SHALL NOT be cached, so the daily
re-rank and per-request seeds keep working. Watch progress
(resume position, progress bars) SHALL be read live and merged
into cached feed rows per request, never served from the cache.

#### Scenario: Resume position reflects the last session

- **WHEN** a kid stops a video mid-way and reloads the app
  within the cache TTL
- **THEN** the watch page resumes at the beacon-recorded
  position, not the position cached before the session

#### Scenario: Recommendations re-rank normally

- **WHEN** the For-You feed is requested twice in a day
- **THEN** each request re-evaluates the ranking rather than
  serving a cached list

### Requirement: Repeat navigations reuse the client route cache

The client router SHALL retain visited route payloads for a few
minutes so back-and-forth navigation and tab/sort switches do
not trigger a server fetch. An explicit refresh (Pusher event,
mutation) SHALL always bypass this cache.

#### Scenario: Tab switch within the window is instant

- **WHEN** a kid switches feed tabs and returns within the
  router-cache window
- **THEN** the earlier view renders without a new server request

#### Scenario: Refresh always refetches

- **WHEN** a whitelist Pusher event triggers a route refresh
  while a cached route payload exists
- **THEN** the refresh fetches fresh data from the server

### Requirement: Watch startup is warmed during feed browsing

While the kid browses the feed, the app SHALL pre-warm the
YouTube player assets and MAY prefetch watch routes on pointer
intent, so the tap-to-play delay excludes script download where
the asset is already loaded.

#### Scenario: Player API ready before the tap

- **WHEN** a kid opens a video after browsing the feed
- **THEN** the YouTube IFrame API script is already loaded and
  does not add to the watch-page startup time
