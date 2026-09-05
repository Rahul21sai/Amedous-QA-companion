/**
 * Business logic for the app under test.
 *
 * This module exists as a SEPARATE FILE on purpose. It is the "product bug" surface.
 * `scripts/mutate.js break-total` edits calcTotal() here, which makes the checkout
 * total assert fail WITHOUT changing a single locator — precisely the case the
 * healer must refuse to touch.
 */

const TAX_RATE = 0.08

/** Sum of line items, in cents to avoid float drift. */
function subtotal(items) {
  return items.reduce((sum, i) => sum + i.priceCents * i.qty, 0)
}

/** Tax on the (already promo-discounted) subtotal. */
function calcTax(subtotalCents) {
  return Math.round(subtotalCents * TAX_RATE)
}

/** Promo discount in cents. SAVE10 = 10% off. */
function applyPromo(subtotalCents, code) {
  if (!code) return 0
  if (String(code).trim().toUpperCase() === 'SAVE10') {
    return Math.round(subtotalCents * 0.1)
  }
  return 0
}

/**
 * Order total = subtotal - discount + tax.
 *
 * MUTATION TARGET (`break-total`): dropping the `+ tax` term produces a wrong
 * total while every selector on the page still resolves perfectly.
 */
function calcTotal(items, promoCode) {
  const sub = subtotal(items)
  const discount = applyPromo(sub, promoCode)
  const tax = calcTax(sub - discount)
  return sub - discount + tax
}

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`

module.exports = { TAX_RATE, subtotal, calcTax, applyPromo, calcTotal, fmt }
