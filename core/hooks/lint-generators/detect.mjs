// Read-only stack detection for a repo. A code-level policy is enforced at its
// STRONGEST layer: a real ESLint / Roslyn / ruff rule where the stack supports
// it, and the content-scan hook only as a fallback. This module reports which
// linters a repo can carry, from the marker files present (never runs anything).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function has(dir, name) {
  return existsSync(join(dir, name));
}

function anyMatch(dir, re) {
  try {
    return readdirSync(dir).some((f) => re.test(f));
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function detectStack(repoPath) {
  const linters = [];
  const languages = [];

  const pkg = has(repoPath, "package.json") ? readJson(join(repoPath, "package.json")) : null;
  if (pkg) {
    languages.push("javascript");
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const hasEslintConfig =
      pkg.eslintConfig ||
      ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.json", ".eslintrc.cjs", ".eslintrc.js"].some((f) => has(repoPath, f));
    if (deps.eslint || hasEslintConfig) linters.push("eslint");
    if (deps.typescript || has(repoPath, "tsconfig.json")) languages.push("typescript");
  }

  if (
    anyMatch(repoPath, /\.(csproj|sln|slnx|fsproj|vbproj)$/i) ||
    has(repoPath, "Directory.Build.props") ||
    has(repoPath, "global.json")
  ) {
    languages.push("csharp");
    linters.push("roslyn");
  }

  if (
    has(repoPath, "pyproject.toml") ||
    has(repoPath, "ruff.toml") ||
    has(repoPath, ".ruff.toml") ||
    has(repoPath, "setup.cfg") ||
    has(repoPath, "requirements.txt")
  ) {
    languages.push("python");
    linters.push("ruff");
  }

  return { linters: [...new Set(linters)], languages: [...new Set(languages)] };
}
