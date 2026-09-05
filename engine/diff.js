/**
 * DIFF — two ARIA captures in, TYPED CHANGE RECORDS out.
 *
 * Two passes, in this order for a reason:
 *   A. exact match on (ancestorRoles, role, name) — kills ~95% of nodes for free
 *   B. weighted similarity on the residue only
 * Running the scorer over every pair would be quadratic on a real page; the exact pass is
 * what makes this cheap.
 *
 * ROLE_CHANGED is the record type that earns its keep. An <a> becoming a <button> with
 * identical text is PIXEL-IDENTICAL — every screenshot-diff tool on the market reports the
 * page as unchanged — while it breaks every getByRole('link') call in the suite. Verified
 * against Playwright 1.63: the ARIA tree shows `link "Cart"` becoming `button "Cart"` and
 * the `/url` property disappearing.
 *
 * ATTR_CHANGED exists because id and class changes are INVISIBLE to the ARIA tree
 * (verified — the two trees come back byte-identical). Only the DOM-enrichment pass in
 * capture.js sees them, so they are diffed separately here.
 */

const { score } = require('./score')

const sig = (n) => `${(n.ancestorRoles || []).join('>')}|${n.role}|${n.name || ''}`
const RESIDUE_MATCH = 0.55

function diff(before, after) {
  const A = before.nodes.filter((n) => n.role)
  const B = after.nodes.filter((n) => n.role)

  const records = []
  const matched = new Map() // beforeIndex -> afterIndex
  const takenB = new Set()

  // ---- Pass A: exact structural signature ----
  const bySig = new Map()
  B.forEach((n, i) => {
    const s = sig(n)
    if (!bySig.has(s)) bySig.set(s, [])
    bySig.get(s).push(i)
  })

  A.forEach((a, i) => {
    const bucket = bySig.get(sig(a))
    if (bucket && bucket.length) {
      const j = bucket.shift()
      matched.set(i, j)
      takenB.add(j)
    }
  })

  // ---- Pass B: weighted similarity over what's left ----
  const leftoverA = A.map((_, i) => i).filter((i) => !matched.has(i))
  const leftoverB = B.map((_, j) => j).filter((j) => !takenB.has(j))

  for (const i of leftoverA) {
    let bestJ = -1
    let bestScore = 0
    for (const j of leftoverB) {
      if (takenB.has(j)) continue
      const s = score(A[i], B[j]).score
      if (s > bestScore) { bestScore = s; bestJ = j }
    }
    if (bestJ >= 0 && bestScore >= RESIDUE_MATCH) {
      matched.set(i, bestJ)
      takenB.add(bestJ)

      const a = A[i]
      const b = B[bestJ]
      if (a.role !== b.role) {
        records.push({
          type: 'ROLE_CHANGED',
          role: a.role, toRole: b.role, name: b.name || a.name,
          detail: `${a.role} "${a.name || a.text || ''}" is now a ${b.role}` +
            (a.url && !b.url ? ' (and lost its href)' : ''),
          note: 'Pixel-identical — screenshot diffing cannot see this, but it breaks every role-based locator.',
          confidence: bestScore,
        })
      } else if ((a.name || '') !== (b.name || '')) {
        records.push({
          type: 'RENAMED', role: a.role, from: a.name, to: b.name,
          detail: `${a.role} "${a.name}" was renamed to "${b.name}"`,
          confidence: bestScore,
        })
      } else {
        records.push({
          type: 'MOVED', role: a.role, name: a.name,
          detail: `${a.role} "${a.name || ''}" moved within the page`,
          confidence: bestScore,
        })
      }
    }
  }

  // ---- Unmatched ----
  for (const i of A.map((_, i) => i).filter((i) => !matched.has(i))) {
    const a = A[i]
    records.push({ type: 'REMOVED', role: a.role, name: a.name, detail: `${a.role} "${a.name || a.text || ''}" is gone` })
  }
  for (const j of B.map((_, j) => j).filter((j) => !takenB.has(j))) {
    const b = B[j]
    records.push({
      type: 'ADDED', role: b.role, name: b.name,
      detail: `a new ${b.role} "${b.name || b.text || ''}" appeared` +
        (b.states && b.states.disabled ? ' (disabled)' : ''),
    })
  }

  // ---- Attribute drift on matched pairs (ARIA is blind to this) ----
  for (const [i, j] of matched) {
    const a = A[i]
    const b = B[j]
    if (!a.tag && !b.tag) continue
    const changes = []
    if (a.id !== b.id && (a.id || b.id)) changes.push(`id "${a.id || '(none)'}" -> "${b.id || '(none)'}"`)
    if (a.cls !== b.cls && (a.cls || b.cls)) changes.push(`class "${a.cls || '(none)'}" -> "${b.cls || '(none)'}"`)
    if (a.tag !== b.tag && (a.tag || b.tag)) changes.push(`tag <${a.tag}> -> <${b.tag}>`)
    if (changes.length) {
      records.push({
        type: 'ATTR_CHANGED', role: b.role, name: b.name || a.name,
        detail: `${b.role} "${b.name || ''}": ${changes.join('; ')}`,
        note: 'Invisible in the accessibility tree — found by resolving the aria ref back to the DOM.',
      })
    }
  }

  const order = { ROLE_CHANGED: 0, RENAMED: 1, ADDED: 2, REMOVED: 3, ATTR_CHANGED: 4, MOVED: 5 }
  records.sort((x, y) => (order[x.type] ?? 9) - (order[y.type] ?? 9))
  return records
}

/** Map change records to the registry keys they plausibly affect — the impact map. */
function impactedKeys(records, reg) {
  const hits = new Set()
  for (const r of records) {
    for (const [key, entry] of Object.entries(reg)) {
      if (entry.kind !== 'role') continue
      const p = entry.primary
      const fp = entry.fingerprint
      const nameMatches = (v) => v && p.name && String(v).toLowerCase().includes(String(p.name).toLowerCase())

      if (r.type === 'RENAMED' && p.role === r.role && nameMatches(r.from)) hits.add(key)
      else if (r.type === 'ROLE_CHANGED' && p.role === r.role) hits.add(key)
      else if (r.type === 'REMOVED' && p.role === r.role && nameMatches(r.name)) hits.add(key)
      else if (r.type === 'ATTR_CHANGED' && fp && r.name && fp.name === r.name) hits.add(key)
    }
  }
  return [...hits]
}

module.exports = { diff, impactedKeys, RESIDUE_MATCH }
