# Make Tool: promote a repeated incantation into a reusable script

> **Config inputs:** `config.paths.toolsDir`

**Input**: what the tool should do.

## When to reach for this

- You have typed the **same multi-flag command a second time** — the third real use is the extract point, so the second is the signal to build it now.
- A one-liner has grown into a **pipeline worth a name** that you will run again.
- A future agent would need to rediscover an incantation you already worked out.

Do **not** build a tool for a true one-off. That stays in your shell history or the scratchpad. `{{config.paths.toolsDir}}` is for scripts that earn their keep by running more than once.

## Steps

1. **Name the single purpose.** One sentence, one verb. If it needs an "and", that is two tools.
2. **Write it to the tools-dir contract** — the conventions doc under `{{config.paths.toolsDir}}`, if the project has one: `--help`/`-h`, meaningful exit codes, non-interactive, cwd-safe (resolve paths from the script location), stdin for large payloads, no secrets in argv.
3. **Pick the shells.** Author the POSIX `.sh` as the baseline (CI, unattended loops, Git Bash), with LF line endings. Add a shell-native twin (e.g. `.ps1`) **only when the tool must run interactively in that shell**; the twin mirrors the `.sh` flags, stdin shape, and exit codes exactly.
4. **Prefer delegating over reimplementing.** If a vetted helper already does the hard part, the tool is a thin wrapper over it. Do not re-derive its logic in shell.
5. **Catalog it.** Add a row to the `{{config.paths.toolsDir}}` catalog (tool, what it does, usage) in the same change.
6. **Surface it only if broadly useful.** Point to it from the project's always-loaded instructions only when it helps across the workflow. A niche tool just lives in the catalog.
7. **Prove it.** Run `--help` in each shell you shipped (exit 0) and one real smoke of the happy path. Fix the cause of any failure; do not paper over it.

## Guardrails

- **No premature abstraction.** Do not build a shared shell library for the first two small wrappers. Extract on the third real use.
- **stdin over argv** for a claim, a diff, a file list, or any large payload.
- **No secrets in argv** (process table + shell history leak them). Read them from the environment or a file.
- **One purpose per script.** A flag matrix that forks behavior is a sign you are hiding two tools in one file.
