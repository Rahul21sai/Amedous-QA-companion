# GlassBox QA

### Self-healing tests that refuse to lie.

Autonomous Quality Engineering for the AI Development Era.

---

## The thesis

Playwright already ships a planner, a generator, and a healer. Competing with the healer is not a product.

**The product is the layer that decides whether healing is _allowed_:** a confidence gate whose arithmetic is on screen, a classifier that can tell a broken locator from a broken product, and a hard refusal path that blocks a release rather than turning a suite green over a real bug.

Everyone in QA has shipped a bug behind a green suite. The dangerous tool is not the one that fails — it's the one that makes a broken test pass.

---

## Quick start

```bash
npm install
npm run demo
```

Then open **http://localhost:4400** (dashboard) and **http://localhost:4300/break** (the panel that breaks the app).

```bash
npm run baseline    # MUST run first — records the fingerprints healing scores against
npm run run         # detect changes, select, run, heal, validate, decide
npm test            # 14 unit tests on the scorer, gate and classifier
npm run probe       # offline heal oracle, no browser
```

> **The baseline is not optional.** Self-healing has a cold start: with no recorded fingerprint there is nothing to score against and the whole mechanism silently no-ops. `npm run baseline` also restores canonical locators from `registry.seed.json`, so every rehearsal starts from the same known-good state.

---

## What actually happens

```
App under test ──► Change Detection ──► AI QA Engine ──► Quality Validation ──► Release Decision
                                        ├ Risk Selection    ├ UI
                                        ├ Self-Healing      ├ Security (OWASP 2025)
                                        └ Re-run            ├ Accessibility
                                                            └ Performance
```

1. **Capture** — one `ariaSnapshotJSON` per page, then each `ref` resolved back to the DOM for `tag`/`id`/`class`. One artifact drives healing, change detection, the a11y pre-screen and the element inventory.
2. **Diff** — two-pass matcher emits typed records: `RENAMED`, `ROLE_CHANGED`, `ADDED`, `REMOVED`, `ATTR_CHANGED`.
3. **Select** — records map to registry keys, keys map to specs. An exact impact map with no coverage instrumentation.
4. **Run → classify → heal → re-run** — with the gate below.
5. **Validate** — security, accessibility, performance.
6. **Decide** — `gate.json` evaluates to GO / WARN / BLOCK.

---

## The gate

| Condition | Action |
|---|---|
| unique unchanged `id` matching exactly one element | **AUTO-HEAL** — identity, not similarity |
| score ≥ 0.85 **and** margin over runner-up ≥ 0.15 | **AUTO-HEAL** |
| score ≥ 0.60, margin < 0.15 | **ESCALATE** — two plausible candidates, so do not guess |
| 0.60 ≤ score < 0.85 | heal, flagged for review |
| score < 0.60 | **REFUSE** |
| failure is an assertion **value** mismatch | **NEVER ATTEMPTED** — product bug |

**The margin rule is the differentiator.** Healenium ships only an absolute score-cap of 0.6; Similo ships only argmax. Neither can distinguish `Place Order` from `Place Order Later` — both bind to whichever scores marginally higher, and you get a permanently green test asserting nothing. Requiring a margin detects that and escalates.

Thresholds live in `engine/gate.json` and are rendered on screen. A threshold you cannot see is a threshold you cannot audit.

### Why the score table is the point

