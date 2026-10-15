/**
 * Reconcile `drizzle.__drizzle_migrations` bookkeeping with the local
 * journal after a migration `.sql` file was edited or regenerated
 * post-apply. Two columns can drift from `drizzle/meta/_journal.json`
 * + the `.sql` files:
 *
 *   - `hash`       — must equal sha256(file contents); drizzle-orm's
 *                    readMigrationFiles() hashes the raw file text
 *                    (node_modules/drizzle-orm/migrator.js)
 *   - `created_at` — must equal the journal entry's `when`
 *                    (folderMillis). The pg migrator applies every
 *                    migration whose folderMillis is greater than the
 *                    LAST stored created_at
 *                    (node_modules/drizzle-orm/pg-core/dialect.js), so
 *                    a stale created_at on the final row makes
 *                    `drizzle-kit migrate` re-run statements that
 *                    already exist and die on e.g.
 *                    `relation already exists` (exit 1, no error
 *                    shown).
 *
 * Stored rows are positionally aligned with journal entries when
 * ordered by created_at. Dry-run prints drift; --apply updates both
 * columns. Metadata-only — no schema change. Never edit a migration
 * file after it has been applied; if it was meant to change, write a
 * new migration instead.
 *
 * Requires UPDATE rights on drizzle.__drizzle_migrations — run with
 * the avnadmin URL from .env (ai_agent has no DDL/DML there):
 *
 *   DATABASE_URL="$(grep -m1 avnadmin .env | cut -d= -f2-)" \
 *     npx tsx scripts/reconcile-migration-hashes.ts [--apply]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";

// Same convention as refresh-videos.ts: lets plain `npx tsx` pick up
// .env; a real DATABASE_URL in the environment still wins.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — rely on real environment variables
}

const { values: args } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

interface JournalEntry {
  tag: string;
  when: number;
}

interface MigrationRow {
  id: number;
  hash: string;
  created_at: string; // bigint comes back as a string
}

async function main() {
  if (args.help) {
    console.log(
      "npx tsx scripts/reconcile-migration-hashes.ts [--apply]"
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set — run with the avnadmin URL:\n" +
        '  DATABASE_URL="$(grep -m1 avnadmin .env | cut -d= -f2-)" \\'
    );
    console.error(
      "    npx tsx scripts/reconcile-migration-hashes.ts [--apply]"
    );
    process.exit(1);
  }

  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8")
  ) as { entries: JournalEntry[] };

  // Hash exactly what drizzle-orm hashes: the raw .sql file text.
  const local = journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256")
      .update(readFileSync(`drizzle/${entry.tag}.sql`, "utf8"))
      .digest("hex"),
  }));

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<MigrationRow>(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations" +
        " ORDER BY created_at, id"
    );

    if (rows.length !== local.length) {
      throw new Error(
        `Cannot align: ${rows.length} stored row(s) vs ` +
          `${local.length} journal entr(ies) — inspect the table by` +
          " hand before reconciling."
      );
    }

    const updates: { row: MigrationRow; next: (typeof local)[0] }[] =
      [];
    for (let i = 0; i < local.length; i++) {
      const row = rows[i];
      const next = local[i];
      const hashDrift = row.hash !== next.hash;
      const tsDrift = row.created_at !== String(next.when);
      if (!hashDrift && !tsDrift) continue;
      updates.push({ row, next });
      console.log(`[${i}] ${next.tag} (row id ${row.id}):`);
      if (hashDrift) {
        console.log(`  hash       ${row.hash}\n           -> ${next.hash}`);
      }
      if (tsDrift) {
        console.log(
          `  created_at ${row.created_at}\n           -> ${next.when}`
        );
      }
    }

    if (updates.length === 0) {
      console.log("All stored rows match the journal — nothing to do");
      return;
    }
    if (!args.apply) {
      console.log(
        `\n${updates.length} row(s) drifted — dry run only,` +
          " rerun with --apply to update"
      );
      return;
    }
    await pool.query("BEGIN");
    try {
      for (const { row, next } of updates) {
        const result = await pool.query(
          "UPDATE drizzle.__drizzle_migrations SET hash = $1," +
            " created_at = $2 WHERE id = $3",
          [next.hash, next.when, row.id]
        );
        if (result.rowCount !== 1) {
          throw new Error(
            `UPDATE matched ${result.rowCount} row(s) for id ` +
              `${row.id} (${next.tag}) — aborting`
          );
        }
        console.log(`updated row id ${row.id} (${next.tag})`);
      }
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
    console.log(`Reconciled ${updates.length} row(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
