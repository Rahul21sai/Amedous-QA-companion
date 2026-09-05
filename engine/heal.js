/**
 * HEAL — the confidence gate. This is the layer that decides whether healing is ALLOWED.
 *
 * Playwright already ships a planner, a generator and a healer. Competing with the healer
 * is not the product. The product is this: a gate whose arithmetic is visible, a margin
 * rule that detects ambiguity, and a refusal path.
 *
 * THE MARGIN RULE is the genuinely novel part. Healenium ships only an absolute
 * score-cap (0.6). Similo ships only argmax. Neither can tell "Place Order" from
 * "Place Order Later" — both confidently bind to whichever scores marginally higher,
 * and you end up with a permanently GREEN test asserting nothing. That is the existential
 * failure mode of this entire product category. Requiring a MARGIN over the runner-up
 * detects it and escalates instead of guessing.
 *
 * Thresholds live in gate.json and are shown on screen as a dial. No competitor exposes
 * them; a threshold you cannot see is a threshold you cannot audit.
 */

const { rank } = require('./score')
const registry = require('./registry')

const AUTO_HEAL = 'AUTO_HEAL'
const REVIEW = 'HEAL_FLAGGED_FOR_REVIEW'
const AMBIGUOUS = 'ESCALATED_AMBIGUOUS'
const REFUSED = 'REFUSED_LOW_CONFIDENCE'

/**
 * Decide what to do about a broken locator.
 *
 * @param fingerprint  the enriched node recorded on the last green run
 * @param candidates   interactive nodes from the CURRENT capture
 * @param thresholds   { autoHeal, minimum, margin }
 */
function decide(fingerprint, candidates, thresholds) {
  const { autoHeal, minimum, margin: marginFloor } = thresholds

  if (!fingerprint) {
    return {
      decision: REFUSED,
      reason:
        'no fingerprint recorded — self-healing needs at least one successful run to have ' +
        'captured what the element looked like. Run the baseline first.',
      ranked: [],
    }
  }

  const ranked = rank(fingerprint, candidates)
  if (!ranked.length) return { decision: REFUSED, reason: 'no candidate elements on the page', ranked }

  const best = ranked[0]
  const runnerUp = ranked[1] || null
  const margin = runnerUp ? best.score - runnerUp.score : 1

  const common = { ranked, best, runnerUp, margin, score: best.score, thresholds }

  if (best.score < minimum) {
    return {
      ...common,
      decision: REFUSED,
      reason: `best candidate scored ${best.score.toFixed(3)}, below the ${minimum} floor — not confident enough to touch the test`,
    }
  }

  if (margin < marginFloor) {
    return {
      ...common,
      decision: AMBIGUOUS,
      reason:
        `two candidates are within ${marginFloor} of each other ` +
        `("${best.node.name}" ${best.score.toFixed(3)} vs "${runnerUp.node.name}" ${runnerUp.score.toFixed(3)}, ` +
        `margin ${margin.toFixed(3)}). Picking one would be a guess, and a wrong guess makes ` +
        `the test permanently green while asserting nothing. Escalating for review.`,
    }
  }

  if (best.score >= autoHeal) {
    return { ...common, decision: AUTO_HEAL, reason: `scored ${best.score.toFixed(3)} with a ${margin.toFixed(3)} margin over the runner-up` }
  }

  return {
    ...common,
    decision: REVIEW,
    reason: `scored ${best.score.toFixed(3)} — above the ${minimum} floor but below the ${autoHeal} auto-apply bar, so it is applied and flagged`,
  }
}

/** Turn a winning candidate node into a registry `primary` descriptor. */
function primaryFor(node) {
  return { role: node.role, name: node.name, exact: true }
}

/**
 * Apply a decision. Only AUTO_HEAL and REVIEW mutate anything, and the mutation goes
 * through registry.applyRegistryPatch, which cannot reach an assertion.
 */
function apply(key, decision) {
  if (decision.decision !== AUTO_HEAL && decision.decision !== REVIEW) {
    return { applied: false, reason: decision.reason }
  }
  const patch = registry.applyRegistryPatch(key, primaryFor(decision.best.node), {
    score: decision.score,
    margin: decision.margin,
    reason: decision.reason,
  })
  return { applied: true, ...patch }
}

/**
 * Cluster failures by the change that caused them, so one breakage becomes ONE fix
 * rather than N. Ungrouped agents cheerfully do the same job twelve times.
 */
function clusterByKey(failures) {
  const clusters = new Map()
  for (const f of failures) {
    const key = f.failure.key || '(none)'
    if (!clusters.has(key)) clusters.set(key, { key, specs: [] })
    clusters.get(key).specs.push(f.id)
  }
  return [...clusters.values()]
}

module.exports = { decide, apply, primaryFor, clusterByKey, AUTO_HEAL, REVIEW, AMBIGUOUS, REFUSED }
