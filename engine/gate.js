/**
 * GATE — evaluate the release policy in gate.json against the run facts.
 *
 * Deterministic. Every rule renders FIRED or PASSED with a plain reason, so the verdict is
 * traceable to a line in a file a reviewer can read, version and argue with. "No human
 * decided this, and no model did either — the policy file did."
 */

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'gate.json')
const RANK = { GO: 0, WARN: 1, BLOCK: 2 }

function loadPolicy() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'))
}

/** Resolve a dotted path like "securityFindings.critical" against the facts. */
function read(facts, expr) {
  return expr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), facts)
}

/** Only the tiny comparison grammar the policy actually uses. Not eval. */
function evaluateCondition(when, facts) {
  const m = /^([A-Za-z0-9_.]+)\s*(>|>=|<|<=|==|!=)\s*(-?[0-9.]+)$/.exec(when.trim())
  if (!m) return { ok: false, error: `unsupported condition: ${when}` }
  const [, lhsExpr, op, rhsRaw] = m
  const lhs = Number(read(facts, lhsExpr) ?? 0)
  const rhs = Number(rhsRaw)
  const fired =
    op === '>' ? lhs > rhs : op === '>=' ? lhs >= rhs : op === '<' ? lhs < rhs
    : op === '<=' ? lhs <= rhs : op === '==' ? lhs === rhs : lhs !== rhs
  return { ok: true, fired, lhs, rhs, lhsExpr }
}

function evaluate(facts) {
  const policy = loadPolicy()
  const evaluated = policy.rules.map((rule) => {
    const r = evaluateCondition(rule.when, facts)
    if (!r.ok) return { ...rule, state: 'ERROR', detail: r.error }
    return {
      ...rule,
      state: r.fired ? 'FIRED' : 'PASSED',
      detail: `${r.lhsExpr} = ${r.lhs}`,
    }
  })

  const fired = evaluated.filter((r) => r.state === 'FIRED')
  const verdict = fired.reduce((worst, r) => (RANK[r.verdict] > RANK[worst] ? r.verdict : worst), 'GO')

  return {
    verdict,
    rules: evaluated,
    firedRules: fired,
    // The one-line reason to say out loud. A verdict with one named cause beats a score.
    headline:
      verdict === 'GO'
        ? 'No policy rule fired.'
        : `${fired.length} rule${fired.length === 1 ? '' : 's'} fired — ${fired[0].reason}`,
    thresholds: policy.thresholds,
    roi: policy.roi,
  }
}

module.exports = { evaluate, loadPolicy, FILE }
