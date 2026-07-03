#!/usr/bin/env node
// Fails if any project-specific string leaks into the tool-agnostic core.
// core/ is the single source of truth every adapter points at; it must stay
// generic so the pack drops cleanly into any project. Everything project-
// specific belongs in workflow.config.yaml, never in core/.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(packRoot, "core");

// Each pattern is a leak: a name, vendor, brand, or absolute path that would
// couple core/ to one project. Add project-neutral terms here, never remove the
// project-specific ones.
const forbidden = [
  { label: "project brand (orbit)", re: /\borbit\b/i },
  { label: "project domain (useorbit)", re: /useorbit/i },
  { label: "author handle (thomasluizon)", re: /thomasluizon/i },
  { label: "product name (astra)", re: /\bastra\b/i },
  { label: "absolute Windows path", re: /[A-Za-z]:\\Users\\/i },
  { label: "absolute Windows path (forward slash)", re: /[A-Za-z]:\/Users\//i },
  { label: "absolute Unix home path", re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//i },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const leaks = [];
for (const file of walk(coreDir)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { label, re } of forbidden) {
      if (re.test(line)) {
        leaks.push({ file: relative(packRoot, file), line: i + 1, label, text: line.trim() });
      }
    }
  });
}

if (leaks.length > 0) {
  console.error(`Genericity check FAILED — ${leaks.length} project-specific string(s) in core/:\n`);
  for (const leak of leaks) {
    console.error(`  ${leak.file}:${leak.line}  [${leak.label}]`);
    console.error(`    ${leak.text}`);
  }
  console.error(`\nMove project-specific values into workflow.config.yaml; core/ must stay generic.`);
  process.exit(1);
}

console.log("Genericity check passed — core/ is free of project-specific strings.");
