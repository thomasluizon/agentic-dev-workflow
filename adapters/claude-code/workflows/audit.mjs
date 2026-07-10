export const meta = {
  name: 'audit',
  description: 'Generic repo-wide audit engine — cheap-model fan-out per surface + adversarial verify (default refuted) + loop-until-dry; returns verified findings for the driver model to synthesize. All project specifics (repos, surfaces, ladders, checklists) arrive via args, so this script is tool-runtime code but carries ZERO project constants.',
  phases: [
    { title: 'Find', detail: 'one finder per surface, scoped by kind' },
    { title: 'Verify', detail: 'one skeptic per serious finding — default refuted' },
    { title: 'Complete', detail: 'completeness critic + gap finders, loop until dry' },
  ],
}

// -----------------------------------------------------------------------------
// This is a Claude-Code Workflow-tool asset (NOT in tool-agnostic core/). Workflow
// scripts have no filesystem/Node access, so the CONSUMING skill (audit-*, driven by
// the pack's verification-protocol) reads workflow.config.yaml + the audit checklist,
// assembles the payload below, and invokes Workflow({ scriptPath, args }). Shape:
//   {
//     kind, scope,                        // scope: a repo role/name, a path, or 'both'
//     repos: [{ name, path, role }],      // from config.repos[]
//     cheapModel?: 'haiku',               // config.execution.cheapSubagentModel; omit -> inherit
//     verifyCap?, hardRounds?, maxDryRounds?,
//     exclude?: 'Exclude generated/vendored dirs ...',
//     calibration?: 'Calibrate to <scale> ...',   // config.auditAnchors.scale-derived
//     kinds: {                            // one entry per audit kind the skill supports
//       <kind>: {
//         ladder, rationale, checklist,   // checklist = path the finder reads FIRST
//         extra?,                         // kind-specific finder instructions
//         surfaces: [{ label, where, repos?, sections? }],
//       },
//     },
//   }
// -----------------------------------------------------------------------------

const cfg = typeof args === 'string' ? JSON.parse(args) : args || {}
const kind = cfg.kind
const scope = cfg.scope || 'both'
const repos = Array.isArray(cfg.repos) ? cfg.repos : []
const kinds = cfg.kinds || {}
const VERIFY_CAP = cfg.verifyCap ?? 60
const HARD_ROUNDS = cfg.hardRounds ?? 4
const maxDry = cfg.maxDryRounds ?? 2
const cheapModel = cfg.cheapModel || undefined
const EXCLUDE = cfg.exclude || 'Exclude generated/vendored dirs (node_modules, dist, build, bin, obj, coverage, and any lockfiles or migrations except when read to confirm a claim).'
const CALIBRATION = cfg.calibration || 'Calibrate severity to the project scale — never inflate severity to look thorough; when uncertain, pick the lower tier with a "verify" note.'

if (!kinds[kind]) throw new Error(`audit workflow: unknown kind "${kind}" (configured: ${Object.keys(kinds).join(', ') || 'none'})`)
const kc = kinds[kind]

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' },
          location: { type: 'string' }, evidence: { type: 'string' }, rationale: { type: 'string' },
          fix: { type: 'string' }, reference: { type: 'string' },
        },
        required: ['severity', 'title', 'location', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, note: { type: 'string' }, adjustedSeverity: { type: 'string' } },
  required: ['refuted', 'note'],
}
const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    gaps: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, prompt: { type: 'string' } }, required: ['label', 'prompt'] },
    },
  },
  required: ['gaps'],
}

