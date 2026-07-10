// Read-only machine detection for setup-harness phase 1 ("research the machine").
// Every probe here is non-mutating: it reads files, asks the OS where a binary
// lives (`where`/`which`), runs `--version` on a curated set of safe tools, and
// reads git's own metadata. It NEVER runs a project's test/build/install script,
// starts a server, or touches the network beyond git's local config — inference
// only, and every inferred value is surfaced for the user to confirm or correct.
//
// Pure Node built-ins (no deps), and no bash-isms: the CLI-presence probe picks
// `where` on Windows and `which` elsewhere, so it runs the same on every OS.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferCommands } from "./commands.mjs";

// CLIs worth knowing about, grouped so the interview can reason about capability
// rather than a flat list. Presence is resolved by the OS path lookup; a curated
// subset also gets a `--version` probe (only tools whose version flag is safe and
// side-effect-free).
export const KNOWN_CLIS = {
  vcs: ["git"],
  forge: ["gh", "glab", "az", "jira", "bb"],
  runtime: ["node", "python", "python3", "dotnet", "go", "ruby", "java"],
  packageManager: ["npm", "pnpm", "yarn", "bun", "pip", "pip3", "poetry", "uv", "cargo", "nuget"],
  container: ["docker", "podman"],
  automation: ["make", "task", "just"],
};

const VERSION_PROBE = new Set([
  "git", "gh", "glab", "az", "jira", "node", "python", "python3",
  "dotnet", "go", "ruby", "java", "npm", "pnpm", "yarn", "bun", "docker", "podman",
]);

function run(file, args, opts = {}) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
      windowsHide: true,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

// Where a binary lives, or null. `where`/`which` return every match on separate
// lines; we keep the first. This is the sanctioned "safe probe" — it resolves a
// PATH entry, it does not execute the tool.
export function whichCli(name) {
  const locator = process.platform === "win32" ? "where" : "which";
  const out = run(locator, [name]);
  if (!out) return null;
  return out.split(/\r?\n/)[0].trim() || null;
}

function probeVersion(name) {
  if (!VERSION_PROBE.has(name)) return null;
  const out = run(name, ["--version"]);
  if (!out) return null;
  const firstLine = out.split(/\r?\n/)[0].trim();
  const match = firstLine.match(/\d+(?:\.\d+){1,3}/);
  return match ? match[0] : firstLine.slice(0, 40);
}

// Detect every known CLI. Returns a flat map name -> { present, path, version,
// group } plus a `present` convenience list, so both the runbook and the tracker
// driver can consume it.
export function detectClis(groups = KNOWN_CLIS) {
  const clis = {};
  for (const [group, names] of Object.entries(groups)) {
    for (const name of names) {
      const binPath = whichCli(name);
      const present = Boolean(binPath);
      clis[name] = {
        present,
        group,
        path: binPath,
        version: present ? probeVersion(name) : null,
      };
    }
  }
  return clis;
}

export function detectOs() {
  const shellEnv = process.env.SHELL || process.env.ComSpec || "";
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    shell: shellEnv ? path.basename(shellEnv) : "",
    homedir: os.homedir(),
    node: process.version,
    cpus: os.cpus().length,
  };
}

const GIT_HOSTS = [
  { host: "github", re: /github\.com/i },
  { host: "gitlab", re: /gitlab\.com|gitlab\./i },
  { host: "azure", re: /dev\.azure\.com|visualstudio\.com/i },
  { host: "bitbucket", re: /bitbucket\.org|bitbucket\./i },
];

export function hostFromRemoteUrl(url) {
  if (!url) return null;
  for (const { host, re } of GIT_HOSTS) if (re.test(url)) return host;
  return "unknown";
}

