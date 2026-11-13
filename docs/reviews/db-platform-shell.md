# Review: Schema, DB pool, configs, PWA/APK shell & UI primitives

## Summary

Overall this unit is in good shape: the schema is heavily commented,
migrations are append-only with thoughtful self-healing data fixes, and
the client-shell components (`app-update.ts`, `drag-scroll.tsx`,
`sw.js`) are small and defensive. The main structural gap is indexing —
there are **zero secondary indexes** beyond PKs and three unique
constraints, so several hot queries and every trailing-column FK
cascade path seq-scan. Secondary concerns: a pool comment that
contradicts its own config, a missing `pool.on("error")` handler, dead
schema surface (`shared_access.role`, `invites.email`), the known
`semi: false` Prettier drift, and `"use client"` on primitives that
server components import.

## Strengths

- Schema comments carry real invariants: tombstone semantics
  (schema.ts:233-234), `isShort` derivation (55-57), songs
  `(videoId, startSeconds)` merge rule (82-83), username/email shared
  namespace (22-24), and the "unpin hides, re-pin returns" contract
  for playlist_items (260-263).
- Migrations are exemplary: 0013 backfills `is_short` with the same
  heuristic as app code, 0014/0015 contain well-reasoned self-healing
  data fixes with explanatory comments.
- `drizzle.config.ts:10-12` prefers `DATABASE_URL_UNPOOLED` with a
  comment explaining the PgBouncer pitfall; AGENTS.md documents the
  matching dangerous-command rule.
- `lib/app-update.ts` is genuinely defensive: manifest fetched via
  `CapacitorHttp` (no CORS), APK URL restricted to https on GitHub
  hosts (31-42), throttle stamp only written after a fully validated
  check (95-101), and it never throws.
- `components/drag-scroll.tsx` handles the nasty edge cases:
  pointercancel without click, pointer released outside the window,
  nested non-scrollable tagged ancestors falling through, native
  image-drag suppression, capture-phase listeners, cleanup on unmount.
- `components/pwa-register.tsx` unregisters SW + clears caches in dev
  — prevents the classic stale-chunk trap.
- `public/sw.js` is minimal and correct: cache-first only on
  content-hashed `/_next/static` + `/icons`, everything else
  network-only so authed pages never go stale.
- CI (`android-release.yml:52-57`) fails on cap-sync drift and
  verifies the APK's real `versionCode` before publishing
  `update.json` — the update loop can't lie about versions.
- `lib/db/index.ts` sets `application_name` and `keepAlive` —
  operational niceties most projects skip.

## Issues

1. **med — No secondary indexes anywhere.** Every snapshot in
   `drizzle/meta/` shows `"indexes": {}`; the only non-PK index in all
   16 migrations is `songs_video_start_uniq` (0011). Postgres does not
   auto-index FK columns. Concrete gaps:
   - `videos(channel_id)`: `unapproveChannel`'s tombstone-cleanup
     subquery (`app/actions/channels.ts:180-186`) seq-scans the entire
     video cache — the largest table — on every channel un-approve.
     Also hit by `scripts/refresh-videos.ts:113` (`--channel`) and the
     `?channel=` feed filter (`lib/kids-feed.ts:319`, mitigated by the
     profile-scoped join).
   - `whitelisted_videos(profile_id, via_channel_id) WHERE
     via_channel_id IS NOT NULL`: channel un-approve's pin delete
     (`channels.ts:165-172`) and the dashboard's pin-count group-by
     (`app/parent/dashboard/page.tsx:230-238`) scan every pin of the
     profile. The PK's `profile_id` prefix narrows but can't seek.
   - `watch_history(profile_id, watched_on, last_seen_at)`: the
     history feed filters `watchedOn = date` and orders by
     `watched_on DESC, last_seen_at DESC`
     (`lib/kids-feed.ts:556-566`); the PK's column order
     `(profile_id, video_id, watched_on)` serves neither the date
     equality nor the sort — it scans and sorts all of the profile's
     history rows.
   - `songs(imported_by)`: the "Yours" tab filter
     (`lib/songs-feed.ts:333`) seq-scans a global, append-mostly
     table that only grows.
   - `playlists(profile_id)`: tile query (`lib/kids-feed.ts:919+`).
   - Cascade-side FK indexes: `video_id` is the trailing column of the
     PKs on `whitelisted_videos`, `watch_progress`, `watch_history`,
     `video_reactions`, `playlist_items`, `channel_video_exclusions`;
     `channel_id` trails on `whitelisted_channels` and
     `channel_sync_exclusions`; `profiles.parent_id`,
     `invites.profile_id`, `invites.from_parent_id` and
     `songs.imported_by` are unindexed entirely. Any `videos` delete
     (e.g. `videos:refresh --prune`) seq-scans ~6 child tables per
     row; same for `users`/`channels` deletes.
     Fix: add `index()`/`uniqueIndex()` entries in schema.ts for the
     five hot paths above plus plain indexes on the trailing FK columns,
     then `npm run db:generate`. Severity is med, not high, only because
     current row counts are family-scale.

