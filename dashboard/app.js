/**
 * DASHBOARD — a pure WebSocket reader.
 *
 * There is deliberately no business logic here and nothing is computed in the browser.
 * Every number rendered arrives from the engine. That means an unfinished or broken UI
 * degrades to `node engine/run.js` in a terminal with all the same numbers, and it also
 * means nothing on screen can disagree with what the engine actually decided.
 */

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const state = { specs: new Map(), heals: [], running: false }

// ---------------------------------------------------------------------------
// flow diagram
// ---------------------------------------------------------------------------
function setPhase(name) {
  const nodes = document.querySelectorAll('.fnode')
  nodes.forEach((n) => {
    if (n.dataset.phase === name) {
      n.classList.add('is-active')
      n.classList.remove('is-done')
    } else if (n.classList.contains('is-active')) {
      n.classList.remove('is-active')
      n.classList.add('is-done')
    }
  })
}
function clearFlow() {
  document.querySelectorAll('.fnode').forEach((n) => n.classList.remove('is-active', 'is-done', 'is-alert'))
  ;['f-changes', 'f-select', 'f-heals', 'f-rerun', 'f-ui', 'f-sec', 'f-a11y', 'f-perf', 'f-verdict'].forEach((id) => ($(id).textContent = '—'))
}

// ---------------------------------------------------------------------------
// heal inspector — the per-property arithmetic
// ---------------------------------------------------------------------------
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(0) + '%')

function healCard(h) {
  const el = document.createElement('div')
  el.className = 'heal'

  const rows = (h.breakdown || [])
    .map((r) => {
      const nosig = r.status === 'no-signal'
      return `<tr class="${nosig ? 'is-nosig' : ''}">
        <td>${esc(r.label)}</td>
        <td>${r.weight.toFixed(1)}</td>
        <td>${nosig ? 'no signal' : pct(r.sim)}</td>
        <td>${nosig ? '—' : '+' + r.points.toFixed(3)}</td>
        <td class="${r.status === 'match' ? 't-ok' : r.status === 'miss' ? 't-bad' : 't-muted'}">${esc(r.status)}</td>
      </tr>`
    })
    .join('')

  const sum = (h.breakdown || []).reduce((s, r) => s + r.points, 0)
  const adds = h.earned != null && Math.abs(sum - h.earned) < 1e-6

  const table = h.breakdown && h.breakdown.length
    ? `<table class="sc">
         <thead><tr><th>property</th><th>weight</th><th>similarity</th><th>points</th><th>status</th></tr></thead>
         <tbody>${rows}</tbody>
         <tfoot><tr><td>TOTAL</td><td>${h.weightSum?.toFixed(1) ?? '—'}</td><td></td><td>${h.earned?.toFixed(3) ?? '—'}</td><td></td></tr></tfoot>
       </table>
       <div class="sc-sum ${adds ? '' : 'bad'}">
         ${h.earned?.toFixed(3)} / ${h.weightSum?.toFixed(1)} = <b>${h.score?.toFixed(4)}</b>
         &nbsp;·&nbsp; rows sum to ${sum.toFixed(3)} ${adds ? '— matches, the table is honest' : '— MISMATCH'}
         ${h.margin != null ? `&nbsp;·&nbsp; margin over runner-up ${h.margin.toFixed(4)}` : ''}
         ${h.runnerUp ? `&nbsp;·&nbsp; runner-up "${esc(h.runnerUp.name)}" ${h.runnerUp.score.toFixed(4)}` : ''}
       </div>`
    : ''

  const locs = h.from && h.to
    ? `<div class="heal__locs">
         <div class="from">− getByRole('${esc(h.from.role)}', { name: '${esc(h.from.name)}'${h.from.exact === false ? ', exact: false' : ''} })</div>
         <div class="to">+ getByRole('${esc(h.to.role)}', { name: '${esc(h.to.name)}'${h.to.exact === false ? ', exact: false' : ''} })</div>
       </div>`
    : ''

  const bug = h.classification === 'PRODUCT_BUG' && h.expected != null
    ? `<div class="heal__locs"><div class="from">expected ${esc(h.expected)}</div><div class="to">actual&nbsp;&nbsp; ${esc(h.actual)}</div></div>`
    : ''

  el.innerHTML = `
    <div class="heal__hd">
      <span class="heal__key">${esc(h.key)}</span>
      <span class="heal__dec dec-${esc(h.decision)}">${esc(h.decision).replace(/_/g, ' ')}</span>
      <span class="badge">${esc(h.classification || '')}</span>
      ${h.identityOverride ? '<span class="badge">identity override</span>' : ''}
      <span class="cluster">${(h.specs || []).length} test(s): ${(h.specs || []).join(', ')}</span>
    </div>
    <p class="heal__why">${esc(h.reason)}</p>
    ${bug}${locs}${table}
    ${h.llmJustification ? `<p class="heal__why"><span class="badge">${h.provenance || 'COMPUTED'}</span> ${esc(h.llmJustification)}</p>` : ''}
  `
  return el
}

