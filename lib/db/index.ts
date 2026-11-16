import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Remote Postgres: keep connections alive longer than pg's 10s default so
// leisurely clicks don't pay a fresh TCP+TLS+auth handshake (~0.5s) per
// navigation. DATABASE_URL points at Neon's pooled (PgBouncer) endpoint,
// which multiplexes many client connections onto few real backends, so the
// lambda-side pool size no longer risks exhausting the server — max stays
// small only to bound per-instance memory and connection churn.
//
// Staging: every Vercel preview deploy (VERCEL_ENV=preview — the `staging`
// branch's soak environment and per-PR previews) uses STAGING_DATABASE_URL,
// a separate `nibrastube_staging` Neon database owned by a dedicated
// `nibrastube_staging` role. Preview deploys must never write to prod.
// DATABASE_URL remains the fallback so previews keep working until the
// dashboard env var is added (Preview scope) — but a preview falling back
// to prod must be loud, not silent.
const isPreview = process.env.VERCEL_ENV === "preview";
if (isPreview && !process.env.STAGING_DATABASE_URL) {
  console.warn(
    "[db] VERCEL_ENV=preview but STAGING_DATABASE_URL is unset — " +
      "falling back to DATABASE_URL (production). Set the " +
      "Preview-scoped env var in the Vercel dashboard.",
  );
}
const databaseUrl = isPreview
  ? (process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

const pool = new pg.Pool({
  connectionString: databaseUrl,
  application_name: "nibrastube",
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

export const db = drizzle(pool, { schema });
