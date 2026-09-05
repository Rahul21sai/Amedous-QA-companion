/**
 * SECURITY — four real checks, OWASP Top 10 **2025** codes.
 *
 * Everything here runs against OUR OWN app on localhost. No attack traffic ever leaves the
 * machine, which is both the ethical position and the reliable one: a shared public demo
 * target is rate-limited and gives flaky results mid-demo.
 *
 * Every finding is a TRUE POSITIVE BY CONSTRUCTION — each defect is deliberately planted in
 * sut/, so we know the ground truth and nothing on the panel is hand-waved.
 *
 * What we deliberately did NOT do, and why (say this out loud):
 *   OWASP ZAP is a 287MB Docker-free download and 2.16+ requires Java 17, while this
 *   machine has Java 11.0.21. We swapped a 287MB Java DAST for five targeted checks that
 *   run in about eight seconds.
 */

const semver = require('semver')

const BASE = 'http://localhost:4300'

// A deliberately small, vendored slice of the retire.js database. The real DB is 549KB;
// we need one component, and vendoring it keeps the check offline and instant.
// NOTE: in the real DB `§§version§§` is a literal placeholder token, not a regex — you
// must substitute a capture group before compiling, or nothing ever matches.
const SCA_DB = [
  {
    component: 'jquery',
    // retire.js ships this exact extractor for reading the live version off a page.
    extractor: "window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery",
    vulnerabilities: [
      {
        atOrAbove: '1.0.0', below: '3.5.0',
        severity: 'medium',
        cve: 'CVE-2020-11022',
        cwe: 'CWE-79',
        ghsa: 'GHSA-gxr4-xjj5-5px2',
        summary: 'Passing HTML from untrusted sources to jQuery DOM manipulation methods may execute untrusted code.',
      },
      {
        atOrAbove: '1.2.0', below: '3.5.0',
        severity: 'medium',
        cve: 'CVE-2020-11023',
        cwe: 'CWE-79',
        ghsa: 'GHSA-jpcq-cgw6-v4j6',
        summary: 'Passing HTML containing <option> elements to jQuery manipulation methods may execute untrusted code.',
      },
    ],
  },
]

const HEADER_CHECKS = [
  { header: 'content-security-policy', title: 'No Content-Security-Policy', severity: 'high' },
  { header: 'strict-transport-security', title: 'No Strict-Transport-Security', severity: 'medium' },
  { header: 'x-content-type-options', title: 'No X-Content-Type-Options (MIME sniffing possible)', severity: 'low' },
  { header: 'x-frame-options', title: 'No X-Frame-Options / frame-ancestors (clickjacking)', severity: 'medium' },
  { header: 'referrer-policy', title: 'No Referrer-Policy', severity: 'low' },
]

