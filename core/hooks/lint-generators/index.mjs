// Route a code-level policy to its STRONGEST enforcement layer: a real linter
// rule where the repo's stack supports it, the content-scan hook only as a
// fallback. This is the "enforce at the strongest available layer" rule made
// mechanical — setup-harness calls it per code-level policy to decide whether it
// emits a lint rule or a hook.

import { detectStack } from "./detect.mjs";
import { generateEslint } from "./eslint.mjs";
import { generateRoslyn } from "./roslyn.mjs";
import { generateRuff } from "./ruff.mjs";

const GEN = { eslint: generateEslint, roslyn: generateRoslyn, ruff: generateRuff };

// A code policy may hint its language(s); otherwise every detected linter is
// tried and the first that supports it wins.
function lintersToTry(policy, stack) {
  const byLang = { javascript: "eslint", typescript: "eslint", csharp: "roslyn", python: "ruff" };
  if (policy.language && byLang[policy.language]) return stack.linters.includes(byLang[policy.language]) ? [byLang[policy.language]] : [];
  return stack.linters;
}

export function strongestLayerFor(policy, stackOrRepoPath) {
  const stack = typeof stackOrRepoPath === "string" ? detectStack(stackOrRepoPath) : stackOrRepoPath;
  for (const linter of lintersToTry(policy, stack)) {
    const result = GEN[linter]?.(policy);
    if (result && (result.supported === true || result.supported === "scaffold")) {
      return { layer: "lint", linter, result };
    }
  }
  return {
    layer: "hook",
    template: "content-scan",
    reason: stack.linters.length ? "no lint rule expresses this policy on the detected stack" : "no lint stack detected",
  };
}

export { detectStack, generateEslint, generateRoslyn, generateRuff };
