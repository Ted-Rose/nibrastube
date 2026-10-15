---
name: implement-plan
description: Implement a docs/plans/*-plan.md file end-to-end with
  subagents — an implementer agent cuts a feature branch and opens a
  draft PR, then fresh reviewer agents review it and fixer agents
  iterate until clean. Invoke when the user asks to implement/execute
  a plan file using agents.
---

# Implement a Plan File with Subagents

Orchestrate a multi-agent implementation of a plan file (e.g.
`docs/plans/kid-login-plan.md`). Single repo: `nibrastube`, GitHub
target = the fork `Ted-Rose/nibrastube`.

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
         cd ../nibrastube-wt/<slug> && npm install
    2. Read AGENTS.md first — it defines the whitelist/auth
       invariants, commands, and sharp edges. Every line <= 79
       chars in every file type.
    3. Migrations: `npm run db:generate` is safe (files only).
       NEVER run `npm run db:migrate` under the default ai_agent
       DATABASE_URL — if a migration must be applied, report the
       avnadmin command to the user instead of running it, unless
       you invoke it exactly as AGENTS.md documents.
    4. Implement the plan against the contract it specifies.
       Verify:
         npm run typecheck && npm run lint
       (no test suite; add a manual-verification note describing
       the UI walkthrough on :3100).
    5. Commit only files you edited (never git add -A, never
       commit plan/scratch md). Format: `Type: Capitalized msg`.
       Push: git push -u origin feature/<slug>
    6. Open a DRAFT PR on the fork following
       .devin/workflows/create-pr.md — write the body to
       pr-body.md, use --body-file, rm it after. Body must include
       a UI-verification section (pages/clicks/expected result)
       and --repo Ted-Rose/nibrastube.
    7. gh pr checks <N> --repo Ted-Rose/nibrastube --watch; fix
       failures until green, then gh pr ready.
    Return: PR URL, worktree path, files changed, verification
    results, anything you could not do.

## Phase 2 — Review (fresh reviewer agent)

When the implementation PR exists, launch ONE NEW `subagent_general`
reviewer, in background. A new agent — never reuse the implementer.
Prompt:

    Review PR <url> in nibrastube (fork Ted-Rose/nibrastube). Do NOT
    modify any files — review only. The PR implements <plan-file>
    (absolute path); read the plan first.
    1. gh pr diff <N> --repo Ted-Rose/nibrastube and read
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

1. Launch one `subagent_general` fixer on the same branch (the PR
   worktree is still checked out at `../nibrastube-wt/<slug>` —
   verify with `git -C <wt> branch --show-current`). Prompt: the PR
   URL, the numbered findings verbatim, "fix, commit (`Fix: ...`),
   push, re-watch `gh pr checks`, return what changed". Nits may be
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
- When done, update the plan file's status header in `docs/plans/`
  (`implemented` / `partial` / `in progress` / `not implemented` /
  `reverted`) and include that edit in the PR or a follow-up commit.

## Final report

PR URL, review rounds needed, findings fixed per round, the worktree
path, and any outstanding items (e.g. a migration command the user
must run).
