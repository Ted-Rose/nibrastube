---
name: fix-good-first-issue
description: Pick an open GitHub issue labeled "good first issue" in
  Ted-Rose/nibrastube, fix it on a new branch cut from updated main,
  open a PR, wait for checks, fix any failures, and run a
  reviewer loop until clean. Invoke when the user asks to fix a
  good-first-issue / pick up an issue.
---

# Fix a "Good First Issue" in nibrastube

Single repo — the GitHub target is the user's FORK
`Ted-Rose/nibrastube` (remote `origin`); never operate on `upstream`.

## 0. Environment

- `gh` and `npm` may be missing from PATH in non-interactive shells —
  prepend `export PATH="/opt/homebrew/bin:$PATH"`.
- The main checkout often holds the user's uncommitted work — do NOT
  switch branches in it. Work in a git worktree instead (step 3).

## 1. Pick an issue

List candidates:

    gh issue list --repo Ted-Rose/nibrastube \
      --label "good first issue" --state open

- If the user gave an issue number, use it; otherwise pick the top
  candidate.
- Always verify no PR already covers the issue — even when the user
  gave the number explicitly:

      gh pr list --repo Ted-Rose/nibrastube \
        --state all --search "#<N> in:title,body"

  Skip the issue if a PR references it (`Closes #<N>`,
  `Fixes #<N>`) or a `fix/issue-<N>-*` PR already exists. If the user
  explicitly asked for an already-claimed issue, tell them which PR
  covers it and ask whether to proceed anyway.
- Read the chosen issue fully:

      gh issue view <N> --repo Ted-Rose/nibrastube --comments

If no unclaimed issues remain, stop and tell the user.

## 2. Sanity-check the fix location

Single repo, but still think before branching:

- Symptoms that look like UI bugs but are data/auth bugs (wrong
  cookie, missing guard, proxy redirect) usually belong in
  `proxy.ts`, `lib/auth.ts`, or a server action — read AGENTS.md's
  "Business rules & invariants" first.
- The frozen legacy `docs/plans/*-plan.md` files may describe a
  planned feature that already covers the issue — check status
  headers so you don't duplicate a planned WP.

## 3. Branch from updated `main` in a worktree

Do not disturb the main checkout's working tree:

    git fetch origin
    git worktree add ../nibrastube-wt/issue-<N> \
      -b fix/issue-<N>-<short-slug> origin/main
    cd ../nibrastube-wt/issue-<N>
    npm install   # worktrees don't share node_modules
    cp ../nibrastube/.env .env   # nor .env

(If the worktree dir already exists, remove it first — follow-up
work always gets a fresh worktree, per AGENTS.md.)

## 4. Fix the issue

- Read `AGENTS.md` — it is the source of truth for conventions,
  the whitelist/auth invariants, and the known sharp edges. `prd.md`
  unchecked boxes are roadmap, not bugs.
- Implement the fix. Keep every line <= 79 characters in every file
  type.
- Schema changes: edit `lib/db/schema.ts` + `npm run
  db:generate`, commit the `drizzle/` files, and never
  `drizzle-kit push`. If a migration must be APPLIED, hand
  the user the `npm run db:migrate` command rather than
  running it (production Neon write — AGENTS.md).
- No test suite — verify with:

      npm run typecheck && npm run lint

  plus a manual run on port 3100 if the fix is user-visible (test
  login: `tester@example.com` / `password`, PIN `0000`). If the fix
  touches the song parser, also run
  `npx tsx scripts/test-song-parser.ts`.
- If the change alters behavior, update `AGENTS.md` (conventions
  rule 10).

## 5. Commit, push, and open a PR

- Stage only files you edited — never `git add -A` / `git add .`.
  Never commit plan/scratch markdown.
- Commit message format: `Type: Capitalized message`
  (e.g. `Fix: Redirect kid sessions before parent checks`).
- Push:

      git push -u origin fix/issue-<N>-<short-slug>

- Create the PR ready for review (never a draft) targeting the
  fork's `main`. Follow `.devin/skills/create-pr/`: write the
  body to a temp file and use `--body-file` (never inline
  `--body`):

      gh pr create --repo Ted-Rose/nibrastube \
        --title "Type: Capitalized message" \
        --base main --head fix/issue-<N>-<short-slug> \
        --body-file pr-body.md
      rm pr-body.md

- The PR body must link the issue with `Closes #<N>` and include a
  UI-verification section (pages/clicks/expected result — AGENTS.md
  conventions rule 7).

## 6. Wait for checks; fix failures

    gh pr checks <PR-number> --repo Ted-Rose/nibrastube --watch

- When the watch ends, inspect results. If any check fails, get logs
  (`gh run view --log-failed`), fix, commit, push, watch again.
- Repeat until every check passes — the worktree stays up until
  they do. (The repo may report no checks — note that and
  continue.)

## 7. Reviewer loop, then report

Spawn a FRESH reviewer subagent on the PR diff
(`gh pr diff <N> --repo Ted-Rose/nibrastube`). Fix everything
useful it reports, push, then spawn another fresh reviewer —
repeat until a round finds nothing meaningful. Keep the
worktree until the loop is clean AND checks are green, then
remove it (`git worktree remove --force` + `git branch -D`,
per AGENTS.md).

Then report to the user: the issue number/title fixed, the PR
URL, and the final check status.
