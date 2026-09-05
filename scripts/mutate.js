#!/usr/bin/env node
/**
 * Physically mutate the app under test, then make a REAL git commit.
 *
 * This is deliberately not a `?v=2` query flag. Because the edit lands on disk and in
 * git history:
 *   - `git diff` shown on stage is genuine
 *   - the adjudicator's "was this an intentional presentation change or a logic change?"
 *     question is answered by reading real source, not a fixture
 *   - a judge can be handed the keyboard and edit the file themselves
 *
 * Usage:  node scripts/mutate.js <name> [label]
 *         node scripts/mutate.js reset
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'sut', 'public')

const read = (p) => fs.readFileSync(p, 'utf8')
const write = (p, s) => fs.writeFileSync(p, s)

function git(args, { quiet = true } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '')
  }
}

/** Replace in a file, and fail loudly if the anchor was not found. */
function edit(file, find, replace, what) {
  const before = read(file)
  if (!before.includes(find)) {
    throw new Error(`anchor not found in ${path.relative(ROOT, file)} — ${what}\n  looked for: ${find.slice(0, 90)}`)
  }
  write(file, before.split(find).join(replace))
}

// ---------------------------------------------------------------------------

const MUTATIONS = {
  'rename-cta': {
    // Presentation-layer change. The adjudicator should classify this INTENTIONAL and
    // permit a heal.
    kind: 'presentation',
    describe: (label) => `rename checkout CTA to "${label}"`,
    apply(label) {
      const file = path.join(PUB, 'checkout.html')
      const html = read(file)
      // Anchored on class + type, never on the id, so this still works after `strip-ids`.
      const m = /(<button class="btn btn--primary"[^>]*type="submit">)([^<]*)(<\/button>)/.exec(html)
      if (!m) throw new Error('could not find the place-order button in checkout.html')
      if (m[2].trim() === label.trim()) throw new Error(`the button is already labelled "${label}"`)
      write(file, html.replace(m[0], `${m[1]}${label}${m[3]}`))
      return `"${m[2]}" -> "${label}"`
    },
  },

  'link-to-button': {
    kind: 'presentation',
    describe: () => 'change the cart nav from a link to a button',
    apply() {
      let touched = 0
      for (const f of ['index.html', 'cart.html', 'checkout.html', 'confirm.html']) {
        const file = path.join(PUB, f)
        const html = read(file)
        const next = html.replace(
          /<a class="nav-cart" id="cart-link" href="\/cart">([\s\S]*?)<\/a>/g,
          '<button class="nav-cart" id="cart-link" type="button" onclick="location.href=\'/cart\'">$1</button>'
        )
        if (next !== html) { write(file, next); touched++ }
      }
      if (!touched) throw new Error('cart link already converted (run reset first)')
      return `link -> button across ${touched} page(s); role changed, pixels identical`
    },
  },

  'decoy-button': {
    kind: 'presentation',
    describe: () => 'add a near-identical "Place Order Later" button',
    apply() {
      const file = path.join(PUB, 'checkout.html')
      const html = read(file)
      if (html.includes('Place Order Later')) throw new Error('decoy already present (run reset first)')
      // The decoy deliberately carries NO id, so it can never masquerade as the real
      // element's identity anchor. It competes on similarity only, which is the point.
      const m = /( *)(<button class="btn btn--primary"[^>]*type="submit">)/.exec(html)
      if (!m) throw new Error('could not find the place-order button in checkout.html')
      write(
        file,
        html.replace(
          m[0],
          `${m[1]}<button class="btn btn--ghost" type="button">Place Order Later</button>\n${m[1]}${m[2]}`
        )
      )
      return 'added "Place Order Later" — a near-twin competing on similarity alone'
    },
  },

  'strip-ids': {
    // Realistic, not contrived: plenty of design systems and CSS-in-JS setups emit no
    // stable ids at all, or regenerate them with a build hash. With no id to anchor on,
    // the identity override cannot fire and the scorer has to rely on similarity alone —
    // which is exactly when the ambiguity gate earns its keep.
    kind: 'presentation',
    describe: () => 'remove stable ids from the checkout buttons',
    apply() {
      const file = path.join(PUB, 'checkout.html')
      const html = read(file)
      const next = html
        .replace(' id="place-order-btn"', '')
        .replace(' id="place-order-later-btn"', '')
      if (next === html) throw new Error('checkout button ids already stripped (run reset first)')
      write(file, next)
      return 'checkout buttons no longer carry ids — healing must fall back to similarity'
    },
  },

  'break-total': {
    // LOGIC change. The adjudicator must classify this a PRODUCT BUG and refuse the heal.
    kind: 'logic',
    describe: () => 'drop the tax term from calcTotal()',
    apply() {
      edit(
        path.join(ROOT, 'sut', 'pricing.js'),
        '  return sub - discount + tax',
        '  return sub - discount',
        'calcTotal return statement'
      )
      return 'calcTotal() no longer adds tax — every locator still resolves, only an assertion fails'
    },
  },

  'drop-audit-log': {
    kind: 'logic',
    describe: () => 'remove the failed-login audit write',
    apply() {
      edit(
        path.join(ROOT, 'sut', 'server.js'),
        '  if (!ok) audit(`LOGIN_FAILED email=${req.body.email}`)',
        '  // audit write removed',
        'failed-login audit call'
      )
      return 'failed logins are no longer audited — OWASP A09:2025'
    },
  },
}

