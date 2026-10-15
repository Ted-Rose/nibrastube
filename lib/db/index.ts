import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Remote Postgres: Aiven free plan caps the whole service at
// max_connections=20 (~17 usable) and each warm Vercel lambda owns a
// pool, so max: 2 bounds the worst-case slots a burst of instances can
// hold. Frozen lambdas defeat idleTimeoutMillis — Vercel suspends the
// event loop between invocations, so the idle reaper never fires while
// a lambda is parked — but 1.5s still releases slots quickly between
// requests on a live instance. application_name lets pg_stat_activity
// attribute connections to this app.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 1_500,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  application_name: "nibrastube",
});

export const db = drizzle(pool, { schema });
