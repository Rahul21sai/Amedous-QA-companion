/**
 * Unit tests for the scorer and the gate. `node --test engine/` — Node 22's built-in
 * runner, zero install.
 *
 * The most important test here is `breakdown sums to earned`. If the rows on screen do not
 * add up to the number beside them, the anti-fraud artifact is itself a fraud, and this is
 * the test that catches it.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { score, rank, PROPERTIES } = require('./score')
const heal = require('./heal')
const { classify, PRODUCT_BUG, AUTOMATION_BREAK, APP_ERROR } = require('./classify')

const node = (over = {}) => ({
  role: 'button', name: 'Place Order', text: null, tag: 'button', id: 'place-order-btn',
  cls: 'btn btn--primary', url: null, interactive: true,
  region: 'Place your order', ancestorRoles: ['generic', 'main', 'region', 'generic'],
  neighborTexts: ['I agree to the terms of sale'], siblingIndex: 1,
  box: { x: 100, y: 200, width: 120, height: 40 },
  ...over,
})

const THRESHOLDS = { autoHeal: 0.85, minimum: 0.6, margin: 0.15 }

test('identical nodes score 1.0', () => {
  const r = score(node(), node())
  assert.strictEqual(r.score, 1)
})

test('breakdown rows sum exactly to earned, and score === earned / weightSum', () => {
  const r = score(node(), node({ name: 'Complete Purchase', box: { x: 104, y: 200, width: 150, height: 40 } }))
  const sum = r.breakdown.reduce((s, row) => s + row.points, 0)
  assert.ok(Math.abs(sum - r.earned) < 1e-9, `rows sum ${sum} != earned ${r.earned}`)
  assert.ok(Math.abs(r.score - r.earned / r.weightSum) < 1e-9)
})

test('a property with no signal on either side is excluded from the denominator', () => {
  // Neither side has a url, so `href` must not silently score full marks.
  const r = score(node({ url: null }), node({ url: null }))
  const href = r.breakdown.find((b) => b.key === 'url')
  assert.strictEqual(href.status, 'no-signal')
  assert.strictEqual(href.points, 0)
  assert.ok(r.weightSum < PROPERTIES.reduce((s, p) => s + p.weight, 0))
})

test('a total relabel still scores above the auto-heal bar when everything else matches', () => {
  const r = score(node(), node({ name: 'Zzzz Qqqq' }))
  assert.ok(r.score >= 0.85, `expected >= 0.85, got ${r.score}`)
})

test('an unrelated element scores well below the floor', () => {
  const other = node({
    role: 'textbox', name: 'Email address', tag: 'input', id: 'email', cls: 'fld',
    interactive: true, region: 'Contact details', neighborTexts: ['Card number'],
    box: { x: 20, y: 40, width: 300, height: 30 },
  })
  assert.ok(score(node(), other).score < 0.6)
})

test('rank returns candidates best-first', () => {
  const fp = node()
  const ranked = rank(fp, [node({ name: 'Apply Promo', id: 'apply-promo' }), node()])
  assert.strictEqual(ranked[0].node.id, 'place-order-btn')
  assert.ok(ranked[0].score > ranked[1].score)
})

// ---------------- the gate ----------------

test('two near-identical candidates escalate instead of guessing', () => {
  const fp = node()
  const real = node({ name: 'Place Order Now', id: 'place-order-btn' })
  const decoy = node({ name: 'Place Order Later', id: 'place-order-later-btn', cls: 'btn btn--ghost', box: { x: 100, y: 160, width: 140, height: 40 } })
  // Strip the id so the identity override cannot short-circuit the ambiguity check.
  const d = heal.decide({ ...fp, id: '' }, [{ ...real, id: '' }, { ...decoy, id: '' }], THRESHOLDS)
  assert.strictEqual(d.decision, heal.AMBIGUOUS)
})

test('a unique unchanged id overrides the margin gate (role change case)', () => {
  const fp = node()
  const changed = node({ role: 'button', tag: 'button', url: null }) // same id
  const sibling = node({ role: 'link', name: 'Shop', tag: 'a', id: '', cls: 'nav-link', url: '/' })
  const d = heal.decide(fp, [changed, sibling], THRESHOLDS)
  assert.strictEqual(d.decision, heal.AUTO_HEAL)
  assert.strictEqual(d.identityOverride, true)
})

test('no fingerprint means refuse — the cold-start guard', () => {
  const d = heal.decide(null, [node()], THRESHOLDS)
  assert.strictEqual(d.decision, heal.REFUSED)
})

test('healing preserves exact:false so a live count cannot be baked into the locator', () => {
  const p = heal.primaryFor(node({ name: 'Cart (7)' }), { role: 'link', name: 'Cart', exact: false })
  assert.strictEqual(p.exact, false)
  assert.strictEqual(p.name, 'Cart', 'must keep the stable prefix, not the live string')
})

// ---------------- the classifier ----------------

test('an assertion value mismatch is a PRODUCT BUG and healing is not allowed', () => {
  const c = classify({ phase: 'assert', reason: 'value-mismatch', key: 'checkout.orderTotal', expected: '1215.00', actual: '1125.00' }, {})
  assert.strictEqual(c.verdict, PRODUCT_BUG)
  assert.strictEqual(c.healAllowed, false)
})

test('a locator resolving zero elements is an AUTOMATION break and may be healed', () => {
  const c = classify({ phase: 'action', reason: 'no-match', key: 'checkout.placeOrder' }, { hasCandidate: true })
  assert.strictEqual(c.verdict, AUTOMATION_BREAK)
  assert.strictEqual(c.healAllowed, true)
})

test('a 5xx outranks everything — never repair a test against a broken app', () => {
  const c = classify({ phase: 'assert', reason: 'value-mismatch' }, { httpErrors: [{ status: 500, url: '/checkout' }] })
  assert.strictEqual(c.verdict, APP_ERROR)
  assert.strictEqual(c.healAllowed, false)
})

test('the registry refuses to patch an assertion target', () => {
  const registry = require('./registry')
  assert.throws(
    () => registry.applyRegistryPatch('checkout.orderTotal', { role: 'button', name: 'x' }),
    /assertion target/i
  )
})
