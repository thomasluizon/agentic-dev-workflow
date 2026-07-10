// Gate — the second half of setup-harness, step 2. Turns a decomposition (from
// decode.mjs) into ONE editable table the user reviews before anything enforcing
// is written, then reads their edits back. This is the human gate between
// autonomy phases: the harness proposes a tier + action per rule; the user flips
// toggles and fixes tiers in the file; on "go" the generators run against the
// EDITED table — never the raw proposal.
//
// The table is Markdown so it is editable in any editor with no tooling. Two
// columns are meant to be changed: TIER (HOOK / LINT / RULE / FACT / SKILL) and
// ACTION (enforce / soften / drop). `renderGateTable` writes it; `parseGateTable`
// reads the edits back; `applyEdits` produces the approved decomposition the
// generators consume. Conflicts are rendered inline and must be settled before
// "go" — precedence is ALWAYS-ASK, so nothing is auto-resolved.

import { subjectClash } from "./decode.mjs";

export const GATE_FILENAME = "harness.decomposition.md";

const ACTIONS = new Set(["enforce", "soften", "drop", "keep"]);
const TIER_SET = new Set(["HOOK", "LINT", "RULE", "FACT", "SKILL"]);

function cell(text) {
  return String(text == null ? "" : text).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function scopeCell(rowScopes, exceptions) {
  const parts = [];
  if (rowScopes?.include?.length) parts.push(`in: ${rowScopes.include.join(", ")}`);
  if (rowScopes?.exclude?.length) parts.push(`except: ${rowScopes.exclude.join(", ")}`);
  if (exceptions?.length) parts.push(`exempt: ${exceptions.join(", ")}`);
  return parts.join(" · ") || "—";
}

function conflictBanner(conflicts) {
  if (!conflicts?.length) return "";
  const lines = ["## ⚠ Conflicts — resolve these before you type `go`", "", "Two or more sources pull opposite ways on the same subject. Precedence is **always-ask**: nothing is auto-resolved. Pick a winner by setting the losing row(s) to `drop` (or `soften`).", ""];
  for (const c of conflicts) lines.push(`- **${c.subject}** — ${cell(c.detail)} (rows: ${c.rowIds.join(", ")})`);
  lines.push("");
  return lines.join("\n");
}

// Render the whole decomposition as one editable Markdown document. The row ID in
// the first column is the join key parseGateTable uses to read edits back, so it
// must be preserved verbatim.
export function renderGateTable(decomposition, { projectName = "" } = {}) {
  const { rows = [], conflicts = [], stats = {} } = decomposition;
  const header = [
    `# Harness decomposition${projectName ? ` — ${projectName}` : ""}`,
    "",
    "Every rule the interview and your docs surfaced, classified to its enforcement tier. **Review, then edit the `Tier` and `Action` columns** and re-run setup (or type `go`). Nothing enforcing is written until you approve.",
    "",
    "- **Tier** — `HOOK` (deterministic gate), `LINT` (a real linter rule, strongest layer), `RULE` (re-injected each session), `FACT` (CLAUDE.md), `SKILL` (a procedure).",
    "- **Action** — `enforce` (write the gate), `soften` (keep as an advisory rule, don't block), `drop` (discard). `keep`/`drop` for non-enforcing tiers.",
    "- **Do not edit the `ID` column** — it links your edits back to the proposal.",
    "",
    `Tally: ${Object.entries(stats).map(([tier, n]) => `${n} ${tier}`).join(" · ") || "none"}.`,
    "",
  ].join("\n");

  const banner = conflictBanner(conflicts);
  const conflictedIds = new Set(conflicts.flatMap((c) => c.rowIds));

  const tableHead = [
    "| ID | Rule | Source | Tier | Action | Scope / exceptions | Why |",
    "|---|---|---|---|---|---|---|",
  ];
  const body = rows.map((r) => {
    const flag = conflictedIds.has(r.id) ? "⚠ " : "";
    return `| ${cell(r.id)} | ${flag}${cell(r.rule)} | ${cell(r.source)} | ${cell(r.tier)} | ${cell(r.action)} | ${cell(scopeCell(r.scopes, r.exceptions))} | ${cell(r.reason)} |`;
  });

  return `${header}${banner}## Decomposition\n\n${[...tableHead, ...body].join("\n")}\n\nWhen this reads right, type \`go\` to generate.\n`;
}

// Read a (possibly user-edited) gate document back into an edits map
// { id: { tier, action } }. Tolerant of reformatting: it keys on the ID column
// and ignores the header, the separator, and any non-table lines.
export function parseGateTable(markdown) {
  const edits = {};
  for (const raw of String(markdown || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.replace(/\\\|/g, "|").trim());
    if (cells.length < 5) continue;
    const [id, , , tierRaw, actionRaw] = cells;
    if (!id || id.toLowerCase() === "id" || /^-+$/.test(id)) continue;
    const tier = tierRaw.toUpperCase();
    const action = actionRaw.toLowerCase();
    edits[id] = {
      tier: TIER_SET.has(tier) ? tier : undefined,
      action: ACTIONS.has(action) ? action : undefined,
    };
  }
  return edits;
}

// Apply the edits to the decomposition, producing the approved set the generators
// consume. `drop` removes a row (recorded as dropped); `soften` on an enforcing
// tier downgrades it to an advisory RULE and stops it blocking. Everything else
// keeps the (possibly re-tiered) row.
export function applyEdits(decomposition, edits = {}) {
  const kept = [];
  const dropped = [];
  for (const r of decomposition.rows || []) {
    const edit = edits[r.id] || {};
    const action = edit.action || r.action;
    const tier = edit.tier || r.tier;
    if (action === "drop") {
      dropped.push({ ...r, action, tier, dropped: true });
      continue;
    }
    if (action === "soften" && (tier === "HOOK" || tier === "LINT")) {
      kept.push({ ...r, action: "soften", tier: "RULE", softenedFrom: tier });
      continue;
    }
    kept.push({ ...r, action, tier });
  }
  return { rows: kept, dropped, conflicts: decomposition.conflicts || [] };
}

// Conflicts still unsettled after edits: a subject whose SURVIVING rows still pull
// opposite ways (a ban and a requirement, or two competing values). Dropping or
// softening the losing row clears it. The runbook must ask before "go" while any
// remain — nothing is auto-resolved.
export function pendingConflicts(approved) {
  return (approved.conflicts || []).filter((c) => {
    const liveRows = approved.rows.filter((r) => r.subject === c.subject);
    return liveRows.length > 1 && subjectClash(c.subject, liveRows);
  });
}

async function main() {
  const fs = await import("node:fs");
  const { decode } = await import("./decode.mjs");
  const { readAnswers } = await import("./answers.mjs");
  const answers = readAnswers(process.argv[3] || "harness.answers.yaml");
  const md = renderGateTable(decode(answers), { projectName: answers?.answered?.projectName || "" });
  fs.writeFileSync(GATE_FILENAME, md);
  console.log(`Wrote ${GATE_FILENAME} — edit Tier/Action, then continue.`);
}

if (process.argv[1] && process.argv[2] === "render") main();
