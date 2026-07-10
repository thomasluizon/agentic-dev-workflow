// harness.answers.yaml — the durable, resumable record of the setup interview.
// Answers are written HERE incrementally as each question is confirmed, so a long
// grill can be interrupted and resumed, and the later decode step re-reads it to
// explain why each generated artifact exists. No secrets are ever stored.
//
// The pack has zero runtime dependencies, so this module carries its own tiny
// YAML emitter + parser scoped to exactly the shapes this file uses: nested block
// maps, block sequences of scalars, and block sequences of flat maps. The pair is
// a matched set proven by a round-trip test; it is not a general YAML library.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ANSWERS_FILENAME = "harness.answers.yaml";
const INDENT = 2;

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// ---- emit --------------------------------------------------------------------

function needsQuote(str) {
  if (str === "") return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(str)) return true;
  if (/^-?\d+(\.\d+)?$/.test(str)) return true;
  return !/^[A-Za-z0-9][A-Za-z0-9 ._/@+-]*$/.test(str);
}

function quote(str) {
  const escaped = str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function emitScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  const str = String(value);
  return needsQuote(str) ? quote(str) : str;
}

function emitSeqItem(item, indent) {
  const pad = " ".repeat(indent);
  if (isObject(item) || Array.isArray(item)) {
    const block = emit(item, indent + INDENT);
    const lines = block.split("\n");
    lines[0] = pad + "- " + lines[0].slice(indent + INDENT);
    return lines.join("\n");
  }
  return pad + "- " + emitScalar(item);
}

function emit(value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + "[]";
    return value.map((item) => emitSeqItem(item, indent)).join("\n");
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return pad + "{}";
    const out = [];
    for (const key of keys) {
      const v = value[key];
      if (Array.isArray(v)) {
        if (v.length === 0) out.push(`${pad}${key}: []`);
        else out.push(`${pad}${key}:`, emit(v, indent + INDENT));
      } else if (isObject(v)) {
        if (Object.keys(v).length === 0) out.push(`${pad}${key}: {}`);
        else out.push(`${pad}${key}:`, emit(v, indent + INDENT));
      } else {
        out.push(`${pad}${key}: ${emitScalar(v)}`);
      }
    }
    return out.join("\n");
  }
  return pad + emitScalar(value);
}

export function toYaml(obj) {
  return emit(obj ?? {}, 0) + "\n";
}

// ---- parse -------------------------------------------------------------------

function unquote(str) {
  const inner = str.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[++i];
      out += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
    } else {
      out += inner[i];
    }
  }
  return out;
}

function parseScalar(raw) {
  const str = raw.trim();
  if (str === "" || str === "~" || str === "null") return null;
  if (str === "[]") return [];
  if (str === "{}") return {};
  if (str === "true") return true;
  if (str === "false") return false;
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) return unquote(str);
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  return str;
}

const isSeqLine = (content) => /^-(\s|$)/.test(content);
const afterDash = (content) => content.replace(/^-\s?/, "");
const isMapEntry = (content) => /^[A-Za-z0-9_.\-]+:(\s|$)/.test(content);

function splitKey(content) {
  const match = content.match(/^([A-Za-z0-9_.\-]+):\s?(.*)$/);
  return match ? { key: match[1], rest: match[2] } : null;
}

function toLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim() !== "" && !/^\s*#/.test(line))
    .map((line) => ({ indent: line.match(/^ */)[0].length, content: line.trim() }));
}

function parseBlock(lines, i, blockIndent) {
  return isSeqLine(lines[i].content) ? parseSeq(lines, i, blockIndent) : parseMap(lines, i, blockIndent);
}

