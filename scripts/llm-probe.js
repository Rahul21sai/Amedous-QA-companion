#!/usr/bin/env node
/**
 * DISCOVER the LLM endpoint's actual wire format, then cache the answer.
 *
 * ICA's `/ica/v1/chat-models` is not the OpenAI `/v1/chat/completions` shape, and the exact
 * contract varies by deployment. Guessing produces a demo that silently falls back to
 * templates and nobody notices until someone asks. So this tries each candidate shape
 * against the real endpoint and reports exactly what came back.
 *
 *   npm run llm:probe
 *
 * On success it writes .glassbox/llm-shape.json, which engine/llm.js picks up
 * automatically. Nothing else needs configuring.
 */

const llm = require('../engine/llm')

const c = llm.config()

function line(s = '') { console.log(s) }

/** Same auth headers llm.js sends, so route probes are apples-to-apples. */
function headersFor(cfg) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (cfg.key) {
    h.Authorization = `Bearer ${cfg.key}`
    h.icaKey = cfg.key
    h['api-key'] = cfg.key
    h['x-api-key'] = cfg.key
  }
  if (cfg.integrationId) h['Integration-Id'] = cfg.integrationId
  if (cfg.extensionName) h['Extension-Name'] = cfg.extensionName
  return h
}

async function main() {
  line()
  line('LLM ENDPOINT PROBE')
  line('='.repeat(66))
  line(`provider        ${c.provider || '(none configured)'}`)
  line(`base url        ${c.base || '(unset)'}`)
  line(`model           ${c.model}`)
  line(`api key         ${c.key ? `set, ${c.key.length} chars, ending "${c.key.slice(-4)}"` : 'EMPTY'}`)
  line(`integration id  ${c.integrationId || '(unset)'}`)
  line(`extension name  ${c.extensionName || '(unset)'}`)
  line(`mode            ${llm.mode()}`)
  line('='.repeat(66))

  if (!c.base) {
    line()
    line('No endpoint configured. Set ICA_BASE_URL in .env.')
    process.exit(2)
  }

  if (!c.key) {
    line()
    line('ICA_API_KEY is EMPTY — every shape below will fail on auth, so nothing can be')
    line('detected yet. Paste the key into .env and run this again:')
    line()
    line('    npm run llm:probe')
    line()
    line('Until then GlassBox runs in `off` mode, which is a fully working path: all prose')
    line('is generated from the deterministic change records and every number on screen is')
    line('computed. Nothing in the demo depends on this endpoint.')
    line()
    line('Probing anyway to check reachability...')
  }

  // ---- Which routes EXIST? ----
  // A 404 on a deliberately bogus sibling path, versus a non-404 on a real one, separates
  // "this route does not exist" from "this route exists and rejected my credentials".
  // Without the bogus control you cannot tell the two apart, and you end up debugging auth
  // on a URL that was never right.
  line()
  line('ROUTE EXISTENCE  (bogus control vs real candidates)')
  line('-'.repeat(66))
  const CONTROL = '/definitely-not-a-real-route-xyz'
  const candidates = [CONTROL, '/chat/completions', '/models', '/completion', `/${c.model}/completion`]
  let controlStatus = null
  for (const suffix of candidates) {
    let status = 'ERR'
    let bodyText = ''
    try {
      const r = await fetch(c.base + suffix, {
        method: 'POST',
        headers: headersFor(c),
        body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(12000),
      })
      status = r.status
      bodyText = (await r.text()).slice(0, 70).replace(/\s+/g, ' ')
    } catch (e) {
      bodyText = e.message
    }
    if (suffix === CONTROL) controlStatus = status
    const verdict =
      suffix === CONTROL ? '(control)' : status === controlStatus ? 'does not exist' : 'EXISTS'
    line(`${String(status).padEnd(5)} ${verdict.padEnd(15)} ${suffix}`)
    line(`      ${bodyText}`)
  }
  line('-'.repeat(66))

  const prompt = 'Reply with exactly this JSON and nothing else: {"ok": true, "shape": "detected"}'
  const results = []

  for (const name of llm.SHAPE_NAMES) {
    process.stdout.write(`\n${name.padEnd(14)} `)
    const r = await llm.callRaw(c, name, 'You reply with strict JSON only.', prompt, 15000)
    results.push({ name, ...r })
    if (r.ok) {
      console.log(`OK  ${r.status}`)
      console.log(`               url:  ${r.url}`)
      console.log(`               text: ${String(r.text).slice(0, 200).replace(/\n/g, ' ')}`)
    } else {
      console.log(`FAIL${r.status ? '  ' + r.status : ''}`)
      console.log(`               url:  ${r.url || '(n/a)'}`)
      console.log(`               err:  ${String(r.error || '').slice(0, 260).replace(/\s+/g, ' ')}`)
      // A response body on a failure is often where the API tells you the right field
      // names — print a little of it, it is the most useful thing here.
      if (r.json) console.log(`               body: ${JSON.stringify(r.json).slice(0, 260)}`)
    }
  }

  const winner = results.find((r) => r.ok)
  line()
  line('='.repeat(66))

  if (winner) {
    llm.saveShape(winner.name, { url: winner.url, status: winner.status, probedModel: c.model })
    line(`DETECTED: ${winner.name}`)
    line(`  cached to ${llm.SHAPE_FILE}`)
    line()
    line('Next:')
    line('  1. GLASSBOX_LLM=record npm run run     # call live once, cache every response')
    line('  2. GLASSBOX_LLM=replay npm run run     # serve from cache — USE THIS ON STAGE')
    line()
    line('Replay gives zero network, zero latency and zero variance, with the mode shown')
    line('on screen as a badge. That is determinism without deception.')
  } else {
    const auth = results.filter((r) => r.status === 401 || r.status === 403)
    const notFound = results.filter((r) => r.status === 404)
    line('NO SHAPE DETECTED')
    line()
    if (!c.key) {
      line('  Expected — the API key is empty. Fill in ICA_API_KEY and re-run.')
      if (auth.length) line(`  Good news: ${auth.length} shape(s) returned ${auth[0].status}, so the host and path are reachable.`)
    } else if (auth.length) {
      line(`  ${auth.length} shape(s) returned 401/403 — the endpoint is reachable but the key was`)
      line('  rejected. Check the key, and whether this deployment also needs')
      line('  ICA_INTEGRATION_ID / ICA_EXTENSION_NAME (both settable in .env).')
    } else if (notFound.length === results.length) {
      line('  Every shape returned 404 — the base URL path is probably not where completions')
      line('  live. Check the ICA docs for the exact route under /ica/v1/chat-models.')
    } else {
      line('  Unreachable, or the response format is one none of the candidates recognise.')
      line('  If you can paste a working curl for this endpoint, adding it is ~6 lines in')
      line('  the SHAPES table in engine/llm.js.')
    }
    line()
    line('GlassBox stays fully functional in `off` mode either way.')
    process.exitCode = 1
  }
  line()
}

main().catch((e) => { console.error(e); process.exit(1) })