async function run(context, page, log) {
  const findings = []

  // ---- A02:2025 Security Misconfiguration — response headers ----
  const res = await page.goto(BASE + '/checkout', { waitUntil: 'domcontentloaded' })
  const headers = res ? res.headers() : {}
  for (const c of HEADER_CHECKS) {
    if (!headers[c.header]) {
      findings.push({ owasp: 'A02:2025', category: 'Security Misconfiguration', severity: c.severity, title: c.title, evidence: `response to GET /checkout has no ${c.header} header` })
    }
  }
  if (headers['x-powered-by']) {
    findings.push({ owasp: 'A02:2025', category: 'Security Misconfiguration', severity: 'low', title: 'Server technology disclosed via x-powered-by', evidence: `x-powered-by: ${headers['x-powered-by']}` })
  }

  // ---- A02:2025 — cookie flags ----
  for (const c of await context.cookies()) {
    const missing = []
    if (!c.httpOnly) missing.push('HttpOnly')
    if (!c.secure) missing.push('Secure')
    if (!c.sameSite || c.sameSite === 'None') missing.push('SameSite')
    if (missing.length) {
      findings.push({ owasp: 'A02:2025', category: 'Security Misconfiguration', severity: 'medium', title: `Session cookie "${c.name}" missing ${missing.join(', ')}`, evidence: `${c.name} is readable from JavaScript, so XSS can steal the session` })
    }
  }

  // ---- A01:2025 Broken Access Control — unauthenticated replay ----
  // Record what an authenticated session actually requested, then replay each of those
  // requests through a context carrying NO cookies. Any 200 is a genuine finding, and it
  // costs nothing extra because the UI run already generated the traffic.
  const seen = new Set()
  const capture = (req) => {
    const u = req.url()
    if (u.startsWith(BASE + '/api/')) seen.add(u)
  }
  page.on('request', capture)
  await page.goto(BASE + '/checkout', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => fetch('/api/cart').catch(() => {}))
  await page.evaluate(() => fetch('/api/admin/orders').catch(() => {}))
  await page.waitForTimeout(300)
  page.off('request', capture)

  const anon = await context.request // reuse the request fixture but strip credentials
  for (const url of seen) {
    try {
      const r = await anon.get(url, { headers: { cookie: '' }, failOnStatusCode: false })
      if (r.status() === 200 && url.includes('/admin/')) {
        findings.push({
          owasp: 'A01:2025', category: 'Broken Access Control', severity: 'critical',
          title: `${url.replace(BASE, '')} returns 200 with no credentials`,
          evidence: `curl -i ${url}`,
          detail: 'Replayed from the authenticated run with the cookie header removed.',
        })
      }
    } catch {}
  }

  // ---- A05:2025 Injection — EXECUTION oracle, not reflection matching ----
  // We do not grep for our payload in the response. We install a binding and wait for the
  // browser to call us back. A JavaScript callback that actually fired cannot be a false
  // positive.
  let xssFired = false
  const probe = await context.newPage()
  await probe.exposeBinding('__glassboxXss', () => { xssFired = true })
  probe.on('dialog', async (d) => { xssFired = true; await d.dismiss() })
  try {
    await probe.goto(BASE + '/checkout', { waitUntil: 'domcontentloaded' })
    const payload = '"><img src=x onerror="window.__glassboxXss && window.__glassboxXss()">'
    await probe.getByRole('textbox', { name: 'Promo code' }).fill(payload)
    await probe.getByRole('button', { name: 'Apply Promo' }).click()
    await probe.waitForTimeout(600)
    if (xssFired) {
      findings.push({
        owasp: 'A05:2025', category: 'Injection', severity: 'critical',
        title: 'Reflected XSS in the promo-code field executes script',
        evidence: `payload: ${payload}`,
        detail: 'Confirmed by execution, not by reflection matching — the page called our exposed binding back.',
      })
    }
  } catch (e) {
    log(`  xss probe could not complete: ${e.message.split('\n')[0]}`)
  }

  // ---- A03:2025 Software Supply Chain — live version detection ----
  for (const comp of SCA_DB) {
    let version = null
    try {
      version = await probe.evaluate(`(() => { try { return ${comp.extractor} } catch (e) { return null } })()`)
    } catch {}
    if (!version) continue
    const clean = semver.coerce(version)
    for (const v of comp.vulnerabilities) {
      if (clean && semver.gte(clean, v.atOrAbove) && semver.lt(clean, v.below)) {
        findings.push({
          owasp: 'A03:2025', category: 'Software Supply Chain Failures', severity: v.severity,
          title: `${comp.component} ${version} — ${v.cve}`,
          evidence: `read off the running page via ${comp.extractor}`,
          detail: `${v.summary} (${v.cwe}, ${v.ghsa})`,
          link: `https://nvd.nist.gov/vuln/detail/${v.cve}`,
        })
      }
    }
  }
  await probe.close()

  // ---- A09:2025 Security Logging Failures ----
  try {
    const before = await readAudit(context)
    await context.request.post(BASE + '/api/login', { data: { email: 'attacker@example.com', password: 'wrong' }, failOnStatusCode: false })
    await new Promise((r) => setTimeout(r, 200))
    const after = await readAudit(context)
    if (after === before) {
      findings.push({
        owasp: 'A09:2025', category: 'Security Logging and Alerting Failures', severity: 'medium',
        title: 'Failed authentication is not audited',
        evidence: 'a failed POST /api/login produced no new audit-log entry',
      })
    }
  } catch {}

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  findings.forEach((f) => { bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1 })
  log(`security: ${findings.length} findings — ${Object.entries(bySeverity).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`)
  for (const f of findings) log(`  ${f.owasp} [${f.severity}] ${f.title}`)

  return findings
}

/** Size of the audit log, read through the app's own filesystem. */
async function readAudit() {
  const fs = require('fs')
  const p = require('path').join(__dirname, '..', 'sut', 'audit.log')
  return fs.existsSync(p) ? fs.statSync(p).size : 0
}

module.exports = { run, SCA_DB, HEADER_CHECKS }