2. **med — Pool comment contradicts config.**
   `lib/db/index.ts:5-7` says connections are kept alive "longer than
   pg's 10s default" to avoid a ~0.5 s handshake per navigation, but
   line 15 sets `idleTimeoutMillis: 10_000` — exactly the default.
   Either the intended value was never applied (raise to e.g. 60_000)
   or the comment is stale. As written, every >10 s gap between clicks
   pays the cold handshake the comment describes avoiding.

3. **med — No `pool.on("error")` handler** (`lib/db/index.ts:11-18`).
   `pg.Pool` emits `'error'` when an *idle* client dies — which Neon
   does routinely (PgBouncer `server_idle_timeout`, compute
   suspend/resume). An unhandled `'error'` event on an EventEmitter
   throws in Node, so a long-lived `next start` or dev server can
   crash on an idle-connection drop it should have shrugged off. Add
   `pool.on("error", (e) => console.error("pg idle client error", e))`.

4. **med — `capacitor.config.ts:11-14` silently falls back to
   `https://nibrastube.example.com`** when `CAPACITOR_SERVER_URL` is
   unset. In CI this comes from `vars.APP_URL`
   (`android-release.yml:34`); if that variable is ever unset or
   renamed, the release pipeline signs and publishes an APK whose
   WebView loads a dead placeholder domain. Fail fast instead: throw
   when the env var is missing (or gate the fallback behind
   `NODE_ENV !== "production"`).

5. **med — `"use client"` on `ui/button.tsx:1` and `ui/label.tsx:1`
   ships JS for server-rendered chrome.** `Button` is imported by at
   least six server components (`app/parent/dashboard/page.tsx`,
   `_components/video-preview.tsx`, `_components/channel-detail.tsx`,
   `app/parent/profiles/page.tsx`, `app/invite/[token]/page.tsx`,
   `components/dashboard-video-card.tsx`), so every dashboard render
   hydrates Button instances and pulls `@base-ui/react` + `cva` +
   `tailwind-merge` into the client bundle for what is often just a
   styled `<Link>`/`form action` button. `ui/input.tsx` proves
   `@base-ui/react` renders fine without the directive (it has none
   and is used in client forms via their own boundary). Remove the
   directive from button/label — client callers keep working through
   their own `"use client"` boundary.

6. **med — Prettier `semi: false` vs all-semi codebase**
   (`.prettierrc:3`). Documented in AGENTS.md, but still live drift:
   `npm run format` (`package.json:11`) would strip semicolons
   repo-wide in one giant noise diff. Fix one side: flip the config to
   `"semi": true` (matches every source file) or accept a one-time
   reformat — don't leave the trap armed.

7. **med — Dead schema surface.**
   - `shared_access.role` (schema.ts:299): `acceptInvite` always
     writes `"editor"` (`app/actions/invites.ts:65`); nothing ever
     reads the column and no `"viewer"` grant path exists. Drop it or
     implement the read tier.
   - `invites.email` (schema.ts:309): collected at invite creation
     (`invites.ts:21-27`) but never used — no email is sent, and
     `acceptInvite` doesn't bind the invite's email to the accepting
     account, so anyone holding the token can claim it (documented as
     token-as-credential, making `email` purely decorative).
   - `invites.status` allows `"rejected"` per the comment but nothing
     sets it; expired-but-never-accepted rows stay `"pending"`
     forever (no cleanup).

8. **low — `package.json` hygiene.**
   - `shadcn` (line 42) is a codegen CLI in `dependencies` — move to
     `devDependencies` (or drop; `components.json` registries don't
     need it at runtime).
   - `@types/bcryptjs` (line 51) is redundant — bcryptjs 3.0.3 bundles
     `index.d.ts` (verified in `node_modules/bcryptjs/package.json`
     `types` field).
   - `format` covers only `**/*.{ts,tsx}` — misses `.mjs`, `.json`,
     `.md`, `.css` even though the repo enforces 79 cols on every file
     type.
   - No `check`/`ci` aggregate script (`typecheck && lint`); minor.

