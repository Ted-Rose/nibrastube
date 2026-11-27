// Vercel build entrypoint — package.json's `vercel-build` script overrides
// the default `next build` for Vercel deployments only (local `npm run
// build` and the Cloud Run Docker image are unaffected).
//
// Applies pending Drizzle migrations BEFORE building so a deploy can never
// serve code ahead of its schema. Preview builds migrate the
// `nibrastube_staging` database (DB_TARGET=staging → drizzle.config.ts
// reads STAGING_DATABASE_URL_UNPOOLED/STAGING_DATABASE_URL); production
// builds migrate prod via DATABASE_URL_UNPOOLED/DATABASE_URL. Both
// unpooled vars must exist in the Vercel project env — PgBouncer
// transaction pooling breaks drizzle-kit migrate, and if the staging URL
// is missing on a preview build the migrate fails loudly instead of
// silently falling back to prod.
import { spawnSync } from "node:child_process";

const run = (cmd, args, env) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (process.env.VERCEL === "1") {
  const env = { ...process.env };
  if (env.VERCEL_ENV === "preview") env.DB_TARGET = "staging";
  run("drizzle-kit", ["migrate"], env);
}

run("next", ["build"], process.env);
