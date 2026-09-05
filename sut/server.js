/**
 * APP UNDER TEST — "Aperture Store", port 4300.
 *
 * Two deliberate design choices, both load-bearing for the demo:
 *
 * 1. Pages are read FRESH FROM DISK on every request. So `scripts/mutate.js` and the
 *    /break panel edit real source files, the change is live on the next reload with no
 *    restart, and `git diff` shows a genuine diff. That is what licenses handing a judge
 *    the keyboard — nothing is a `?v=2` query flag.
 *
 * 2. Every vulnerability and accessibility defect below is PLANTED. That makes every
 *    finding a true positive by construction: we know the ground truth, so nothing the
 *    security or a11y panel reports is hand-waved.
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const catalog = require('./catalog')
const pricing = require('./pricing')

const PORT = 4300
const PUB = path.join(__dirname, 'public')
const app = express()

app.use(express.urlencoded({ extended: false }))
app.use(express.json())

// PLANTED (A02:2025 Security Misconfiguration): x-powered-by is left on, and NO security
// headers are set anywhere — no CSP, HSTS, X-Content-Type-Options, X-Frame-Options or
// Referrer-Policy. `probes/security.js` asserts on each of these by name.

// ---------------------------------------------------------------------------
// Sessions + cart (in-memory; a hackathon fixture, not a real store)
// ---------------------------------------------------------------------------
const sessions = new Map()

function sid(req, res) {
  const cookie = String(req.headers.cookie || '')
  const found = /(?:^|;\s*)sid=([^;]+)/.exec(cookie)
  if (found && sessions.has(found[1])) return found[1]
  const id = 's' + Math.random().toString(36).slice(2, 10)
  sessions.set(id, { cart: [], authed: false })
  // PLANTED (A02:2025): session cookie with no HttpOnly, no SameSite, no Secure.
  res.setHeader('Set-Cookie', `sid=${id}; Path=/`)
  return id
}

const session = (req, res) => sessions.get(sid(req, res))

// ---------------------------------------------------------------------------
// Templating — read from disk every time so edits are live
// ---------------------------------------------------------------------------
function render(file, vars = {}) {
  let html = fs.readFileSync(path.join(PUB, file), 'utf8')
  for (const [k, v] of Object.entries(vars)) {
    html = html.split(`{{${k}}}`).join(v == null ? '' : String(v))
  }
  return html.replace(/\{\{[a-zA-Z_]+\}\}/g, '')
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const s = session(req, res)
  const rows = catalog
    .map(
      (p) => `      <li class="card" data-product="${p.id}">
        <h3 class="card__title">${esc(p.name)}</h3>
        <p class="card__blurb">${esc(p.blurb)}</p>
        <p class="card__price">${pricing.fmt(p.priceCents)}</p>
        <form method="post" action="/cart/add">
          <input type="hidden" name="id" value="${p.id}">
          <button class="btn btn--primary" id="add-${p.id}" type="submit">Add to Cart</button>
        </form>
      </li>`
    )
    .join('\n')
  res.type('html').send(render('index.html', { PRODUCTS: rows, COUNT: s.cart.length }))
})

app.get('/cart', (req, res) => {
  const s = session(req, res)
  const rows = s.cart.length
    ? s.cart
        .map((i) => {
          const p = catalog.find((c) => c.id === i.id)
          return `        <tr data-line="${i.id}"><td>${esc(p.name)}</td><td>${i.qty}</td><td class="line-total">${pricing.fmt(
            p.priceCents * i.qty
          )}</td></tr>`
        })
        .join('\n')
    : '        <tr><td colspan="3">Your cart is empty.</td></tr>'
  res.type('html').send(render('cart.html', { LINES: rows, COUNT: s.cart.length }))
})

app.post('/cart/add', (req, res) => {
  const s = session(req, res)
  const id = String(req.body.id || '')
  if (catalog.some((c) => c.id === id)) {
    const line = s.cart.find((i) => i.id === id)
    if (line) line.qty += 1
    else s.cart.push({ id, qty: 1 })
  }
  res.redirect('/cart')
})

app.get('/checkout', (req, res) => {
  const s = session(req, res)
  const items = s.cart.map((i) => ({ ...catalog.find((c) => c.id === i.id), qty: i.qty }))
  const sub = pricing.subtotal(items)
  res.type('html').send(
    render('checkout.html', {
      COUNT: s.cart.length,
      SUBTOTAL: pricing.fmt(sub),
      TAX: pricing.fmt(pricing.calcTax(sub)),
      TOTAL: pricing.fmt(pricing.calcTotal(items, null)),
      PROMO_ERROR: '',
    })
  )
})

/**
 * PLANTED (A05:2025 Injection): the promo code is echoed back into the page and the
 * client renders it with innerHTML (see public/app.js), so a payload executes.
 * The security probe confirms this with an exposeBinding callback — it does not
 * grep for the payload in the response.
 */
