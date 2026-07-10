// Runtime-agnostic content invariants: scan a block of newly-written text for
// banned characters, banned phrases, and secret patterns. Every rule is
// parameterized and independently path-scoped (a rule can be enforced
// everywhere EXCEPT a carve-out set — a carve-out narrows, never disables). The
// Claude Code PostToolUse hook feeds the added text (Edit new_string /
// MultiEdit edits / Write content); the opencode tool.execute.before plugin
// feeds the pending edit args. Both call `scanContent` and translate findings.
//
// Secret patterns default to a conservative, universal set (unambiguous key
// shapes only) so a bare install does not false-positive on ordinary code; a
// project extends them via policy.

import { inScope } from "./scope.mjs";

// Deliberately conservative — only shapes that are almost never a false
// positive. A project adds its own via `secretScan.extraPatterns`.
export const DEFAULT_SECRET_PATTERNS = [
  { name: "AWS access key id", source: "AKIA[0-9A-Z]{16}" },
  { name: "GitHub token", source: "gh[pousr]_[0-9A-Za-z]{36,}" },
  { name: "Google API key", source: "AIza[0-9A-Za-z_\\-]{35}" },
  { name: "Slack token", source: "xox[baprs]-[0-9A-Za-z-]{10,}" },
  { name: "Stripe live secret key", source: "sk_live_[0-9A-Za-z]{16,}" },
  { name: "private key block", source: "-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----" },
];

function snippetAround(text, index, matchLen) {
  const start = Math.max(0, index - 20);
  return text.slice(start, index + matchLen + 20).replace(/\s+/g, " ").trim();
}

function scanEmDash(text, rule) {
  const findings = [];
  const rangeEnDashOffsets = new Set();
  if (rule.allowNumericEnDash !== false) {
    for (const m of text.matchAll(/\d\s*–\s*\d/g)) rangeEnDashOffsets.add(m.index + m[0].indexOf("–"));
  }
  for (const m of text.matchAll(/[—–]/g)) {
    if (m[0] === "–" && rangeEnDashOffsets.has(m.index)) continue;
    findings.push({
      rule: "em-dash",
      message: `${m[0] === "—" ? "em dash (—)" : "en dash (–)"} is a banned typographic tell here`,
      snippet: snippetAround(text, m.index, 1),
    });
  }
  return findings;
}

function scanBannedPhrases(text, rule) {
  const findings = [];
  for (const phrase of rule.phrases || []) {
    if (!phrase) continue;
    const re = phrase instanceof RegExp
      ? new RegExp(phrase.source, phrase.flags.includes("g") ? phrase.flags : phrase.flags + "g")
      : new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const m of text.matchAll(re)) {
      findings.push({ rule: "banned-phrase", message: `banned phrase "${m[0]}"`, snippet: snippetAround(text, m.index, m[0].length) });
    }
  }
  return findings;
}

function scanSecrets(text, rule) {
  const patterns = [...DEFAULT_SECRET_PATTERNS, ...(rule.extraPatterns || []).map((p) => (typeof p === "string" ? { name: "custom secret", source: p } : p))];
  const findings = [];
  for (const { name, source } of patterns) {
    let re;
    try {
      re = new RegExp(source, "g");
    } catch {
      continue;
    }
    for (const m of text.matchAll(re)) {
      findings.push({ rule: "secret", message: `possible ${name} committed in source`, snippet: "«redacted secret match»" });
    }
  }
  return findings;
}

// contentPolicy = { emDash?, bannedPhrases?, secretScan? } — each an object with
// `{ enabled, scope?, ...ruleFields }`. Returns a flat findings array; empty =
// clean. filePath gates each rule's own scope.
export function scanContent(text, contentPolicy = {}, filePath = "") {
  if (typeof text !== "string" || text.length === 0) return [];
  const findings = [];
  const em = contentPolicy.emDash;
  if (em?.enabled && inScope(filePath, em.scope)) findings.push(...scanEmDash(text, em));
  const bp = contentPolicy.bannedPhrases;
  if (bp?.enabled && inScope(filePath, bp.scope)) findings.push(...scanBannedPhrases(text, bp));
  const sec = contentPolicy.secretScan;
  if (sec?.enabled && inScope(filePath, sec.scope)) findings.push(...scanSecrets(text, sec));
  return findings;
}

// Large-binary guard for a Write/create: flag when a file's path matches a
// blocked glob or its content exceeds a byte cap. Returns a finding or null.
export function checkLargeBinary(filePath, byteLength, largeBinaryPolicy = {}) {
  if (!largeBinaryPolicy.enabled) return null;
  const { blockedGlobs = [], maxBytes = 0, scope } = largeBinaryPolicy;
  if (!inScope(filePath, scope)) return null;
  if (maxBytes > 0 && byteLength > maxBytes) {
    return { rule: "large-binary", message: `file is ${byteLength} bytes (cap ${maxBytes}); use the configured asset storage`, snippet: filePath };
  }
  return null;
}
