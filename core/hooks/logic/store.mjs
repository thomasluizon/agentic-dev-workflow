// store.mjs — the out-of-repo, per-project harness store for REPO-CLEAN mode.
//
// On a machine where the repo working directory must stay pristine (a company
// PC that forbids committing — or even creating — any AI/Claude file in a
// checkout), the harness overlay cannot live in the repo. Repo-clean mode keeps
// EVERY per-project artifact under ~/.claude/harness/, keyed by the project's
// absolute git-root path, and delivers it at runtime by reading from here.
//
// This module is the single, dependency-free logic core BOTH the hot-path hooks
// (loadPolicy, the fact injector) AND setup/ read the store through — it lives in
// hooks/logic/ so setup/ imports it downward (setup -> logic, the established
// direction) and the hooks import it sideways, with no layering inversion. It
// therefore uses ONLY Node built-ins (no YAML/JSON dependency, no git shell-out):
//   - policy is JSON  -> parsed here (the loadPolicy hot path stays zero-dep);
//   - facts/rules are markdown -> read as raw text here (the injector hot path);
//   - config is YAML  -> only its RAW TEXT is read here (readStoreConfigText); the
//     YAML PARSE stays in setup/config.mjs, which already owns the pack's parser,
//     so logic/ never has to import setup/.
//
// The store key is a deterministic slug of the absolute repo root (Claude Code's
// own ~/.claude/projects/<encoded> convention), so a hook computes the entry path
// from cwd with NO index read on the hot path; index.json is only for listing,
// migration, and collision reporting.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STORE_DIRNAME = "harness";
export const INDEX_FILENAME = "index.json";
export const MODE_FILENAME = "harness.mode";
export const POLICY_FILENAME = "hooks.policy.json";
export const CONFIG_FILENAME = "workflow.config.yaml";
export const FACTS_FILENAME = "facts.md";
export const RULES_DIRNAME = "rules";

// The most a single injection is allowed to add to the prompt, so a sprawling
// facts file never blows the context budget. Truncated with a visible note.
const INJECT_SOFT_CAP = 12_000;

// ---- repo-root resolution (pure fs, worktree-aware) --------------------------

// The absolute root of the git repo containing `startDir`, or null if none.
// A normal repo has a `.git` DIRECTORY at its root. A linked worktree has a
// `.git` FILE pointing at `<main>/.git/worktrees/<name>`; in that case we derive
// the MAIN worktree root so every worktree of one repo shares a single store
// entry. Pure filesystem walk — never shells out to git (hot-path safe).
export function resolveRepoRoot(startDir) {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  for (let i = 0; i < 100; i++) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      let stat;
      try {
        stat = fs.statSync(gitPath);
      } catch {
        return dir;
      }
      if (stat.isDirectory()) return dir;
      const main = mainWorktreeRoot(gitPath, dir);
      return main || dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Given a linked-worktree `.git` FILE, return the main worktree root. The file
// reads `gitdir: <path>` pointing at `<main>/.git/worktrees/<name>`; that dir's
// `commondir` file points at the main `.git` (usually `../..`). Both pointers may
// be relative, so each is resolved against the dir it lives beside.
function mainWorktreeRoot(gitFilePath, worktreeDir) {
  let gitdir;
  try {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitFilePath, "utf8"));
    if (!match) return null;
    gitdir = match[1].trim();
  } catch {
    return null;
  }
  const absGitdir = path.isAbsolute(gitdir) ? gitdir : path.resolve(worktreeDir, gitdir);

  let commonGitDir = null;
  try {
    const commonFile = path.join(absGitdir, "commondir");
    if (fs.existsSync(commonFile)) {
      const rel = fs.readFileSync(commonFile, "utf8").trim();
      commonGitDir = path.isAbsolute(rel) ? rel : path.resolve(absGitdir, rel);
    }
  } catch {
    commonGitDir = null;
  }
  if (!commonGitDir) {
    const marker = `${path.sep}worktrees${path.sep}`;
    const idx = absGitdir.lastIndexOf(marker);
    if (idx < 0) return null;
    commonGitDir = absGitdir.slice(0, idx);
  }
  return path.basename(commonGitDir) === ".git" ? path.dirname(commonGitDir) : commonGitDir;
}

// ---- store paths -------------------------------------------------------------

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function storeRoot() {
  return path.join(claudeDir(), STORE_DIRNAME);
}

// Deterministic entry slug for an absolute repo root: every non-alphanumeric
// character becomes a dash, mirroring Claude Code's own ~/.claude/projects/<enc>
// encoding. A hook computes this from cwd with no index read.
export function slugForPath(absPath) {
  return String(absPath || "").replace(/[^a-zA-Z0-9]/g, "-");
}

export function storeEntryDir(repoRoot) {
  if (!repoRoot) return null;
  return path.join(storeRoot(), "projects", slugForPath(repoRoot));
}

