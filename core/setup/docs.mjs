// Doc-source handling for setup-harness. Two jobs:
//   1. Classify each doc pointer the user gives as an explicit LINK (a specific
//      page to fetch) or a SOURCE to search (a Confluence space, a wiki base, a
//      docs repo) — the design's "explicit links + a taught doc-source".
//   2. From fetched doc text, extract every NORMATIVE statement ("must / never /
//      always / required ...") as a candidate rule for the decode step to tier.
//
// The fetch itself (a Confluence/Notion MCP, or WebFetch) is driven by the
// runbook — this module is the deterministic text-side: turning prose into a
// deduped list of candidate rules, each tagged hard vs soft, so the decode step
// works from a concrete list rather than re-reading whole pages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Hard modals create an enforceable candidate; soft modals a recommendation the
// decode step is more likely to route to a rule/note than a hook.
const HARD_MODALS = [
  "must not", "must", "shall not", "shall", "never", "always", "required",
  "requires", "prohibited", "forbidden", "not allowed", "do not", "don't",
  "may not", "cannot", "mandatory", "enforce", "only ever",
];
const SOFT_MODALS = ["should not", "should", "prefer", "preferred", "recommended", "recommend", "avoid", "discouraged", "consider"];

const HARD_RE = buildModalRegExp(HARD_MODALS);
const SOFT_RE = buildModalRegExp(SOFT_MODALS);

function buildModalRegExp(modals) {
  const escaped = modals.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp(`(?:^|\\b|\\s)(?:${escaped.join("|")})(?:\\b|\\s|$)`, "i");
}

// Split text into candidate statements. Markdown list items and headings are
// natural rule units; otherwise fall back to sentence-ish segments. Bullets keep
// their own line so "- never commit secrets" is one statement.
function segments(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+\.\s+/, "").trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/)) {
      const trimmed = sentence.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

// Extract normative statements from a doc's text. Returns
// [{ text, strength: "hard" | "soft" }] deduped, capped to keep the decode gate
// reviewable; the count of any that were dropped is returned so nothing is
// silently truncated.
export function extractNormativeStatements(text, { max = 200 } = {}) {
  const found = [];
  const seen = new Set();
  for (const segment of segments(text)) {
    const normalized = segment.replace(/\s+/g, " ").trim();
    if (normalized.length < 6 || normalized.length > 400) continue;
    const isHard = HARD_RE.test(normalized);
    const isSoft = !isHard && SOFT_RE.test(normalized);
    if (!isHard && !isSoft) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ text: normalized, strength: isHard ? "hard" : "soft" });
  }
  return {
    statements: found.slice(0, max),
    total: found.length,
    dropped: Math.max(0, found.length - max),
  };
}

// Classify a doc pointer. A specific page URL is a LINK to fetch; a space key, a
// wiki/base URL with no page, or a repo reference is a SOURCE to search. The
// heuristic is deliberately loose — the runbook confirms the classification.
export function classifyDocSource(input) {
  const value = String(input || "").trim();
  if (!value) return { kind: "unknown", value };
  const isUrl = /^https?:\/\//i.test(value);
  if (isUrl) {
    const looksLikeSpace = /\/(wiki\/spaces|spaces|display)\/[^/]+\/?$/i.test(value) || /\/(wiki|docs)\/?$/i.test(value);
    const hasPage = /\/(pages|page)\/\d+|\.(md|html?)$|\/[^/]+-[^/]+$/i.test(value);
    if (looksLikeSpace && !hasPage) return { kind: "source", medium: "web", value };
    return { kind: "link", medium: "web", value };
  }
  if (/^[A-Z][A-Z0-9]+$/.test(value)) return { kind: "source", medium: "space-key", value };
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return { kind: "source", medium: "repo", value };
  return { kind: "source", medium: "named", value };
}

// Split a mixed list of user-provided pointers into links to fetch and sources to
// search.
export function partitionDocInputs(inputs = []) {
  const links = [];
  const sources = [];
  for (const raw of inputs) {
    const classified = classifyDocSource(raw);
    if (classified.kind === "link") links.push(classified);
    else if (classified.kind === "source") sources.push(classified);
  }
  return { links, sources };
}

export function dedupeStatements(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = typeof item === "string" ? item : item.text;
    const key = (text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(typeof item === "string" ? { text, strength: "hard" } : item);
  }
  return out;
}

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "extract" && arg) {
    const text = fs.readFileSync(arg, "utf8");
    process.stdout.write(JSON.stringify(extractNormativeStatements(text), null, 2) + "\n");
  } else if (cmd === "classify" && arg) {
    process.stdout.write(JSON.stringify(classifyDocSource(arg), null, 2) + "\n");
  } else {
    console.error("usage: docs.mjs <extract <file> | classify <pointer>>");
    process.exit(1);
  }
}
