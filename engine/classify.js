/**
 * THE 3-WAY FAILURE CLASSIFIER — decidable from observables. No LLM.
 *
 * We deliberately do NOT produce causal root-cause prose. mabl published the real
 * ceiling for that: ~100% accuracy on symptom detection but only 75–80% on root cause,
 * and that was a purpose-built agent reading structured session data. A four-hour agent
 * is worse, and it would state a wrong cause confidently on stage. We claim detection and
 * verified repair, which are demonstrable, not causation, which is not.
 */

const AUTOMATION_BREAK = 'AUTOMATION_BREAK'
const PRODUCT_BUG = 'PRODUCT_BUG'
const APP_ERROR = 'APP_ERROR'

/**
 * @param failure { phase:'action'|'assert', reason:'no-match'|'value-mismatch'|'error',
 *                  key, resolved, expected, actual, message }
 * @param context { hasCandidate:boolean, httpErrors:[], consoleErrors:[] }
 */
function classify(failure, context = {}) {
  const { httpErrors = [], consoleErrors = [] } = context

  // Server or page-level breakage outranks everything — repairing a test against a
  // broken app is meaningless.
  if (httpErrors.length) {
    return {
      verdict: APP_ERROR,
      healAllowed: false,
      reason: `the app returned ${httpErrors.map((e) => e.status).join(', ')} for ${httpErrors
        .map((e) => e.url)
        .join(', ')}`,
    }
  }

  // THE HARD GUARD. An assertion that fails on a VALUE is a statement about the product,
  // not about the locator. Healing is never even attempted here — not gated, not scored,
  // not attempted. This is the ~10 lines that answer "doesn't self-healing hide bugs?".
  if (failure.phase === 'assert' && failure.reason === 'value-mismatch') {
    return {
      verdict: PRODUCT_BUG,
      healAllowed: false,
      reason:
        `every locator resolved; the assertion failed on a value ` +
        `(expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}). ` +
        `Changing the test to accept the new value would hide the defect.`,
    }
  }

  // A locator that resolves to nothing is a statement about the page's structure.
  if (failure.reason === 'no-match') {
    return {
      verdict: AUTOMATION_BREAK,
      healAllowed: context.hasCandidate !== false,
      reason: `locator for "${failure.key}" resolved 0 elements — the element moved, was renamed, or changed role`,
    }
  }

  // An assertion whose TARGET vanished is structural, not a value problem. Still only
  // healable if the target is a healable (action-kind) key; assertion targets are not.
  if (failure.phase === 'assert' && failure.reason === 'error') {
    return {
      verdict: AUTOMATION_BREAK,
      healAllowed: false,
      reason: `assertion target "${failure.key}" could not be read: ${failure.message}`,
    }
  }

  if (consoleErrors.length) {
    return {
      verdict: APP_ERROR,
      healAllowed: false,
      reason: `uncaught page error: ${consoleErrors[0]}`,
    }
  }

  return { verdict: APP_ERROR, healAllowed: false, reason: failure.message || 'unclassified failure' }
}

module.exports = { classify, AUTOMATION_BREAK, PRODUCT_BUG, APP_ERROR }
