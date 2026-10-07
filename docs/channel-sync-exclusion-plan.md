# Plan: Exclude Channels from Sync (parent-scoped)

Feature branch prefix: `feature/` (e.g. `feature/channel-sync-exclusion`).

## Goal

A per-channel pause control on the parent dashboard's **Approved
Channels** card: "stop fetching new videos from this channel for **all
of my kids**". Pausing keeps everything already whitelisted — it is not
an un-approve — it only stops the automatic sync (daily poll +
resumable backfill) from ever touching that channel again until
resumed.

## Facts established by codebase investigation

- **Sync entry points are exactly two.** `syncAllChannels()`
  (`lib/channel-sync.ts`) runs the daily poll/resume via
  `/api/sync-channels` (client-pinged, once/day). `approveChannel`
  (`app/actions/channels.ts:56-73`) fires a one-off `after()` backfill
  at approval time. Both funnel through `backfillChannel` /
  `pollChannel`; there is no cron or third caller.
- **`channels` is a global cache across all families** — a
  `syncEnabled` flag on it would leak across tenants: one family
  pausing a channel would mute it for every other family that approved
  it. The exclusion must be scoped to the **owning parent**
  (`profiles.parentId`), not the channel.
- **`whitelisted_channels` is per (profile, channel)** — a flag there
  gives per-kid granularity, but "for all kids" would mean bulk updates
  on every toggle and future approvals would silently re-enable. A
  parent-keyed exclusion row covers current *and* future approvals with
  one row.
- **Sync query shape** (`syncAllChannels`, `lib/channel-sync.ts:258`):
  `whitelisted_channels ⨝ channels`, `asc(lastSyncAt)` (NULLs re-sorted
  first in JS), `LIMIT 50`. Excluded rows just need filtering out —
  ordering and cap are untouched.
- **Mid-flight guard already exists.** `isChannelApproved` is re-checked
  per backfill page and again inside `upsertVideosAndWhitelist` before
  inserting pins — the exact hook point where "paused mid-run" should
  also abort.
- **Dashboard card precedent:** `ApprovedChannelsCard`
  (`app/parent/dashboard/page.tsx:100-177`) renders per approved
  channel: thumbnail, title, pin count, `lastSyncAt`, `Syncing…` when
  `!backfillComplete`, and a form-bound `SubmitButton` (trash icon) →
  `unapproveChannel`. A second icon button + a "Paused" badge follows
  the same pattern — no new client components.
- **Auth precedent:** mutating actions do `getSession()` →
  `requireParentUnlocked()` → `assertCanManageProfile(session,
  profileId)`. Here there is no single profileId — the natural check is
  "the channel is whitelisted by ≥1 profile this parent manages"
  (`getManageableProfiles` already returns owned + `shared_access`
  profiles).
- **Pause ≠ un-approve:** `unapproveChannel` deletes `viaChannelId`
  pins and tombstones; pausing deletes nothing. Manual pins and
  channel-synced pins all stay playable.

## Data model — one new table

`lib/db/schema.ts`:

```ts
// Channels a parent has muted: sync never fetches uploads for these
// (profile owner) + channel pairs. Survives un-approve/re-approve —
// a muted channel stays muted.
export const channelSyncExclusions = pgTable(
  "channel_sync_exclusions",
  {
    parentId: uuid("parent_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    channelId: text("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    excludedAt: timestamp("excluded_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentId, table.channelId] }),
  })
);
```

Then `npm run db:generate` → `npm run db:migrate`. No backfill needed.

**Why parentId = profile owner:** sync rows are keyed by
`whitelisted_channels.profileId`; the profile's owner decides what the
family's device fetches. Exclusions only ever filter whitelist rows
under that owner's profiles, so a shared-access parent can never mute
(or un-mute) channels for a different family.

## Files to modify

### 1. `lib/channel-sync.ts`

