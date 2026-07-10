// Infers the test / lint / typecheck / build commands for a repo from its
// manifests, so the interview can present a filled-in guess the user confirms or
// corrects rather than an empty form. Reading manifests only — nothing here runs
// a single one of the commands it infers.
//
// Each inferred command carries the `source` file and the `evidence` (the script
// name or manifest key it came from) so the runbook can show WHY it guessed, and
// the confidence: "high" when a manifest names the exact step, "low" when it is a
// stack-default fallback the user most likely wants to correct.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function exists(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

function firstMatch(dir, pattern) {
  try {
    return fs.readdirSync(dir).find((f) => pattern.test(f)) || null;
  } catch {
    return null;
  }
}

// The four steps validate runs, in the config's field order.
const STEP_ORDER = ["testCmd", "lintCmd", "typeCheckCmd", "buildCmd"];

function detectPackageManager(dir) {
  if (exists(dir, "pnpm-lock.yaml")) return "pnpm";
  if (exists(dir, "yarn.lock")) return "yarn";
  if (exists(dir, "bun.lockb") || exists(dir, "bun.lock")) return "bun";
  if (exists(dir, "package-lock.json")) return "npm";
  return "npm";
}

function runScript(pm, script) {
  if (pm === "npm") return script === "test" ? "npm test" : `npm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  return `${pm} run ${script}`;
}

// package.json — map its `scripts` block to the four steps, honoring common
// aliases (type-check / typecheck / tsc; lint; test; build).
function fromPackageJson(dir, out) {
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return;
  const scripts = pkg.scripts || {};
  const pm = detectPackageManager(dir);
  out.packageManager = pm;
  out.stack.push("node");
  const pick = (names) => names.find((n) => typeof scripts[n] === "string");

  const testScript = pick(["test"]);
  if (testScript) set(out, "testCmd", runScript(pm, testScript), "package.json", `scripts.${testScript}`, "high");

  const lintScript = pick(["lint"]);
  if (lintScript) set(out, "lintCmd", runScript(pm, lintScript), "package.json", `scripts.${lintScript}`, "high");

  const typeScript = pick(["typecheck", "type-check", "tsc", "types", "check-types"]);
  if (typeScript) set(out, "typeCheckCmd", runScript(pm, typeScript), "package.json", `scripts.${typeScript}`, "high");
  else if (exists(dir, "tsconfig.json")) set(out, "typeCheckCmd", `${pm === "npm" ? "npx" : pm} tsc --noEmit`, "tsconfig.json", "tsconfig present", "low");

  const buildScript = pick(["build"]);
  if (buildScript) set(out, "buildCmd", runScript(pm, buildScript), "package.json", `scripts.${buildScript}`, "high");
}

// .NET — a .sln/.slnx/.csproj means `dotnet test` / `dotnet build`, and
// `dotnet format` covers the lint step. Type-checking is folded into the build.
function fromDotnet(dir, out) {
  const solution = firstMatch(dir, /\.slnx?$/i);
  const project = firstMatch(dir, /\.csproj$/i);
  const target = solution || project;
  if (!target) return;
  out.stack.push("dotnet");
  set(out, "testCmd", "dotnet test", target, "dotnet project", "high");
  set(out, "buildCmd", "dotnet build", target, "dotnet project", "high");
  set(out, "lintCmd", "dotnet format --verify-no-changes", target, "dotnet format", "low");
}

// Python — pyproject.toml tool tables tell us which runner the repo uses.
function fromPython(dir, out) {
  const pyproject = readText(path.join(dir, "pyproject.toml"));
  const hasSetup = exists(dir, "setup.py") || exists(dir, "setup.cfg");
  if (!pyproject && !hasSetup) return;
  out.stack.push("python");
  const body = pyproject || "";
  const runner = detectPyRunner(dir, body);

  if (/\[tool\.pytest/.test(body) || exists(dir, "pytest.ini") || exists(dir, "tests")) {
    set(out, "testCmd", withRunner(runner, "pytest"), "pyproject.toml", "pytest", body ? "high" : "low");
  }
  if (/\[tool\.ruff/.test(body)) set(out, "lintCmd", withRunner(runner, "ruff check ."), "pyproject.toml", "tool.ruff", "high");
  else if (/\[tool\.flake8/.test(body) || exists(dir, ".flake8")) set(out, "lintCmd", withRunner(runner, "flake8"), "pyproject.toml", "flake8", "low");
  if (/\[tool\.mypy/.test(body)) set(out, "typeCheckCmd", withRunner(runner, "mypy ."), "pyproject.toml", "tool.mypy", "high");
  else if (/\[tool\.pyright/.test(body)) set(out, "typeCheckCmd", withRunner(runner, "pyright"), "pyproject.toml", "tool.pyright", "high");
  if (/\[build-system\]/.test(body)) set(out, "buildCmd", withRunner(runner, "python -m build"), "pyproject.toml", "build-system", "low");
}

function detectPyRunner(dir, body) {
  if (/\[tool\.poetry/.test(body)) return "poetry";
  if (exists(dir, "uv.lock")) return "uv";
  return "";
}

function withRunner(runner, command) {
  if (runner === "poetry") return `poetry run ${command}`;
  if (runner === "uv") return `uv run ${command}`;
  return command;
}

// Makefile — a repo that drives everything through make usually wants make used.
// Only claim a step when the target actually exists.
function fromMakefile(dir, out) {
  const makefile = readText(path.join(dir, "Makefile")) || readText(path.join(dir, "makefile"));
  if (!makefile) return;
  out.stack.push("make");
  const targets = new Set([...makefile.matchAll(/^([A-Za-z0-9_.-]+)\s*:/gm)].map((m) => m[1]));
  const map = { test: "testCmd", lint: "lintCmd", typecheck: "typeCheckCmd", "type-check": "typeCheckCmd", build: "buildCmd" };
  for (const [target, field] of Object.entries(map)) {
    if (targets.has(target)) set(out, field, `make ${target}`, "Makefile", `target ${target}`, "low");
  }
}

// A guess is only overwritten by a higher-confidence source, so package.json's
// named script beats a stack default and an explicit tool table beats a fallback.
function set(out, field, command, source, evidence, confidence) {
  const existing = out.inferred[field];
  const rank = { high: 2, low: 1 };
  if (existing && rank[existing.confidence] >= rank[confidence]) return;
  out.inferred[field] = { command, source, evidence, confidence };
}

// Infer all four steps for a directory. Returns { inferred, packageManager,
// stack, commands } where `commands` is the flat { testCmd, ... } shape the
// config uses (empty string for a step we could not infer, so validate skips it).
export function inferCommands(dir = process.cwd()) {
  const out = { inferred: {}, packageManager: "", stack: [] };
  fromPackageJson(dir, out);
  fromDotnet(dir, out);
  fromPython(dir, out);
  fromMakefile(dir, out);

  const commands = {};
  for (const field of STEP_ORDER) commands[field] = out.inferred[field]?.command || "";
  return {
    inferred: out.inferred,
    commands,
    packageManager: out.packageManager,
    stack: [...new Set(out.stack)],
  };
}

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--dir");
  const dir = dirFlag >= 0 ? args[dirFlag + 1] : process.cwd();
  process.stdout.write(JSON.stringify(inferCommands(dir), null, 2) + "\n");
}