// The entry dir for wherever `startDir` sits, resolving the repo root first.
export function entryDirForStart(startDir) {
  const root = resolveRepoRoot(startDir);
  return root ? storeEntryDir(root) : null;
}

// ---- index.json --------------------------------------------------------------

export function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(storeRoot(), INDEX_FILENAME), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeIndex(index) {
  const dir = storeRoot();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INDEX_FILENAME), JSON.stringify(index, null, 2) + "\n");
  return index;
}

// Record (or update) a repo's store entry and stamp its mode, keyed by the
// absolute repo root. Returns the entry. `group` lets several repos share config
// intent (e.g. a monorepo's members) without collapsing their entries.
export function registerStoreEntry(repoRoot, { mode = "repo-clean", group = "" } = {}) {
  if (!repoRoot) throw new Error("registerStoreEntry requires an absolute repo root");
  const slug = slugForPath(repoRoot);
  const index = readIndex();
  index[repoRoot] = { slug, mode, ...(group ? { group } : {}) };
  writeIndex(index);
  const entryDir = storeEntryDir(repoRoot);
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, MODE_FILENAME), mode + "\n");
  return { slug, mode, group, entryDir };
}

// Every registered store entry as { repoRoot, slug, mode, entryDir }.
export function listStoreEntries() {
  const index = readIndex();
  return Object.entries(index).map(([repoRoot, meta]) => ({
    repoRoot,
    slug: meta.slug || slugForPath(repoRoot),
    mode: meta.mode || "repo-clean",
    entryDir: storeEntryDir(repoRoot),
  }));
}

// The recorded mode for a repo, from the fast per-entry file (falling back to the
// index), or null if the repo has no store entry (mode-1/mode-2 or unmanaged).
export function readStoreMode(startDir) {
  const entryDir = entryDirForStart(startDir);
  if (!entryDir) return null;
  try {
    return fs.readFileSync(path.join(entryDir, MODE_FILENAME), "utf8").trim() || null;
  } catch {
    const root = resolveRepoRoot(startDir);
    return readIndex()[root]?.mode || null;
  }
}

// ---- store reads (the runtime layer) -----------------------------------------

// The store's hook policy (JSON) for the repo containing `startDir`, or null. Used
// by loadPolicy — the hot path — so it stays a plain JSON parse, zero deps.
export function readStorePolicy(startDir) {
  const entryDir = entryDirForStart(startDir);
  if (!entryDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(entryDir, POLICY_FILENAME), "utf8"));
  } catch {
    return null;
  }
}

// The RAW TEXT of the store's workflow.config.yaml, or null. The YAML PARSE lives
// in setup/config.mjs (which owns the pack's parser); logic/ never imports setup/.
export function readStoreConfigText(startDir) {
  const entryDir = entryDirForStart(startDir);
  if (!entryDir) return null;
  try {
    return fs.readFileSync(path.join(entryDir, CONFIG_FILENAME), "utf8");
  } catch {
    return null;
  }
}

// ---- injected context (facts + rules) — the shared assembly ------------------

function stripFrontmatter(text) {
  return String(text || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function readRuleBodies(entryDir) {
  const dir = path.join(entryDir, RULES_DIRNAME);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort();
  } catch {
    return [];
  }
  const bodies = [];
  for (const name of names) {
    try {
      const body = stripFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
      if (body) bodies.push(body);
    } catch {
      /* skip an unreadable rule file — never block */
    }
  }
  return bodies;
}

// Assemble the facts + project rules that BOTH injectors (the Claude Code
// UserPromptSubmit hook and the opencode system.transform hook) push into the
// model's context for a repo-clean project. Returns a single string, or null when
// the repo has no store entry (mode-1/mode-2 repos keep their facts in-repo, so
// the injector must no-op). Soft-capped so a huge facts file can't flood context.
export function buildInjectedContext(repoRoot) {
  const entryDir = storeEntryDir(repoRoot);
  if (!entryDir || !fs.existsSync(entryDir)) return null;

  const sections = [];
  try {
    const facts = fs.readFileSync(path.join(entryDir, FACTS_FILENAME), "utf8").trim();
    if (facts) sections.push(facts);
  } catch {
    /* no facts.md — rules may still exist */
  }
  sections.push(...readRuleBodies(entryDir));
  if (sections.length === 0) return null;

  const header = "The following project facts and rules are managed by the agentic harness (repo-clean mode; they live outside this repo). Treat them as project instructions:";
  let body = `${header}\n\n${sections.join("\n\n")}`;
  if (body.length > INJECT_SOFT_CAP) {
    body = body.slice(0, INJECT_SOFT_CAP) + "\n\n[...truncated — see the full facts/rules in the harness store.]";
  }
  return body;
}