**a. New guard** replacing `isChannelApproved` (same signature +
semantics, now also checks the owner isn't excluded):

```ts
async function isChannelSyncEnabled(profileId: string, channelId: string) {
  const row = await db.query.whitelistedChannels.findFirst({
    where: and(
      eq(whitelistedChannels.profileId, profileId),
      eq(whitelistedChannels.channelId, channelId)
    ),
  });
  if (!row) return false;
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });
  if (!profile) return false;
  const exclusion = await db.query.channelSyncExclusions.findFirst({
    where: and(
      eq(channelSyncExclusions.parentId, profile.parentId),
      eq(channelSyncExclusions.channelId, channelId)
    ),
  });
  return !exclusion;
}
```

Call sites (`backfillChannel` loop, `upsertVideosAndWhitelist`
pre-insert re-check) swap to the new name — a channel paused mid-run
stops fetching further pages and stops inserting pins.

**b. `syncAllChannels` query** — join `profiles` for `parentId`, left
join the exclusion table, filter excluded:

```ts
const rows = await db
  .select({ whitelist: whitelistedChannels, channel: channels })
  .from(whitelistedChannels)
  .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
  .innerJoin(profiles, eq(whitelistedChannels.profileId, profiles.id))
  .leftJoin(
    channelSyncExclusions,
    and(
      eq(channelSyncExclusions.parentId, profiles.parentId),
      eq(channelSyncExclusions.channelId, whitelistedChannels.channelId)
    )
  )
  .where(isNull(channelSyncExclusions.channelId))
  .orderBy(asc(whitelistedChannels.lastSyncAt))
  .limit(MAX_CHANNELS_PER_RUN);
```

### 2. `app/actions/channels.ts`

**a. New action:**

```ts
export async function setChannelSyncExcluded(
  channelId: string,
  excluded: boolean
) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();

  // Collect the owners of every profile this parent manages that
  // whitelists the channel — one exclusion row per owner.
  const manageable = await getManageableProfiles(session.user.id);
  const manageableIds = new Set(manageable.map((p) => p.id));
  const rows = await db
    .select({ ownerId: profiles.parentId })
    .from(whitelistedChannels)
    .innerJoin(profiles, eq(whitelistedChannels.profileId, profiles.id))
    .where(eq(whitelistedChannels.channelId, channelId));
  const ownerIds = [
    ...new Set(
      rows
        .filter((r) => manageableIds.has(...)) // see note below
        .map((r) => r.ownerId)
    ),
  ];
  // ...
}
```

Refinement — the join needs the whitelist `profileId` to test
membership, so `select({ ownerId: profiles.parentId, profileId:
whitelistedChannels.profileId })`, filter `profileId ∈ manageableIds`,
dedupe owners, then:

```ts
if (ownerIds.length === 0) return; // channel not approved under us

if (excluded) {
  await db
    .insert(channelSyncExclusions)
    .values(ownerIds.map((parentId) => ({ parentId, channelId })))
    .onConflictDoNothing();
} else {
  await db
    .delete(channelSyncExclusions)
    .where(
      and(
        inArray(channelSyncExclusions.parentId, ownerIds),
        eq(channelSyncExclusions.channelId, channelId)
      )
    );
}

revalidatePath(`/parent/dashboard`);
```

(In the common single-family case `ownerIds` is one element; the loop
form keeps shared-access edge cases honest. Only the **owner's** id is
written, so a shared parent toggling writes the owner's row — i.e.
pausing actually affects the profiles they see.)

**b. `approveChannel`** — gate the `after()` backfill: before
scheduling (or first thing inside it), look up the profile owner and
skip `backfillChannel` when an exclusion exists. This makes "approve a
paused channel" pin nothing automatically — consistent with "stop
retrieving data from this channel". (Alternative: let the initial
backfill run since approval is explicit — decided against: the mute
should be absolute, and it doubles as an "approve-but-don't-import"
feature.)

### 3. `app/parent/dashboard/page.tsx` (`ApprovedChannelsCard`)

- Third parallel query: the exclusion `channelId`s for
  `session.user.id` (pass `session` or `userId` into the card — it's
  currently only passed `profileId`/`profileName`):
  `db.select({ channelId: channelSyncExclusions.channelId })
     .from(channelSyncExclusions)
     .where(eq(channelSyncExclusions.parentId, userId))`.
