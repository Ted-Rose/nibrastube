---
description: Create a GitHub pull request without shell quoting issues
---

Always follow these steps when creating a pull request. Never pass
PR body text inline via `--body` (causes shell quoting failures).
Always use `--body-file` instead.

All PRs target the user's FORK — pass `--repo Ted-Rose/nibrastube`.
Never open PRs on `upstream` unless explicitly asked.

1. Write the PR description to a temporary markdown file at the
   repo root (e.g. `pr-body.md`). The body must include a
   **UI verification / QC section**: concrete manual test steps
   (which pages to open, which buttons to click, what the expected
   result is) that exercise the change end-to-end through the app's
   UI. For backend- or API-only changes, still evaluate whether UI
   verification is worthwhile — it usually is, since driving the
   feature through the UI exercises the backend end-to-end. Only
   omit UI steps when the change is genuinely unreachable from the
   UI, and in that case document an equivalent verification (e.g. a
   curl command, script, or log line to check).

2. Run the `gh pr create` command using `--body-file`:

```
gh pr create --repo Ted-Rose/nibrastube \
  --title "<title>" \
  --base <base-branch> --head <feature-branch> \
  --body-file pr-body.md
```

3. After the PR is created successfully, delete the temporary
   file:

```
rm pr-body.md
```

This pattern avoids all shell quoting/escaping issues with
multi-line or special-character PR bodies.
