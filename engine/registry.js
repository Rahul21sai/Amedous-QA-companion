/**
 * REGISTRY — resolution and the single writable seam for healing.
 *
 * THE STRUCTURAL GUARANTEE. `applyRegistryPatch` is the only function in this codebase
 * that writes a locator, and it accepts a registry KEY plus a `primary` descriptor. It has
 * no file handle to `tests/` and no way to address an `expect()` argument. So the healer
 * is not *instructed* to avoid rewriting assertions — it is *incapable* of it.
 *
 * That is the whole answer to "doesn't self-healing just hide real bugs?", and it is
 * enforced by the shape of the write path rather than by a prompt.
 *
 * Second consequence: because specs reference keys, one patched entry fixes every call
 * site with zero AST rewriting — and the key→spec map is an exact change-to-test impact
 * map, for free, with no coverage instrumentation.
 */

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'registry.json')

function load() {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  delete raw._doc
  return raw
}

function save(reg) {
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const merged = { _doc: onDisk._doc, ...reg }
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n')
}

const HEALABLE = (entry) => entry.kind === 'role'

/** Turn a registry entry into a live Playwright locator. */
function locatorFor(page, entry) {
  if (entry.kind === 'css') return page.locator(entry.primary.selector)
  const { role, name, exact } = entry.primary
  if (name == null) return page.getByRole(role)
  return page.getByRole(role, { name, exact: exact !== false })
}

/** Human-readable form, for the UI and for generated code. */
function describe(entry) {
  if (entry.kind === 'css') return `locator('${entry.primary.selector}')`
  const { role, name, exact } = entry.primary
  if (name == null) return `getByRole('${role}')`
  return `getByRole('${role}', { name: '${name}'${exact === false ? ', exact: false' : ''} })`
}

/**
 * THE ONLY WRITER. Accepts a key and a `primary` descriptor — nothing else.
 * Refuses non-healable (assertion) entries outright.
 */
function applyRegistryPatch(key, primary, meta = {}) {
  const reg = load()
  const entry = reg[key]
  if (!entry) throw new Error(`unknown registry key: ${key}`)
  if (!HEALABLE(entry)) {
    throw new Error(
      `refusing to patch "${key}": it is an assertion target (kind=${entry.kind}). ` +
        `Rewriting an assertion to make a test pass would hide a real defect.`
    )
  }
  const from = { ...entry.primary }
  entry.primary = { ...primary }
  entry.healHistory = (entry.healHistory || []).concat([
    { from, to: { ...primary }, score: meta.score ?? null, margin: meta.margin ?? null, reason: meta.reason ?? null },
  ])
  save(reg)
  return { key, from, to: entry.primary }
}

/** Record the fingerprint observed on a green run — this is what healing scores against. */
function recordFingerprints(fingerprints) {
  const reg = load()
  for (const [key, node] of Object.entries(fingerprints)) {
    if (reg[key]) reg[key].fingerprint = node
  }
  save(reg)
  return Object.keys(fingerprints).length
}

module.exports = { load, save, locatorFor, describe, applyRegistryPatch, recordFingerprints, HEALABLE, FILE }
