/**
 * CAPTURE — the one artifact everything else derives from.
 *
 * `ariaSnapshotJSON({mode:'ai'})` gives a semantic tree, but it returns ONLY:
 *     box, children, cursor, disabled, level, name, placeholder, ref, role, url
 * There is no id, no class, no tag. (Verified empirically against Playwright 1.63.0.)
 *
 * That matters twice over:
 *   1. A Similo-style scorer claiming id/class/tag weights from ARIA alone would be
 *      fabricating rows in its own score table.
 *   2. An id-only or class-only change is INVISIBLE to the ARIA tree — two identical
 *      trees. A demo built on ARIA alone silently no-ops on those.
 *
 * The fix is the `aria-ref=` selector engine: once a snapshot has assigned refs, each
 * ref resolves back to the live DOM. So we take one snapshot, then enrich every
 * interactive node with its real tag/id/class/attributes.
 *
 * Measured: snapshot 75ms + parallel enrichment of 120 refs 132ms. ~200ms/page.
 *
 * SECOND GOTCHA, also verified: static text arrives as BARE STRINGS inside `children`,
 * not as {role:'text'} objects. Without the `typeof x === 'string'` branch the flattener
 * silently drops every piece of text on the page.
 */

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'option', 'tab', 'menuitem', 'switch', 'slider', 'searchbox', 'spinbutton',
])

/**
 * Wait for the page to be deterministically settled before snapshotting.
 *
 * Capturing before hydration/lazy-load settles fills the diff with phantom
 * ADDED/REMOVED records, which makes the change detector look broken. We wait on a
 * concrete locator, never `waitForLoadState('networkidle')` — that is discouraged, and
 * Playwright's own healer prompt explicitly forbids it.
 *
 * The animation/caret freezing is the portable half of the stabilization pipeline from
 * the visual-regression suite: generic selectors only, no site-specific constants.
 */
async function settle(page, anchor = 'h1') {
  await page.waitForLoadState('load')
  await page.locator(anchor).first().waitFor({ state: 'visible', timeout: 10000 })
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;
      transition-delay:0s!important;scroll-behavior:auto!important}*{caret-color:transparent!important}
      [class*="spinner"],[role="progressbar"]{visibility:hidden!important}`,
  })
  await page.evaluate(async () => {
    const imgs = Array.from(document.images).filter((i) => !i.complete)
    await Promise.all(
      imgs.map(
        (i) =>
          new Promise((res) => {
            i.addEventListener('load', res, { once: true })
            i.addEventListener('error', res, { once: true })
            setTimeout(res, 3000)
          })
      )
    )
  })
}

/**
 * Flatten the ARIA tree into a table of nodes, carrying the structural context the
 * scorer needs (ancestor roles, sibling position, neighbouring text).
 */
function flatten(tree) {
  const out = []

  /**
   * What a node contributes to its siblings' neighbour-text list.
   *
   * Recurses through UNNAMED wrappers. Markup is full of layout divs that surface as
   * `generic` nodes with no name of their own; if we stopped at them, a control whose only
   * sibling is a wrapper would report no neighbours at all and the 1.5-weight neighbour
   * signal would sit permanently unused.
   */
  function contribution(n, depth = 0) {
    if (typeof n === 'string') return n.trim()
    if (!n || typeof n !== 'object') return ''
    const own = String(n.name || n.text || '').trim()
    if (own) return own
    if (depth >= 3) return ''
    const kids = Array.isArray(n.children) ? n.children : []
    return kids.map((k) => contribution(k, depth + 1)).filter(Boolean).join(' ')
  }

  function walk(node, ancestorRoles, ancestorNames, siblingIndex, neighborTexts) {
    // THE BARE-STRING BRANCH. Do not remove — static text arrives as a raw string.
    if (typeof node === 'string') return
    if (!node || typeof node !== 'object') return

    const kids = Array.isArray(node.children) ? node.children : []
    const ownStrings = kids.filter((k) => typeof k === 'string').map((s) => s.trim()).filter(Boolean)
    const elementKids = kids.filter((k) => k && typeof k === 'object')

    const record = {
      ref: node.ref || null,
      role: node.role || null,
      name: node.name || null,
      text: node.text || (ownStrings.length === 1 ? ownStrings[0] : null),
      url: node.url || null,
      placeholder: node.placeholder || null,
      cursor: node.cursor || null,
      box: node.box || null,
      states: {
        disabled: node.disabled ?? null,
        checked: node.checked ?? null,
        expanded: node.expanded ?? null,
        selected: node.selected ?? null,
        pressed: node.pressed ?? null,
        level: node.level ?? null,
        invalid: node.invalid ?? null,
      },
      ancestorRoles,
      ancestorNames,
      // Nearest named container — e.g. the "Place your order" section. This is the most
      // stable signal there is for a control whose own label just changed, and it is why
      // every interactive element in the SUT lives in its own labelled <section>.
      region: [...ancestorNames].reverse().find(Boolean) || null,
      siblingIndex,
      neighborTexts,
      interactive: INTERACTIVE.has(node.role) || node.cursor === 'pointer',
      tag: null, id: null, cls: null, attrs: null, // filled in by enrich()
    }
    out.push(record)

    // A node's neighbours are its parent's loose text plus what its SIBLINGS contribute —
    // never its own name. Including itself was making a renamed button also "rename" its
    // own neighbourhood, collapsing the one signal that should have survived the change.
    const contributions = elementKids.map(contribution)
    const nextRoles = node.role ? ancestorRoles.concat(node.role) : ancestorRoles
    const nextNames = ancestorNames.concat(node.name || '')

    elementKids.forEach((k, i) => {
      const siblingTexts = ownStrings.concat(contributions.filter((_, j) => j !== i).filter(Boolean))
      walk(k, nextRoles, nextNames, i, siblingTexts)
    })
  }

  const roots = Array.isArray(tree) ? tree : [tree]
  const rootContribs = roots.map(contribution)
  roots.forEach((r, i) => walk(r, [], [], i, rootContribs.filter((_, j) => j !== i).filter(Boolean)))

  return out
}

/**
 * Recover tag/id/class/attributes for each node via the `aria-ref=` selector engine.
 * Parallel: 120 refs in ~132ms. Sequential is 7ms each, which adds up fast.
 */
async function enrich(page, nodes) {
  const targets = nodes.filter((n) => n.ref && (n.interactive || n.role === 'heading'))
  await Promise.all(
    targets.map(async (n) => {
      try {
        const info = await page.locator(`aria-ref=${n.ref}`).evaluate((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: el.className && typeof el.className === 'string' ? el.className : '',
          attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value])),
        }))
        Object.assign(n, info)
      } catch {
        // A ref can go stale if the page moved under us. Leave the ARIA-only record;
        // the scorer treats missing properties as "no signal", not as a zero score.
      }
    })
  )
  return nodes
}

/**
 * Capture one page. Returns { url, nodes[] }.
 */
async function capturePage(page, url, { anchor = 'h1' } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(page, anchor)
  const tree = await page.ariaSnapshotJSON({ mode: 'ai', boxes: true })
  const nodes = flatten(tree)
  await enrich(page, nodes)
  return { url, capturedAt: null, nodes }
}

module.exports = { capturePage, flatten, enrich, settle, INTERACTIVE }
