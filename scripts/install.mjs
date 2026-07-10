#!/usr/bin/env node
// Vendors the pack into a consumer project: copies the tool-agnostic core plus
// the chosen tool's thin adapter into the consumer's skills directory, then
// writes a skills-lock.json pinning what was installed. Re-runnable; sync.mjs
// re-uses `vendor()` to refresh an existing install.

import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Per-tool install layout. `skillsSubdir` is where wrapper skills land, relative
// to the consumer root; `coreSubdir` is where core/ is vendored; `agentsSubdir`
// (optional) is where the agent wrappers land. The adapter wrappers reference
// core with a relative pointer that resolves from `skillsSubdir` to `coreSubdir`.
// `engineDirs` vendors the dual-target hook-engine adapters (authored shells that
// import the vendored logic core); the hook shells probe `../skills/_core/hooks/
// logic`, so the layout keeps them a sibling of the vendored core. (Wiring the
// Claude Code hooks into settings.json + registering nothing for opencode's
// auto-loaded plugin is the bootstrap step; this vendors the files.)
const layouts = {
  "claude-code": {
    adapterSkillsDir: "skills",
    skillsSubdir: ".claude/skills",
    coreSubdir: ".claude/skills/_core",
    agentsSubdir: ".claude/agents",
    engineDirs: [
      { from: "hooks", to: ".claude/hooks" },
      { from: "workflows", to: ".claude/workflows" },
    ],
  },
  opencode: {
    adapterSkillsDir: "skills",
    skillsSubdir: ".opencode/skills",
    coreSubdir: ".opencode/skills/_core",
    agentsSubdir: ".opencode/agents",
    engineDirs: [{ from: "plugin", to: ".opencode/plugin" }],
  },
};

export function hashTree(dir) {
  const hash = createHash("sha256");
  const files = [];
  (function walk(d) {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  })(dir);
  for (const file of files.sort()) {
    hash.update(relative(dir, file).replace(/\\/g, "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

export function vendor({ tool, into, ref = "main", dryRun = false }) {
  const layout = layouts[tool];
  if (!layout) {
    throw new Error(`Unknown tool "${tool}". Expected one of: ${Object.keys(layouts).join(", ")}`);
  }
  if (!into) throw new Error("Missing --into <consumer-dir>");

  const adapterDir = join(packRoot, "adapters", tool);
  const coreDir = join(packRoot, "core");

  const plan = [
    { from: join(adapterDir, layout.adapterSkillsDir), to: join(into, layout.skillsSubdir) },
    { from: coreDir, to: join(into, layout.coreSubdir) },
  ];
  if (layout.agentsSubdir) {
    plan.push({ from: join(adapterDir, "agents"), to: join(into, layout.agentsSubdir) });
  }
  for (const dir of layout.engineDirs || []) {
    const from = join(adapterDir, dir.from);
    if (existsSync(from)) plan.push({ from, to: join(into, dir.to) });
  }

  if (dryRun) {
    console.log(`[dry-run] install tool=${tool} ref=${ref} into=${into}`);
    for (const step of plan) {
      console.log(`  copy ${relative(packRoot, step.from)}  ->  ${relative(into, step.to) || "."}`);
    }
    console.log(`  write ${join(layout.skillsSubdir, "..", "..")}/skills-lock.json`);
    return { dryRun: true, plan };
  }

  for (const step of plan) {
    rmSync(step.to, { recursive: true, force: true });
    mkdirSync(dirname(step.to), { recursive: true });
    cpSync(step.from, step.to, { recursive: true });
  }

  const computedHash = hashTree(join(into, layout.coreSubdir));
  const lock = {
    version: 1,
    pack: {
      source: "thomasluizon/agentic-dev-workflow",
      sourceType: "github",
      ref,
      tool,
      installedPaths: [layout.skillsSubdir, layout.coreSubdir, layout.agentsSubdir, ...(layout.engineDirs || []).map((d) => d.to)].filter(Boolean),
      computedHash,
    },
  };
  const lockPath = join(into, "skills-lock.json");
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Installed ${tool} adapter + core into ${into}`);
  console.log(`Wrote ${lockPath} (computedHash ${computedHash.slice(0, 12)}…)`);
  return { dryRun: false, lock };
}

function parseArgs(argv) {
  const args = { ref: "main", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tool") args.tool = argv[++i];
    else if (a === "--into") args.into = argv[++i];
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    vendor(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
