# Plan: Always-on suitability filter for the 13+ audience

**Status: implemented** (`feature/age-suitability`)

Decisions locked by the user (differ from the A+C+B recommendation):

- **Policy = Tier A+B.** `age_restricted` is a hard floor — an 18+
  video is never playable or displayed to kids on ANY surface, even
  if whitelisted. `made_for_kids` stays exactly as the code already
  behaves: filtered on unvetted surfaces (search hydration, `/songs`
  catalog), exempt for parent-approved content.
- **Mechanism = Option B only.** Query-time `suitableVideo` guard
  (`lib/video-suitability.ts`) — no `audience` column, no schema
  change, no ingest-time drops, no tombstoning in channel-sync code
  paths. Restricted pins become inert rows; the parent dashboard
  labels them "Blocked" instead of letting them vanish silently.
- Existing restricted pins are cleaned by a data-only migration
  (`0015_age_restricted_pin_cleanup`): tombstone channel-synced
  restricted pins, then delete all restricted pins.
- Open questions 1–4 resolved accordingly (A+B, NULL = suitable,
  unpin + tombstone, MFK path unchanged).

Feature branch prefix: `feature/` (e.g. `feature/age-suitability`).

## Goal

Guarantee that a video **unsuitable for a 13+ audience can never be
played in the app** — not by search, not by manual pin, not by channel
sync, not by songs import — no matter which code path carried it in.
Two layered questions:

1. **What counts as unsuitable** (the policy), and
2. **Where the filter is enforced** (code at ingest, code at query, or
   a database-level mechanism).

## Facts established by investigation

### Signals already cached per video (`lib/db/schema.ts`, `videos`)

| Column | Source | Meaning |
|---|---|---|
| `made_for_kids` | `status.madeForKids` | Uploader-declared under-13 |
| `age_restricted` | `contentDetails.contentRating.ytRating === "ytAgeRestricted"` | YouTube's own 18+ flag |
| `privacy_status` | `status.privacyStatus` | public / unlisted / private |
| `live_broadcast_content` | `snippet.liveBroadcastContent` | none / live / upcoming |
| `category_id` | `snippet.categoryId` | broad topic bucket |
| `embeddable` | `status.embeddable` | already a hard filter |
| `raw` | whole videos.list item | preserves **unparsed** `contentRating` fields: `acbRating`, `mpaaRating`, `tvpgRating`, `bbfcRating`, … |

**YouTube exposes no 13–17 rating.** The API gives exactly two
age-relevant booleans: `madeForKids` (under-13) and `ytAgeRestricted`
(18+). "Suitable for 13+" therefore decomposes into which of these
flags we treat as disqualifying. Regional rating systems in
`contentRating` (MPAA R/NC-17, ACB R18+, TVPG TV-MA, …) offer more
granularity for free — they're already inside `raw` — and can be
promoted later without new API parts.

### Current data (production Neon, 2026-10-20)

| Table | Total | `age_restricted` | `made_for_kids` | NULL flags |
|---|---|---|---|---|
| `videos` | 13,839 | **3** | 4,053 | `age_restricted` NULL: 25 (stale, `fetched_at` NULL) |
| `whitelisted_videos` | 13,488 | **5 pins → 3 videos** | 2,437 pins | 0 |
| `songs` | 4 | 0 | — | — |
| `watch_history` | 290 | 0 | — | — |

A restricted drop therefore affects almost nothing today (5 pins), but
the mechanism matters going forward. MFK is the bulk signal — the
policy decision below is really about it.

### Every path a video can enter `videos`

1. **`pinVideo`** (`app/actions/pinning.ts`) — `getVideoDetails` →
   insert/update → `whitelisted_videos` insert.
2. **Channel sync** (`lib/channel-sync.ts`) — `getUploadsPage` (ids
   only) → `getVideosBatch` → `upsertVideoRows` →
   `whitelisted_videos` inserts. Used by `backfillChannel`,
   `pollChannel`, `syncAllChannels`.
3. **`refreshVideoIds`** (`lib/video-cache.ts`,
   `scripts/refresh-videos.ts`) — `getVideosBatch` → `upsertVideoRows`.
4. **Songs import** (`app/actions/songs.ts`) — `getVideoDetails` for
   the compilation → `videos` insert → `songs` rows.
5. **`searchYouTube`** (`lib/youtube.ts`) — `getVideosBatch` hydration
   only (never persisted).

### Every surface a video can be displayed or played

- `lib/kids-feed.ts` — all kids-portal feeds + watch-page playlist
  (whitelist-sourced only).
- `lib/songs-feed.ts` — public `/songs` catalog (joins `videos`).
- Watch page (`app/kids/[profileId]/watch/[videoId]/page.tsx`) —
  whitelist membership check, redirects otherwise.
- `/api/watch-progress`, `/api/video-reactions` — whitelist-checked.
- `components/watch-experience.tsx` — 500 ms rogue-video snapback.
- Parent dashboard — `searchYouTube` results, whitelisted lists,
  song imports.

