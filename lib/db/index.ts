import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Remote Postgres: keep connections alive longer than pg's 10s default so
// leisurely clicks don't pay a fresh TCP+TLS+auth handshake (~0.5s) per
// navigation. DATABASE_URL points at Neon's pooled (PgBouncer) endpoint,
// which multiplexes many client connections onto few real backends, so the
// lambda-side pool size no longer risks exhausting the server — max stays
// small only to bound per-instance memory and connection churn.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: "nibrastube",
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

export const db = drizzle(pool, { schema });
