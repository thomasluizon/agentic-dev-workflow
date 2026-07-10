// Repo discovery for setup-harness phase 2. Finds the set of repositories the
// workflow spans by three complementary means, then hands the union to the
// runbook to confirm ONCE with the user:
//   1. the current repo (git toplevel of the invocation directory),
//   2. its workspace members (npm/pnpm workspaces, a .sln/.slnx project list),
//   3. sibling repos under a projects-root the user points at.
// All read-only: git plumbing + a bounded filesystem scan. The user can always
// just name a "projects folder with all the repos inside" and skip the scan.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function run(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function repoName(dir) {
  return path.basename(path.normalize(dir));
}

// The git repo containing `dir`, plus its declared workspace members.
export function discoverCurrentRepo(dir = process.cwd()) {
  const inside = run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) return { isRepo: false, root: null, name: null, workspaceMembers: [] };
  const root = path.normalize(run("git", ["-C", dir, "rev-parse", "--show-toplevel"]) || dir);
  return {
    isRepo: true,
    root,
    name: repoName(root),
    workspaceMembers: discoverWorkspaceMembers(root),
  };
}

// Members of a monorepo: npm/pnpm/yarn workspaces globs, or the projects listed
// in a .slnx/.sln. Returned as { name, path, relative } so the interview can ask
// per-member commands. A member glob is expanded one level (the common case:
// `apps/*`, `packages/*`); deeper custom globs fall back to the literal dir.
export function discoverWorkspaceMembers(root) {
  const members = [];
  const pkg = readJson(path.join(root, "package.json"));
  const workspaceGlobs = normalizeWorkspaces(pkg?.workspaces) || pnpmWorkspaces(root);
  for (const glob of workspaceGlobs || []) {
    for (const dir of expandGlobOneLevel(root, glob)) {
      if (fs.existsSync(path.join(dir, "package.json"))) addMember(members, root, dir);
    }
  }
  for (const project of dotnetProjects(root)) addMember(members, root, path.dirname(project));
  return dedupeByPath(members);
}

function normalizeWorkspaces(workspaces) {
  if (Array.isArray(workspaces)) return workspaces;
  if (workspaces && Array.isArray(workspaces.packages)) return workspaces.packages;
  return null;
}

function pnpmWorkspaces(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const globs = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const item = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/);
      if (item) globs.push(item[1].trim());
      else if (/^\S/.test(line)) break;
    }
  }
  return globs.length ? globs : null;
}

// `apps/*` -> each child dir of apps/. A glob with no `*` is treated as a literal
// path. A `**` or nested glob is approximated by its leading literal segment.
function expandGlobOneLevel(root, glob) {
  const clean = glob.replace(/\\/g, "/").replace(/\/$/, "");
  const starIndex = clean.indexOf("*");
  if (starIndex === -1) {
    const literal = path.join(root, clean);
    return fs.existsSync(literal) ? [literal] : [];
  }
  const base = clean.slice(0, starIndex).replace(/\/$/, "");
  const baseDir = base ? path.join(root, base) : root;
  return listDirs(baseDir);
}

function dotnetProjects(root) {
  const solution = firstFile(root, /\.slnx?$/i);
  if (!solution) return [];
  const text = fs.readFileSync(solution, "utf8");
  const projects = new Set();
  for (const match of text.matchAll(/([A-Za-z0-9_.\-\\/]+\.csproj)/g)) {
    const rel = match[1].replace(/\\/g, "/");
    const full = path.join(root, rel);
    if (fs.existsSync(full)) projects.add(full);
  }
  return [...projects];
}

// Immediate git-repo children of a projects-root — the sibling repos. Bounded to
// one level by default (a projects folder holds repos, not trees of them);
// node_modules and dotfolders are skipped.
export function scanProjectsRoot(root, { maxDepth = 1 } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  const found = [];
  walk(path.normalize(root), 0);
  return dedupeByPath(found);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const child of listDirs(dir)) {
      const base = path.basename(child);
      if (base === "node_modules" || base.startsWith(".")) continue;
      if (isGitRepo(child)) {
        found.push({ name: repoName(child), path: child, relative: path.relative(root, child) || "." });
      } else if (depth < maxDepth) {
        walk(child, depth + 1);
      }
    }
  }
}

// The union the runbook confirms once: the current repo, its workspace members,
// and any siblings under the projects-root. `members` and `siblings` are kept
// separate so the interview can treat a monorepo (members share a root) and a
// multi-repo project (independent siblings) differently.
export function discoverRepos({ dir = process.cwd(), projectsRoot = "" } = {}) {
  const current = discoverCurrentRepo(dir);
  const siblings = projectsRoot ? scanProjectsRoot(projectsRoot) : [];
  const currentRoot = current.root ? path.normalize(current.root) : null;
  return {
    current,
    workspaceMembers: current.workspaceMembers,
    siblings: siblings.filter((s) => path.normalize(s.path) !== currentRoot),
    projectsRoot: projectsRoot || null,
  };
}

function addMember(members, root, dir) {
  members.push({ name: repoName(dir), path: path.normalize(dir), relative: path.relative(root, dir) || "." });
}

function dedupeByPath(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = path.normalize(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(dir, e.name))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch {
    return [];
  }
}

function firstFile(dir, pattern) {
  try {
    const name = fs.readdirSync(dir).find((f) => pattern.test(f));
    return name ? path.join(dir, name) : null;
  } catch {
    return null;
  }
}

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ""; };
  const dir = get("--dir") || process.cwd();
  const projectsRoot = get("--projects-root");
  process.stdout.write(JSON.stringify(discoverRepos({ dir, projectsRoot }), null, 2) + "\n");
}