// ---------------------------------------------------------------------------
// renderers
// ---------------------------------------------------------------------------
function renderChanges(records) {
  const box = $('changes')
  if (!records || !records.length) { box.innerHTML = '<div class="empty">no semantic changes detected</div>'; return }
  box.innerHTML = records
    .map(
      (r) => `<div class="row">
        <span class="row__tag">${esc(r.type)}</span>
        <span class="row__txt">${esc(r.detail)}
          ${r.note ? `<span class="row__note">${esc(r.note)}</span>` : ''}</span>
      </div>`
    )
    .join('')
  $('f-changes').textContent = records.length
}

function renderSpecs() {
  const box = $('specs')
  const all = [...state.specs.values()]
  if (!all.length) { box.innerHTML = '<div class="empty">—</div>'; return }
  box.innerHTML = all
    .map(
      (s) => `<div class="row">
        <span class="row__tag ${s.status === 'pass' ? 'tag-low' : 'tag-crit'}">${s.status === 'pass' ? 'PASS' : 'FAIL'}</span>
        <span class="row__txt">${esc(s.id)} &nbsp;${esc(s.name)}${s.healed ? ' <span class="badge">healed</span>' : ''}
          ${s.message ? `<span class="row__note">${esc(s.message)}</span>` : ''}</span>
      </div>`
    )
    .join('')
  const pass = all.filter((s) => s.status === 'pass').length
  $('f-ui').textContent = `${pass}/${all.length}`
}

const sevTag = (s) => ({ critical: 'tag-crit', high: 'tag-high', medium: 'tag-med', low: 'tag-low' }[s] || 'tag-low')

function renderFindings(f) {
  const sec = $('security')
  if (f.security && f.security.length) {
    sec.innerHTML = f.security
      .map(
        (x) => `<div class="row">
          <span class="row__tag ${sevTag(x.severity)}">${esc(x.owasp)}</span>
          <span class="row__tag ${x.isNew ? 'tag-new' : 'tag-known'}">${x.isNew ? 'NEW' : 'known'}</span>
          <span class="row__txt">${esc(x.title)}
            <span class="row__note">${esc(x.evidence || '')}${x.detail ? ' — ' + esc(x.detail) : ''}</span></span>
        </div>`
      )
      .join('')
    const crit = f.security.filter((x) => x.severity === 'critical').length
    $('f-sec').textContent = `${f.security.length} (${crit} crit)`
  }

  const a = $('a11y')
  if (f.a11y && f.a11y.length) {
    a.innerHTML = f.a11y
      .map(
        (v) => `<div class="row">
          <span class="row__tag ${sevTag(v.impact === 'serious' ? 'high' : v.impact)}">${esc(v.impact)}</span>
          <span class="row__txt">${esc(v.id)} on ${esc(v.page)} &nbsp;<span class="t-muted">${esc(v.nodes)} node(s)</span>
            <span class="row__note">${esc(v.help)}</span></span>
        </div>`
      )
      .join('')
    $('f-a11y').textContent = f.a11y.length
  }

  const p = $('perf')
  if (f.perf) {
    p.innerHTML = Object.entries(f.perf)
      .map(
        ([url, m]) => `<div class="row"><span class="row__tag">${esc(url)}</span>
          <span class="row__txt">TTFB ${m.ttfbMs}ms · FCP ${m.fcpMs}ms · LCP ${m.lcpMs}ms · CLS ${m.cls}
          <span class="row__note">${m.resources} requests, ${m.transferredKb}KB transferred</span></span></div>`
      )
      .join('')
    const c = f.perf['/checkout']
    if (c) $('f-perf').textContent = `LCP ${c.lcpMs}ms`
  }
}

function renderTrace(rows) {
  if (!rows) return
  $('trace').innerHTML = rows
    .map(
      (t) => `<div class="row">
        <span class="row__tag ${t.status === 'pass' ? 'tag-low' : t.status === 'NO COVERAGE' ? 'tag-crit' : 'tag-known'}">${esc(t.ac)}</span>
        <span class="row__txt">${esc(t.text)}
          <span class="row__note">${esc(t.status)} · ${t.specs.length ? esc(t.specs.join(', ')) : 'no covering test'}</span></span>
      </div>`
    )
    .join('')
}

