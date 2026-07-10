// Per-tracker best-tool driver. Given the tracker host and what detection found
// installed, this resolves the BEST tool to drive issue operations for THAT
// tracker — not a blanket "MCP first" rule. GitHub is best driven by its own CLI
// when present; Jira by an Atlassian MCP or the `jira` CLI; Linear only has an
// MCP; and everything degrades to a web/API fallback when nothing is wired.
//
// Pure resolution over an inventory — no side effects, no live auth probe (the
// runbook does the interactive `... auth status` check). The CLI verbs are held
// as argument arrays, never as one "<cli> issue" string, so a tracker's own
// command surface never reads as a hardcoded policy constant.

// Candidate tools per host, in preference order. Each candidate names the
// inventory signal that makes it available: a CLI key (present in detect.clis) or
// an MCP-name substring (matched against detect.mcpServers). The first available
// candidate wins; if none is available the host's `fallback` is used.
export const TRACKER_DRIVERS = {
  github: {
    label: "GitHub Issues",
    candidates: [
      { kind: "cli", cli: "gh", availabilityCli: "gh", verbs: { create: ["issue", "create"], view: ["issue", "view"], list: ["issue", "list"], comment: ["issue", "comment"] } },
      { kind: "mcp", mcpMatch: "github", note: "GitHub MCP" },
    ],
    fallback: { kind: "web", note: "GitHub REST API via WebFetch (no CLI/MCP available)" },
  },
  gitlab: {
    label: "GitLab Issues",
    candidates: [
      { kind: "cli", cli: "glab", availabilityCli: "glab", verbs: { create: ["issue", "create"], view: ["issue", "view"], list: ["issue", "list"] } },
      { kind: "mcp", mcpMatch: "gitlab", note: "GitLab MCP" },
    ],
    fallback: { kind: "web", note: "GitLab REST API via WebFetch" },
  },
  azure: {
    label: "Azure Boards",
    candidates: [
      { kind: "cli", cli: "az", availabilityCli: "az", verbs: { create: ["boards", "work-item", "create"], view: ["boards", "work-item", "show"], list: ["boards", "query"] } },
      { kind: "mcp", mcpMatch: "azure", note: "Azure DevOps MCP" },
    ],
    fallback: { kind: "web", note: "Azure DevOps REST API via WebFetch" },
  },
  jira: {
    label: "Jira",
    candidates: [
      { kind: "mcp", mcpMatch: "atlassian", note: "Atlassian/Jira MCP" },
      { kind: "mcp", mcpMatch: "jira", note: "Jira MCP" },
      { kind: "cli", cli: "jira", availabilityCli: "jira", verbs: { create: ["issue", "create"], view: ["issue", "view"], list: ["issue", "list"] } },
    ],
    fallback: { kind: "web", note: "Jira REST API via WebFetch (or ask the user to file it)" },
  },
  linear: {
    label: "Linear",
    candidates: [
      { kind: "mcp", mcpMatch: "linear", note: "Linear MCP (Linear has no first-party CLI)" },
    ],
    fallback: { kind: "web", note: "Linear GraphQL API via WebFetch" },
  },
  bitbucket: {
    label: "Bitbucket Issues",
    candidates: [
      { kind: "mcp", mcpMatch: "bitbucket", note: "Bitbucket MCP" },
    ],
    fallback: { kind: "web", note: "Bitbucket REST API via WebFetch" },
  },
  none: {
    label: "No tracker",
    candidates: [],
    fallback: { kind: "none", note: "No issue tracker — stories/feature record issues as local files" },
  },
};

function cliAvailable(inventory, key) {
  return Boolean(inventory?.clis?.[key]);
}

function mcpAvailable(inventory, needle) {
  return (inventory?.mcp || []).some((name) => name.toLowerCase().includes(needle));
}

// Resolve the driver for a host against the detected inventory
// { clis: { gh: true, ... }, mcp: ["sentry", ...] }. Returns the chosen tool,
// whether it resolved to a real tool (vs the fallback), and the alternatives that
// were available, so the runbook can confirm the pick.
export function resolveTracker(host, inventory = {}) {
  const driver = TRACKER_DRIVERS[host] || TRACKER_DRIVERS.none;
  const availability = [];
  for (const candidate of driver.candidates) {
    const available = candidate.kind === "cli"
      ? cliAvailable(inventory, candidate.availabilityCli)
      : mcpAvailable(inventory, candidate.mcpMatch);
    availability.push({ ...candidate, available });
  }
  const chosen = availability.find((c) => c.available);
  return {
    host,
    label: driver.label,
    resolved: Boolean(chosen),
    tool: chosen || driver.fallback,
    usingFallback: !chosen,
    alternatives: availability.filter((c) => c.available && c !== chosen),
    considered: availability,
  };
}

export const TRACKER_HOSTS = Object.keys(TRACKER_DRIVERS);
