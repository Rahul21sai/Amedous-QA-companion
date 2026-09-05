/**
 * LLM — optional by design, and provider-agnostic.
 *
 * Configured from .env (loaded via Node 22's built-in process.loadEnvFile).
 * IBM ICA is the primary target; any OpenAI-compatible endpoint also works.
 *
 * THREE MODES, and the mode is shown on screen as a badge so this is honest rather than
 * deceptive:
 *   off     no model at all; deterministic template prose from the typed change records
 *   record  CACHE-FIRST, then live on a miss, then template on failure. Best for a demo:
 *           rehearsed beats replay instantly from cache, and a judge typing something
 *           unrehearsed still gets a real answer.
 *   replay  serve ONLY from cache — zero network, zero latency, zero variance. Anything
 *           not previously recorded falls back to template prose.
 *
 * `off` is the default when no key is configured, and it is a FULLY WORKING path, not a
 * degraded one. An ICA endpoint will almost certainly need the corporate network, which
 * hackathon wifi will not have, so nothing in the demo may depend on a network call.
 *
 * WIRE FORMAT. ICA's `/ica/v1/chat-models` is NOT the OpenAI `/v1/chat/completions` shape,
 * and its exact contract is deployment-specific. Rather than hardcode a guess, the request
 * and response mapping lives in SHAPES below, `scripts/llm-probe.js` discovers empirically
 * which one the endpoint actually speaks, and the answer is cached to
 * .glassbox/llm-shape.json. Same philosophy as the rest of this codebase: verify, don't
 * assume.
 *
 * TOKEN DISCIPLINE: raw DOM and HTML are never sent — only the 5–30 typed change records or
 * the top-5 candidate summaries. A single modern page is 500KB–2MB of HTML.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const CACHE = path.join(ROOT, '.glassbox', 'llm-cache')
const SHAPE_FILE = path.join(ROOT, '.glassbox', 'llm-shape.json')

// Node 22 ships this — no dotenv dependency.
try { process.loadEnvFile(path.join(ROOT, '.env')) } catch { /* no .env, fine */ }

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
function config() {
  const icaKey = (process.env.ICA_API_KEY || '').trim()
  const icaBase = (process.env.ICA_BASE_URL || '').trim().replace(/\/+$/, '')
  const genericKey = (process.env.GLASSBOX_LLM_KEY || '').trim()
  const genericBase = (process.env.GLASSBOX_LLM_URL || '').trim().replace(/\/+$/, '')

  // Provider is chosen by which BASE URL is present, not by whether a key exists.
  // Gating on the key too would hide the endpoint whenever the key is blank, which is
  // exactly the state you are in when you most need to probe reachability.
  const useIca = !!icaBase
  return {
    provider: useIca ? 'ica' : genericBase ? 'openai-compatible' : null,
    base: useIca ? icaBase : genericBase,
    key: useIca ? icaKey : genericKey,
    model: (useIca ? process.env.ICA_MODEL : process.env.GLASSBOX_LLM_MODEL) || 'claude-sonnet-5',
    integrationId: (process.env.ICA_INTEGRATION_ID || '').trim(),
    extensionName: (process.env.ICA_EXTENSION_NAME || '').trim(),
    shape: (process.env.GLASSBOX_LLM_SHAPE || '').trim() || discoveredShape(),
  }
}