9. **low — `theme-provider.tsx` forces light** (`forcedTheme="light"`)
   yet stays mounted in `app/layout.tsx:60`, shipping `next-themes`
   client JS + a context wrapper, while dozens of `dark:` variants in
   `ui/*` and elsewhere are dead code. Either remove the provider and
   the dark variants, or commit to dark mode. As-is it's the worst of
   both.

10. **low — `tsconfig.json` could be stricter**: no
    `noUncheckedIndexedAccess` (band-aid fixes like
    `p_projects` lookups `byId.get(id)` are already manual), and
    `allowJs: true` sweeps `public/sw.js` and any stray JS into the
    typecheck program. Both optional; current strictness passes.

11. **low — `max: 3` pool size vs parallel page queries.**
    `app/parent/dashboard/page.tsx` fires `Promise.all` batches at
    lines 134, 223, 386, 468, and the kids feed streams several
    Suspense-boundary queries concurrently. With 3 slots the excess
    queue on connection acquisition; on a warm serverless instance
    this adds latency under load. Fine while traffic is one family —
    revisit to ~6 if traces show `queueing` time. (The 10 s
    `connectionTimeoutMillis` is also what a stuck query waits before
    erroring — acceptable.)

12. **low — `videos.raw` / `channels.raw` jsonb is ~9 KB/row**
    (noted at `app/parent/dashboard/page.tsx:119`) and largely
    duplicates the promoted columns; it's only read for upsert
    passthrough (`lib/video-cache.ts:45`). Consider dropping it, or
    storing only fields not yet promoted, once refresh flows no
    longer depend on it.

13. **low — Cross-table login-identifier uniqueness is app-enforced
    only.** `users.email` and `profiles.username` share one namespace
    by convention (schema.ts:22-24 comment), but no DB constraint can
    span tables — a concurrent signup + `setKidCredentials` could both
    pass their checks. Acceptable at family scale; worth a comment in
    the two write paths noting the accepted race.

14. **low — 79-col violations in reviewed files.** `lib/db/schema.ts`
    has 15 lines >79 (line 1's 133-char import, comment lines like
    27/38/121); `components/ui/*` have ~19 (mostly generated Tailwind
    class strings — arguably formatter output and exempt);
    `drag-scroll.tsx` and `public/sw.js` have one each. Minor; fix the
    schema import/comment lines when next editing the file.

15. **low — `sw.js` cache name is pinned at `nibrastube-v1`.** Safe
    today (only content-hashed assets are cached), but bump the name
    whenever the fetch strategy changes, or old clients keep the stale
    cache forever. Also note `/icons` URLs aren't hashed — if an icon
    is ever regenerated (`scripts/generate-icons.mjs`), cached copies
    persist until the cache name changes. Easiest fix: include the
    icon set in the name bump habit, or let icon responses be
    network-first.

16. **low — `next.config.mjs` is entirely empty.** Works, but it's
    the natural home for `serverExternalPackages: ["pg"]` (pg ships
    native-ish bindings and prefers external resolution) and
    `poweredByHeader: false`. Optional hardening.

## Refactor suggestions

1. Add a `0016_*` migration with the indexes from issue 1 — highest
   real-world impact: `videos(channel_id)`,
   `whitelisted_videos(profile_id, via_channel_id) partial`,
   `watch_history(profile_id, watched_on desc, last_seen_at desc)`,
   `songs(imported_by)`, `playlists(profile_id)`, plus plain indexes
   on every trailing FK column (`video_id`, `channel_id`,
   `parent_id`, `profile_id` where not PK-leading).
2. Fix the pool in one pass: `idleTimeoutMillis: 60_000`,
   `pool.on("error")` handler, and correct the comment to match.
3. Remove `"use client"` from `ui/button.tsx` and `ui/label.tsx`;
   verify `npm run typecheck && npm run build` and a manual dashboard
   click-through.
4. Decide the Prettier `semi` question once (config → `true`), run
   `npm run format`, and stop carrying the AGENTS.md caveat.
5. Trim dead surface: drop `shared_access.role` and `invites.email`
   (or implement their intended semantics), move `shadcn` to
   devDependencies, drop `@types/bcryptjs`, delete the empty `hooks/`
   dir or its unused `components.json` alias.
6. Fail fast on missing `CAPACITOR_SERVER_URL` in release builds;
   optionally add `serverExternalPackages: ["pg"]` to next.config.
7. If dark mode is genuinely not coming: remove `ThemeProvider` +
   `next-themes` and delete dead `dark:` classes from `ui/*`.
