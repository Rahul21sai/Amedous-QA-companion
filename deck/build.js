const pptxgen = require('pptxgenjs')

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.3 x 7.5 — set BEFORE adding slides
pres.author = 'Rahul Vudumula'
pres.title = 'GlassBox QA'

// Palette mirrors the product's own UI — the verdict states ARE the design system.
const INK = '14161B'
const PANEL = '1E222B'
const LINE = '2E3440'
const WHITE = 'FFFFFF'
const MUTE = '9AA3B2'
const DIM = '6C7686'
const GREEN = '35C98A'
const RED = 'EA5A5F'
const AMBER = 'E8A33D'
const BLUE = '4B8EF7'

const H = 'Calibri'
const B = 'Calibri'
const M = 'Courier New'

/** Chip — the repeated motif across all four slides. */
function chip(s, { x, y, w, text, fill, color = WHITE, size = 11, h = 0.3 }) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, rectRadius: 0.05, line: { color: fill } })
  s.addText(text, { x, y, w, h, isTextBox: true, align: 'center', valign: 'middle', fontFace: B, fontSize: size, bold: true, color, margin: 0 })
}

function card(s, { x, y, w, h }) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: PANEL }, rectRadius: 0.03, line: { color: LINE, width: 1 } })
}

// ===========================================================================
// SLIDE 1 — the problem, in a number
// ===========================================================================
{
  const s = pres.addSlide()
  s.background = { color: INK }

  s.addText('GlassBox QA', {
    x: 0.7, y: 0.55, w: 7.4, h: 0.85, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 46, bold: true, color: WHITE, charSpacing: -0.5,
  })
  s.addText('Self-healing tests that refuse to lie.', {
    x: 0.7, y: 1.42, w: 7.4, h: 0.4, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 19, italic: true, color: GREEN,
  })

  s.addText('Autonomous Quality Engineering for the AI Development Era', {
    x: 0.7, y: 2.1, w: 7.2, h: 0.35, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, color: MUTE,
  })

  // The stat, from real production code.
  card(s, { x: 8.35, y: 0.55, w: 4.25, h: 3.15 })
  s.addText('82%', {
    x: 8.7, y: 0.85, w: 3.6, h: 1.15, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 68, bold: true, color: RED,
  })
  s.addText('of selector references in a real 229-spec enterprise suite are hardcoded strings', {
    x: 8.7, y: 2.05, w: 3.6, h: 0.75, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, color: WHITE,
  })
  s.addText('4,494 of 5,480 cy.get() calls\nmeasured, not estimated', {
    x: 8.7, y: 2.95, w: 3.6, h: 0.5, isTextBox: true, margin: 0,
    fontFace: M, fontSize: 10, color: DIM, lineSpacing: 14,
  })

  s.addText('The problem', {
    x: 0.7, y: 2.85, w: 7.2, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: DIM, charSpacing: 1.2,
  })
  s.addText(
    [
      { text: 'AI writes code faster than QA can maintain tests. ', options: { bold: true, color: WHITE } },
      { text: 'Every UI rename, reorder or refactor breaks scripts that were never wrong — just brittle.', options: { color: MUTE } },
    ],
    { x: 0.7, y: 3.2, w: 7.2, h: 0.75, isTextBox: true, margin: 0, fontFace: B, fontSize: 15, lineSpacing: 22 }
  )

  s.addText('The bet', {
    x: 0.7, y: 4.2, w: 11.9, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: DIM, charSpacing: 1.2,
  })
  card(s, { x: 0.7, y: 4.55, w: 11.9, h: 1.35 })
  s.addText(
    [
      { text: 'Playwright already ships a planner, a generator and a healer. Microsoft gave that away.\n', options: { color: MUTE } },
      { text: 'So we built the layer that decides whether healing is ', options: { color: WHITE } },
      { text: 'allowed', options: { color: GREEN, bold: true, italic: true } },
      { text: '.', options: { color: WHITE } },
    ],
    { x: 1.05, y: 4.8, w: 11.2, h: 0.9, isTextBox: true, margin: 0, fontFace: B, fontSize: 17, lineSpacing: 27 }
  )

  chip(s, { x: 0.7, y: 6.25, w: 2.15, text: 'Playwright 1.63', fill: LINE, color: MUTE, size: 10 })
  chip(s, { x: 2.95, y: 6.25, w: 1.95, text: 'axe-core 4.13', fill: LINE, color: MUTE, size: 10 })
  chip(s, { x: 5.0, y: 6.25, w: 2.15, text: 'OWASP Top 10 2025', fill: LINE, color: MUTE, size: 10 })
  chip(s, { x: 7.25, y: 6.25, w: 2.5, text: 'IBM ICA · claude-sonnet-5', fill: LINE, color: MUTE, size: 10 })
  chip(s, { x: 9.85, y: 6.25, w: 2.75, text: 'Zero Docker · Zero build step', fill: LINE, color: MUTE, size: 10 })

  s.addNotes(
    'Open with the number, not the architecture. That 82% is from the IBM.com Cypress suite I work on: ' +
    '5,480 cy.get() calls across 229 spec files, 4,494 of them hardcoded strings. Then set the frame ' +
    'immediately, because a QA judge is already thinking it: Playwright ships a healer for free, so we ' +
    'did not build another one.'
  )
}

