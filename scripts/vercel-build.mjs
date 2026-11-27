// Vercel build entrypoint — package.json's `vercel-build` script overrides
// the default `next build` for Vercel deployments only (local `npm run
// build` and the Cloud Run Docker image are unaffected; a Build Command
// override in the Vercel dashboard would bypass this entirely).
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
//
// Caveat: migrate-then-build leaves a window where the OLD deployment
// still serves traffic against the NEW schema (worse if the build then
// fails). Additive migrations are safe; destructive ones need an
// expand→contract two-deploy sequence.
import { spawnSync } from "node:child_process";

const attempt = (cmd, args, env) => {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env,
    // Windows .bin shims are .cmd files and need a shell to exec.
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`[vercel-build] spawn ${cmd} failed:`, result.error);
  }
  if (result.signal) {
    console.error(`[vercel-build] ${cmd} killed by ${result.signal}`);
  }
  return result.status ?? 1;
};

if (process.env.VERCEL === "1") {
  const env = { ...process.env };
  const isPreview = env.VERCEL_ENV === "preview";
  if (isPreview) env.DB_TARGET = "staging";
  else delete env.DB_TARGET;
  let status = attempt("drizzle-kit", ["migrate"], env);
  if (status !== 0) {
    // Concurrent builds race on __drizzle_migrations — retry once after a
    // short wait rather than spuriously failing the deploy.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    status = attempt("drizzle-kit", ["migrate"], env);
  }
  if (status !== 0) process.exit(status);
}

process.exitCode = attempt("next", ["build"], process.env);
