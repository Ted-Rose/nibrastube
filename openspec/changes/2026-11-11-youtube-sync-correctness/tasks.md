# Tasks

## 1. YouTube request layer

- [ ] 1.1 Add private `ytGet(path, params)` to `lib/youtube.ts`
      (BASE_URL + key guard + 15 s timeout); move
      `QuotaExceededError` there and throw it on 403/429 quota
      bodies; collapse the 8 duplicated API-key guards
- [ ] 1.2 `getVideoDetails` → `FullVideoDetails | null`; friendly
      "video not found" in `pinVideo`
- [ ] 1.3 Refuse `embeddable !== true` in `pinVideo` and
      `getOrFetchVideo` (existing row AND fresh fetch)

## 2. Pin/tombstone correctness

- [ ] 2.1 `unpinVideo`: `DELETE … RETURNING via_channel_id`;
      tombstone also when `videos.channelId` is approved for the
      profile
- [ ] 2.2 `approveChannel` `after()`: skip `backfillChannel` when
      `backfillComplete`

## 3. Poll correctness

- [ ] 3.1 Union `channel_video_exclusions` into the `known` lookup
- [ ] 3.2 Persist a resume cursor when the 5-page cap hits without
      a known id (D7 rec: reuse `backfillPageToken` +
      `backfillComplete=false`; user-run `db:migrate` only if the
      dedicated column is chosen instead)
- [ ] 3.3 `syncAllChannels` `NULLS FIRST` ordering via `sql`;
      `triggerPinned` → `notifyProfile` (after the realtime
      change lands)

## 4. Verification

- [ ] 4.1 `npm run typecheck && npm run lint`
- [ ] 4.2 Manual: pin a dead/private id → friendly error; unpin a
      manual pin on an approved channel → trigger
      `/api/sync-channels` → no resurrection; re-approve a
      completed channel → no re-backfill; forced 403 → quota
      abort in logs, not TypeError

## Hand-off (user-run)

- [ ] H1 `npm run db:migrate` — only if D7 lands as the dedicated
      `poll_page_token` column (recommended path needs none)
