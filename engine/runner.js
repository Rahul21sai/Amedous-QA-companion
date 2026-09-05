/**
 * RUNNER — executes declarative specs against a real browser.
 *
 * Every failure is reported in a SHAPE THE CLASSIFIER CAN DECIDE ON: which phase it
 * happened in (action vs assert), why (no-match vs value-mismatch), how many elements the
 * locator resolved to, and the expected/actual values. That distinction is the entire
 * basis of the refusal, so it is captured here rather than inferred later from a
 * stringified error message.
 */

const registry = require('./registry')

const BASE = 'http://localhost:4300'
const money = (s) => Math.round(parseFloat(String(s).replace(/[^0-9.]/g, '')) * 100)

/** Keys a spec touches — the exact impact map, straight off the spec. */
function keysOf(spec) {
  return [...new Set(spec.steps.filter((s) => s.key).map((s) => s.key))]
}

async function runStep(page, step, reg, emit) {
  // --- navigation ---
  if (step.goto) {
    const res = await page.goto(BASE + step.goto, { waitUntil: 'domcontentloaded' })
    if (res && res.status() >= 500) {
      return { ok: false, phase: 'action', reason: 'error', message: `HTTP ${res.status()} for ${step.goto}`, http: { status: res.status(), url: step.goto } }
    }
    return { ok: true }
  }

  // --- derived money assertion: total must equal subtotal + tax ---
  // Derived rather than a hardcoded amount, so it fails on a genuine pricing defect and
  // on nothing else. A hardcoded $268.92 would also fail on a price change, which is not
  // a bug.
  if (step.assertMath === 'totalEqualsSubtotalPlusTax') {
    const read = async (key) => (await registry.locatorFor(page, reg[key]).first().innerText()).trim()
    const sub = money(await read('checkout.subtotal'))
    const discount = money(await read('checkout.discount'))
    const tax = money(await read('checkout.tax'))
    const total = money(await read('checkout.orderTotal'))
    const expected = sub - discount + tax
    if (total !== expected) {
      return {
        ok: false,
        phase: 'assert',
        reason: 'value-mismatch',
        key: 'checkout.orderTotal',
        expected: `subtotal - discount + tax = ${(expected / 100).toFixed(2)}`,
        actual: (total / 100).toFixed(2),
        message:
          `order total ${(total / 100).toFixed(2)} != subtotal ${(sub / 100).toFixed(2)} ` +
          `- discount ${(discount / 100).toFixed(2)} + tax ${(tax / 100).toFixed(2)} = ${(expected / 100).toFixed(2)}`,
      }
    }
    return { ok: true }
  }

  const entry = reg[step.key]
  if (!entry) return { ok: false, phase: 'action', reason: 'error', key: step.key, message: `unknown registry key ${step.key}` }
  const loc = registry.locatorFor(page, entry)

  // --- resolution check comes FIRST, so "0 elements" is never reported as a
  //     value problem. This is what keeps the classifier honest. ---
  let count = 0
  try {
    count = await loc.count()
  } catch (e) {
    return { ok: false, phase: step.assert ? 'assert' : 'action', reason: 'error', key: step.key, message: e.message }
  }

  if (count === 0) {
    return {
      ok: false,
      phase: step.assert ? 'assert' : 'action',
      reason: 'no-match',
      key: step.key,
      resolved: 0,
      message: `${registry.describe(entry)} resolved 0 elements`,
    }
  }

  // --- actions ---
  if (step.action) {
    try {
      const target = loc.first()
      if (step.action === 'click') await target.click({ timeout: 5000 })
      else if (step.action === 'fill') await target.fill(step.value, { timeout: 5000 })
      else if (step.action === 'check') await target.check({ timeout: 5000 })
      else return { ok: false, phase: 'action', reason: 'error', key: step.key, message: `unknown action ${step.action}` }
      await page.waitForLoadState('domcontentloaded')
      return { ok: true, resolved: count }
    } catch (e) {
      return { ok: false, phase: 'action', reason: 'error', key: step.key, resolved: count, message: e.message.split('\n')[0] }
    }
  }

  // --- assertions ---
  if (step.assert === 'visible') {
    const visible = await loc.first().isVisible()
    return visible
      ? { ok: true, resolved: count }
      : { ok: false, phase: 'assert', reason: 'value-mismatch', key: step.key, expected: 'visible', actual: 'hidden', message: `${step.key} is not visible` }
  }

  if (step.assert === 'text') {
    const actual = (await loc.first().innerText()).trim()
    return actual.includes(step.value)
      ? { ok: true, resolved: count }
      : { ok: false, phase: 'assert', reason: 'value-mismatch', key: step.key, expected: step.value, actual, message: `expected text to contain "${step.value}", got "${actual}"` }
  }

  return { ok: false, phase: 'action', reason: 'error', key: step.key, message: 'unrecognised step' }
}

/** Run one spec. Returns { id, name, status, failure?, steps[], ms }. */
async function runSpec(page, spec, reg, emit = () => {}) {
  const started = Date.now()
  const consoleErrors = []
  const httpErrors = []
  const onErr = (e) => consoleErrors.push(String(e.message || e))
  const onRes = (r) => { if (r.status() >= 500) httpErrors.push({ status: r.status(), url: r.url() }) }
  page.on('pageerror', onErr)
  page.on('response', onRes)

  const steps = []
  try {
    for (const [i, step] of spec.steps.entries()) {
      const label = step.goto ? `goto ${step.goto}` : step.assertMath ? `assert ${step.assertMath}` : `${step.action || 'assert ' + step.assert} ${step.key}`
      emit({ type: 'step', specId: spec.id, index: i, label, state: 'running' })
      const r = await runStep(page, step, reg, emit)
      steps.push({ label, ...r })
      emit({ type: 'step', specId: spec.id, index: i, label, state: r.ok ? 'pass' : 'fail' })
      if (!r.ok) {
        if (r.http) httpErrors.push(r.http)
        return {
          id: spec.id, name: spec.name, ac: spec.ac, tags: spec.tags,
          status: 'fail', steps, ms: Date.now() - started,
          failure: { ...r, stepIndex: i, label },
          context: { consoleErrors, httpErrors },
        }
      }
    }
    return { id: spec.id, name: spec.name, ac: spec.ac, tags: spec.tags, status: 'pass', steps, ms: Date.now() - started, context: { consoleErrors, httpErrors } }
  } finally {
    page.off('pageerror', onErr)
    page.off('response', onRes)
  }
}

module.exports = { runSpec, keysOf, BASE, money }
