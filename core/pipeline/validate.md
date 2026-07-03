# Validate

> **Config inputs:** `config.repos`

Run all validation checks across the affected repos and report results.

**Input**: an optional scope hint (a repo name, a role from `{{config.repos}}`, or `all`). Default: auto-detect.

---

## Detect Scope

If no scope is provided, auto-detect: run `git status` in each repo in `{{config.repos}}` and validate any repo with uncommitted changes. If every repo is clean, validate them all.

---

## Checks

For each in-scope repo in `{{config.repos}}`, run its configured commands from the repo root, in this order, **skipping any command that is empty (`""`)**:

```bash
cd <repo.path> && <repo.lintCmd>
cd <repo.path> && <repo.typeCheckCmd>
cd <repo.path> && <repo.testCmd>
cd <repo.path> && <repo.buildCmd>
```

A repo with an empty command for a given step simply has no such step — record it as N/A, not a failure.

---

## Process

1. Run each non-empty check per in-scope repo, capture output
2. Collect failures
3. Report results

---

## Output

```markdown
## Validation Results

### <repo.name> (<repo.role>)

| Check | Result | Details |
|-------|--------|---------|
| Lint | PASS / FAIL / N/A | {N errors or "passed"} |
| Type check | PASS / FAIL / N/A | {N errors or "passed"} |
| Tests | PASS / FAIL / N/A | {N passed, M failed} |
| Build | PASS / FAIL / N/A | {warnings/errors} |

(repeat one block per in-scope repo)

### Summary

- **Status**: ALL PASSING / {N} FAILURES
- **Action needed**: {None / list}
```

---

## If Failures Found

For each failure, list:
1. Repo, file, line number
2. Error message
3. Suggested fix (if obvious)

Example:

```
### Failures

1. **<repo.name> / <path>:42**
   - Error: `Type 'string' is not assignable to type 'number'`
   - Fix: Check the type annotation or value

2. **<repo.name> / <path>:18**
   - Error: `Cannot implicitly convert 'string' to 'int'`
   - Fix: Add an explicit cast or change the type
```