Every heal renders its own arithmetic — 15 weighted properties (weights from [arXiv:2208.00677](https://arxiv.org/abs/2208.00677)), each row's contribution, and the sum. The UI checks that the rows add up to the displayed total and says so.

```
property              w     sim   points   status
role                1.5    100%   +1.500   match
accessible name     1.5     20%   +0.300   partial
tag                 1.5    100%   +1.500   match
visible text        1.5   no signal   —     no-signal
neighbour texts     1.5    100%   +1.500   match
is interactive      1.5    100%   +1.500   match
containing region   1.5    100%   +1.500   match
id                  0.5    100%   +0.500   match
...
TOTAL              12.5           11.043
score = 11.043 / 12.5 = 0.8835   rows sum to 11.043 — matches, the table is honest
```

A property with **no signal on either side is excluded from both numerator and denominator** — it does not silently score full marks. That is the trap in Healenium's constants: awarding full points when neither side has a class inflates scores on attribute-less elements and produces confident wrong heals.

### Why it structurally cannot hide a bug

Specs name **registry keys**, never selectors:

```js
{ action: 'click', key: 'checkout.placeOrder' }
```

`registry.applyRegistryPatch(key, primary)` is the only function that writes a locator. It accepts a registry key and refuses `kind: 'css'` entries outright. The healer holds **no file handle to `tests/`**, so it cannot rewrite an `expect()` argument or an expected value. That is architecture, not a prompt instruction.

Assertion targets (totals, amounts) are `kind: 'css'` and are **not healable, by construction**.

---

## Try it

```bash
npm run baseline

node scripts/mutate.js rename-cta "Anything You Like"   # → AUTO-HEAL, arithmetic on screen
node scripts/mutate.js link-to-button                   # → ROLE_CHANGED (pixel-identical)
node scripts/mutate.js strip-ids                        # no stable ids, as many design systems do
node scripts/mutate.js decoy-button                     # a near-twin candidate
node scripts/mutate.js break-total                      # → PRODUCT BUG, refuses, BLOCK
node scripts/mutate.js drop-audit-log                   # → OWASP A09:2025
node scripts/mutate.js reset                            # back to the pristine tag
```

Mutations compose. `strip-ids` + `decoy-button` + `rename-cta` removes every identity anchor and leaves two near-twin buttons, which is the case that makes the **ambiguity gate** fire:

```
best candidate: button "Place Order Now"   @ 0.8171
runner-up:      button "Place Order Later" @ 0.8096   margin 0.0076
DECISION ESCALATED_AMBIGUOUS — picking one would be a guess.
```

Every mutation **edits a real source file and makes a real git commit** — not a `?v=2` query flag. That is what makes `git diff` real, and it is what lets you hand someone else the keyboard.

`ROLE_CHANGED` is the one worth pausing on: an `<a>` becoming a `<button>` with identical text is **pixel-identical**, so every screenshot-diff tool reports the page as unchanged — while it breaks every `getByRole('link')` call in the suite.

---

## Verified platform facts

Each of these was executed on the dev machine, not assumed.

| Fact | Consequence |
|---|---|
| Playwright 1.63 requires Chromium **1243**; local cache had **1228** | `chromium.launch()` fails cold. Use `channel: 'chrome'` — 315ms, zero download. |
| `ariaSnapshotJSON` returns only `box, children, cursor, disabled, level, name, placeholder, ref, role, url` | **No `id`, `class` or `tag`.** A Similo scorer claiming those weights from ARIA alone is fabricating rows. |
| `page.locator('aria-ref=e7').evaluate(...)` resolves a ref to the live DOM | Recovers `tag`/`id`/`class`/attrs. 120 refs in **132ms** in parallel (7ms each sequentially). |
| Static text arrives as **bare strings** in `children`, not `{role:'text'}` | The flattener needs a `typeof x === 'string'` branch or it drops all text. |
| `id`/`class` changes leave the ARIA tree **byte-identical** | Caught only by the DOM-enrichment pass. |
| `require()` caches JS while HTML is read fresh | `sut/server.js` hot-reloads `pricing.js` per request, or a logic mutation is invisible to the running server. |

## What this deliberately does not do

- **No OWASP ZAP.** 287MB Docker-free download, and 2.16+ needs Java 17 while the machine has 11.0.21. Five targeted checks run in ~8 seconds instead.
- **No Docker, no Kubernetes, no load testing, no mobile/real-device.**
- **No causal root-cause prose.** mabl published the ceiling: ~100% on symptom detection, 75–80% on root cause with a purpose-built agent. A short-build agent is worse and would state a wrong cause confidently. We claim detection and verified repair.
- **No pixel diffing.** Anti-aliasing, font hinting and lazy images make it a false-positive machine, and baseline *management* is the real problem. The `ROLE_CHANGED` story is precisely that we catch what pixels cannot.
- **axe-core covers machine-checkable rules only — roughly 30–40% of WCAG.** Zero violations does not mean accessible.

## Security checks (all true positives by construction)

Every defect is deliberately planted in `sut/`, so ground truth is known and nothing is hand-waved. All checks run against localhost — no attack traffic leaves the machine.

| OWASP 2025 | Check |
|---|---|
| A01 Broken Access Control | Record every request during an authenticated run, replay through a cookie-less context. Any 200 is real, with a repro curl. |
| A02 Security Misconfiguration | Response headers (CSP, HSTS, nosniff, frame-options, referrer-policy), `x-powered-by`, cookie flags. |
| A03 Software Supply Chain | jQuery version read **off the running page** via retire.js's own extractor, semver-matched to real CVE/CWE/GHSA. |
| A05 Injection | `page.exposeBinding` **execution oracle** — we don't grep for the payload in the response, we wait for the browser to call us back. A callback that fired cannot be a false positive. |
| A09 Logging Failures | A failed login must produce an audit entry. |

New findings block; findings accepted into the baseline warn. That is how real DAST gating works — a panel that cries wolf on known debt gets ignored.

## Measuring maintenance reduction

Two numbers, and the assumption travels with the one that needs it:

- **No assumption:** *N* spec files a human would have edited vs **1** registry key we edited. Computed from the run.
- **With assumption:** engineer-minutes saved, with the minutes-per-fix assumption printed beside it.

Flake claim: *"we ran the healed suite 5 times and it passed 5 times"* — verified, 5/5, ~9s per run. Not "zero flakes".

## LLM (optional by design) — IBM ICA

Configured in `.env` (gitignored). Node 22 loads it natively, no `dotenv` dependency.

```bash
ICA_API_KEY=<paste your key>
ICA_BASE_URL=https://<your-ica-host>/ica/v1/chat-models
ICA_MODEL=claude-sonnet-5
GLASSBOX_LLM=off          # off | record | replay
```

```bash
npm run llm:probe         # verify the endpoint and detect its wire format
```

**Modes.** `record` calls live and caches every response; **`replay` serves only from cache** — zero network, zero latency, zero variance, which is what you want on stage; `off` uses deterministic template prose. Default is `off`, and **`off` is a fully working path, not a degraded one** — an ICA endpoint needs the corporate network, which conference wifi will not have, so nothing in the demo may depend on a network call.

The badge on screen says not just the mode but the **reason** — e.g. `LLM: off — ICA_API_KEY is empty`. A badge reading only "off" invites *"is the AI part even real?"*; one that names the cause answers it.

### What the probe established about this endpoint

`/ica/v1/chat-models` is **not** the OpenAI `/v1/chat/completions` path, so rather than guess, `scripts/llm-probe.js` tests candidate shapes against the live endpoint. Findings:

| Route | Status | Meaning |
|---|---|---|
| `…/definitely-not-a-real-route-xyz` | 404 `{"detail":"Not Found"}` | **control** |
| `…/chat/completions` | 400 `{"error":"Invalid icaKey"}` | **exists** — reached auth |
| `…/models` | 400 `{"error":"Invalid icaKey"}` | exists |
| `…/completion`, `…/{model}/completion`, `…/{model}/invoke` | 404 | do not exist |

A 400 rather than a 404 means the route resolved and only the credential was rejected. So **this deployment is OpenAI-compatible**: `POST {base}/chat/completions` with `{messages:[...]}`. That's pinned as `GLASSBOX_LLM_SHAPE=openai`.

The auth header could **not** be identified from outside: `Authorization: Bearer`, bare `Authorization`, `icaKey`, `Integration-Id`, `api-key`, `x-api-key` and *sending no header at all* all return the identical generic `Invalid icaKey`. So the client sends the key in every plausible header at once — servers ignore headers they don't recognise, which removes the guess at no cost.

### The model's authority is deliberately narrow

It **never writes a selector**. It may only re-rank candidates the deterministic scorer already produced, and if it disagrees, **the scorer's answer is kept** and the disagreement recorded. Raw DOM is never sent — only the 5–30 typed change records. Every figure on screen is badged `COMPUTED` or `LLM PROSE`.

## Layout

```
sut/          the app under test + planted defects (a fixture, not the product)
engine/       capture · score · diff · heal · classify · registry · gate · llm · run
probes/       security · a11y · perf
tests/        declarative specs + acceptance criteria
dashboard/    pure WebSocket reader, zero business logic
scripts/      mutate.js (real edits + real commits) · probe-heal.js (offline oracle)
```

The dashboard computes nothing. If it breaks, `node engine/run.js` prints a complete verdict JSON with all the same numbers. The story survives a missing UI; it does not survive a missing engine.
