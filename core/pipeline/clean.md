# Clean — Git Worktree & Branch Cleanup

> **Config inputs:** `config.repos`, `config.worktree.root`, `config.branchNaming.protectedBranches`

Removes all git worktrees and local branches except the protected branches (`{{config.branchNaming.protectedBranches}}`) and the currently checked-out branch, across every repo in `{{config.repos}}`.

## When to Use

- After finishing worktree-based work
- When local branches have accumulated
- When the user says "clean up", "clean branches", "clean worktrees"

## Process

Run these steps in EACH repo in `{{config.repos}}` (`<repo.path>` per entry).

1. **Get the current branch:**
```bash
git -C <repo.path> branch --show-current
```

2. **Remove all worktrees** under `{{config.worktree.root}}/`:
```bash
git -C <repo.path> worktree list
```
For each worktree that is NOT the main working directory, remove it **without `--force`**:
```bash
git -C <repo.path> worktree remove <worktree-path>
```
**Windows junction / symlink hazard — do NOT use `--force`.** If a worktree contains a directory junction or symlink (a linked sibling repo, a shared `node_modules`, etc.), `git worktree remove --force` follows the link and deletes the link *target's* contents, not the link — irreversible data loss. First unlink any junction/symlink dirs inside the worktree (`cmd //c rmdir "<link>"` on Windows, which removes the link without touching its target; `rm "<link>"` for a POSIX symlink), verify the worktree is clean with `git -C <repo.path> status`, THEN run `git worktree remove` without `--force`. If a worktree legitimately holds uncommitted changes you mean to discard, confirm with the user rather than reaching for `--force`.

3. **Delete all local branches** except the protected branches (`{{config.branchNaming.protectedBranches}}`) and the current branch:
```bash
git -C <repo.path> branch | grep -v '^\*' | grep -vE '<protected-branches-alternation>' | xargs -r git -C <repo.path> branch -D
```
where `<protected-branches-alternation>` is the `{{config.branchNaming.protectedBranches}}` list joined with `|` (e.g. `main|release`).

4. **Prune worktree refs:**
```bash
git -C <repo.path> worktree prune
```

5. **Report** what was cleaned, per repo:
```
Cleaned (<repo.name>):
  Worktrees removed: <count>
  Branches deleted: <list>
  Current branch: <branch>
```

If nothing to clean in a repo, report "Already clean."

## Rules
- NEVER delete a protected branch (`{{config.branchNaming.protectedBranches}}`).
- NEVER delete the currently checked-out branch.
- NEVER use `git worktree remove --force`: a junction/symlink inside the worktree makes it delete the link's TARGET (data loss on Windows especially). Unlink junctions/symlinks first (`cmd //c rmdir` / `rm`), verify with `git status`, then remove without `--force`.
- Operate over every repo in `{{config.repos}}`, not just the launch repo.