const repoRoots = repos.map((r) => `${r.name} (${r.role || 'repo'}): ${r.path}`).join(' · ') || '(no repo roots provided)'
const roleMatches = (surface, scopeVal) => {
  const want = String(scopeVal).toLowerCase()
  const sr = (surface.repos || 'both').toLowerCase()
  if (sr === 'both') return true
  return sr.split(/[\s,/]+/).includes(want)
}
function scopeLabel(scopeVal) {
  if (!scopeVal || scopeVal === 'both') return repos.map((r) => r.name).join(' + ') || 'the project'
  const match = repos.find((r) => [r.name, r.role].map((x) => String(x).toLowerCase()).includes(String(scopeVal).toLowerCase()))
  return match ? match.name : scopeVal
}
function resolveSurfaces(scopeVal) {
  const all = kc.surfaces || []
  if (!scopeVal || scopeVal === 'both') return all
  const byRole = all.filter((s) => roleMatches(s, scopeVal))
  if (byRole.length) return byRole
  // A path scope: keep every surface but constrain it to the path.
  return all.map((s) => ({ ...s, where: `${s.where} — but ONLY within the path "${scopeVal}"` }))
}

function finderPrompt(surface, scopeVal) {
  const sectionNote = surface.sections ? ` (sections ${surface.sections})` : ''
  return [
    `Objective: ${kind} audit of the "${surface.label}" surface in ${scopeLabel(scopeVal)}.`,
    `Read the rubric/checklist FIRST: ${kc.checklist}${sectionNote}. It is the contract for what counts and how findings are shaped.`,
    `Where to look: ${surface.where}.`,
    `Repo roots — ${repoRoots}.`,
    kc.extra || '',
    `For every REAL issue emit a finding with: severity from [${kc.ladder}]; a one-line title; category (the rubric/checklist dimension); location (repo-relative path:line); evidence (the exact line/command that proves it); rationale (${kc.rationale}); fix (the concrete change); reference (the rule / rubric dimension / checklist section).`,
    `${CALIBRATION} ${EXCLUDE} Findings only, no padding. If the surface is clean, return an empty findings array.`,
  ].filter(Boolean).join('\n')
}
function skepticPrompt(f) {
  return [
    `Adversarially REFUTE this ${kind} finding. Read the cited location in full context and argue it is a FALSE POSITIVE — the path is unreachable, the input already validated, the claim already handled elsewhere, the evidence misread, it is a duplicate, or the severity is inflated.`,
    `Default to refuted=true when uncertain — the burden is on the finding to prove it is real, not on you to prove it isn't.`,
    `Finding: severity=${f.severity} · title=${f.title} · location=${f.location} · evidence=${f.evidence} · rationale=${f.rationale || ''}.`,
    `Return refuted (bool) + note (one line why). If it is real but over-rated, set adjustedSeverity to the correct lower label.`,
  ].join('\n')
}
function criticPrompt(sweptLabels, count) {
  return [
    `Completeness critic for the ${kind} audit of ${scopeLabel(scope)}.`,
    `Surfaces swept so far: ${sweptLabels.join(', ')} — producing ${count} findings.`,
    `What did this audit NOT examine — a surface never swept, a file/handler/route skipped, or a claim left unverified?`,
    `Stay strictly within this audit's calibration — ${kc.ladder}. Do NOT propose gaps outside the in-scope tiers. Propose at most 6 gaps, highest-value first.`,
    `Return gaps as {label, prompt}, where prompt is a ready-to-run finder objective for that gap (same finding shape as the finders). Return an EMPTY gaps array if coverage is genuinely complete — do not invent gaps.`,
  ].join('\n')
}

const rank = (s) => {
  const x = (s || '').toLowerCase()
  if (x.includes('critical') || x.includes('tier 1')) return 0
  if (x.includes('high') || x.includes('tier 2')) return 1
  if (x.includes('medium')) return 2
  return 3
}
const keyOf = (f) => `${(f.location || '').toLowerCase().trim()}::${(f.title || '').toLowerCase().trim().slice(0, 60)}`
const countBy = (findings) => {
  const out = {}
  for (const f of findings) { const s = (f.severity || 'unknown').trim(); out[s] = (out[s] || 0) + 1 }
  return out
}
const isSerious = (f) => rank(f.severity) <= 1

