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
            if (
              !process.env.STAGING_DATABASE_URL_UNPOOLED &&
              process.env.STAGING_DATABASE_URL
            ) {
              console.warn(
                "[drizzle] only the pooled STAGING_DATABASE_URL" +
                  " is set — PgBouncer breaks drizzle-kit migrate;" +
                  " prefer STAGING_DATABASE_URL_UNPOOLED.",
              );
            }
            // `||` so an empty var counts as unset too.
            return (process.env.STAGING_DATABASE_URL_UNPOOLED ||
              process.env.STAGING_DATABASE_URL)!;
          })()
        : (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL!),
  },
});