// ===========================================================================
// SLIDE 2 — how it works (their own diagram)
// ===========================================================================
{
  const s = pres.addSlide()
  s.background = { color: WHITE }

  s.addText('One artifact. Five capabilities.', {
    x: 0.7, y: 0.5, w: 9.5, h: 0.6, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 38, bold: true, color: INK, charSpacing: -0.4,
  })
  s.addText('Your whiteboard diagram, running as software', {
    x: 0.7, y: 1.12, w: 9.5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 14, color: '5B6270',
  })

  // Pipeline
  const py = 1.85
  const stages = [
    { t: 'Change\nDetection', c: BLUE, w: 1.75 },
    { t: 'Risk-Based\nSelection', c: BLUE, w: 1.75 },
    { t: 'Self-Heal\n+ Gate', c: GREEN, w: 1.75 },
    { t: 'Re-run', c: GREEN, w: 1.35 },
    { t: 'Validate\nUI·Sec·A11y·Perf', c: AMBER, w: 2.35 },
    { t: 'Release\nDecision', c: RED, w: 1.75 },
  ]
  let px = 0.7
  stages.forEach((st, i) => {
    s.addShape(pres.ShapeType.roundRect, {
      x: px, y: py, w: st.w, h: 0.92, fill: { color: 'F4F6F9' }, rectRadius: 0.04, line: { color: st.c, width: 1.5 },
    })
    s.addText(st.t, {
      x: px, y: py, w: st.w, h: 0.92, isTextBox: true, margin: 0, align: 'center', valign: 'middle',
      fontFace: B, fontSize: 11.5, bold: true, color: INK, lineSpacing: 15,
    })
    px += st.w
    if (i < stages.length - 1) {
      s.addText('›', { x: px, y: py, w: 0.28, h: 0.92, isTextBox: true, margin: 0, align: 'center', valign: 'middle', fontFace: B, fontSize: 20, color: '9AA3B2' })
      px += 0.28
    }
  })

  // The capture
  card2(s, 0.7, 3.15, 5.75, 3.0, 'F4F6F9', 'DFE3EA')
  s.addText('The capture', {
    x: 1.0, y: 3.4, w: 5.15, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: DIM, charSpacing: 1.2,
  })
  s.addText('page.ariaSnapshotJSON({ mode: "ai" })', {
    x: 1.0, y: 3.72, w: 5.15, h: 0.28, isTextBox: true, margin: 0, fontFace: M, fontSize: 11.5, bold: true, color: '0B5FBF',
  })
  s.addText('+ each ref resolved back to the DOM via aria-ref=', {
    x: 1.0, y: 4.0, w: 5.15, h: 0.28, isTextBox: true, margin: 0, fontFace: M, fontSize: 10.5, color: '5B6270',
  })
  s.addText(
    [
      { text: 'Verified: ariaSnapshotJSON returns no id, class or tag. ', options: { bold: true, color: INK } },
      { text: 'Resolving the ref recovers them — 120 nodes in 132 ms. That one enriched artifact drives healing, change detection, the a11y pre-screen, the security element inventory and the model prompt.', options: { color: '5B6270' } },
    ],
    { x: 1.0, y: 4.42, w: 5.15, h: 1.5, isTextBox: true, margin: 0, fontFace: B, fontSize: 12, lineSpacing: 17 }
  )

  // Registry
  card2(s, 6.85, 3.15, 5.75, 3.0, 'F4F6F9', 'DFE3EA')
  s.addText('The write seam', {
    x: 7.15, y: 3.4, w: 5.15, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: DIM, charSpacing: 1.2,
  })
  s.addText('{ action: "click", key: "checkout.placeOrder" }', {
    x: 7.15, y: 3.72, w: 5.15, h: 0.28, isTextBox: true, margin: 0, fontFace: M, fontSize: 11.5, bold: true, color: '0B5FBF',
  })
  s.addText('Tests name registry keys — never selectors.', {
    x: 7.15, y: 4.0, w: 5.15, h: 0.28, isTextBox: true, margin: 0, fontFace: M, fontSize: 10.5, color: '5B6270',
  })
  s.addText(
    [
      { text: 'The healer holds no file handle to tests/. ', options: { bold: true, color: INK } },
      { text: 'It is structurally incapable of rewriting an assertion — architecture, not a prompt instruction. One patched key fixes N tests, and the key map is an exact change-to-test impact map with zero coverage instrumentation.', options: { color: '5B6270' } },
    ],
    { x: 7.15, y: 4.42, w: 5.15, h: 1.5, isTextBox: true, margin: 0, fontFace: B, fontSize: 12, lineSpacing: 17 }
  )

  chip(s, { x: 0.7, y: 6.5, w: 3.05, text: '3 pages · 89 nodes · ~200 ms', fill: 'E8EDF5', color: '3A4250', size: 10 })
  chip(s, { x: 3.9, y: 6.5, w: 2.6, text: '6 specs · 16 registry keys', fill: 'E8EDF5', color: '3A4250', size: 10 })
  chip(s, { x: 6.65, y: 6.5, w: 2.6, text: 'Full run in ~9 seconds', fill: 'E8EDF5', color: '3A4250', size: 10 })

  s.addNotes(
    'Point at the pipeline: this is the diagram you drew on the whiteboard, and every box is a running ' +
    'process. Then the two cards are the whole engineering story — one capture feeds five features, and ' +
    'the registry indirection is why the healer physically cannot lie.'
  )
}

