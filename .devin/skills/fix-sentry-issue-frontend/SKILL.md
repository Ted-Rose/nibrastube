---
name: fix-sentry-issue-frontend
description: Pull unresolved production errors from the Sentry
  nibrastube-app project, reproduce and fix them on a branch cut
  from updated main, open a draft PR against the fork, and mark
  the Sentry issue resolved only after the PR merges. Invoke
  when the user asks to fix Sentry issues / triage the Sentry
  queue in nibrastube.
---

# Fix an unresolved Sentry issue (nibrastube-app)

GitHub target: the user's FORK `Ted-Rose/nibrastube` (remote
`origin`) — pass `--repo Ted-Rose/nibrastube` to every `gh`
call; never operate on `upstream`. Default branch `main`,
squash-merge only.

The Sentry project is `nibrastube-app` in org `nibrastube-a2`,
hosted in the **EU region — `https://de.sentry.io`**, NOT
sentry.io. One project covers BOTH the browser and the Node.js
server runtime — this skill triages the whole queue; runtime is
just an event tag.

## 0. Auth — required before anything else

    source ~/.config/devin/sentry.env   # provides SENTRY_API_TOKEN

The token is a user-level auth token shared across the user's
Sentry orgs. If `SENTRY_API_TOKEN` is unset, STOP and tell the
user to set it up once:

1. de.sentry.io → User Settings → Auth Tokens → Create New Token
   (or an org internal integration scoped to `nibrastube-a2`).
2. Permissions: `Issue & Event: Read & Write`, `Project: Read`,
   `Release: Read`, `Organization: Read`. Save, copy the token.
3. `echo 'SENTRY_API_TOKEN=<token>' >> ~/.config/devin/sentry.env`

API helpers used throughout:

    BASE="https://de.sentry.io/api/0"
    AUTH="Authorization: Bearer $SENTRY_API_TOKEN"
    ORG="nibrastube-a2"
    PROJECT="nibrastube-app"

## 1. Fetch the work queue

    curl -s -H "$AUTH" \
      "$BASE/projects/$ORG/$PROJECT/issues/\
?query=is:unresolved+level:error+environment:production\
&statsPeriod=14d&sort=freq"

Only `level:error` events are auto-fixable — that filter IS the
queue: client exceptions, `global-error` crashes,
`onRequestError` server crashes, and `captureInternalException`
bugs. Warning-level provider streams (`error_code:
rate_limited` / `provider_error`) are intentionally excluded
(see `AGENTS.md` "Sentry event streams").

**The queue may legitimately be EMPTY**: `NEXT_PUBLIC_SENTRY_DSN`
is not yet set on the `redzi` Vercel project (Production scope),
so prod currently sends nothing. An empty response is expected
until the user activates it — say so and stop; do NOT loosen the
query to hunt dev/preview events unless the user asks.

## 2. Pick and analyze one item

- Default: ONE item per run — the highest-count/recent issue.
  If the user said "fix all", enumerate first and post the list.
- Fetch `GET $BASE/issues/<id>/events/latest/` — exception type,
  sourcemapped stack frames (file/line/function), `runtime` /
  `error_code` tags, release sha (Vercel git SHA), breadcrumbs.
- Reproduce before fixing. Can't reproduce → report back to the
  user and move on; NEVER a speculative fix.

## 3. Sanity-check the fix location

- Symptoms that look like UI bugs but are data/auth bugs (wrong
  cookie, missing guard, proxy redirect) usually belong in
  `proxy.ts`, `lib/auth.ts`, or a server action — read
  `AGENTS.md`'s invariants first.
- `docs/plans/*-plan.md` may already cover the issue — check
  status headers so you don't duplicate a planned WP.

## 4. Branch and fix — in a worktree

The main checkout often holds the user's uncommitted work — do
NOT switch branches in it:

    git fetch origin
    git worktree add ../nibrastube-wt/sentry-<id> \
      -b fix/sentry-<issue_short_id> origin/main
    cd ../nibrastube-wt/sentry-<id>
    npm install   # worktrees don't share node_modules

- Read `AGENTS.md`; 79-char lines in every file type.
- `export PATH="/opt/homebrew/bin:$PATH"` on every exec call —
  node/npm/gh are not on the default PATH.
- NEVER run `npm run db:migrate` under the default `ai_agent`
  DATABASE_URL. Schema changes: edit `lib/db/schema.ts` +
  `npm run db:generate`, commit the `drizzle/` files, hand the
  user the avnadmin migrate command. Never `drizzle-kit push`.
- No test suite — verify:

      npm run typecheck && npm run lint

  plus a manual run on port 3100 if user-visible (test login
  `tester@example.com` / `password`, PIN `0000`). If the song
  parser is touched, also `npx tsx scripts/test-song-parser.ts`.
- Update `AGENTS.md` when behavior changes.

## 5. Draft PR

- Stage only files you edited, by path (never `git add -A` /
  `git add .`). Never commit plan/scratch markdown.
- Commit format `Type: Capitalized message` (usually `Fix:`).
- `git push -u origin <branch>`, then a DRAFT PR targeting the
  fork's `main` per `.devin/workflows/create-pr.md` — body via
  `--body-file`, never inline `--body`:

      gh pr create --repo Ted-Rose/nibrastube --draft \
        --title "Type: Capitalized message" \
        --base main --head fix/sentry-<issue_short_id> \
        --body-file pr-body.md

- Body must: link the Sentry issue
  (`https://nibrastube-a2.sentry.io/issues/<id>/`), quote the top
  stack frame, and include the UI verification / QC section.
- `gh pr checks <N> --repo Ted-Rose/nibrastube --watch`; fix
  until green (the repo may report no checks — note it and
  continue), then `gh pr ready --repo Ted-Rose/nibrastube`.

## 6. Resolve — only after merge

    curl -s -X PUT -H "$AUTH" \
      -H 'Content-Type: application/json' \
      -d '{"status": "resolvedInNextRelease"}' \
      "$BASE/issues/<id>/"

Release = Vercel git SHA; resolution takes effect on the next
deploy. NEVER resolve before merge; NEVER `ignore` / `archive`
an issue without asking the user.

## Guardrails

- If >3 actionable items exist, post the queue list and let the
  user pick before fixing.
- One-off Sentry scripts: `import * as Sentry from
  "@sentry/nextjs"` under plain tsx/ESM loses the named exports
  (CJS interop) — write `.cts` + `require()` or use
  `@sentry/node`.
- Report at the end: issue handled, PR URL, worktree path, and
  Sentry resolution status.
