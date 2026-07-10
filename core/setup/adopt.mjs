// Adopt-vs-reset — the second half of setup-harness, the "existing bloated setup"
// path. On a project that already has a CLAUDE.md / hooks / rules, the runbook
// asks reset-vs-adopt. Adopt means: BACK UP the existing artifacts to a
// timestamped folder (nothing is lost), then DECOMPOSE the old content as a
// decode source (its prose becomes candidate rules), so the same gate re-tiers it
// and the generators rewrite a lean harness. Reset just skips the decompose.
//
// This module does the mechanical halves — the safe copy and the prose->candidates
// extraction. The runbook drives which files exist (from detect.mjs) and whether
// the user chose adopt or reset. Read + copy only; it never deletes an original
// (generation overwrites in place; the backup is the safety net).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractNormativeStatements } from "./docs.mjs";

// The artifacts an adopt backs up before the rewrite. Files and directories both;
// a missing entry is simply skipped.
export const BACKUP_TARGETS = ["CLAUDE.md", "AGENTS.md", "hooks.policy.json", ".claude/rules", ".claude/hooks", ".claude/skills"];

export function backupPathFor(stamp) {
  return path.join(".harness-backup", String(stamp || "backup"));
}

// Copy every existing target into `.harness-backup/<stamp>/`, preserving the
// relative layout. Returns the list of what was backed up (relative paths) so the
// manifest and the gaps report can record it.
export function backupExisting(root = process.cwd(), stamp = "backup", targets = BACKUP_TARGETS) {
  const destBase = path.join(root, backupPathFor(stamp));
  const backedUp = [];
  for (const rel of targets) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(destBase, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    backedUp.push(rel);
  }
  return { backupDir: backupPathFor(stamp), backedUp };
}

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// Turn existing prose (CLAUDE.md, AGENTS.md, the rules dir) into decode
// candidates: every normative statement becomes a `{ source, text, strength }`
// the decode step classifies exactly like a doc statement. Existing hooks are
// reported separately as already-enforced (their presence is a fact, not prose to
// re-tier). This is how "nothing is lost" — old bloat is re-decomposed, not dropped.
export function decomposeExisting(root = process.cwd()) {
  const candidates = [];
  const proseFiles = ["CLAUDE.md", "AGENTS.md"].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  const rulesDir = path.join(root, ".claude", "rules");
  if (fs.existsSync(rulesDir)) proseFiles.push(...listFiles(rulesDir).filter((f) => /\.mdx?$/i.test(f)));

  for (const file of proseFiles) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const source = path.relative(root, file).replace(/\\/g, "/");
    for (const statement of extractNormativeStatements(text).statements) {
      candidates.push({ source, text: statement.text, strength: statement.strength });
    }
  }

  const hooksDir = path.join(root, ".claude", "hooks");
  const existingHooks = fs.existsSync(hooksDir) ? listFiles(hooksDir).filter((f) => /\.(mjs|js|cjs)$/i.test(f)).map((f) => path.relative(root, f).replace(/\\/g, "/")) : [];

  return { candidates, existingHooks, proseFiles: proseFiles.map((f) => path.relative(root, f).replace(/\\/g, "/")) };
}

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const [cmd, dir] = process.argv.slice(2);
  const root = dir || process.cwd();
  if (cmd === "decompose") {
    process.stdout.write(JSON.stringify(decomposeExisting(root), null, 2) + "\n");
  } else if (cmd === "backup") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    process.stdout.write(JSON.stringify(backupExisting(root, stamp), null, 2) + "\n");
  } else {
    console.error("usage: adopt.mjs <decompose|backup> [dir]");
    process.exit(1);
  }
}