- Per row, beside the trash `SubmitButton`, a second form-bound icon
  button:
  - not excluded → `Pause` icon, `aria-label="Pause sync for
    {title}"`, action `setChannelSyncExcluded.bind(null, channel.id,
    true)`;
  - excluded → `Play` icon, `aria-label="Resume sync for {title}"`,
    action `setChannelSyncExcluded.bind(null, channel.id, false)`.
- Excluded rows get a `Paused` text badge (e.g.
  `text-[11px] text-amber-600` · "sync paused for all profiles") and
  suppress the `Syncing…` spinner line (a paused channel with
  `backfillComplete=false` is waiting, not running).
- Both buttons render side-by-side in the same
  `opacity-100 md:opacity-0 md:group-hover:opacity-100` hover pattern
  as the trash button.

### 4. `AGENTS.md` (post-implementation)

- Data model: add `channel_sync_exclusions` bullet.
- Business rules → Channel sync: "exclusions keyed by profile owner;
  paused channels are filtered in `syncAllChannels` and abort
  mid-flight via the approval re-check; approving a paused channel
  skips the backfill."

## UX rules (decisions)

| Case | Behavior |
|---|---|
| Pause a channel | Stops daily poll + resume-backfill for **every** profile owned by the pausing parent; existing videos stay playable |
| Channel approved by 2 kids | One exclusion row mutes it for both |
| Pause mid-backfill | Current page finishes; next page aborts via the guard re-check |
| Approve a paused channel | Approval row is created but the `after()` backfill is skipped — the channel contributes no videos until resumed |
| Resume a channel | Exclusion row deleted; next daily sync continues (`backfillPageToken` resumes mid-catalog, or `pollChannel` picks up new uploads) |
| Un-approve the last profile using a paused channel | Exclusion row **survives** — re-approving later stays muted (rows are tiny; deliberate mute shouldn't silently expire) |
| Shared-access parent pauses | Writes the **owner's** exclusion — affects exactly the profiles the shared parent sees |
| Another family's channel | Unaffected — exclusions are keyed by profile owner, never global |
| Manual pins of channel videos | Unaffected — only `viaChannelId` auto-sync stops |
| `lastSyncAt` while paused | Frozen (row is filtered out, never touched) |

## Alternatives considered

- **Flag on `channels` (`syncEnabled`)** — rejected: global cache,
  leaks across families.
- **Flag on `whitelisted_channels` (`syncEnabled` per row)** —
  rejected as the sole mechanism: per-kid granularity nobody asked for,
  bulk updates per toggle, and future approvals default back to syncing
  (a second place to remember to pause). Could be added later if
  per-kid pause is ever wanted — it composes cleanly with the parent
  exclusion.

## Out of scope / future

- **Per-profile pause** (mute a channel for one kid only) — a
  `whitelisted_channels` flag can layer on later.
- **"Approve without importing"** toggle at approval time — the pause
  mechanism already provides the effect; dedicated UX is separate.
- **Auto-prune exclusions** when a channel is un-approved everywhere.
- Surfacing pause state in the kids UI (`/kids` channel view) — pins
  stay visible; nothing to show.

## Verification

1. `npm run typecheck` and `npm run lint` pass.
2. `npm run db:generate` → `npm run db:migrate`; confirm
   `channel_sync_exclusions` exists.
3. `npm run dev`, parent portal (`/parent/dashboard`):
   - Approved channel shows a pause button; click → "Paused" badge
     appears, `Syncing…` (if present) hides.
   - `GET /api/sync-channels` → new videos from the paused channel do
     **not** land in `whitelisted_videos`; `last_sync_at` unchanged for
     its rows; other channels still sync.
   - Channel approved under a second profile also stops syncing (same
     badge on both profiles' cards).
   - Resume → badge clears; next `/api/sync-channels` picks the channel
     up again (never-synced channels order first).
   - Approve a brand-new channel while paused → whitelist row exists,
     no `whitelisted_videos` rows appear from it.
   - Trash (un-approve) still works on paused channels.
4. DB spot-check: `select * from channel_sync_exclusions;` shows
   `(parent_id, channel_id)`; deleting the row via the UI removes it.
