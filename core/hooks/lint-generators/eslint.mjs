// Generate an ESLint rule for a code-level policy, so a JS/TS project enforces
// it in the linter (the strongest layer) rather than a content-scan hook. A
// policy descriptor is `{ kind, ...fields }`. Returns `{ supported, artifact,
// note }`; `supported:false` means ESLint core cannot express it — the caller
// falls back to the content-scan hook.

export function generateEslint(policy = {}) {
  switch (policy.kind) {
    case "no-console":
      return { supported: true, artifact: { type: "flat-config-rule", rules: { "no-console": "error" } }, note: "Bans console.* via the core no-console rule." };
    case "no-explicit-any":
      return {
        supported: true,
        artifact: { type: "flat-config-rule", requires: "typescript-eslint", rules: { "@typescript-eslint/no-explicit-any": "error" } },
        note: "Requires typescript-eslint in the flat config.",
      };
    case "no-debugger":
      return { supported: true, artifact: { type: "flat-config-rule", rules: { "no-debugger": "error" } }, note: "" };
    case "ban-call":
      if (!policy.callee) return { supported: false, note: "ban-call needs a `callee` name." };
      return {
        supported: true,
        artifact: {
          type: "flat-config-rule",
          rules: {
            "no-restricted-syntax": ["error", { selector: `CallExpression[callee.name='${policy.callee}']`, message: policy.message || `${policy.callee}() is banned by policy.` }],
          },
        },
        note: "Uses no-restricted-syntax with an AST selector.",
      };
    case "ban-import":
      if (!policy.module) return { supported: false, note: "ban-import needs a `module` name." };
      return {
        supported: true,
        artifact: { type: "flat-config-rule", rules: { "no-restricted-imports": ["error", { paths: [{ name: policy.module, message: policy.message || `Import of ${policy.module} is banned by policy.` }] }] } },
        note: "",
      };
    case "ban-text":
      return { supported: false, note: "ESLint core cannot match arbitrary text; author a custom rule or use the content-scan hook fallback." };
    default:
      return { supported: false, note: `No ESLint mapping for kind "${policy.kind}".` };
  }
}
