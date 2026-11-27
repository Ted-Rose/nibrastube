---
name: fix-good-first-issue
description: Pick an open GitHub issue labeled "good first issue" in
  Ted-Rose/nibrastube, fix it on a new branch cut from updated main,
  push it, fix any check failures, and run a reviewer loop until
  clean — then STOP and report the branch; the user opens and
  merges PRs. Invoke when the user asks to fix a good-first-issue /
  pick up an issue.
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

## 5. Commit, push, and report — the user opens the PR

- Stage only files you edited — never `git add -A` / `git add .`.
  Never commit plan/scratch markdown.
- Commit message format: `Type: Capitalized message`
  (e.g. `Fix: Redirect kid sessions before parent checks`).
- Push:

      git push -u origin fix/issue-<N>-<short-slug>

- **Stop here — never open a pull request or merge to `main`
  on your own** (AGENTS.md "Git workflow"). Report the branch
  name and what you verified. Only when the user asks for a
  PR: follow `.devin/skills/create-pr/` (`--base main`, ready
  for review, body via `--body-file` — never inline `--body`;
  the body must link `Closes #<N>` and include the
  UI-verification section, AGENTS.md conventions rule 7).

## 6. Watch the branch deploy; fix failures

- Vercel deploys every pushed branch — verify the branch
  preview build succeeds (`gh run list --repo
  Ted-Rose/nibrastube --branch fix/issue-<N>-<short-slug>`,
  or the Vercel dashboard; `openspec-validate` only runs on
  PRs/main, so a pushed branch may show no workflow runs —
  that's normal).
- If anything fails, get logs (`gh run view --log-failed`),
  fix, commit, push, watch again — the worktree stays up
  until it's green.

## 7. Reviewer loop, then report

Spawn a FRESH reviewer subagent on the branch diff
(`git diff origin/main...HEAD` in the worktree). Fix
everything useful it reports, push, then spawn another fresh
reviewer — repeat until a round finds nothing meaningful.
Keep the worktree until the loop is clean AND the branch
deploy is green, then remove it (`git worktree remove
--force` + `git branch -D`, per AGENTS.md).

Then report to the user: the issue number/title fixed, the
pushed branch name, and the final check status — do NOT open
a PR.