function discoveredShape() {
  try { return JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8')).shape || null } catch { return null }
}

function saveShape(shape, detail) {
  fs.mkdirSync(path.dirname(SHAPE_FILE), { recursive: true })
  fs.writeFileSync(SHAPE_FILE, JSON.stringify({ shape, detail }, null, 1))
}

/**
 * Candidate wire formats. Each knows how to build a request and how to pull text out of
 * a response. Adding a variant is a few lines here and nothing else changes.
 */
const SHAPES = {
  openai: {
    url: (c) => `${c.base}/chat/completions`,
    /**
     * NOTE: `temperature` is deliberately NOT sent.
     *
     * The ICA LiteLLM proxy rejects temperature=0 for Claude models outright:
     *   litellm.UnsupportedParamsError: claude-sonnet-5 does not support temperature=0.
     *   Only temperature=1 is supported.
     * and other model families on the same proxy do accept 0. Omitting the parameter is
     * the portable choice — every model applies its own default and nothing 400s.
     *
     * The consequence is worth being explicit about: we CANNOT get temperature-0
     * determinism from Claude here. So determinism comes from `replay` serving a recorded
     * cache, which is the only mechanism that actually gives zero variance on stage.
     */
    body: (c, system, user, maxTokens) => ({
      model: c.model,
      max_tokens: maxTokens || 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    text: (j) => j?.choices?.[0]?.message?.content,
  },
  'ica-query': {
    url: (c) => `${c.base}/${encodeURIComponent(c.model)}/completion`,
    body: (_c, system, user) => ({ query: user, system_prompt: system }),
    text: (j) => j?.response ?? j?.generated_text ?? j?.result ?? j?.output ?? j?.answer,
  },
  'ica-messages': {
    url: (c) => `${c.base}/${encodeURIComponent(c.model)}/completion`,
    body: (c, system, user, maxTokens) => ({
      model: c.model, max_tokens: maxTokens || 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    text: (j) =>
      j?.choices?.[0]?.message?.content ?? j?.response ?? j?.generated_text ?? j?.result ?? j?.output,
  },
  'ica-invoke': {
    url: (c) => `${c.base}/${encodeURIComponent(c.model)}/invoke`,
    body: (_c, system, user) => ({ query: `${system}\n\n${user}` }),
    text: (j) => j?.response ?? j?.generated_text ?? j?.result ?? j?.output ?? j?.answer,
  },
}

const SHAPE_NAMES = Object.keys(SHAPES)

/**
 * Auth headers.
 *
 * `Authorization` is the one that matters — determined by sending each candidate in
 * isolation against the live endpoint with a valid key:
 *
 *   Authorization: Bearer <key>   -> 200
 *   Authorization: <key>          -> 200
 *   icaKey / api-key / x-api-key  -> 400 {"error":"Invalid icaKey"}
 *   no header at all              -> 400 {"error":"Invalid icaKey"}
 *
 * Worth noting the trap: with an INVALID key every variant returns that same generic 400,
 * so the header cannot be identified until you hold a working key. Before that, sending
 * the key in several headers at once is the right hedge; once you know, send only this.
 */
function headers(c) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (c.key) h.Authorization = `Bearer ${c.key}`
  // Some ICA deployments additionally gate on these; sent only when configured.
  if (c.integrationId) h['Integration-Id'] = c.integrationId
  if (c.extensionName) h['Extension-Name'] = c.extensionName
  return h
}

// ---------------------------------------------------------------------------
// mode
// ---------------------------------------------------------------------------
function mode() {
  const explicit = (process.env.GLASSBOX_LLM || '').toLowerCase()
  const c = config()
  if (explicit === 'off') return 'off'
  if (explicit === 'record' || explicit === 'replay') {
    // Asking for a live mode without a usable endpoint is a config error, not a silent
    // fallback — say so once, then behave as `off` so the run still completes.
    if (explicit === 'record' && !(c.provider && c.key)) return 'off'
    return explicit
  }
  return c.provider && c.key ? 'replay' : 'off'
}

/** Why the model is not being used, for the on-screen badge. */
function status() {
  const c = config()
  const m = mode()
  if (m !== 'off') return { mode: m, provider: c.provider, model: c.model, shape: c.shape || '(undetected)' }
  if (!c.base) return { mode: 'off', reason: 'no endpoint configured' }
  if (!c.key) return { mode: 'off', reason: 'ICA_API_KEY is empty' }
  return { mode: 'off', reason: 'explicitly disabled' }
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

function cached(key) {
  const f = path.join(CACHE, key + '.json')
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
}
function store(key, value) {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(path.join(CACHE, key + '.json'), JSON.stringify(value, null, 1))
}

const SYSTEM = 'You are a QA engineer. Reply with strict JSON only, no prose outside the JSON.'

/** One raw call. Returns { ok, text, status, error } — never throws. */
async function callRaw(c, shapeName, system, user, timeoutMs = 10000, maxTokens = 400) {
  const shape = SHAPES[shapeName]
  if (!shape) return { ok: false, error: `unknown shape ${shapeName}` }
  const url = shape.url(c)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify(shape.body(c, system, user, maxTokens)),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const raw = await res.text()
    let json = null
    try { json = JSON.parse(raw) } catch {}
    if (!res.ok) return { ok: false, status: res.status, url, error: raw.slice(0, 400), json }
    const text = json ? shape.text(json) : raw
    if (!text) return { ok: false, status: res.status, url, error: 'no text field found in response', json, raw: raw.slice(0, 400) }
    return { ok: true, status: res.status, url, text: String(text), json }
  } catch (e) {
    return { ok: false, url, error: e.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : e.message }
  }
}

/**
 * Ask for JSON. Returns the parsed object, or null — and every caller has a
 * deterministic fallback, so null is never fatal.
 */
async function ask(prompt, { maxTokens = 400 } = {}) {
  const m = mode()
  const c = config()
  const key = hash(`${c.model}|${c.shape || 'auto'}|${prompt}`)

  if (m === 'off') return null
  const hit = cached(key)
  if (hit) return hit
  if (m === 'replay') return null // replay never touches the network

  const shapeName = c.shape || 'openai'
  const r = await callRaw(c, shapeName, SYSTEM, prompt, 10000, maxTokens)
  if (!r.ok) return null

  try {
    const parsed = JSON.parse(String(r.text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    store(key, parsed)
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// the three call sites
// ---------------------------------------------------------------------------

/**
 * Re-rank the top-5 candidates and justify the pick in one sentence.
 *
 * The model NEVER writes a selector. It may only choose among candidates our deterministic
 * scorer already produced, and if it disagrees we KEEP the scorer's answer and record the
 * disagreement. The arithmetic stays authoritative.
 */
async function rerank(fingerprint, decision) {
  if (!decision || !decision.best) return { justification: null, provenance: 'COMPUTED' }

  const deterministic = {
    justification:
      `role, tag and containing region all match; the accessible name changed from ` +
      `"${fingerprint?.name ?? ''}" to "${decision.best.node.name ?? ''}".`,
    provenance: 'COMPUTED',
  }
  if (mode() === 'off') return deterministic

  const top = decision.ranked.slice(0, 5).map((r, i) => ({
    i, role: r.node.role, name: r.node.name, id: r.node.id, tag: r.node.tag,
    region: r.node.region, score: Number(r.score.toFixed(4)),
  }))

  const out = await ask(
    `A test locator broke. The element we are looking for was recorded as:\n` +
      `${JSON.stringify({ role: fingerprint?.role, name: fingerprint?.name, id: fingerprint?.id, tag: fingerprint?.tag, region: fingerprint?.region })}\n\n` +
      `Our deterministic scorer ranked these candidates:\n${JSON.stringify(top, null, 1)}\n\n` +
      `Reply as JSON: {"index": <number>, "justification": "<one sentence, max 25 words>"}`
  )

  if (!out || typeof out.index !== 'number') return deterministic
  const agrees = out.index === 0
  return {
    justification: out.justification || deterministic.justification,
    provenance: 'LLM PROSE',
    agreesWithScorer: agrees,
    note: agrees ? null : 'model preferred a different candidate; the deterministic score was kept',
  }
}

/** Plain-English run summary. Never sees a DOM — only counts and typed records. */
async function summarize(result) {
  const changes = result.changeRecords.map((r) => `${r.type}: ${r.detail}`)
  const refused = result.heals.filter((h) => !h.applied)
  const applied = result.heals.filter((h) => h.applied)

  const template = () => {
    const bits = []
    if (changes.length) bits.push(`Detected ${changes.length} semantic change${changes.length === 1 ? '' : 's'}`)
    if (applied.length) bits.push(`healed ${applied.length} locator${applied.length === 1 ? '' : 's'}`)
    if (refused.length) {
      const bug = refused.find((r) => r.classification === 'PRODUCT_BUG')
      bits.push(
        bug
          ? `refused to heal "${bug.key}" because the failure is a value mismatch (expected ${bug.expected}, got ${bug.actual}) — a product defect, not a broken locator`
          : `escalated ${refused.length} decision${refused.length === 1 ? '' : 's'} rather than guessing`
      )
    }
    const text = (bits.length ? bits.join(', ') : 'No changes detected') + `. Release decision: ${result.verdict.verdict}.`
    return { text: text.charAt(0).toUpperCase() + text.slice(1), provenance: 'COMPUTED' }
  }

  if (mode() === 'off') return template()

  const out = await ask(
    `Summarise this QA run for an engineering lead in at most two sentences. Be factual, no marketing.\n` +
      JSON.stringify(
        {
          changes,
          healsApplied: applied.map((h) => ({ key: h.key, score: h.score })),
          refusals: refused.map((h) => ({ key: h.key, classification: h.classification, expected: h.expected, actual: h.actual })),
          verdict: result.verdict.verdict,
          firedRules: result.verdict.firedRules.map((r) => r.id),
        },
        null,
        1
      ) +
      `\n\nReply as JSON: {"summary": "<text>"}`
  )

  return out && out.summary ? { text: out.summary, provenance: 'LLM PROSE' } : template()
}

module.exports = { mode, status, config, rerank, summarize, ask, callRaw, SHAPES, SHAPE_NAMES, saveShape, SHAPE_FILE }