// Git metadata for a directory: is it a repo, its toplevel, remotes, current
// branch, and the inferred forge host. All read-only git plumbing.
export function detectGit(dir = process.cwd()) {
  const isRepo = run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isRepo) return { isRepo: false, root: null, remotes: [], host: null, currentBranch: null };
  const root = run("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  const currentBranch = run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  const remoteRaw = run("git", ["-C", dir, "remote", "-v"]) || "";
  const seen = new Map();
  for (const line of remoteRaw.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (match && !seen.has(match[1])) seen.set(match[1], match[2]);
  }
  const remotes = [...seen].map(([name, url]) => ({ name, url, host: hostFromRemoteUrl(url) }));
  const origin = remotes.find((r) => r.name === "origin") || remotes[0];
  return {
    isRepo: true,
    root: root ? path.normalize(root) : null,
    remotes,
    host: origin ? origin.host : null,
    currentBranch: currentBranch && currentBranch !== "HEAD" ? currentBranch : null,
  };
}

// Existing CI configuration files present in a repo. The list drives an interview
// follow-up ("you already have CI on <host>; enforce the same gates locally?").
const CI_FILES = [
  { file: ".github/workflows", host: "github", dir: true },
  { file: "azure-pipelines.yml", host: "azure" },
  { file: ".gitlab-ci.yml", host: "gitlab" },
  { file: "bitbucket-pipelines.yml", host: "bitbucket" },
  { file: ".circleci/config.yml", host: "circleci" },
  { file: "Jenkinsfile", host: "jenkins" },
];

export function detectCi(dir = process.cwd()) {
  const found = [];
  for (const entry of CI_FILES) {
    const full = path.join(dir, entry.file);
    if (!fs.existsSync(full)) continue;
    if (entry.dir) {
      const workflows = safeReaddir(full).filter((f) => /\.ya?ml$/i.test(f));
      if (workflows.length) found.push({ ...entry, workflows });
    } else {
      found.push(entry);
    }
  }
  return found;
}

// Convention/agent docs already in the repo. setup-harness treats an existing
// CLAUDE.md / AGENTS.md as an adopt-vs-reset decode source (handled in the next
// slice); here we only report which exist.
const CONVENTION_DOCS = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", "DESIGN.md", "README.md", ".cursorrules", ".windsurfrules"];

export function detectConventionsDocs(dir = process.cwd()) {
  return CONVENTION_DOCS.filter((doc) => fs.existsSync(path.join(dir, doc)));
}

// MCP servers the host tool already has wired, read from the user config file
// (~/.claude.json). Read-only; a missing or malformed file yields an empty list
// rather than failing the whole detection pass.
export function detectMcpServers(homeDir = os.homedir()) {
  const configPath = path.join(homeDir, ".claude.json");
  const names = new Set();
  const config = readJsonIfExists(configPath);
  if (config && typeof config.mcpServers === "object") {
    for (const key of Object.keys(config.mcpServers)) names.add(key);
  }
  if (config && typeof config.projects === "object") {
    for (const project of Object.values(config.projects)) {
      if (project && typeof project.mcpServers === "object") {
        for (const key of Object.keys(project.mcpServers)) names.add(key);
      }
    }
  }
  return [...names].sort();
}

// One inventory object the runbook and the tracker driver both read.
export function detectMachine({ dir = process.cwd() } = {}) {
  const git = detectGit(dir);
  const repoDir = git.root || dir;
  return {
    os: detectOs(),
    clis: detectClis(),
    git,
    ci: detectCi(repoDir),
    conventionsDocs: detectConventionsDocs(repoDir),
    mcpServers: detectMcpServers(),
    commands: inferCommands(repoDir),
  };
}

// A compact inventory for the tracker driver and interview predicates.
export function inventory(machine) {
  const clis = {};
  for (const [name, info] of Object.entries(machine.clis || {})) clis[name] = info.present;
  return { clis, mcp: machine.mcpServers || [], host: machine.git?.host || null };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
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
  const dirFlag = args.indexOf("--dir");
  const dir = dirFlag >= 0 ? args[dirFlag + 1] : process.cwd();
  const machine = detectMachine({ dir });
  process.stdout.write(JSON.stringify(machine, null, 2) + "\n");
}
