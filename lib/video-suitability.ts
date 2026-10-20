import { sql } from "drizzle-orm";
import { videos } from "@/lib/db/schema";

// The 18+ hard floor (docs/plans/age-suitability-filter-plan.md):
// `videos.age_restricted` is YouTube's own flag — a video carrying it
// is never kid-suitable, no matter who pinned it, so every surface
// that displays a video or accepts a write for one ANDs this fragment
// into its query. Enforcement is deliberately query-time (no audience
// column, no ingest drop): a pin on a restricted video is an inert
// row, surfaced as "Blocked" in the parent dashboard.
// `IS DISTINCT FROM true` — NULL flags count as suitable (unknown ≠
// adult), the same posture as the MFK gate and the old visibleVideo
// predicate; stale rows heal via `npm run videos:refresh`.
export const suitableVideo = sql`
  ${videos.ageRestricted} is distinct from true`;
