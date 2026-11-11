# Code reviews — October 2026 audit

Point-in-time, read-only audit of the codebase (ten unit reviews +
one consolidated report), conducted 2026-10-27 against `main`
around the kid-login / Neon-migration era. These files are kept as
**historical reference**, not a living backlog — line numbers and
issue statuses drift as the code moves, so trust the code over any
finding here.

## Reading order

- `OVERALL.md` — start here: consolidated, deduplicated,
  severity-ranked master issue list (#1–#46) with a "what's
  healthy" section. Every `#N` referenced elsewhere in the repo
  resolves against this file.
- The ten unit reports — per-domain detail: severity rationale,
  line refs, and verified repros behind each OVERALL entry:

| File                     | Domain reviewed                          |
|--------------------------|------------------------------------------|
| `architecture.md`        | Module layout, bundling, cross-cutting   |
| `auth-flows-gates.md`    | Login, PIN gate, invites, shared access  |
| `auth-session-routing.md`| JWT/cookie model, `proxy.ts` routing     |
| `db-platform-shell.md`   | Schema/indexes, pool, config, PWA shell  |
| `kids-portal-feed.md`    | Kids feed queries, paging, URL params    |
| `parent-portal.md`       | Dashboard, pinning, channel approval     |
| `playlists-realtime.md`  | Playlist actions + Pusher wiring         |
| `songs-domain.md`        | Song catalog, imports, timestamp parser  |
| `watch-playback-apis.md` | Watch page, player lifecycle, beacons    |
| `youtube-sync.md`        | YouTube API layer + daily channel sync   |

## Status

Findings were burnt down via the refactoring program that used to
live in `docs/plans/` — component-structure work (dashboard split,
`useTokenPager`, `useYouTubePlayer`, `onError` resilience,
generation-guarded paging) already shipped. The still-open work is
tracked as proposals under `openspec/changes/2026-11-11-*` (each
references the OVERALL issue numbers it resolves); new planning
goes through `openspec changes`, never new `docs/plans/` files
(AGENTS.md rule 11).