app.post('/checkout/promo', (req, res) => {
  const s = session(req, res)
  const items = s.cart.map((i) => ({ ...catalog.find((c) => c.id === i.id), qty: i.qty }))
  const code = String(req.body.promo || '')
  const sub = pricing.subtotal(items)
  const discount = pricing.applyPromo(sub, code)
  const message = discount > 0 ? `Promo applied: -${pricing.fmt(discount)}` : `Invalid promo code: ${code}`
  res.type('html').send(
    render('checkout.html', {
      COUNT: s.cart.length,
      SUBTOTAL: pricing.fmt(sub),
      TAX: pricing.fmt(pricing.calcTax(sub - discount)),
      TOTAL: pricing.fmt(pricing.calcTotal(items, code)),
      PROMO_ERROR: message,
    })
  )
})

app.post('/checkout/place', (req, res) => {
  const s = session(req, res)
  const items = s.cart.map((i) => ({ ...catalog.find((c) => c.id === i.id), qty: i.qty }))
  const total = pricing.calcTotal(items, req.body.promo)
  orders.push({ id: 'o' + (orders.length + 1), total, email: String(req.body.email || '') })
  s.cart = []
  res.type('html').send(render('confirm.html', { TOTAL: pricing.fmt(total), COUNT: 0 }))
})

// ---------------------------------------------------------------------------
// The /break control panel — this is what a judge drives
// ---------------------------------------------------------------------------
app.get('/break', (_req, res) => res.type('html').send(render('break.html')))

app.post('/break/apply', (req, res) => {
  const { execFileSync } = require('child_process')
  const name = String(req.body.mutation || '')
  const label = String(req.body.label || '')
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'mutate.js'), name, label], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    })
    res.json({ ok: true, output: out.trim() })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.stderr || e.message) })
  }
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const orders = [{ id: 'o0', total: 28692, email: 'seed@example.com' }]

app.post('/api/login', (req, res) => {
  const s = session(req, res)
  const ok = req.body.email === 'demo@example.com' && req.body.password === 'demo1234'
  s.authed = ok
  // MUTATION TARGET (`drop-audit-log`): A09:2025 — failed logins are audited here.
  if (!ok) audit(`LOGIN_FAILED email=${req.body.email}`)
  res.status(ok ? 200 : 401).json({ ok })
})

app.get('/api/cart', (req, res) => res.json(session(req, res).cart))

/**
 * PLANTED (A01:2025 Broken Access Control): NO authorization check. The security probe
 * finds this by replaying every request recorded during an authenticated run through a
 * cookie-less context — any 200 is a genuine finding with a reproducible curl.
 */
app.get('/api/admin/orders', (_req, res) => res.json({ orders }))

function audit(line) {
  fs.appendFileSync(path.join(__dirname, 'audit.log'), `${new Date().toISOString()} ${line}\n`)
}

// Static assets last. `index: false` so the catalog route above owns "/".
app.use(express.static(PUB, { index: false }))

app.listen(PORT, () => {
  console.log(`[sut]    Aperture Store   http://localhost:${PORT}`)
  console.log(`[sut]    break panel      http://localhost:${PORT}/break`)
})
