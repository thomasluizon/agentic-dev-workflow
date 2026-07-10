#!/usr/bin/env node
// sync.mjs — update an installed harness in place. Two halves, each optional:
//
//   1. CORE   — if the project self-vendored the pack (a skills-lock.json is
//               present), re-vendor CORE + the adapter so the generic skill
//               bodies match the current pack. (A project that uses the GLOBAL
//               CORE instead refreshes it by re-running `node bootstrap.mjs`.)
//   2. OVERLAY — if the project was stood up by `/setup-harness` (a
//               harness.answers.yaml is present), re-DECODE the saved interview
//               deterministically and re-apply the generated artifacts, honoring
//               the approved decomposition (harness.decomposition.md) and
//               PRESERVING every hand-edit the manifest detects. AI-managed files
//               (the policy + config) refresh freely; a hand-edited file is never
//               clobbered without --force. For a REPO-CLEAN project the answers
//               record lives in the out-of-repo store (keyed by git root), so the
//               re-apply runs against the store entry with the store layout.
//
// This is the lifecycle counterpart to bootstrap (global install) and install
// (project vendor): sync keeps an already-installed project current.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { vendor } from "./install.mjs";
import { readAnswers, ANSWERS_FILENAME } from "../core/setup/answers.mjs";
import { decode } from "../core/setup/decode.mjs";
import { parseGateTable, applyEdits, GATE_FILENAME } from "../core/setup/gate.mjs";
import { planArtifacts } from "../core/setup/generate.mjs";
import { readManifest, detectHandEdits, hashContent, MANIFEST_FILENAME } from "../core/setup/manifest.mjs";
import { detectStack } from "../core/hooks/lint-generators/detect.mjs";
import { resolveRepoRoot, storeEntryDir } from "../core/hooks/logic/store.mjs";

