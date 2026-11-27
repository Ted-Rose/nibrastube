---
name: implement-plan
description: Implement a legacy docs/plans/*-plan.md file end-to-end
  with subagents — an implementer agent cuts a feature branch and
  pushes it, then fresh reviewer agents review the diff and fixer
  agents iterate until clean, and the branch is reported for the
  user to PR (agents never open PRs or merge). Invoke when the user
  asks to implement/execute a plan file using agents.
---

# Implement a Plan File with Subagents

Orchestrate a multi-agent implementation of a plan file (e.g.
`docs/plans/db-connections-plan.md`). Single repo: `nibrastube`,
GitHub target = the fork `Ted-Rose/nibrastube`.

NOTE: `docs/plans/` is frozen (AGENTS.md rule 11) — this skill only
executes pre-existing legacy plan files. New planning goes through
`openspec changes`; never create a `*-plan.md` to feed this skill.

Subagents are stateless: front-load every prompt with the plan path,
the worktree path, the branch name, the conventions file to read, and
exactly what to return. Agents share the repo — never run two agents
writing the same checkout concurrently.

**The main checkout often holds the user's uncommitted work.** Never
`git switch`/`git checkout` in it — every agent works in a dedicated
git worktree under `../nibrastube-wt/`.

Track the phases with `todo_write`.

## Phase 0 — Read the plan

Read the plan file yourself. Check its status header first — if it
says `implemented` or `reverted`, stop and confirm with the user.
Extract: a short `<slug>` for branch names, the areas of the app it
touches, and the contract points other code depends on (routes,
cookie/session shape, schema tables, Pusher events).

## Phase 1 — Implementation (background general agent)

Launch one `subagent_general` in the background. If the plan
decomposes into independent, non-overlapping work packages you may
launch more than one — each in its OWN worktree + branch, never two
agents writing the same worktree concurrently. Prompt template:

    Implement <plan-file> (absolute path) in the nibrastube repo.

    1. Work in a dedicated worktree — the main checkout may have
       the user's uncommitted work, do not switch branches there:
         cd <repo>; git fetch origin
         git worktree add ../nibrastube-wt/<slug> \
           -b feature/<slug> origin/main
         cd ../nibrastube-wt/<slug> && npm install &&
         cp ../nibrastube/.env .env
    2. Read AGENTS.md first — it defines the whitelist/auth
       invariants, commands, and sharp edges. Every line <= 79
       chars in every file type.
    3. Migrations: `npm run db:generate` is safe (files only).
       If a migration must be APPLIED, report the
       `npm run db:migrate` command to the user instead of
       running it (production Neon write); never
       `drizzle-kit push`.
    4. Implement the plan against the contract it specifies.
       Verify:
         npm run typecheck && npm run lint
       (no test suite; add a manual-verification note describing
       the UI walkthrough on :3100).
    5. Commit only files you edited (never git add -A, never
       commit plan/scratch md). Format: `Type: Capitalized msg`.
       Push: git push -u origin feature/<slug>
    6. Push the branch — do NOT open a PR (the user opens and
       merges PRs, AGENTS.md "Git workflow"). Report the
       branch name + verification. If the user later asks for
       a PR: follow .devin/skills/create-pr/ (--base main,
       body via pr-body.md + --body-file, UI-verification
       section, --repo Ted-Rose/nibrastube).
    7. Vercel deploys every pushed branch — check the preview
       build succeeds; fix failures until green.
    Return: branch name, worktree path, files changed,
    verification results, anything you could not do.

## Phase 2 — Review (fresh reviewer agent)

When the implementation branch is pushed, launch ONE NEW
`subagent_general`
reviewer, in background. A new agent — never reuse the implementer.
Prompt:

    Review branch <branch> in nibrastube (fork Ted-Rose/nibrastube)
    — diff it against origin/main (`git fetch origin &&
    git diff origin/main...HEAD` or `gh pr diff` once a PR
    exists). Do NOT
    modify any files — review only. The branch implements <plan-file>
    (absolute path); read the plan first.
    1. get the diff (origin/main...HEAD) and read
       surrounding code for context.
    2. Check: correctness vs the plan, edge cases, the whitelist
       invariant (kids can never see unapproved content), auth
       cookie/session contract (`session`/`parentUnlocked`/
       `activeProfileId`, kid vs parent role), server-action guards
       (getSession + assertCanManageProfile + requireParentUnlocked),
       proxy.ts routing implications, Pusher events fired on
       whitelist changes, 79-char limit, no plan/scratch files in
       the diff, no `drizzle-kit push`, migration files generated
       but not applied.
    3. Optionally run npm run typecheck && npm run lint in the PR's
       worktree.
    Return: numbered findings, each with severity
    (blocker|should-fix|nit) and file:line. Say "NO ISSUES"
    explicitly if clean.

## Phase 3 — Fix loop

If the reviewer reported blocker/should-fix findings:

1. Launch one `subagent_general` fixer on the same branch in a
   FRESH worktree — a branch can live in only one worktree, so
   remove whichever worktree currently holds it (`git worktree
   list` to find it; `git worktree remove --force
   ../nibrastube-wt/<name>`), then the fixer adds one on the
   existing branch (`git worktree add ../nibrastube-wt/fix-<slug>
   feature/<slug>`). Prompt: the branch
   name, the numbered findings verbatim, "fix, commit (`Fix: ...`),
   push, return what changed". Nits may be
   batched or skipped — say which.
2. After fixes land, launch a NEW reviewer agent (fresh round, same
   review prompt + "previous findings: <list> — verify the fixes").
3. Repeat until a review round reports NO ISSUES, or after 3 rounds.
   If issues persist past 3 rounds, stop and report the remaining
   findings to the user.

## Guardrails

- Background agents cannot request new permissions. If one is blocked
  by a denied tool (e.g. `git push`, `gh`), resume it in the
  foreground so the user can approve.
- Fixers on the same PR run sequentially — one at a time.
- If a subagent reports the plan is unimplementable as written, stop
  and ask the user rather than improvising.
- Done plans are deleted, not archived (AGENTS.md rule 11): if the
  implementation PR added or updated a `docs/plans/*-plan.md`,
  commit the plan file first (reviewers need the context), then
  delete it in a follow-up commit on the same branch before merge —
  a fully implemented plan never lands in `main`. Leave the file
  only when the outcome is `partial` / `in progress` / `reverted`,
  with its status header updated accordingly.

Once a review round is clean AND the branch deploy is green, remove
the worktree immediately — `git worktree remove --force <path>` +
`git branch -D <type>/<slug>` per AGENTS.md; the work lives on the
remote branch for the user to PR.

## Final report

Branch name, review rounds needed, findings fixed per round,
confirmation the worktree was removed, and any outstanding items
(e.g. a migration command the user must run). Do NOT open a PR or
merge — that is the user's call.
