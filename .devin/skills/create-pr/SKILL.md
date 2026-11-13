---
name: create-pr
description: >
  Open a pull request for the current feature branch the
  repo-approved way — body via a temp file and
  `gh pr create --body-file`, mandatory UI verification
  section, ready for review (never a draft). Use when asked
  to create/open a PR or push changes for review.
---

# Create a PR

1. Prereqs: on a feature branch (never `main` — if commits
   landed on `main`, recover in a worktree: `git branch
   <type>/<slug>`, stash any uncommitted work
   (`git stash -u`), `git fetch origin`,
   `git reset --hard origin/main`, then
   `git worktree add ../nibrastube-wt/<slug> <type>/<slug>`). `gh` installed
   and authed; if missing, tell the user
   `brew install gh && gh auth login`. All `gh` calls target the
   user's FORK — pass `--repo Ted-Rose/nibrastube`; never open
   PRs on `upstream` unless explicitly asked.
2. `git status` — stage only this session's files, by path. Never
   `git add -A` / `git add .` / `git commit -a`; leave the user's
   dirty files and untracked secrets (`.env`, …) alone.
3. Commit with `Type: Capitalized message` (Feat/Fix/Docs/
   Refactor/Test/Chore). Check nothing over 79 chars was
   committed:
   `awk 'length > 79 {print FILENAME":"NR}' <changed files>`.
4. `git push -u origin <branch>`.
5. Write the PR body to a temp file at the repo root
   (`pr-body.md`), then `gh pr create --repo Ted-Rose/nibrastube
   --title "Feat: …" --body-file pr-body.md`. NEVER pass
   the body inline via `--body`. Delete the temp file
   afterwards.
6. Body template:

   ```markdown
   ## Summary
   <what + why, 2-4 bullets>

   ## UI verification / QC
   1. `npm run dev` (port 3100), open
      http://localhost:3100/…
   2. <click X, submit Y>
   3. Expected: <observable result>

   ## Test plan
   - [ ] `npm run typecheck && npm run lint`
   - [ ] `npm run build` (infra/config changes)
   ```

   The UI verification section is mandatory — concrete pages,
   clicks and expected results that exercise the change
   end-to-end. Omit it ONLY when genuinely unreachable from
   the UI, and then document an equivalent (curl command,
   script, log line to watch) under the same heading. Test
   login: `tester@example.com` / `password`, PIN `0000`.
7. `gh pr checks --watch` until green; fix failures on the
   branch, push again.
8. The PR is created ready for review — never a draft unless
   the user explicitly asks. Report the PR URL, then run the
   review loop (AGENTS.md): spawn a fresh reviewer subagent
   on the diff, fix useful findings, push, and re-run
   `gh pr checks --watch` — repeat until a round finds
   nothing meaningful and checks are green.