// Re-decode the saved interview and re-apply the overlay, preserving hand-edits.
// Returns { written, preserved, orphaned, gaps } — never clobbers a hand-edited
// hand-editable file unless `force` is set. `generatedAt` is passed in so the
// module stays deterministic (the CLI stamps the real time). `layout` is "store"
// for a repo-clean project (root is its store entry dir) so re-generation remaps
// the paths the same way the original setup did.
export function reapplyOverlay(root, { force = false, generatedAt = "", layout = "in-repo" } = {}) {
  const answersFile = join(root, ANSWERS_FILENAME);
  if (!existsSync(answersFile)) return { skipped: "no harness.answers.yaml", written: [], preserved: [], orphaned: [], gaps: [] };

  const answers = readAnswers(answersFile);
  const repoPath = answers?.repos?.[0]?.path;
  const stack = repoPath && existsSync(repoPath) ? detectStack(repoPath) : { linters: [] };

  const decoded = decode(answers, { stack });
  const gatePath = join(root, GATE_FILENAME);
  const edits = existsSync(gatePath) ? parseGateTable(readFileSync(gatePath, "utf8")) : {};
  const approved = applyEdits(decoded, edits);

  const { plan, gaps } = planArtifacts(answers, approved, { stack, layout });

  const previous = readManifest(root);
  const buckets = previous ? detectHandEdits(root, previous) : { handEdited: [], unchanged: [], missing: [] };
  const handEdited = new Set(buckets.handEdited);
  const oldByPath = new Map((previous?.artifacts || []).map((a) => [a.path, a]));

  const written = [];
  const preserved = [];
  const artifacts = plan.map((artifact) => {
    const isHandEdit = artifact.handEditable === true && handEdited.has(artifact.path);
    if (isHandEdit && !force) {
      preserved.push(artifact.path);
      const old = oldByPath.get(artifact.path);
      return { path: artifact.path, kind: artifact.kind, tier: artifact.tier, handEditable: true, hash: old?.hash || hashContent(readFileSafe(join(root, artifact.path))), sourceRowIds: artifact.sourceRowIds || [] };
    }
    const full = join(root, artifact.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, artifact.content);
    written.push(artifact.path);
    return { path: artifact.path, kind: artifact.kind, tier: artifact.tier, handEditable: artifact.handEditable === true, hash: hashContent(artifact.content), sourceRowIds: artifact.sourceRowIds || [] };
  });

  // A file the previous manifest owned that the new decomposition no longer
  // produces (a rule dropped at the gate). Report it — never delete, since it may
  // carry hand-edits — so the drift is visible, not silent.
  const nowPaths = new Set(plan.map((a) => a.path));
  const orphaned = (previous?.artifacts || []).map((a) => a.path).filter((p) => !nowPaths.has(p));

  const manifest = {
    version: 1,
    generatedFrom: ANSWERS_FILENAME,
    answersHash: hashContent(JSON.stringify(answers)),
    generatedAt,
    backup: previous?.backup ?? null,
    artifacts,
  };
  writeFileSync(join(root, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + "\n");

  return { written, preserved, orphaned, gaps };
}

function readFileSafe(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function refreshCore(root, ref = "main") {
  const lockPath = join(root, "skills-lock.json");
  if (!existsSync(lockPath)) return { skipped: "no skills-lock.json (project uses the global CORE — re-run bootstrap to refresh it)" };
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return { skipped: "malformed skills-lock.json" };
  }
  const tool = lock?.pack?.tool;
  if (!tool) return { skipped: "skills-lock.json missing pack.tool" };
  const before = lock.pack.computedHash;
  const result = vendor({ tool, into: root, ref });
  return { tool, changed: result.lock.pack.computedHash !== before };
}

function parseArgs(argv) {
  const args = { ref: "main", force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--into") args.into = argv[++i];
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--force") args.force = true;
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.into) {
    console.error("Missing --into <project-dir>");
    process.exit(1);
  }

  const core = refreshCore(args.into, args.ref);
  if (core.skipped) console.log(`CORE: ${core.skipped}`);
  else console.log(`CORE: re-vendored ${core.tool} — ${core.changed ? "updated" : "already up to date"}`);

  // A repo-clean project has no in-repo harness.answers.yaml; its overlay lives in
  // the out-of-repo store, keyed by git root. Point the re-apply at the store entry
  // and remap paths (layout "store") when that is where the answers record lives.
  const repoRoot = resolveRepoRoot(args.into) || args.into;
  const entryDir = storeEntryDir(repoRoot);
  const repoClean = !existsSync(join(args.into, ANSWERS_FILENAME)) && entryDir && existsSync(join(entryDir, ANSWERS_FILENAME));
  const overlayRoot = repoClean ? entryDir : args.into;
  if (repoClean) console.log(`Overlay: repo-clean — re-applying from the store entry ${entryDir}`);

  const overlay = reapplyOverlay(overlayRoot, { force: args.force, generatedAt: new Date().toISOString(), layout: repoClean ? "store" : "in-repo" });
  if (overlay.skipped) {
    console.log(`Overlay: ${overlay.skipped} — run /setup-harness in this project first.`);
  } else {
    console.log(`Overlay: ${overlay.written.length} file(s) refreshed${overlay.preserved.length ? `, ${overlay.preserved.length} hand-edit(s) preserved` : ""}.`);
    if (overlay.preserved.length) {
      console.log(`  preserved (pass --force to regenerate): ${overlay.preserved.join(", ")}`);
    }
    if (overlay.orphaned.length) console.log(`  orphaned (dropped at the gate; left on disk): ${overlay.orphaned.join(", ")}`);
    if (overlay.gaps.length) console.log(`  ${overlay.gaps.length} gap(s) to wire (see the setup gaps report).`);
  }

  if (core.skipped && overlay.skipped) {
    console.error("Nothing to sync — this project has neither a vendored CORE nor a generated overlay.");
    process.exit(1);
  }
}
