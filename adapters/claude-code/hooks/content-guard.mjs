#!/usr/bin/env node
// Claude Code PostToolUse(Edit|Write|MultiEdit) adapter for the content-scan
// logic core: scans the text THIS edit introduced (never the whole file) for
// em dashes, banned phrases, and secrets, plus a large-binary guard on Write.
// Thin: normalize -> scanContent -> exit 2 + stderr on a finding. Policy lives
// in hooks.policy.json; logic in core/hooks/logic/content-scan.mjs.
//
// Fail-open: any error exits 0.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Buffer } from "node:buffer";

const here = dirname(fileURLToPath(import.meta.url));

async function core(mod) {
  for (const rel of ["../skills/_core/hooks/logic", "../../../core/hooks/logic"]) {
    const p = join(here, rel, mod);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error(`hook logic core not found: ${mod}`);
}

try {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const { fromClaudeCode } = await core("payload.mjs");
  const event = fromClaudeCode(input);
  if (event.kind !== "edit" || !event.filePath) process.exit(0);

  const { loadPolicy } = await core("config.mjs");
  const { scanContent, checkLargeBinary } = await core("content-scan.mjs");

  const policy = loadPolicy(event.cwd || process.cwd());
  const findings = [];
  if (event.addedText) findings.push(...scanContent(event.addedText, policy.content, event.filePath));
  if (event.tool === "Write" && typeof event.addedText === "string") {
    const big = checkLargeBinary(event.filePath, Buffer.byteLength(event.addedText, "utf8"), policy.content.largeBinary);
    if (big) findings.push(big);
  }

  if (findings.length === 0) process.exit(0);

  process.stderr.write(
    `Content policy violation in ${event.filePath}:\n` +
      findings.map((f) => `  - [${f.rule}] ${f.message}${f.snippet ? ` — "…${f.snippet}…"` : ""}`).join("\n") +
      `\n\nFix the flagged content (rename/restructure, remove the secret, or move a large asset to the configured storage).\n`,
  );
  process.exit(2);
} catch {
  process.exit(0);
}
