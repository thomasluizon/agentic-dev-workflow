// The one place that knows each host tool's event shape. It normalizes a Claude
// Code hook payload and an opencode tool.execute.before payload into a single
// neutral record the logic core reasons over, so git-action / content-scan are
// written once and never learn a tool's field names.
//
// Neutral record: { source, tool, kind, command, filePath, addedText, cwd, sessionId }
//   kind: "git" (a Bash/shell command), "edit" (a file mutation), or "other".

function addedTextFromClaude(toolInput = {}) {
  if (typeof toolInput.new_string === "string") return toolInput.new_string;
  if (Array.isArray(toolInput.edits)) return toolInput.edits.map((e) => e?.new_string ?? "").join("\n");
  if (typeof toolInput.content === "string") return toolInput.content;
  return "";
}

const CC_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function fromClaudeCode(input = {}) {
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const cwd = input.cwd || null;
  const sessionId = input.session_id || null;
  if (tool === "Bash" && typeof ti.command === "string") {
    return { source: "claude-code", tool, kind: "git", command: ti.command, filePath: null, addedText: null, cwd, sessionId };
  }
  if (CC_EDIT_TOOLS.has(tool)) {
    const filePath = ti.file_path || input?.tool_response?.filePath || null;
    return { source: "claude-code", tool, kind: "edit", command: null, filePath, addedText: addedTextFromClaude(ti), cwd, sessionId };
  }
  return { source: "claude-code", tool, kind: "other", command: null, filePath: null, addedText: null, cwd, sessionId };
}

const OC_EDIT_TOOLS = new Set(["edit", "write", "patch"]);

export function fromOpenCode(tool, args = {}, ctx = {}) {
  const cwd = ctx.directory || ctx.worktree || null;
  const sessionId = ctx.sessionID || null;
  if (tool === "bash" && typeof args.command === "string") {
    return { source: "opencode", tool, kind: "git", command: args.command, filePath: null, addedText: null, cwd, sessionId };
  }
  if (OC_EDIT_TOOLS.has(tool)) {
    const addedText = typeof args.newString === "string" ? args.newString : typeof args.content === "string" ? args.content : "";
    return { source: "opencode", tool, kind: "edit", command: null, filePath: args.filePath || args.path || null, addedText, cwd, sessionId };
  }
  return { source: "opencode", tool, kind: "other", command: null, filePath: null, addedText: null, cwd, sessionId };
}
