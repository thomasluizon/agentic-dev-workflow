# Setup status line: install the portable Claude Code status line on this machine

Reproduce the same at-a-glance status line on any PC. It renders, in one row above the
built-in footer:

```
<model>@<effort>  ctx [██░░░░░░░░] 23%  branch main  5h 61%  wk 69%  you@example.com
```

- **`<model>@<effort>`** — the current model display name, and (when the model supports
  the reasoning-effort parameter) the live effort level appended after `@`
  (`low` / `medium` / `high` / `xhigh` / `max`), reflecting mid-session `/effort` changes.
- **`ctx [▁▁] N%`** — a 10-cell context-window usage bar + percentage.
- **`branch <name>`** — the git branch of the session's cwd (omitted outside a repo).
- **`5h N%` / `wk N%`** — the 5-hour and 7-day Claude.ai rate-limit usage (Pro/Max only;
  each is omitted when absent).
- **`<email>`** — the logged-in account, read from `.claude.json`.

Everything is read from the status-line JSON payload on stdin (and `~/.claude.json` for the
email); the script hardcodes nothing about any machine, so it is portable as-is.

> Claude Code specific. This wires Claude Code's `statusLine` setting and consumes Claude
> Code's status-line stdin payload. Other hosts use a different mechanism — skip there.

## Steps

1. **Resolve the config dir.** Use `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`
   (`os.homedir()` + `.claude` — correct on Windows/macOS/Linux). Call it `<CFG>`. Confirm it
   exists.

2. **Write the script** verbatim to `<CFG>/statusline.mjs`. If a `statusline.mjs` already
   exists there, back it up to `statusline.mjs.bak` first, then overwrite:

   ```js
   import { readFileSync } from "node:fs";
   import { join } from "node:path";
   import { execSync } from "node:child_process";

   let raw = "";
   process.stdin.on("data", (d) => (raw += d));
   process.stdin.on("end", () => {
     let j = {};
     try { j = JSON.parse(raw); } catch {}

     const model = j.model?.display_name ?? "Unknown";
     const effort = j.effort?.level;
     const modelLabel = effort ? `${model}@${effort}` : model;

     const pct = j.context_window?.used_percentage;
     let ctx = "[░░░░░░░░░░] --%";
     if (typeof pct === "number") {
       const p = Math.round(pct);
       const filled = Math.min(10, Math.max(0, Math.floor(p / 10)));
       ctx = `[${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${p}%`;
     }

     const cwd = j.cwd ?? j.workspace?.current_dir ?? "";
     let branch = "";
     if (cwd) {
       try {
         branch = execSync("git symbolic-ref --short HEAD || git rev-parse --short HEAD", {
           cwd, shell: true, stdio: ["ignore", "pipe", "ignore"],
         }).toString().trim();
       } catch {}
     }

     const parts = [`${modelLabel}  ctx ${ctx}`];
     if (branch) parts.push(`branch ${branch}`);

     const fiveHour = j.rate_limits?.five_hour?.used_percentage;
     const week = j.rate_limits?.seven_day?.used_percentage;
     if (typeof fiveHour === "number") parts.push(`5h ${Math.round(fiveHour)}%`);
     if (typeof week === "number") parts.push(`wk ${Math.round(week)}%`);

     try {
       const home = process.env.HOME || process.env.USERPROFILE;
       const email = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"))
         .oauthAccount?.emailAddress;
       if (email) parts.push(email);
     } catch {}

     process.stdout.write(parts.join("  "));
   });
   ```

3. **Wire it in `<CFG>/settings.json`.** Read the file (create `{}` if missing), then set the
   `statusLine` key to a command that runs the script with its **absolute** path — leave every
   other key untouched, and back the file up (`settings.json.bak`) before writing:

   ```jsonc
   {
     "statusLine": {
       "type": "command",
       "command": "node \"<CFG>/statusline.mjs\""   // absolute path to the script above
     }
   }
   ```

   Quote the path (it can contain spaces). On Windows the value looks like
   `node "C:\\Users\\<you>\\.claude\\statusline.mjs"`; on macOS/Linux
   `node "/home/<you>/.claude/statusline.mjs"`.

4. **Verify** before declaring done — pipe a mock payload through the script and confirm the
   `model@effort`, context bar, branch, and rate-limit fields render:

   ```bash
   echo '{"model":{"display_name":"Opus 4.8"},"effort":{"level":"xhigh"},"context_window":{"used_percentage":23},"rate_limits":{"five_hour":{"used_percentage":61},"seven_day":{"used_percentage":69}}}' | node "<CFG>/statusline.mjs"
   # -> Opus 4.8@xhigh  ctx [██░░░░░░░░] 23%  5h 61%  wk 69%  <your email>
   ```

   Then tell the user it takes effect on the next status-line render (it refreshes on the next
   turn; no restart needed).

## Notes

- **`@effort` is graceful.** `effort.level` is present only when the current model supports the
  reasoning-effort parameter; for models that don't (and on Claude Code versions that predate
  the field), the label falls back to the plain model name — no `@` suffix, no error.
- **`5h` / `wk` are Pro/Max only** and appear after the first API response in the session; each
  window is independently omitted when its data is absent.
- **The email** comes from `~/.claude.json`'s `oauthAccount.emailAddress`; if that file or field
  is missing, the segment is simply dropped.