function card2(s, x, y, w, h, fill, line) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, rectRadius: 0.03, line: { color: line, width: 1 } })
}

// ===========================================================================
// SLIDE 3 — the three things that are actually differentiated
// ===========================================================================
{
  const s = pres.addSlide()
  s.background = { color: INK }

  s.addText('Show the arithmetic. Then refuse.', {
    x: 0.7, y: 0.52, w: 8.6, h: 0.6, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 36, bold: true, color: WHITE, charSpacing: -0.4,
  })

  // Score table — the anti-fakery artifact
  card(s, { x: 0.7, y: 1.3, w: 6.4, h: 4.05 })
  chip(s, { x: 1.0, y: 1.55, w: 1.5, text: 'AUTO-HEAL', fill: GREEN, color: '0B2A1C', size: 10 })
  s.addText('confidence 0.8835', {
    x: 2.6, y: 1.55, w: 2.2, h: 0.3, isTextBox: true, margin: 0, valign: 'middle',
    fontFace: M, fontSize: 11, bold: true, color: GREEN,
  })

  const rows = [
    ['role', '1.5', '100%', '+1.500'],
    ['accessible name', '1.5', '20%', '+0.300'],
    ['tag', '1.5', '100%', '+1.500'],
    ['visible text', '1.5', 'no signal', '—'],
    ['neighbour texts', '1.5', '100%', '+1.500'],
    ['containing region', '1.5', '100%', '+1.500'],
    ['id  ·  class  ·  box', '1.5', '≈100%', '+1.864'],
  ]
  let ry = 2.05
  s.addText('property                       w      sim     points', {
    x: 1.0, y: ry, w: 5.8, h: 0.24, isTextBox: true, margin: 0, fontFace: M, fontSize: 9.5, color: DIM,
  })
  ry += 0.3
  rows.forEach((r) => {
    const nosig = r[3] === '—'
    s.addText(`${r[0].padEnd(24)}${r[1].padStart(4)}${r[2].padStart(10)}${r[3].padStart(9)}`, {
      x: 1.0, y: ry, w: 5.8, h: 0.26, isTextBox: true, margin: 0,
      fontFace: M, fontSize: 10.5, color: nosig ? DIM : 'D6DBE4',
    })
    ry += 0.28
  })
  s.addShape(pres.ShapeType.line, { x: 1.0, y: ry + 0.04, w: 5.8, h: 0, line: { color: LINE, width: 1 } })
  s.addText('TOTAL                        12.5              11.043', {
    x: 1.0, y: ry + 0.12, w: 5.8, h: 0.26, isTextBox: true, margin: 0, fontFace: M, fontSize: 10.5, bold: true, color: WHITE,
  })
  s.addText('11.043 / 12.5 = 0.8835   ·   rows sum to 11.043 — the table is honest', {
    x: 1.0, y: ry + 0.46, w: 5.8, h: 0.26, isTextBox: true, margin: 0, fontFace: M, fontSize: 9.5, color: GREEN,
  })

  // Three differentiators
  const items = [
    {
      c: GREEN, t: 'A gate you can audit',
      d: 'Weights from arXiv:2208.00677. A property with no signal is excluded from the denominator, not given free marks — the trap that produces confident wrong heals.',
    },
    {
      c: AMBER, t: 'It refuses to guess',
      d: 'Two candidates 0.008 apart → ESCALATE, even when the top pick is right. Healenium ships an absolute threshold; Similo ships argmax. Both would silently bind to the winner.',
    },
    {
      c: RED, t: 'It refuses to lie',
      d: 'An assertion failing on a VALUE is never healed — not attempted. Every locator resolved; the product is wrong. Release flips to BLOCK with one named reason.',
    },
  ]
  let iy = 1.3
  items.forEach((it) => {
    card(s, { x: 7.45, y: iy, w: 5.15, h: 1.25 })
    s.addShape(pres.ShapeType.roundRect, { x: 7.7, y: iy + 0.22, w: 0.14, h: 0.8, fill: { color: it.c }, rectRadius: 0.06, line: { color: it.c } })
    s.addText(it.t, {
      x: 8.0, y: iy + 0.18, w: 4.4, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 15, bold: true, color: WHITE,
    })
    s.addText(it.d, {
      x: 8.0, y: iy + 0.5, w: 4.4, h: 0.68, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 10.5, color: MUTE, lineSpacing: 13,
    })
    iy += 1.4
  })

  s.addText('An <a> becoming a <button> is pixel-identical — every screenshot differ reports the page unchanged, while it breaks every getByRole(\'link\') call.', {
    x: 0.7, y: 5.6, w: 11.9, h: 0.5, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, italic: true, color: MUTE,
  })
  s.addText('Verified live: 14/14 unit tests · baseline 6/6 green · healed suite 5/5 green across 5 runs', {
    x: 0.7, y: 6.35, w: 11.9, h: 0.35, isTextBox: true, margin: 0,
    fontFace: M, fontSize: 11, color: GREEN,
  })

  s.addNotes(
    'The score table is the anti-fakery weapon — nobody who faked it can produce arithmetic a judge can ' +
    'add up in their head. Then the refusal is the actual wow: everyone in the room has shipped a bug ' +
    'behind a green suite, and a self-healing tool showing restraint is the last thing they expect.'
  )
}

