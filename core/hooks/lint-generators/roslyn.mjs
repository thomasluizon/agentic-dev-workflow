// Generate a Roslyn/.NET enforcement for a code-level policy. Two shapes: elevate
// an existing analyzer diagnostic to error via .editorconfig (the cheap, strong
// win), or scaffold a bespoke DiagnosticAnalyzer when no built-in covers it.
// Returns `{ supported, artifact, note }`; `supported:false` -> hook fallback.

export function generateRoslyn(policy = {}) {
  switch (policy.kind) {
    case "severity": {
      if (!policy.diagnosticId) return { supported: false, note: "severity needs a `diagnosticId` (e.g. CA1822, IDE0005, or a custom analyzer id)." };
      const level = policy.level || "error";
      return {
        supported: true,
        artifact: { type: "editorconfig", line: `dotnet_diagnostic.${policy.diagnosticId}.severity = ${level}` },
        note: "Add to the repo's .editorconfig to elevate the diagnostic. CI must build with warnings-as-errors or treat the id as error.",
      };
    }
    case "ban-call":
    case "ban-text":
    case "custom":
      return {
        supported: "scaffold",
        artifact: {
          type: "analyzer-scaffold",
          description:
            "No built-in diagnostic covers this; scaffold a Roslyn DiagnosticAnalyzer (a *.Analyzers project) that reports a custom diagnostic id, then elevate it to error via .editorconfig. Wire it as an analyzer reference so it fails CI.",
        },
        note: "Bespoke analyzer required — mirrors how a project ships its own custom source-code rules.",
      };
    default:
      return { supported: false, note: `No Roslyn mapping for kind "${policy.kind}".` };
  }
}
