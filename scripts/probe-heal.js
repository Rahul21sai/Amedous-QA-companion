#!/usr/bin/env node
/**
 * THE OFFLINE KNOWN-ANSWER ORACLE.
 *
 * Loads two saved captures from disk and runs the scorer with NO BROWSER AT ALL.
 * The debug loop goes from a ~40 second Playwright round trip to ~200ms, against a case
 * where we already know which node should win. Every hour spent on the scorer depends on
 * this existing first.
 *
 *   node scripts/probe-heal.js --capture   # boot Chrome once, save before/after trees
 *   node scripts/probe-heal.js             # offline: score, print the breakdown
 *
 * The printed breakdown rows must SUM to the displayed total. If they do not, the table
 * on stage is a lie and this is where you find out.
 */

const fs = require('fs')
const path = require('path')
const { rank } = require('../engine/score')

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, '.glassbox', 'oracle')
const BEFORE = path.join(DIR, 'before.json')
const AFTER = path.join(DIR, 'after.json')

const NEW_LABEL = 'Complete Purchase'
const TARGET = 'Place Order' // the accessible name we track across the mutation

// ---------------------------------------------------------------------------

async function capture() {
  const { chromium } = require('playwright')
  const { execFileSync } = require('child_process')
  const { capturePage } = require('../engine/capture')

  fs.mkdirSync(DIR, { recursive: true })

  // channel:'chrome' — Playwright 1.63 wants Chromium 1243, the local cache tops out at
  // 1228, so a cold chromium.launch() genuinely fails. System Chrome launches in ~315ms
  // with zero download.
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })

  try {
    execFileSync('node', ['scripts/mutate.js', 'reset'], { cwd: ROOT, stdio: 'ignore' })

    const before = await capturePage(page, 'http://localhost:4300/checkout')
    fs.writeFileSync(BEFORE, JSON.stringify(before, null, 1))
    console.log(`captured baseline   -> ${path.relative(ROOT, BEFORE)}  (${before.nodes.length} nodes)`)

    execFileSync('node', ['scripts/mutate.js', 'rename-cta', NEW_LABEL], { cwd: ROOT, stdio: 'ignore' })

    const after = await capturePage(page, 'http://localhost:4300/checkout')
    fs.writeFileSync(AFTER, JSON.stringify(after, null, 1))
    console.log(`captured mutated    -> ${path.relative(ROOT, AFTER)}  (${after.nodes.length} nodes)`)

    execFileSync('node', ['scripts/mutate.js', 'reset'], { cwd: ROOT, stdio: 'ignore' })
    execFileSync('git', ['reset', '--hard', 'HEAD~1'], { cwd: ROOT, stdio: 'ignore' })
    console.log('reset app to baseline')
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------

const pct = (v) => (v == null ? '  --  ' : (v * 100).toFixed(0).padStart(4) + '%')

function printBreakdown(result) {
  console.log('  ' + 'property'.padEnd(20) + 'w'.padStart(5) + 'sim'.padStart(8) + 'points'.padStart(9) + '   status')
  console.log('  ' + '-'.repeat(62))
  for (const r of result.breakdown) {
    const w = r.weight.toFixed(1).padStart(5)
    const pts = r.status === 'no-signal' ? '     -   ' : ('+' + r.points.toFixed(3)).padStart(9)
    console.log(`  ${r.label.padEnd(20)}${w}${pct(r.sim).padStart(8)}${pts}   ${r.status}`)
  }
  console.log('  ' + '-'.repeat(62))
  const sum = result.breakdown.reduce((s, r) => s + r.points, 0)
  console.log(
    `  ${'TOTAL'.padEnd(20)}${result.weightSum.toFixed(1).padStart(5)}${''.padStart(8)}${result.earned
      .toFixed(3)
      .padStart(9)}`
  )
  console.log(`  score = ${result.earned.toFixed(3)} / ${result.weightSum.toFixed(1)} = ${result.score.toFixed(4)}`)

  // The self-check that matters: do the rows add up to the number we printed?
  const drift = Math.abs(sum - result.earned)
  console.log(
    drift < 1e-9
      ? `  arithmetic check: rows sum to ${sum.toFixed(3)} — MATCHES earned. Table is honest.`
      : `  ARITHMETIC MISMATCH: rows sum to ${sum.toFixed(3)} but earned is ${result.earned.toFixed(3)}`
  )
  return drift < 1e-9
}

function offline() {
  if (!fs.existsSync(BEFORE) || !fs.existsSync(AFTER)) {
    console.error('no saved captures. Run:  node scripts/probe-heal.js --capture   (SUT must be up)')
    process.exit(2)
  }

  const before = JSON.parse(fs.readFileSync(BEFORE, 'utf8'))
  const after = JSON.parse(fs.readFileSync(AFTER, 'utf8'))

  const fingerprint = before.nodes.find((n) => n.role === 'button' && n.name === TARGET)
  if (!fingerprint) {
    console.error(`could not find a button named "${TARGET}" in the baseline capture`)
    process.exit(2)
  }

  console.log(`\nFINGERPRINT (recorded on the last green run)`)
  console.log(`  ${fingerprint.role} "${fingerprint.name}"  <${fingerprint.tag} id="${fingerprint.id}" class="${fingerprint.cls}">`)
  console.log(`  ancestors: [${fingerprint.ancestorRoles.join(' > ')}]`)
  console.log(`  neighbours: ${JSON.stringify(fingerprint.neighborTexts)}`)

  // Does the original locator still resolve? (name no longer matches -> 0 hits)
  const stillThere = after.nodes.filter((n) => n.role === fingerprint.role && n.name === fingerprint.name)
  console.log(`\nORIGINAL LOCATOR  getByRole('${fingerprint.role}', { name: '${fingerprint.name}' })`)
  console.log(`  resolves to ${stillThere.length} element(s) after the change` + (stillThere.length === 0 ? '  -> BROKEN, healing required' : ''))

  const candidates = after.nodes.filter((n) => n.interactive)
  const ranked = rank(fingerprint, candidates)

  console.log(`\nRANKED CANDIDATES (${candidates.length} interactive nodes scored)`)
  ranked.slice(0, 5).forEach((r, i) => {
    console.log(
      `  ${i === 0 ? '>' : ' '} ${r.score.toFixed(4)}  ${r.node.role} "${r.node.name || r.node.text || ''}"` +
        `  <${r.node.tag || '?'} id="${r.node.id || ''}">`
    )
  })

  const best = ranked[0]
  const runnerUp = ranked[1]
  const margin = runnerUp ? best.score - runnerUp.score : 1

  console.log(`\nSCORE BREAKDOWN — winner`)
  const honest = printBreakdown(best)

  console.log(`\n  runner-up: ${runnerUp ? runnerUp.score.toFixed(4) : 'n/a'}   margin: ${margin.toFixed(4)}`)

  // ---- known-answer assertions ----
  const expectedId = 'place-order-btn'
  const ok = best.node.id === expectedId
  console.log(`\nORACLE`)
  console.log(`  expected winner id : ${expectedId}`)
  console.log(`  actual   winner id : ${best.node.id || '(none)'}`)
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — scorer ${ok ? 'picked' : 'did NOT pick'} the renamed button`)
  console.log(`  ${honest ? 'PASS' : 'FAIL'} — breakdown arithmetic`)

  if (!ok || !honest) process.exit(1)
}

if (process.argv.includes('--capture')) capture().catch((e) => { console.error(e); process.exit(1) })
else offline()
