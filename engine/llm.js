/**
 * LLM — optional by design.
 *
 * Configure an OpenAI-compatible endpoint (IBM ICA works this way):
 *   GLASSBOX_LLM_URL=https://.../v1/chat/completions
 *   GLASSBOX_LLM_KEY=...
 *   GLASSBOX_LLM_MODEL=...
 *   GLASSBOX_LLM=record|replay|off
 *
 * Three modes, and the mode is shown on screen as a badge so this is honest rather than
 * deceptive:
 *   record  call live, cache the response to disk
 *   replay  serve only from cache — zero network, zero latency, zero variance. USE THIS
 *           ON STAGE. Four separate vendors (Applitools, Meticulous, Antithesis,
 *           Functionize) built entire market positions on determinism.
 *   off     no model at all; deterministic template prose from the typed records.
 *
 * `off` is the default when no endpoint is configured, and it is a FULLY WORKING path —
 * not a degraded one. An ICA endpoint almost certainly needs the corporate network, which
 * hackathon wifi will not have, so the demo must never depend on a network call.
 *
 * TOKEN DISCIPLINE: we never send raw DOM or HTML. Only the typed change records and the
 * top-5 candidate summaries. A single SPA page is 500KB–2MB of HTML; that is how you blow
 * a context window at hour three.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CACHE = path.join(__dirname, '..', '.glassbox', 'llm-cache')

const URL_ = process.env.GLASSBOX_LLM_URL || ''
const KEY = process.env.GLASSBOX_LLM_KEY || ''
const MODEL = process.env.GLASSBOX_LLM_MODEL || 'gpt-4o-mini'

function mode() {
  const m = (process.env.GLASSBOX_LLM || '').toLowerCase()
  if (m === 'record' || m === 'replay' || m === 'off') return m
  return URL_ && KEY ? 'replay' : 'off'
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

/** One small JSON-mode call. Returns null on any failure — callers must have a fallback. */
async function ask(prompt, { maxTokens = 300 } = {}) {
  const m = mode()
  const key = hash(MODEL + '|' + prompt)

  if (m === 'off') return null
  const hit = cached(key)
  if (hit) return hit
  if (m === 'replay') return null // replay never reaches the network

  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'You are a QA engineer. Reply with strict JSON only, no prose outside the JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const text = body?.choices?.[0]?.message?.content
    if (!text) return null
    const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim())
    store(key, parsed)
    return parsed
  } catch {
    return null // network, timeout, auth, malformed JSON — all fall through to templates
  }
}

/**
 * Re-rank the top-5 candidates and justify the pick in one sentence.
 *
 * The model NEVER writes a selector. It may only choose among candidates our deterministic
 * scorer already produced, and if it disagrees with the scorer we keep the scorer's answer
 * and record the disagreement. The arithmetic stays authoritative.
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

module.exports = { mode, rerank, summarize, ask }
