import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Prefer the direct (unpooled) endpoint — PgBouncer transaction
    // pooling breaks drizzle-kit migrate's session behavior.
    // `DB_TARGET=staging` (via `npm run db:migrate:staging`) targets
    // the nibrastube_staging database instead of production.
    url:
      process.env.DB_TARGET === "staging"
        ? (() => {
            if (!process.env.STAGING_DATABASE_URL_UNPOOLED) {
              throw new Error(
                process.env.STAGING_DATABASE_URL
                  ? "[drizzle] only the pooled STAGING_DATABASE_URL" +
                      " is set — PgBouncer breaks drizzle-kit" +
                      " migrate; set STAGING_DATABASE_URL_UNPOOLED."
                  : "[drizzle] DB_TARGET=staging but neither" +
                      " STAGING_DATABASE_URL_UNPOOLED nor" +
                      " STAGING_DATABASE_URL is set — refusing to" +
                      " fall back to prod.",
              );
            }
            return process.env.STAGING_DATABASE_URL_UNPOOLED;
          })()
        : (() => {
            if (!process.env.DATABASE_URL_UNPOOLED) {
              console.warn(
                "[drizzle] DATABASE_URL_UNPOOLED unset — migrating" +
                  " through the pooled DATABASE_URL, which PgBouncer" +
                  " can break.",
              );
            }
            // `||` so an empty var counts as unset too.
            return (process.env.DATABASE_URL_UNPOOLED ||
              process.env.DATABASE_URL)!;
          })(),
  },
});
