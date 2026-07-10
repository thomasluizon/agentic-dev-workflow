// Manifest — the versioned record of what setup-harness generated and WHY. Every
// artifact traces back to the rows of harness.answers.yaml it came from, and
// carries the hash of the content that was written. This is what makes a re-run
// or a `sync` safe: on the next pass we re-decode from the answers, regenerate,
// and compare each file's CURRENT hash to the recorded one — a mismatch means the
// user hand-edited it, so we preserve it and ask before clobbering. AI-managed
// files (the policy + config) are marked non-hand-editable and refreshed freely.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const MANIFEST_FILENAME = "harness.manifest.json";

export function hashContent(content) {
  return createHash("sha256").update(String(content ?? "")).digest("hex");
}

// Build the manifest from the write plan. `answersHash` ties it to the exact
// interview record it was decoded from; `generatedAt` is passed in (the modules
// stay deterministic — the CLI stamps the real time).
export function buildManifest(plan, { answersHash = "", generatedAt = "", backup = null } = {}) {
  return {
    version: 1,
    generatedFrom: "harness.answers.yaml",
    answersHash,
    generatedAt,
    backup,
    artifacts: plan.map((a) => ({
      path: a.path,
      kind: a.kind,
      tier: a.tier,
      handEditable: a.handEditable === true,
      hash: hashContent(a.content),
      sourceRowIds: a.sourceRowIds || [],
    })),
  };
}

export function writeManifest(root, manifest) {
  const full = path.join(root, MANIFEST_FILENAME);
  fs.writeFileSync(full, JSON.stringify(manifest, null, 2) + "\n");
  return full;
}

export function readManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_FILENAME), "utf8"));
  } catch {
    return null;
  }
}

// Compare each recorded artifact's hash to the file on disk NOW. A hand-editable
// artifact whose content changed is a hand-edit to preserve; a missing file is
// gone (regenerate); an unchanged file is safe to overwrite. Returns the buckets
// the re-run/sync logic acts on — it never itself writes or deletes.
export function detectHandEdits(root, manifest) {
  const handEdited = [];
  const unchanged = [];
  const missing = [];
  for (const artifact of manifest?.artifacts || []) {
    const full = path.join(root, artifact.path);
    if (!fs.existsSync(full)) {
      missing.push(artifact.path);
      continue;
    }
    const current = hashContent(fs.readFileSync(full, "utf8"));
    if (current === artifact.hash) unchanged.push(artifact.path);
    else if (artifact.handEditable) handEdited.push(artifact.path);
    else unchanged.push(artifact.path);
  }
  return { handEdited, unchanged, missing };
}