function renderVerdict(v, roi, thresholds) {
  if (!v) return
  const pill = $('verdict-pill')
  pill.textContent = v.verdict
  pill.className = 'verdict-pill v-' + v.verdict
  $('verdict-headline').textContent = v.headline
  $('f-verdict').textContent = v.verdict

  const node = $('f-verdict-node')
  node.classList.remove('is-active')
  node.classList.add(v.verdict === 'BLOCK' ? 'is-alert' : 'is-done')

  $('rules').innerHTML = v.rules
    .map(
      (r) => `<div class="rule">
        <span class="rule__st ${r.state === 'FIRED' ? 't-bad' : 't-ok'}">${r.state}</span>
        <span class="rule__id">${esc(r.id)}</span>
        <span class="row__tag">${esc(r.when)}</span>
        <span class="rule__why">${esc(r.detail)} — ${esc(r.reason)}</span>
      </div>`
    )
    .join('')

  if (thresholds) {
    $('thresholds').textContent =
      `Gate: auto-heal ≥ ${thresholds.autoHeal} · minimum ≥ ${thresholds.minimum} · required margin over runner-up ≥ ${thresholds.margin}. ` +
      `These are in gate.json — versioned, reviewable, and deliberately visible.`
  }

  if (roi) {
    $('roi').innerHTML =
      (roi.touchedFilesRatio
        ? `<div class="row"><span class="row__tag tag-low">no assumption</span><span class="row__txt">
             ${roi.specFilesAHumanWouldEdit} test file(s) a human would have edited vs
             <b>${roi.registryEditsMade}</b> registry key we edited =
             <b>${(roi.fileEditReduction * 100).toFixed(0)}% fewer file edits</b>
             <span class="row__note">Computed from this run. Nothing assumed.</span></span></div>`
        : '') +
      `<div class="row"><span class="row__tag tag-med">assumption</span><span class="row__txt">
         ${roi.minutesSaved} engineer-minutes saved
         <span class="row__note">${esc(roi.assumption)}</span></span></div>` +
      `<div class="row"><span class="row__tag">refusals</span><span class="row__txt">${roi.refusals} decision(s) declined or escalated rather than guessed</span></div>`
  }
}

// ---------------------------------------------------------------------------
// websocket
// ---------------------------------------------------------------------------
let thresholds = null

function connect() {
  const ws = new WebSocket(`ws://${location.host}`)

  ws.onmessage = (m) => {
    const e = JSON.parse(m.data)

    switch (e.type) {
      case 'hello':
        thresholds = e.thresholds
        if (thresholds) renderVerdict({ verdict: '—', headline: 'Run the pipeline to get a decision.', rules: [] }, null, thresholds)
        break

      case 'run-start':
        state.specs.clear(); state.heals = []
        clearFlow()
        $('heal-cards').innerHTML = ''
        $('heal-empty').style.display = 'block'
        $('specs').innerHTML = '<div class="empty">running…</div>'
        setRunning(true)
        break

      case 'phase':
        setPhase(e.name)
        break

      case 'changes':
        renderChanges(e.records)
        break

      case 'selection':
        $('f-select').textContent = `${e.selected.length}/${e.total}`
        break

      case 'step': {
        // Show a spec the moment its first step runs, so the panel moves during the run.
        if (!state.specs.has(e.specId)) state.specs.set(e.specId, { id: e.specId, name: '', status: 'running' })
        break
      }

      case 'heal': {
        $('heal-empty').style.display = 'none'
        state.heals.push(e)
        $('heal-cards').appendChild(healCard(e))
        const applied = state.heals.filter((h) => h.applied).length
        const refused = state.heals.length - applied
        $('f-heals').textContent = `${applied} healed, ${refused} refused`
        if (refused) document.querySelector('[data-phase="self-healing"]').classList.add('is-alert')
        break
      }

      case 'findings':
        renderFindings(e)
        break

      case 'done': {
        const r = e.result
        state.specs.clear()
        for (const s of r.specs) {
          state.specs.set(s.id, {
            id: s.id, name: s.name, status: s.status,
            healed: !!s.healedOnRerun,
            message: s.failure ? s.failure.message : '',
          })
        }
        renderSpecs()
        renderChanges(r.changeRecords)
        renderFindings(r.findings)
        renderTrace(r.traceability)
        renderVerdict(r.verdict, r.roi, (r.verdict && r.verdict.thresholds) || thresholds)
        const rerun = r.specs.filter((s) => s.healedOnRerun).length
        $('f-rerun').textContent = rerun ? `${rerun} rescued` : '—'
        // Show WHY the model is off, not just that it is. A badge reading "off" invites
        // "is the AI part even real?"; one reading "off — ICA_API_KEY is empty" answers it.
        const s = r.llmStatus || {}
        $('llm-mode').textContent = s.reason ? `LLM: ${r.llmMode} — ${s.reason}` : `LLM: ${r.llmMode} (${s.model || ''} via ${s.shape || '?'})`
        $('llm-mode').className = 'badge badge--llm'
        $('llm-mode').title = JSON.stringify(s)
        if (r.insight) {
          $('insight').textContent = r.insight.text
          $('insight-badge').textContent = r.insight.provenance
        }
        break
      }

      case 'run-end':
        setRunning(false)
        document.querySelectorAll('.fnode.is-active').forEach((n) => { n.classList.remove('is-active'); n.classList.add('is-done') })
        break

      case 'stderr':
        console.error(e.message)
        break
    }
  }

  ws.onclose = () => setTimeout(connect, 1200)
}

function setRunning(on) {
  state.running = on
  $('btn-run').disabled = on
  $('btn-baseline').disabled = on
  $('btn-run').textContent = on ? 'Running…' : 'Run'
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })

$('btn-run').addEventListener('click', () => post('/api/run', { mode: 'change' }))
$('btn-baseline').addEventListener('click', () => post('/api/run', { mode: 'baseline' }))

setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString() }, 1000)
connect()