// ---------------------------------------------------------------------------

function main() {
  const [, , name, ...rest] = process.argv
  const label = rest.join(' ').trim()

  if (!name || name === '--help') {
    console.log('usage: node scripts/mutate.js <name> [label]\n')
    console.log('  reset                        revert sut/ to the committed baseline')
    for (const [k, m] of Object.entries(MUTATIONS)) console.log(`  ${k.padEnd(28)} ${m.describe(label || '<label>')}`)
    process.exit(0)
  }

  if (name === 'reset') {
    // Restore from the PRISTINE TAG, not from HEAD. Once a mutation has been committed,
    // HEAD contains the mutation, so `git checkout -- sut/` would restore the broken
    // version and reset would silently do nothing.
    const tag = git(['rev-parse', '--verify', 'pristine']).trim()
    if (!tag || tag.startsWith('fatal')) {
      console.error('no "pristine" tag. Create it once:  git tag pristine <baseline-sha>')
      process.exit(1)
    }
    git(['checkout', 'pristine', '--', 'sut/'])
    git(['add', 'sut/'])
    // History stays append-only, so the full sequence of what was broken and reverted is
    // still on screen in `git log` during the demo.
    const dirty = git(['diff', '--cached', '--name-only']).trim()
    if (dirty) {
      git(['commit', '-m', 'chore(sut): reset to pristine', '--no-verify'])
      console.log(`reset: sut/ restored from tag pristine (${tag.slice(0, 7)}) and committed`)
    } else {
      console.log('reset: sut/ already matches pristine — nothing to do')
    }
    return
  }

  const mutation = MUTATIONS[name]
  if (!mutation) {
    console.error(`unknown mutation "${name}". Known: reset, ${Object.keys(MUTATIONS).join(', ')}`)
    process.exit(1)
  }

  let effect
  if (name === 'rename-cta') {
    const chosen = label || 'Complete Purchase'
    effect = mutation.apply(chosen)
  } else {
    effect = mutation.apply()
  }

  // A real commit, so `git diff HEAD~1` is real for the adjudicator.
  git(['add', 'sut/'])
  const msg = `${mutation.kind === 'logic' ? 'fix' : 'style'}(sut): ${mutation.describe(label)}`
  git(['commit', '-m', msg, '--no-verify'])
  const sha = git(['rev-parse', '--short', 'HEAD']).trim()

  console.log(`applied ${name} [${mutation.kind}]`)
  console.log(`  ${effect}`)
  console.log(`  committed ${sha}: ${msg}`)
}

main()
