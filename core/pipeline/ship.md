# Ship

> **Config inputs:** `config.pr.baseBranch`, `config.pr.squash`, `config.pr.commitTrailer`, `config.pr.prBodyFooter`, `config.pr.forbiddenTrailers`, `config.branchNaming`

Ship the current work: commit all changes, push, create a PR to the base branch, and return to the base branch.

## Process

1. **Check the current branch:**
```bash
git branch --show-current
```

2. **If on a protected branch (`{{config.branchNaming.protectedBranches}}`):**
   - If a branch name was provided as an argument, use it.
   - Otherwise, look at the staged/unstaged changes (`git diff`) and generate a descriptive branch name following `{{config.branchNaming.pattern}}` — pick the `{type}` from `{{config.branchNaming.types}}` (e.g. `feature/add-tag-filtering`, `fix/login-redirect`, `chore/update-deps`).
   - Create and switch to the new branch: `git checkout -b <branch-name>`

3. **Check for changes:**
```bash
git status
git diff --stat
```
   If there is nothing to commit, skip to step 5 (there may already be commits to push).

4. **Commit all changes:**
   - Stage the relevant files (prefer specific files over `git add -A`).
   - Write a concise, descriptive commit message based on the diff.
   - Append `{{config.pr.commitTrailer}}` to the message **only if it is set** (a machine that bans authorship trailers leaves it empty — emit nothing then).
   - Ensure the message contains none of `{{config.pr.forbiddenTrailers}}` (the git hook blocks a commit that does).

5. **Push the branch:**
```bash
git push -u origin <branch-name>
```

6. **Create a PR to the base branch:**
   Open a PR from `<branch-name>` against `{{config.pr.baseBranch}}` through your git host's PR tooling — the forge CLI or MCP resolved for the remote (e.g. `gh pr create` on GitHub, `glab mr create` on GitLab, `az repos pr create` on Azure DevOps), filling the title/body from the commits.
   If `{{config.pr.prBodyFooter}}` is set, append it to the PR body (keep the generated summary and add the footer). Emit nothing when it is empty.

7. **Return to the base branch:**
```bash
git checkout {{config.pr.baseBranch}}
```

8. **Report:**
```
Shipped!
  Branch: <branch-name>
  PR: <pr-url>
  Now on: {{config.pr.baseBranch}}
```

Note: if `{{config.pr.squash}}` is true, the PR is expected to squash-merge — do not add extra merge commits to the branch after opening it.
