import { sql } from "drizzle-orm";
import { videos } from "@/lib/db/schema";

// The kid-suitability floor — a video failing either clause is never
// shown, no matter who pinned it, so every surface that displays a
// video or accepts a write for one ANDs this fragment into its query:
//
// 1. `age_restricted IS DISTINCT FROM true` — YouTube's own 18+ flag
//    (docs/plans/age-suitability-filter-plan.md). NULL counts as
//    suitable (unknown ≠ adult), the same posture as the MFK gate;
//    stale rows heal via `npm run videos:refresh`.
// 2. `playback_blocked = false` — a player-observed permanent failure
//    (IFrame onError 100/101/150 → POST /api/video-errors). The flag
//    is runtime-written, not API-sourced, so videos:refresh can't
//    clear it; a false positive re-errors once, not per page load.
//
// Enforcement is deliberately query-time (no audience column, no
// ingest drop): a pin on an unplayable video is an inert row,
// surfaced as "Blocked" in the parent dashboard.
export const suitableVideo = sql`
  ${videos.ageRestricted} is distinct from true
  and ${videos.playbackBlocked} = false`;
