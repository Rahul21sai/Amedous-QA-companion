/**
 * PERFORMANCE — three real numbers, measured in the browser.
 *
 * Deliberately NOT Lighthouse: 15–30s per page, ESM-only so it needs a dynamic import from
 * CJS, it resets storage by default so it cannot audit an authenticated in-page state, and
 * it needs the browser launched with a --remote-debugging-port that matches what you pass
 * to playAudit. The whiteboard weights performance at 10. Navigation Timing plus a
 * PerformanceObserver give real LCP/CLS/TTFB with none of that risk.
 */

const BASE = 'http://localhost:4300'

async function measure(page, url) {
  // Register the observers BEFORE navigation, or LCP and CLS entries are missed.
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0 }
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__vitals.lcp = Math.max(window.__vitals.lcp, e.startTime)
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {}
  })

  await page.goto(BASE + url, { waitUntil: 'load' })
  await page.waitForTimeout(700) // let LCP/CLS entries land

  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find((p) => p.name === 'first-contentful-paint')
    const bytes = performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0)
    return {
      ttfbMs: Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0),
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      lcpMs: Math.round(window.__vitals?.lcp || 0),
      cls: Number((window.__vitals?.cls || 0).toFixed(4)),
      resources: performance.getEntriesByType('resource').length,
      transferredKb: Math.round(bytes / 1024),
    }
  })
}

async function run(page, log) {
  const out = {}
  for (const url of ['/', '/checkout']) {
    out[url] = await measure(page, url)
  }
  const c = out['/checkout']
  log(`performance /checkout: TTFB ${c.ttfbMs}ms · FCP ${c.fcpMs}ms · LCP ${c.lcpMs}ms · CLS ${c.cls} · ${c.resources} requests, ${c.transferredKb}KB`)
  return out
}

module.exports = { run, measure }
