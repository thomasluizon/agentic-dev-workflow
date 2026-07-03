#!/usr/bin/env node
// Refreshes an existing install: re-vendors the pack into a consumer that
// already has a skills-lock.json and re-pins computedHash. Idempotent — running
// it twice on an unchanged pack produces the same lock.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vendor } from "./install.mjs";

function parseArgs(argv) {
  const args = { ref: "main", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--into") args.into = argv[++i];
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.into) {
  console.error("Missing --into <consumer-dir>");
  process.exit(1);
}

const lockPath = join(args.into, "skills-lock.json");
if (!existsSync(lockPath)) {
  console.error(`No skills-lock.json in ${args.into} — run install.mjs first.`);
  process.exit(1);
}

const existing = JSON.parse(readFileSync(lockPath, "utf8"));
const tool = existing?.pack?.tool;
if (!tool) {
  console.error(`Malformed lock at ${lockPath} — missing pack.tool.`);
  process.exit(1);
}

const before = existing.pack.computedHash;
const result = vendor({ tool, into: args.into, ref: args.ref, dryRun: args.dryRun });
if (!args.dryRun) {
  const after = result.lock.pack.computedHash;
  console.log(after === before ? "Already up to date (hash unchanged)." : "Re-pinned computedHash.");
}