### Lesson from the just-fixed regression

The madeForKids drop inside the shared `getVideosBatch` helper
silently emptied channel sync (#regression fixed in 9ed8f6e): callers
saw "0 details" and could not distinguish "all blocked" from "all
private". **Any future ingest-side drop must return rejections
explicitly**, and the enforcement must not live inside a shared
fetcher where a display policy can poison ingestion.

## Decision 1 — the policy: what is "unsuitable"

| Tier | Rule | Effect | Blast radius today |
|---|---|---|---|
| **A (floor)** | drop `age_restricted = true` | YouTube-18+ never plays | 5 pins, 3 rows |
| **B** | A + drop `made_for_kids` **on unvetted surfaces only** (search, `/songs`) | current status quo | +0 pins |
| **C** | A + drop `made_for_kids` everywhere | reinstates the reverted gate; kills kids' channels | +2,437 pins |
| **D** | A + drop `live_broadcast_content ∈ {live, upcoming}` | unvetted livestreams never play | 7 rows, 0 pins |

Recommendation: **A + B** — an 18+ hard floor everywhere (even parent
approval can't override it), MFK filtered only where content is
unvetted. Tier C is listed for completeness; it contradicts the
product's purpose. Tier D is optional hardening (live content can't
be vetted by metadata).

Optional later signal (out of scope for v1): keyword heuristics on
title/description/tags — high false-positive risk against "adult
swim" style false friends; skip.

**NULL posture:** treat unknown flags as *suitable* (consistent with
every existing `visibleVideo`-style predicate). `fetched_at IS NULL`
marks the 25 stale rows; the refresh script heals them. Strict
"unknown = blocked" would hide 25 cached rows for no real signal.

## Decision 2 — the mechanism: where to enforce

### Option A — ingest-time drop (code only)

A single `isKidSuitable(details)` predicate in `lib/youtube.ts`;
fetchers return `{ items, rejected }` instead of silently dropping.
Callers act per-context:

- `upsertVideosAndWhitelist` skips rejected ids **and tombstones them**
  in `channel_video_exclusions` so `pollChannel` stops re-fetching the
  same rejected ids forever (otherwise every daily poll burns quota
  on them).
- `pinVideo` / songs import return a `reason` so the dashboard can
  show "Blocked: age-restricted" instead of failing silently
  (requires actions to return a result — today they `return` void).
- `searchYouTube` filters as now, but reports nothing (display only).

+ Content never persists; smallest storage/visibility surface.
− Restricted pins *of already-cached videos* must also be refused in
  `pinVideo`'s `existingVideo` branch (the fetch never happens). Drift
  (a video that becomes 18+ later) is invisible until refresh.

### Option B — query-time filter (code only)

A `suitableVideo` WHERE fragment (or join) applied in `kids-feed`,
`songs-feed`, watch page, and the two write APIs — the same shape as
the removed `visibleVideo`, driven by the chosen tier.

+ Trivial, instantly reversible by editing one predicate.
− **Repeats the exact UX bug just fixed**: pins exist but are
  invisible — "channel added, no videos". Requires a "Blocked" badge
  in the dashboard to stay honest. Whitelisted_videos accumulates
  dead rows.

### Option C — classification column ("smarter change in the table")

`videos.audience` — `text` CHECK-constrained to
`'kids' | 'general' | 'adult' | NULL` (NULL = unclassified/stale):

- Computed **once** in `videoRowValues()`/`upsertVideoRows` (the only
  writers), so every insert path — pin, sync, refresh, songs —
  classifies identically with no per-caller code.
- Or a Postgres **generated column** for the trivial tiers:
  `CASE WHEN age_restricted THEN 'adult' WHEN made_for_kids THEN
  'kids' ELSE 'general' END` — DB-side truth, impossible for app code
  to forget. Works because the v1 rule is a pure per-row function;
  if later tiers need external data (keyword lists), generated must
  go back to app-computed.
- Partial index `WHERE audience = 'adult'` is pointless for lookups,
  but feeds get a cheap `audience IS DISTINCT FROM 'adult'` scan
  term.
- Unlocks later work this plan shouldn't do now: per-profile age
  bands (`profiles.minAge`), a parent dashboard "Blocked items"
  report, per-tier retention.

+ Single source of truth; drift visible via `videos:refresh`;
  enables reporting & future per-kid ages; pins on blocked videos can
  be surfaced as "blocked" rather than vanished.
− Schema migration + app enforcement still required; doesn't by
  itself stop inserts.

### Option D — hard database enforcement

CHECK/trigger on `videos` refusing `audience='adult'` writes, or a
trigger on `whitelisted_videos` refusing pins on restricted videos.

+ Truly "always" — no code path can bypass it.
− Errors surface far from their cause (a backfill page fails on one
  video); refresh script must be updated to not fight the trigger;
  migrations to relax the policy become heavy. Recommended only as a
  **backstop** on top of C, not instead of it — and only if the
  guarantee must survive buggy app code.

## Recommendation — A + C + B as defense-in-depth

1. **`videos.audience` column** (Option C, app-computed in
   `videoRowValues`, migration backfills from existing flags).
   Rule v1: `age_restricted → 'adult'`, `made_for_kids → 'kids'`,
   else `'general'`, NULL flags → NULL.
2. **Ingest drop for `'adult'`** (Option A): the shared fetch path
   reports rejected ids; channel sync tombstones them; pin/song
   actions return a block reason for the dashboard.
   *This is the "always" guarantee*: an 18+ video can never be
   pinned, synced, imported, or searched.
3. **Query-layer guard** (Option B) `audience IS DISTINCT FROM 'adult'`
   in kids-feed + songs-feed + watch page + the two write APIs —
   belt-and-suspenders for rows classified before the column existed
   or reclassified later.
4. **`made_for_kids` unchanged from today**: exempt for
   parent-approved content, filtered on search + `/songs` (the gate
   as it stands after 9ed8f6e).

### Migration sketch (`0015_*.sql`)

```sql
ALTER TABLE "videos"
  ADD COLUMN "audience" text
  CHECK ("audience" IN ('kids','general','adult'));

UPDATE "videos" SET "audience" = CASE
  WHEN "age_restricted" THEN 'adult'
  WHEN "made_for_kids"  THEN 'kids'
  ELSE 'general' END;
-- NULL flags stay NULL = unclassified (healed by videos:refresh).

-- Remove the 5 existing restricted pins; tombstone them so the next
-- channel sync doesn't re-pin (and doesn't re-fetch) them.
INSERT INTO "channel_video_exclusions" ("profile_id", "video_id")
SELECT wv."profile_id", wv."video_id"
FROM "whitelisted_videos" wv JOIN "videos" v ON v."id" = wv."video_id"
WHERE v."age_restricted" AND wv."via_channel_id" IS NOT NULL
ON CONFLICT DO NOTHING;

DELETE FROM "whitelisted_videos" wv
USING "videos" v
WHERE v."id" = wv."video_id" AND v."age_restricted";
```

(Keeping the 3 `videos` rows is fine — they're inert once unpinned
and the query guard hides them; deleting them would cascade
`watch_history`/`watch_progress`/`video_reactions` unnecessarily.)

### Parent UX

- `pinVideo`/songs import return `{ ok: false, reason: "age-restricted" }`
  → dashboard toast (actions currently return `void`; small contract
  change, matches the invite-accept precedent).
- Optional v2: "Blocked" count chip on the Approved Channels card and
  a "blocked" tile state in drill-ins (pins kept, labeled).

### Drift & refresh

- Uploaders can flip `madeForKids`; YouTube can flag a video 18+ at
  any time. `videos:refresh`/`refreshVideoIds` rewrites `audience`
  with every row; a video that turns `'adult'` is hidden by the
  query-layer guard immediately — its pins stay but are inert.
  (Optional follow-up: sweep unpin on reclassification.)

## Task breakdown

1. `drizzle` migration 0015: `audience` column + CHECK + backfill +
   restricted-pin removal + tombstones (above).
2. `lib/youtube.ts`: `classifyAudience(details)` + audience in
   `videoRowValues`; `getVideosBatch`/`getVideoDetails` return
   `{ items, rejected }` (or a `blockedReason` field).
3. `lib/channel-sync.ts` `upsertVideosAndWhitelist`: skip rejected,
   write tombstones, log counts.
4. `app/actions/pinning.ts`, `app/actions/songs.ts`: refuse
   `'adult'`/rejected items incl. the already-cached branch; return
   `{ ok, reason }`; dashboard surfaces the reason.
5. `lib/kids-feed.ts`, `lib/songs-feed.ts`, watch page,
   `/api/watch-progress`, `/api/video-reactions`:
   `audience IS DISTINCT FROM 'adult'` guard.
6. `scripts/refresh-videos.ts`: reclassifies automatically via
   `upsertVideoRows` — verify; document.
7. `AGENTS.md`: replace the "13+ audience gate" bullet with the
   tier model + the `audience` invariant.
8. Verification: approve a channel containing an 18+ upload → pin
   shows blocked toast, sync log counts it, `channel_video_exclusions`
   gains the row; pin an 18+ video manually → refused; `/songs`
   unchanged for MFK.

## Open questions

1. **Policy tier** — A (18+ only), A+B (recommended), A+B+D
   (also block live), or C (also drop MFK everywhere)?
2. **NULL `age_restricted`** on stale/omitted rows — allow
   (recommended) or block?
3. **Existing 5 restricted pins** — unpin + tombstone (recommended,
   in the migration) or leave pins and rely on the query guard?
4. **MFK on unvetted surfaces** — keep as today, or fold into the
   same `audience`-based predicate for one code path?
