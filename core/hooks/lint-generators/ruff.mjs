// Generate a ruff configuration for a code-level policy, so a Python project
// enforces it in the linter. Returns `{ supported, artifact, note }`;
// `supported:false` -> hook fallback.

const KNOWN = {
  "no-print": { codes: ["T20"], note: "flake8-print (T20) flags print/pprint calls." },
  "no-eval": { codes: ["S307"], note: "flake8-bandit S307 flags eval()." },
  "no-exec": { codes: ["S102"], note: "flake8-bandit S102 flags exec()." },
  "no-assert": { codes: ["S101"], note: "flake8-bandit S101 flags assert used as a guard." },
  "no-unused-imports": { codes: ["F401"], note: "pyflakes F401." },
};

export function generateRuff(policy = {}) {
  if (policy.kind === "select" && Array.isArray(policy.codes) && policy.codes.length) {
    return { supported: true, artifact: { type: "pyproject", snippet: ruffSnippet(policy.codes) }, note: "Selects the given ruff rule codes." };
  }
  const known = KNOWN[policy.kind];
  if (known) return { supported: true, artifact: { type: "pyproject", snippet: ruffSnippet(known.codes) }, note: known.note };
  if (policy.kind === "ban-text") return { supported: false, note: "ruff cannot match arbitrary text; use the content-scan hook fallback." };
  return { supported: false, note: `No ruff mapping for kind "${policy.kind}".` };
}

function ruffSnippet(codes) {
  const list = codes.map((c) => `"${c}"`).join(", ");
  return ["[tool.ruff.lint]", `extend-select = [${list}]`].join("\n");
}