function parseMap(lines, i, blockIndent) {
  const obj = {};
  let idx = i;
  while (idx < lines.length && lines[idx].indent === blockIndent && !isSeqLine(lines[idx].content)) {
    const parsed = splitKey(lines[idx].content);
    if (!parsed) { idx++; continue; }
    const { key, rest } = parsed;
    idx++;
    if (rest === "") {
      if (idx < lines.length && lines[idx].indent > blockIndent) {
        const childIndent = lines[idx].indent;
        const [val, next] = parseBlock(lines, idx, childIndent);
        obj[key] = val;
        idx = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(rest);
    }
  }
  return [obj, idx];
}

function parseSeq(lines, i, blockIndent) {
  const arr = [];
  let idx = i;
  while (idx < lines.length && lines[idx].indent === blockIndent && isSeqLine(lines[idx].content)) {
    const rest = afterDash(lines[idx].content);
    idx++;
    if (rest === "") {
      if (idx < lines.length && lines[idx].indent > blockIndent) {
        const childIndent = lines[idx].indent;
        const [val, next] = parseBlock(lines, idx, childIndent);
        arr.push(val);
        idx = next;
      } else {
        arr.push(null);
      }
    } else if (isMapEntry(rest)) {
      const itemIndent = blockIndent + INDENT;
      const synthetic = [{ indent: itemIndent, content: rest }];
      while (idx < lines.length && lines[idx].indent >= itemIndent && !(lines[idx].indent === blockIndent && isSeqLine(lines[idx].content))) {
        synthetic.push(lines[idx]);
        idx++;
      }
      const [val] = parseBlock(synthetic, 0, itemIndent);
      arr.push(val);
    } else {
      arr.push(parseScalar(rest));
    }
  }
  return [arr, idx];
}

export function fromYaml(text) {
  const lines = toLines(text);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

// ---- answers API -------------------------------------------------------------

export function emptyAnswers(mode = "thorough", startedAt = "") {
  return {
    version: 1,
    mode,
    startedAt,
    machine: {},
    repos: [],
    answered: {},
    docs: { links: [], sources: [], normativeStatements: [] },
    tracker: {},
    progress: { answeredIds: [] },
  };
}

export function readAnswers(file) {
  try {
    const parsed = fromYaml(fs.readFileSync(file, "utf8"));
    return isObject(parsed) ? parsed : emptyAnswers();
  } catch {
    return emptyAnswers();
  }
}

export function writeAnswers(file, obj) {
  const header = "# harness.answers.yaml — setup-harness interview record (AI-managed; no secrets). Resumed and re-decoded from here.\n";
  fs.writeFileSync(file, header + toYaml(obj));
  return file;
}

export function answeredIds(obj) {
  return obj?.progress?.answeredIds || [];
}

function markAnswered(obj, id) {
  obj.progress = obj.progress || { answeredIds: [] };
  if (!obj.progress.answeredIds.includes(id)) obj.progress.answeredIds.push(id);
}

// Record one confirmed answer and persist immediately — the incremental write
// that makes the interview resumable. `id` is the question's answersKey (or a
// follow-up id); the value is stored flat under `answered`.
export function setAnswer(file, id, value) {
  const obj = readAnswers(file);
  obj.answered = obj.answered || {};
  obj.answered[id] = value;
  if (id === "repos" && Array.isArray(value)) obj.repos = value;
  markAnswered(obj, id);
  writeAnswers(file, obj);
  return obj;
}

export function recordDocs(file, { links = [], sources = [] } = {}) {
  const obj = readAnswers(file);
  obj.docs = obj.docs || { links: [], sources: [], normativeStatements: [] };
  obj.docs.links = [...new Set([...(obj.docs.links || []), ...links])];
  obj.docs.sources = [...new Set([...(obj.docs.sources || []), ...sources])];
  writeAnswers(file, obj);
  return obj;
}

// Append the normative statements extracted from a fetched doc, for the decode
// step to classify into tiers. Deduped by source+text.
export function recordNormative(file, source, statements = []) {
  const obj = readAnswers(file);
  obj.docs = obj.docs || { links: [], sources: [], normativeStatements: [] };
  const list = obj.docs.normativeStatements || [];
  const seen = new Set(list.map((s) => `${s.source} ${s.text}`));
  for (const statement of statements) {
    const text = typeof statement === "string" ? statement : statement.text;
    const key = `${source} ${text}`;
    if (text && !seen.has(key)) {
      seen.add(key);
      list.push({ source, text, strength: statement.strength || "hard" });
    }
  }
  obj.docs.normativeStatements = list;
  writeAnswers(file, obj);
  return obj;
}

export function recordMachine(file, machine) {
  const obj = readAnswers(file);
  obj.machine = machine;
  writeAnswers(file, obj);
  return obj;
}

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
  if (cmd === "init") {
    const mode = flag("--mode", "thorough");
    const startedAt = flag("--started-at", "");
    writeAnswers(file, emptyAnswers(mode, startedAt));
    console.log(`Initialized ${file} (mode=${mode})`);
  } else if (cmd === "set") {
    const [id, rawValue] = rest;
    let value;
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }
    setAnswer(file, id, value);
    console.log(`Recorded ${id}`);
  } else if (cmd === "get") {
    const obj = readAnswers(file);
    const key = rest[0];
    process.stdout.write(JSON.stringify(key ? obj.answered?.[key] ?? null : obj, null, 2) + "\n");
  } else if (cmd === "progress") {
    console.log(answeredIds(readAnswers(file)).join(" ") || "(none)");
  } else {
    console.error("usage: answers.mjs <init|set|get|progress> <file> [args]");
    process.exit(1);
  }
}
