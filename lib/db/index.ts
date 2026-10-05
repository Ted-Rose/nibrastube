import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Remote Postgres: keep connections alive longer than pg's 10s default so
// leisurely clicks don't pay a fresh TCP+TLS+auth handshake (~0.5s) per
// navigation.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 60_000,
  keepAlive: true,
});

export const db = drizzle(pool, { schema });
