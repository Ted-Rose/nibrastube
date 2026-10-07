import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Remote Postgres: keep connections alive longer than pg's 10s default so
// leisurely clicks don't pay a fresh TCP+TLS+auth handshake (~0.5s) per
// navigation. Aiven free plan caps the whole service at max_connections=20
// (~17 usable) and each Vercel instance owns a pool, so keep max small and
// release idle slots quickly.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

export const db = drizzle(pool, { schema });
