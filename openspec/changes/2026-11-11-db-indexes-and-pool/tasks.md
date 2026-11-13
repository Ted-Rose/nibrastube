# Tasks

## 1. Schema indexes

- [ ] 1.1 Add the `index()` entries listed in `design.md` to
      `lib/db/schema.ts` (hot-path + trailing-FK sets)
- [ ] 1.2 `npm run db:generate` → commit the generated `drizzle/`
      migration + meta files

## 2. Pool config

- [ ] 2.1 `lib/db/index.ts`: `idleTimeoutMillis: 60_000`, add the
      `pool.on("error")` handler, fix the comment; `max` stays 3

## 3. Verification

- [ ] 3.1 `npm run typecheck && npm run lint`
- [ ] 3.2 Manual: `npm run dev -- -p 3100` idles >10 s across
      navigations — no pool crash or handshake stall

## Hand-off (user-run)

- [ ] H1 `npm run db:migrate` — production Neon via the unpooled
      URL (`drizzle.config.ts` prefers `DATABASE_URL_UNPOOLED`);
      then confirm the new indexes in `pg_indexes`
