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

  /**
   * IDENTITY OVERRIDE — a unique, unchanged id is identity, not similarity.
   *
   * This exists because of a real failure the similarity model cannot express. When an
   * <a> becomes a <button>, the CORRECT element loses both the `role` and `tag` points
   * (-3.0 of 12.5) while an unrelated sibling that kept its <a> keeps them — so the right
   * answer can score only narrowly above a wrong one and the margin gate escalates a case
   * that is not actually ambiguous.
   *
   * A stable id that still matches, and matches EXACTLY ONE candidate, settles the
   * question: that is the same element with a different role. We still require the score
   * to clear the minimum floor, and we say on screen that the override fired, so it is
   * auditable rather than a hidden special case.
   */
  const fpId = (fingerprint.id || '').trim()
  if (fpId) {
    const idMatches = ranked.filter((r) => (r.node.id || '').trim() === fpId)
    if (idMatches.length === 1 && idMatches[0].score >= minimum) {
      const winner = idMatches[0]
      return {
        ...common,
        best: winner,
        score: winner.score,
        identityOverride: true,
        decision: AUTO_HEAL,
        reason:
          `id "${fpId}" is unchanged and matches exactly one element on the page, so this is the ` +
          `same element rather than a similar one (scored ${winner.score.toFixed(3)}` +
          `${winner.node.role !== fingerprint.role ? `, role changed ${fingerprint.role} -> ${winner.node.role}` : ''}). ` +
          `Identity override applied; the margin gate does not apply when identity is certain.`,
      }
    }
  }

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

/**
 * Turn a winning candidate node into a registry `primary` descriptor.
 *
 * PRESERVE the original `exact` flag. Some names legitimately contain live data —
 * "Cart (1)" changes with the cart count, which is why that key was authored with
 * exact:false. Healing it to exact:true would bind the test to one specific count and
 * break it on the next run, i.e. the heal itself would introduce the flake.
 */
function primaryFor(node, previous = {}) {
  const exact = previous.exact === false ? false : true
  // With exact:false, keep the stable prefix rather than the whole live string.
  const name = exact ? node.name : previous.name ?? node.name
  return { role: node.role, name, exact }
}

/** Same element seen on several pages is ONE candidate, not N identical ones. */
function dedupeCandidates(nodes) {
  const seen = new Map()
  for (const n of nodes) {
    const identity = `${n.tag || ''}|${n.id || ''}|${n.role || ''}|${n.name || ''}|${n.cls || ''}`
    if (!seen.has(identity)) seen.set(identity, n)
  }
  return [...seen.values()]
}

/**
 * Apply a decision. Only AUTO_HEAL and REVIEW mutate anything, and the mutation goes
 * through registry.applyRegistryPatch, which cannot reach an assertion.
 */
function apply(key, decision) {
  if (decision.decision !== AUTO_HEAL && decision.decision !== REVIEW) {
    return { applied: false, reason: decision.reason }
  }
  const previous = (registry.load()[key] || {}).primary || {}
  const patch = registry.applyRegistryPatch(key, primaryFor(decision.best.node, previous), {
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

module.exports = { decide, apply, primaryFor, dedupeCandidates, clusterByKey, AUTO_HEAL, REVIEW, AMBIGUOUS, REFUSED }