const seen = new Set()
const dedupeFresh = (findings) => {
  const fresh = []
  for (const f of findings) { const k = keyOf(f); if (seen.has(k)) continue; seen.add(k); fresh.push(f) }
  return fresh
}
const agentOpts = (label, phaseName) => {
  const o = { label, phase: phaseName, effort: 'low', schema: FINDINGS_SCHEMA }
  if (cheapModel) o.model = cheapModel
  return o
}
const verdictOpts = (label, phaseName) => {
  const o = { label, phase: phaseName, effort: 'low', schema: VERDICT_SCHEMA }
  if (cheapModel) o.model = cheapModel
  return o
}

phase('Find')
const surfaces = resolveSurfaces(scope)
log(`audit:${kind} · scope ${scopeLabel(scope)} · ${surfaces.length} surfaces`)
const firstPass = (
  await parallel(surfaces.map((s) => () => agent(finderPrompt(s, scope), agentOpts(`find:${s.label}`, 'Find'))))
).filter(Boolean)
const sweptLabels = surfaces.map((s) => s.label)
let findings = dedupeFresh(firstPass.flatMap((r) => r.findings || []))

async function verifySerious(candidates, phaseName) {
  const serious = candidates.filter(isSerious).sort((a, b) => rank(a.severity) - rank(b.severity))
  const now = serious.slice(0, VERIFY_CAP)
  const capped = serious.slice(VERIFY_CAP)
  const verdicts = (
    await parallel(now.map((f, i) => () => agent(skepticPrompt(f), verdictOpts(`verify:${(f.location || String(i)).slice(0, 40)}`, phaseName)).then((v) => ({ f, v }))))
  ).filter(Boolean)
  const survivors = []
  for (const { f, v } of verdicts) {
    if (v && v.refuted) continue
    if (v && v.adjustedSeverity) f.severity = v.adjustedSeverity
    survivors.push(f)
  }
  const passthrough = candidates.filter((f) => !isSerious(f))
  return { kept: [...survivors, ...passthrough], capped }
}

phase('Verify')
let { kept, capped } = await verifySerious(findings, 'Verify')
const deferred = capped.map((f) => ({ title: f.title, location: f.location, severity: f.severity, deferReason: 'exceeded the adversarial-verify cap — shipped unchallenged, re-verify before acting' }))
log(`verified: ${kept.length} kept · ${capped.length} deferred (cap)`)

phase('Complete')
let round = 0
let dry = 0
while (dry < maxDry && round < HARD_ROUNDS) {
  round += 1
  const critic = await agent(criticPrompt(sweptLabels, kept.length), (() => { const o = { label: `critic:round-${round}`, phase: 'Complete', effort: 'low', schema: CRITIC_SCHEMA }; if (cheapModel) o.model = cheapModel; return o })())
  const gaps = (critic && critic.gaps) || []
  if (!gaps.length) { dry += 1; continue }
  const roundRaw = (
    await parallel(gaps.map((g) => () => agent(g.prompt, agentOpts(`find:${g.label}`, 'Complete'))))
  ).filter(Boolean).flatMap((r) => r.findings || [])
  gaps.forEach((g) => sweptLabels.push(g.label))
  const fresh = dedupeFresh(roundRaw)
  if (!fresh.length) { dry += 1; continue }
  dry = 0
  const { kept: freshKept, capped: freshCapped } = await verifySerious(fresh, 'Complete')
  kept = kept.concat(freshKept)
  freshCapped.forEach((f) => deferred.push({ title: f.title, location: f.location, severity: f.severity, deferReason: 'exceeded the adversarial-verify cap — shipped unchallenged, re-verify before acting' }))
  log(`round ${round}: +${fresh.length} fresh (${freshKept.length} kept)`)
}

kept.sort((a, b) => rank(a.severity) - rank(b.severity))
return {
  kind, scope, scopeLabel: scopeLabel(scope),
  findings: kept, counts: countBy(kept), coverage: sweptLabels, deferred,
  rounds: round,
  loopBound: round >= HARD_ROUNDS ? `stopped at the ${HARD_ROUNDS}-round hard cap` : `${dry} consecutive dry round(s)`,
}