// ===========================================================================
// SLIDE 4 — results, boundaries, verdict
// ===========================================================================
{
  const s = pres.addSlide()
  s.background = { color: WHITE }

  s.addText('Every number computed. Every limit named.', {
    x: 0.7, y: 0.52, w: 10.5, h: 0.6, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 34, bold: true, color: INK, charSpacing: -0.4,
  })

  // Stats
  const stats = [
    { n: '67%', l: 'fewer file edits', s: '3 test files a human edits\nvs 1 registry key we edit', c: GREEN, note: 'no assumption' },
    { n: '11', l: 'real security findings', s: 'OWASP 2025 · A01 A02 A03 A05 A09\nall true positives by construction', c: RED, note: 'planted, so ground truth known' },
    { n: '3 / 6', l: 'specs selected', s: 'exact impact map from the registry\n6 s instead of 41 s', c: BLUE, note: 'no coverage instrumentation' },
  ]
  let sx = 0.7
  stats.forEach((st) => {
    card2(s, sx, 1.25, 3.8, 2.15, 'F4F6F9', 'DFE3EA')
    s.addText(st.n, { x: sx + 0.28, y: 1.42, w: 3.2, h: 0.62, isTextBox: true, margin: 0, fontFace: H, fontSize: 40, bold: true, color: st.c })
    s.addText(st.l, { x: sx + 0.28, y: 2.05, w: 3.2, h: 0.28, isTextBox: true, margin: 0, fontFace: B, fontSize: 13, bold: true, color: INK })
    s.addText(st.s, { x: sx + 0.28, y: 2.36, w: 3.24, h: 0.55, isTextBox: true, margin: 0, fontFace: B, fontSize: 10.5, color: '5B6270', lineSpacing: 13 })
    s.addText(st.note, { x: sx + 0.28, y: 2.98, w: 3.24, h: 0.26, isTextBox: true, margin: 0, fontFace: M, fontSize: 9, color: '8A93A2' })
    sx += 4.05
  })

  // Declined
  card2(s, 0.7, 3.65, 5.75, 2.35, 'FFF6F6', 'F3D6D8')
  s.addText('Declined, out loud', {
    x: 1.0, y: 3.88, w: 5.15, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: '9B3A3E', charSpacing: 1.2,
  })
  s.addText(
    [
      { text: 'No OWASP ZAP — 287 MB, and 2.16+ needs Java 17 while this box has 11.', options: { breakLine: true } },
      { text: 'No causal root-cause prose — the published ceiling is 75–80%; a 4-hour agent would lie confidently.', options: { breakLine: true } },
      { text: 'No pixel diffing — anti-aliasing and lazy images make it a false-positive machine.', options: { breakLine: true } },
      { text: 'axe-core covers ~30–40% of WCAG. Zero violations does not mean accessible.', options: {} },
    ],
    { x: 1.0, y: 4.22, w: 5.15, h: 1.6, isTextBox: true, margin: 0, fontFace: B, fontSize: 11, color: '3A4250', lineSpacing: 15, bullet: { code: '2022' } }
  )

  // Verdict
  card2(s, 6.85, 3.65, 5.75, 2.35, 'F4F6F9', 'DFE3EA')
  s.addText('The release decision is a policy file', {
    x: 7.15, y: 3.88, w: 5.15, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: DIM, charSpacing: 1.2,
  })
  chip(s, { x: 7.15, y: 4.25, w: 1.35, text: 'BLOCK', fill: RED, size: 13, h: 0.42 })
  s.addText('G1  productBugs > 0', {
    x: 8.7, y: 4.25, w: 3.6, h: 0.42, isTextBox: true, margin: 0, valign: 'middle',
    fontFace: M, fontSize: 11, bold: true, color: '9B3A3E',
  })
  s.addText(
    'No human decided that, and no model decided it. gate.json did — and you can read it, version it, and review it in a pull request.',
    { x: 7.15, y: 4.85, w: 5.15, h: 0.6, isTextBox: true, margin: 0, fontFace: B, fontSize: 11.5, color: '3A4250', lineSpacing: 15 }
  )
  s.addText('COMPUTED  vs  LLM PROSE  — every figure on screen is badged by origin.', {
    x: 7.15, y: 5.5, w: 5.15, h: 0.3, isTextBox: true, margin: 0, fontFace: M, fontSize: 9.5, color: '6C7686',
  })

  s.addText(
    [
      { text: 'Microsoft gave away the healer. ', options: { color: '5B6270' } },
      { text: 'What we built is the layer that decides whether healing is allowed.', options: { color: INK, bold: true } },
    ],
    { x: 0.7, y: 6.35, w: 11.9, h: 0.4, isTextBox: true, margin: 0, fontFace: H, fontSize: 16 }
  )

  s.addNotes(
    'Lead with the assumption-free number, then the one that needs an assumption with the assumption ' +
    'printed beside it. Volunteering what we declined, and why, is the opposite of a vendor slide — ' +
    'judges discount percentages but respect an engineer who names their own boundaries.'
  )
}

pres.writeFile({ fileName: 'GlassBox-QA.pptx' }).then((f) => console.log('wrote', f))
