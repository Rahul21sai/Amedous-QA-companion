/**
 * TEST SPECS — declarative, and every locator is a REGISTRY KEY, never a selector.
 *
 * `key` is what makes one heal fix N tests, and it is what gives us an exact
 * change-to-test impact map with no coverage instrumentation.
 *
 * Step shapes:
 *   { goto: '/path' }
 *   { action: 'click'|'fill'|'check', key, value? }
 *   { assert: 'visible'|'text'|'textNot', key, value? }
 *   { assertMath: 'totalEqualsSubtotalPlusTax' }   // derived, not a hardcoded amount
 *
 * `intent` traces each spec back to a business requirement, which is what turns
 * "understand business intent" from a slogan into a column in the traceability matrix.
 */

module.exports = [
  {
    id: 'T01',
    name: 'Shopper can reach the cart from the shop',
    ac: 'AC-1',
    tags: ['ui', 'nav'],
    steps: [
      { goto: '/' },
      { assert: 'visible', key: 'nav.cart' },
      { action: 'click', key: 'nav.cart' },
      { assert: 'visible', key: 'cart.toCheckout' },
    ],
  },
  {
    id: 'T02',
    name: 'Shopper can add a lens to the cart',
    ac: 'AC-2',
    tags: ['ui', 'cart'],
    steps: [
      { goto: '/' },
      { action: 'click', key: 'shop.addLens' },
      { assert: 'visible', key: 'cart.toCheckout' },
      { assert: 'text', key: 'nav.cart', value: 'Cart (1)' },
    ],
  },
  {
    id: 'T03',
    name: 'Shopper can add two different products',
    ac: 'AC-2',
    tags: ['ui', 'cart'],
    steps: [
      { goto: '/' },
      { action: 'click', key: 'shop.addLens' },
      { action: 'click', key: 'nav.shop' },
      { action: 'click', key: 'shop.addTripod' },
      { assert: 'text', key: 'nav.cart', value: 'Cart (2)' },
    ],
  },
  {
    id: 'T04',
    name: 'Checkout shows a correct order total',
    ac: 'AC-3',
    tags: ['ui', 'checkout', 'money'],
    steps: [
      { goto: '/' },
      { action: 'click', key: 'shop.addLens' },
      { action: 'click', key: 'cart.toCheckout' },
      { assert: 'visible', key: 'checkout.placeOrder' },
      // Derived, not a magic number — so this fails on a real pricing bug and on
      // nothing else.
      { assertMath: 'totalEqualsSubtotalPlusTax' },
    ],
  },
  {
    id: 'T05',
    name: 'Shopper can apply a valid promo code',
    ac: 'AC-4',
    tags: ['ui', 'checkout', 'promo'],
    steps: [
      { goto: '/' },
      { action: 'click', key: 'shop.addLens' },
      { action: 'click', key: 'cart.toCheckout' },
      { action: 'fill', key: 'checkout.promo', value: 'SAVE10' },
      { action: 'click', key: 'checkout.applyPromo' },
      { assertMath: 'totalEqualsSubtotalPlusTax' },
    ],
  },
  {
    id: 'T06',
    name: 'Shopper can place an order',
    ac: 'AC-5',
    tags: ['ui', 'checkout', 'money'],
    steps: [
      { goto: '/' },
      { action: 'click', key: 'shop.addLens' },
      { action: 'click', key: 'cart.toCheckout' },
      { action: 'fill', key: 'checkout.email', value: 'demo@example.com' },
      { action: 'check', key: 'checkout.terms' },
      { action: 'click', key: 'checkout.placeOrder' },
      { assert: 'visible', key: 'confirm.chargedTotal' },
    ],
  },
]
