#!/usr/bin/env node
/**
 * ORCHESTRATOR. Mirrors the flow diagram exactly:
 *
 *   App -> Change Detection -> AI QA Engine {Generate | Self-Heal | Risk Selection}
 *       -> Quality Validation {UI | Security | A11y | Perf} -> Insights -> Release Decision
 *
 * This file is the product. The dashboard is a pure reader of the events it emits, so a
 * missing UI degrades to this printing a complete verdict JSON — the story survives a
 * missing dashboard, it does not survive a missing engine.
 *
 *   node engine/run.js --baseline    capture fingerprints, run everything, expect green
 *   node engine/run.js               detect changes, select, run, heal, validate, decide
 *   node engine/run.js --quiet       verdict line only (used for the flake-proof loop)
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const { capturePage } = require('./capture')
const { diff, impactedKeys } = require('./diff')
const registry = require('./registry')
const heal = require('./heal')
const { classify, PRODUCT_BUG, APP_ERROR } = require('./classify')
const { runSpec, keysOf, BASE } = require('./runner')
const gate = require('./gate')
const llm = require('./llm')
const specs = require('../tests/specs')

const ROOT = path.join(__dirname, '..')
const STATE = path.join(ROOT, '.glassbox')
const BASELINE = path.join(STATE, 'baseline')
const PAGES = [
  { name: 'shop', url: '/', anchor: 'h1' },
  { name: 'cart', url: '/cart', anchor: 'h1' },
  { name: 'checkout', url: '/checkout', anchor: 'h1' },
]

const ARGS = process.argv.slice(2)
const IS_BASELINE = ARGS.includes('--baseline')
const QUIET = ARGS.includes('--quiet')

// ---------------------------------------------------------------------------
// Event stream. Console + optional WebSocket sink installed by engine/server.js.
// ---------------------------------------------------------------------------
const sinks = []
const events = []
function emit(e) {
  const ev = { t: Date.now(), ...e }
  events.push(ev)
  for (const s of sinks) { try { s(ev) } catch {} }
  // When the dashboard spawns this process it reads events off stdout as NDJSON. Keeping
  // the transport this dumb is deliberate: run.js stays a standalone CLI, so the terminal
  // fallback keeps working whether or not a dashboard is attached.
  if (process.env.GLASSBOX_STREAM) process.stdout.write('@@GBX@@' + JSON.stringify(ev) + '\n')
  if (!QUIET && e.type === 'phase') console.log(`\n=== ${e.name.toUpperCase()} ${'='.repeat(Math.max(0, 44 - e.name.length))}`)
  if (!QUIET && e.type === 'log') console.log(`  ${e.message}`)
}
const log = (message) => emit({ type: 'log', message })
const phase = (name) => emit({ type: 'phase', name })

// ---------------------------------------------------------------------------

/** Put an item in the cart so /cart and /checkout have content worth capturing. */
async function primeCart(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Add Aperture 35mm Lens/ }).click()
  await page.waitForLoadState('domcontentloaded')
}

async function captureAll(page) {
  await primeCart(page)
  const out = {}
  for (const p of PAGES) {
    out[p.name] = await capturePage(page, BASE + p.url, { anchor: p.anchor })
  }
  return out
}

/**
 * Harvest the fingerprint for every healable registry key from a capture set.
 * These are what healing scores against — no fingerprint, no heal (the cold-start trap).
 */
function harvestFingerprints(captures, reg) {
  const all = Object.values(captures).flatMap((c) => c.nodes)
  const found = {}
  for (const [key, entry] of Object.entries(reg)) {
    if (entry.kind !== 'role') continue
    const { role, name, exact } = entry.primary
    const match = all.find((n) => {
      if (n.role !== role) return false
      if (name == null) return true
      return exact === false ? String(n.name || '').includes(name) : n.name === name
    })
    if (match) found[key] = match
  }
  return found
}

const readJSON = (p, fallback = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback)

// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(BASELINE, { recursive: true })
  const started = Date.now()

  // Playwright 1.63 needs Chromium 1243; the local cache tops out at 1228, so a cold
  // chromium.launch() fails outright. System Chrome launches in ~315ms with no download.
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()

  const result = {
    mode: IS_BASELINE ? 'baseline' : 'change',
    startedAt: new Date().toISOString(),
    changeRecords: [], impacted: [], selection: null,
    specs: [], heals: [], findings: { security: [], a11y: [], perf: null },
    verdict: null, roi: null, llmMode: llm.mode(),
  }

  try {
    // ---------------- CHANGE DETECTION ----------------
    phase('change detection')
    const captures = await captureAll(page)
    const nodeCount = Object.values(captures).reduce((n, c) => n + c.nodes.length, 0)
    log(`captured ${PAGES.length} pages, ${nodeCount} accessibility nodes (+ DOM enrichment)`)

    let reg = registry.load()

    if (IS_BASELINE) {
      // Restore canonical locators from the seed FIRST. Otherwise a previous rehearsal's
      // heal is still in registry.json, so the "baseline" starts already-broken, heals
      // itself, and is not a baseline at all. This is what makes rehearsal repeatable.
      const restored = registry.restoreFromSeed()
      log(`restored ${restored} canonical locators from registry.seed.json`)
      reg = registry.load()

      for (const [name, cap] of Object.entries(captures)) {
        fs.writeFileSync(path.join(BASELINE, `${name}.json`), JSON.stringify(cap, null, 1))
      }
      const fps = harvestFingerprints(captures, reg)
      const n = registry.recordFingerprints(fps)
      reg = registry.load()
      log(`recorded ${n} locator fingerprints — this is what self-healing scores against`)

      // A baseline that cannot fingerprint every healable key is NOT a baseline. Fail loud.
      //
      // The silent version of this is genuinely dangerous: if the app is already mutated
      // when the baseline runs, the canonical locator matches nothing, no fingerprint is
      // recorded, and every later heal refuses with "no fingerprint recorded" — correct
      // behaviour that looks like a broken product, and impossible to debug live.
      const missing = Object.entries(reg).filter(([, e]) => e.kind === 'role' && !e.fingerprint).map(([k]) => k)
      if (missing.length) {
        console.error(`\nBASELINE FAILED — could not fingerprint: ${missing.join(', ')}\n`)
        console.error('The canonical locator for each key above matched nothing on the page, which almost')
        console.error('always means the app is already mutated. Restore it and re-run:\n')
        console.error('    node scripts/mutate.js reset && node engine/run.js --baseline\n')
        await browser.close()
        process.exit(3)
      }
    } else {
      const before = {}
      for (const p of PAGES) {
        const prev = readJSON(path.join(BASELINE, `${p.name}.json`))
        if (prev) before[p.name] = prev
      }
      if (!Object.keys(before).length) {
        console.error('\nNo baseline. Run:  node engine/run.js --baseline\n')
        console.error('Self-healing has a cold start — with no recorded fingerprint there is')
        console.error('nothing to compare against and the whole mechanism silently no-ops.\n')
        process.exit(2)
      }
      for (const p of PAGES) {
        if (!before[p.name]) continue
        const recs = diff(before[p.name], captures[p.name])
        recs.forEach((r) => result.changeRecords.push({ page: p.name, ...r }))
      }
      if (result.changeRecords.length === 0) log('no semantic changes detected')
      for (const r of result.changeRecords) {
        log(`${r.type.padEnd(14)} [${r.page}] ${r.detail}`)
        if (r.note) log(`               ^ ${r.note}`)
      }
      emit({ type: 'changes', records: result.changeRecords })
    }

    // ---------------- RISK-BASED SELECTION ----------------
    phase('risk-based test selection')
    let selected = specs
    if (!IS_BASELINE && result.changeRecords.length) {
      result.impacted = impactedKeys(result.changeRecords, reg)
      log(`change records map to ${result.impacted.length} registry key(s): ${result.impacted.join(', ') || '(none)'}`)
      const hit = specs.filter((s) => keysOf(s).some((k) => result.impacted.includes(k)))
      if (hit.length) {
        selected = hit
        log(`selected ${hit.length} of ${specs.length} specs — the registry gives an exact impact map, no coverage instrumentation needed`)
      } else {
        log(`no spec touches the changed keys; running the full suite as a safety net`)
      }
    } else if (!IS_BASELINE) {
      log('nothing changed — running the full suite')
    } else {
      log(`baseline run: all ${specs.length} specs`)
    }
    result.selection = { selected: selected.map((s) => s.id), total: specs.length }
    emit({ type: 'selection', ...result.selection })

    // ---------------- FIRST PASS ----------------
    phase('quality validation — ui')
    const firstPass = []
    for (const spec of selected) {
      const r = await runSpec(page, spec, reg, emit)
      firstPass.push(r)
      log(`${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}${r.status === 'pass' ? '' : '\n         ' + r.failure.message}`)
    }

    // ---------------- CLASSIFY + HEAL ----------------
    const failures = firstPass.filter((r) => r.status === 'fail')
    if (failures.length) {
      phase('self-healing')
      const clusters = heal.clusterByKey(failures)
      log(`${failures.length} failing spec(s) clustered into ${clusters.length} root cause(s) — one change, one fix, not ${failures.length} fixes`)

      const thresholds = gate.loadPolicy().thresholds
      const allNodes = heal.dedupeCandidates(Object.values(captures).flatMap((c) => c.nodes).filter((n) => n.interactive))

      for (const cluster of clusters) {
        const sample = failures.find((f) => (f.failure.key || '(none)') === cluster.key)
        const verdict = classify(sample.failure, {
          ...sample.context,
          hasCandidate: true,
        })

        log(`\n  cluster "${cluster.key}" affects ${cluster.specs.join(', ')}`)
        log(`  classified ${verdict.verdict}: ${verdict.reason}`)

        if (!verdict.healAllowed) {
          result.heals.push({
            key: cluster.key, specs: cluster.specs, classification: verdict.verdict,
            decision: 'NOT_ATTEMPTED', reason: verdict.reason,
            expected: sample.failure.expected, actual: sample.failure.actual,
          })
          log(`  HEAL NOT ATTEMPTED — ${verdict.verdict === PRODUCT_BUG ? 'this is a product defect, not a broken locator' : 'not a healable failure'}`)
          emit({ type: 'heal', key: cluster.key, decision: 'NOT_ATTEMPTED', classification: verdict.verdict, reason: verdict.reason })
          continue
        }

        const entry = reg[cluster.key]
        const decision = heal.decide(entry && entry.fingerprint, allNodes, thresholds)
        const chosen = await llm.rerank(entry && entry.fingerprint, decision)

        log(`  best candidate: ${decision.best ? `${decision.best.node.role} "${decision.best.node.name}" @ ${decision.best.score.toFixed(4)}` : 'none'}`)
        log(`  runner-up: ${decision.runnerUp ? decision.runnerUp.score.toFixed(4) : 'n/a'}   margin: ${decision.margin != null ? decision.margin.toFixed(4) : 'n/a'}   gate: auto>=${thresholds.autoHeal} min>=${thresholds.minimum} margin>=${thresholds.margin}`)
        log(`  DECISION ${decision.decision} — ${decision.reason}`)

        const applied = heal.apply(cluster.key, decision)
        const record = {
          key: cluster.key, specs: cluster.specs, classification: verdict.verdict,
          decision: decision.decision, reason: decision.reason,
          identityOverride: !!decision.identityOverride,
          score: decision.score ?? null, margin: decision.margin ?? null,
          breakdown: decision.best ? decision.best.breakdown : [],
          weightSum: decision.best ? decision.best.weightSum : null,
          earned: decision.best ? decision.best.earned : null,
          from: applied.from || null, to: applied.to || null,
          applied: applied.applied,
          llmJustification: chosen.justification,
          runnerUp: decision.runnerUp ? { name: decision.runnerUp.node.name, score: decision.runnerUp.score } : null,
        }
        result.heals.push(record)
        emit({ type: 'heal', ...record })
        if (applied.applied) log(`  APPLIED  ${registry.describe({ kind: 'role', primary: applied.from })}\n        -> ${registry.describe({ kind: 'role', primary: applied.to })}`)
      }

      // ---------------- RE-RUN ----------------
      const healedKeys = result.heals.filter((h) => h.applied).map((h) => h.key)
      if (healedKeys.length) {
        phase('re-run after heal')
        reg = registry.load()
        const retryIds = new Set(result.heals.filter((h) => h.applied).flatMap((h) => h.specs))
        for (const spec of selected.filter((s) => retryIds.has(s.id))) {
          const r = await runSpec(page, spec, reg, emit)
          const idx = firstPass.findIndex((f) => f.id === spec.id)
          firstPass[idx] = { ...r, healedOnRerun: r.status === 'pass' }
          log(`${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}  (after heal)`)
        }
      }
    }

    result.specs = firstPass

    // ---------------- SECURITY / A11Y / PERF ----------------
    phase('quality validation — security, accessibility, performance')
    const security = require('../probes/security')
    const a11y = require('../probes/a11y')
    const perf = require('../probes/perf')

    result.findings.security = await security.run(context, page, log)
    result.findings.a11y = await a11y.run(page, log)
    result.findings.perf = await perf.run(page, log)

    // KNOWN-FINDINGS BASELINE. This is how real DAST/SAST gating works: a NEW finding
    // blocks, accepted debt warns. Without it every run blocks on the same pre-existing
    // issues, the panel cries wolf, and teams learn to ignore it.
    const KNOWN = path.join(STATE, 'known-findings.json')
    const secId = (f) => `${f.owasp}|${f.title}`
    const a11yId = (v) => `${v.id}|${v.page}|${v.target || ''}`

    if (IS_BASELINE) {
      fs.writeFileSync(KNOWN, JSON.stringify({ security: result.findings.security.map(secId), a11y: result.findings.a11y.map(a11yId) }, null, 1))
      log(`accepted ${result.findings.security.length} security + ${result.findings.a11y.length} a11y findings into the baseline — from now on only NEW findings block`)
    }
    const known = readJSON(KNOWN, { security: [], a11y: [] })
    result.findings.security.forEach((f) => { f.isNew = !known.security.includes(secId(f)) })
    result.findings.a11y.forEach((v) => { v.isNew = !known.a11y.includes(a11yId(v)) })
    const newSec = result.findings.security.filter((f) => f.isNew)
    const newA11y = result.findings.a11y.filter((v) => v.isNew)
    if (!IS_BASELINE) log(`vs baseline: ${newSec.length} new security finding(s), ${newA11y.length} new a11y violation(s)`)
    for (const f of newSec) log(`  NEW  ${f.owasp} [${f.severity}] ${f.title}`)

    emit({ type: 'findings', ...result.findings })

    // ---------------- RELEASE DECISION ----------------
    phase('release decision')
    const productBugs = result.heals.filter((h) => h.classification === PRODUCT_BUG).length
    const ambiguous = result.heals.filter((h) => h.decision === heal.AMBIGUOUS).length
    const failedAfterHeal = result.specs.filter((s) => s.status === 'fail').length
    // TRACEABILITY: acceptance criterion -> covering spec(s) -> result.
    // "Unmapped" means an AC that NO spec in the suite covers — a genuine coverage gap.
    // It must NOT mean "a spec we chose not to run this time"; risk-based selection is
    // the point of the tool, not a hole in it.
    const criteria = require('../tests/intents.json').criteria
    const runById = new Map(result.specs.map((s) => [s.id, s]))
    result.traceability = criteria.map((c) => {
      const covering = specs.filter((s) => s.ac === c.id)
      const ran = covering.map((s) => runById.get(s.id)).filter(Boolean)
      return {
        ac: c.id,
        text: c.text,
        specs: covering.map((s) => s.id),
        status: !covering.length ? 'NO COVERAGE' : !ran.length ? 'not selected this run' : ran.every((r) => r.status === 'pass') ? 'pass' : 'fail',
      }
    })
    const unmapped = result.traceability.filter((t) => t.status === 'NO COVERAGE')
    for (const t of result.traceability) log(`${t.ac}  ${String(t.status).padEnd(20)} ${t.specs.join(', ') || '(none)'}  ${t.text}`)

    const facts = {
      productBugs,
      ambiguousHeals: ambiguous,
      failedAfterHeal,
      securityFindings: {
        newCritical: result.findings.security.filter((f) => f.severity === 'critical' && f.isNew).length,
        knownCritical: result.findings.security.filter((f) => f.severity === 'critical' && !f.isNew).length,
        critical: result.findings.security.filter((f) => f.severity === 'critical').length,
        total: result.findings.security.length,
      },
      a11yViolations: {
        newCritical: result.findings.a11y.filter((v) => v.impact === 'critical' && v.isNew).length,
        knownCritical: result.findings.a11y.filter((v) => v.impact === 'critical' && !v.isNew).length,
        critical: result.findings.a11y.filter((v) => v.impact === 'critical').length,
        total: result.findings.a11y.length,
      },
      unmappedAcceptanceCriteria: unmapped.length,
    }

    result.verdict = gate.evaluate(facts)
    result.facts = facts

    for (const r of result.verdict.rules) {
      log(`${r.state === 'FIRED' ? '[FIRED ]' : '[PASSED]'} ${r.id}  ${r.when.padEnd(34)} (${r.detail})`)
    }
    log('')
    log(`RELEASE DECISION: ${result.verdict.verdict}`)
    log(`  ${result.verdict.headline}`)

    // ---------------- ROI ----------------
    const appliedHeals = result.heals.filter((h) => h.applied)
    const specsRescued = result.specs.filter((s) => s.healedOnRerun).length
    const policy = gate.loadPolicy()
    result.roi = {
      healsApplied: appliedHeals.length,
      registryEditsMade: appliedHeals.length,
      specFilesAHumanWouldEdit: specsRescued,
      // Needs NO assumption — a ratio computed from this run.
      touchedFilesRatio: appliedHeals.length ? `${specsRescued}:${appliedHeals.length}` : null,
      fileEditReduction: specsRescued > 0 ? 1 - appliedHeals.length / specsRescued : null,
      // Needs an assumption, and the assumption travels with the number.
      minutesSaved: specsRescued * policy.roi.minutesPerManualFix,
      assumption: policy.roi.assumptionNote,
      refusals: result.heals.filter((h) => !h.applied).length,
    }
    if (result.roi.touchedFilesRatio) {
      log('')
      log(`ROI (no assumption): ${specsRescued} spec(s) a human would have edited vs ${appliedHeals.length} registry key we edited = ${(result.roi.fileEditReduction * 100).toFixed(0)}% fewer file edits`)
      log(`ROI (assumption):    ${result.roi.minutesSaved} engineer-minutes, assuming ${policy.roi.minutesPerManualFix} min per manual fix`)
    }

    result.ms = Date.now() - started
    result.insight = await llm.summarize(result)
    if (result.insight) { log(''); log(`INSIGHT [${result.insight.provenance}]: ${result.insight.text}`) }
  } finally {
    await browser.close()
  }

  fs.writeFileSync(path.join(STATE, 'last-run.json'), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(STATE, 'last-events.json'), JSON.stringify(events, null, 2))
  emit({ type: 'done', result })

  if (QUIET) {
    console.log(`${result.verdict.verdict}  specs=${result.specs.filter((s) => s.status === 'pass').length}/${result.specs.length}  heals=${result.roi.healsApplied}  refusals=${result.roi.refusals}  ${result.ms}ms`)
  } else {
    console.log(`\n=== VERDICT JSON ${'='.repeat(40)}`)
    console.log(
      JSON.stringify(
        {
          verdict: result.verdict.verdict,
          headline: result.verdict.headline,
          specs: { pass: result.specs.filter((s) => s.status === 'pass').length, fail: result.specs.filter((s) => s.status === 'fail').length },
          changeRecords: result.changeRecords.map((r) => `${r.type}: ${r.detail}`),
          heals: result.heals.map((h) => ({ key: h.key, classification: h.classification, decision: h.decision, score: h.score, margin: h.margin, applied: h.applied })),
          security: result.findings.security.map((f) => `${f.owasp} ${f.severity}: ${f.title}`),
          a11y: `${result.findings.a11y.length} violations`,
          perf: result.findings.perf,
          roi: result.roi,
          llmMode: result.llmMode,
          ms: result.ms,
        },
        null,
        2
      )
    )
    console.log(`\nwrote .glassbox/last-run.json`)
  }

  // A baseline with a failing spec is also not a baseline — the fingerprints it recorded
  // describe a broken app, so every later comparison is against the wrong reference.
  if (IS_BASELINE) {
    const failed = result.specs.filter((s) => s.status === 'fail')
    if (failed.length) {
      console.error(`\nBASELINE FAILED — ${failed.length} spec(s) did not pass: ${failed.map((s) => s.id).join(', ')}`)
      console.error('Fingerprints recorded from a red baseline describe a broken app. Fix the app, then re-run.\n')
      process.exitCode = 3
      return
    }
  }

  process.exitCode = 0
}

module.exports = { main, sinks }

if (require.main === module) {
  main().catch((e) => { console.error('\nRUN FAILED:', e.message); console.error(e.stack); process.exit(1) })
}
