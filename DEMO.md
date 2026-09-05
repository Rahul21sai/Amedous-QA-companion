# The 5-minute demo

## Before you walk on

```bash
npm run demo          # starts SUT :4300 and dashboard :4400
npm run baseline      # MUST be done before the audience is watching
```

Two windows: **dashboard** at `localhost:4400`, **break panel** at `localhost:4300/break`.

Verify: 6/6 green, verdict WARN, `git log --oneline` clean. Then `node scripts/mutate.js reset`.

**Rehearse the `off` LLM path.** It is the default and it works — don't discover that live.

---

## Open with the number, not the architecture

> "I work on IBM.com's CMS. Our Cypress suite has **5,480 `cy.get()` calls across 229 spec files, and 4,494 of them — 82% — are hardcoded selector strings.** That's the maintenance problem. Not in theory."

Then set the frame immediately, because a QA judge is already thinking it:

> "Playwright ships a planner, a generator and a healer. Microsoft gave that away. So we didn't build another healer — we built **the layer that decides whether healing is allowed.**"

---

## 0:00–0:45 · Their own diagram, running

Point at the flow strip. *"This is the diagram you drew on the whiteboard."*

Click **Run Baseline**. Nodes light left to right on real events. 6/6 green.

> "That green run is doing something specific: it records what every element looked like. Self-healing has a cold start — no fingerprint, nothing to compare against, and the whole mechanism silently does nothing. So the baseline isn't a formality."

Verdict lands on **WARN**, not GO. Own it:

> "It says WARN because this app genuinely has known security debt, and I'd rather show you three honest states than a green light on a vulnerable app. New findings block. Known debt warns. That's how real gating works."

---

## 0:45–1:45 · Hand over the keyboard

Open `localhost:4300/break`. Give them the mouse.

> "Type anything you want as the label for the checkout button. Your words, not mine."

They type. Then show `git log --oneline` — a real commit.

> "That edited the actual HTML file and committed it. Not a query flag. Which is why I can let you do it."

Click **Run**.

- Change Detection: `RENAMED button "Place Order" → "<their text>"`
- Risk Selection: **2 of 6** — *"the registry tells us exactly which tests touch that element. No coverage instrumentation."*
- 2 fail → heal → 2 pass

Open the **Heal Inspector**. This is the moment. Let them read it.

> "Fifteen properties, each weighted, each contributing. The score is the sum divided by the weight total — and the panel checks that the rows add up to the number beside them. **Nobody who faked this can produce arithmetic you can add up in your head.**"

Point at `no signal`:

> "Neither version has an href, so that row scores nothing — it's excluded from the denominator rather than given free marks. Getting that wrong is how you get confident wrong heals."

Then the diff: `- getByRole('button', {name: 'Place Order'})` → `+ getByRole('button', {name: '<their text>'})`, and the ROI line: **N test files a human would edit vs 1 registry key.**

---

## 1:45–2:30 · The one visual regression can't see

```bash
node scripts/mutate.js reset && npm run baseline
node scripts/mutate.js link-to-button
```

> "This changes an `<a>` into a `<button>`. Same text, same CSS class, same position. **It is pixel-identical** — Percy, Applitools, every screenshot differ on the market reports this page as unchanged. And it breaks every `getByRole('link')` call in the suite."

Run. `ROLE_CHANGED: link "Cart" is now a button (and lost its href)`. 3 specs break, cluster to **one** root cause, heal, 3 pass. **67% fewer file edits.**

Note the badge on the card:

> "It says *identity override*. The score was only 0.73, because when a link becomes a button it loses the role and tag points — the correct element can actually score below an unrelated sibling that kept its `<a>`. But the `id` never changed and matches exactly one element. **A unique unchanged id is identity, not similarity**, so we heal and we say why on screen."

### Optional: the ambiguity gate

```bash
node scripts/mutate.js decoy-button
node scripts/mutate.js rename-cta "Place Order Now"
```

Two buttons: `Place Order Now` (0.857) and `Place Order Later` (0.838). Margin 0.019.

> "It **escalated instead of healing** — and notice its top pick was actually right. It still refused, because a 0.019 margin isn't confidence, it's a coin flip. Healenium ships an absolute threshold. Similo ships argmax. Both would have silently bound to the winner, and if they'd picked wrong you'd have a permanently green test asserting nothing. That's the failure mode nobody in this market talks about."

---

## 2:30–3:15 · The refusal — this is the actual wow

```bash
node scripts/mutate.js reset && npm run baseline
node scripts/mutate.js break-total
```

> "Now I'm going to break the product, not the UI. The order total quietly stops adding tax."

Run. First, point at Change Detection:

> "**No semantic changes detected** — and that's correct. Nothing about the UI moved. No visual tool, no ARIA diff, nothing structural catches this. Only an assertion does."

T04 and T05 fail. Then the heal card:

> "`PRODUCT_BUG`. `HEAL NOT ATTEMPTED`. Not 'attempted and failed' — **never attempted.** Every locator resolved perfectly; the failure was a value. Adjusting the test to accept $1125 would have hidden the defect."

Then land it architecturally:

> "And this isn't a prompt telling it to behave. The healer's only writer takes a registry key and refuses assertion targets outright. **It holds no file handle to the test files.** It structurally cannot rewrite an assertion."

AC-3 flips to **fail**, G1 fires, verdict flips to **BLOCK**.

> "One named reason. No human decided that and no model decided it — `gate.json` did, and you can read it, version it, and review it in a PR."

---

## 3:15–4:15 · Security, accessibility, performance

All findings are planted defects, so every one is a true positive by construction.

- **A05 Injection** — *"We don't grep for our payload in the response. We install a binding and wait for the browser to call us back. A JavaScript callback that actually fired cannot be a false positive."*
- **A01 Broken Access Control** — *"We recorded every request the authenticated session made, replayed each one with no cookie. `/api/admin/orders` returned 200. Here's the curl."*
- **A03 Supply Chain** — *"jQuery 3.4.1, read off the running page via retire.js's own extractor, matched to two real CVEs with GHSA IDs."*
- **A02** — missing CSP and HSTS, `x-powered-by`, session cookie with no HttpOnly.

Volunteer the boundary before anyone asks:

> "No OWASP ZAP. It's a 287MB download and 2.16+ needs Java 17; this machine has 11. We swapped a 287MB Java DAST for five checks that run in eight seconds. And axe only catches machine-checkable rules — about 30–40% of WCAG. Zero violations does not mean accessible."

Performance: real TTFB, FCP, LCP, CLS from Navigation Timing and PerformanceObserver. *"No Lighthouse — 15 to 30 seconds a page for a number I can get honestly in 200 milliseconds."*

---

## 4:15–5:00 · Close on the honest numbers

Point at the provenance badges.

> "Every figure carries `COMPUTED` because code in this repo computed it. The LLM badge says `off` — the whole thing runs with no model at all. When it is on, it may only re-rank candidates the deterministic scorer already found; it never writes a selector, and if it disagrees the arithmetic wins."

Two ROI numbers, weakest assumption first:

> "**No assumption:** 3 test files a human would have edited, 1 registry key we edited — 67% fewer file edits, computed from the run you just watched.
> **With an assumption:** 36 engineer-minutes, assuming 12 minutes per manual fix — and I'm printing the 12 next to it, because a percentage you can't interrogate is a vendor slide."

Flake claim:

> "I'm not going to say zero flakes. I ran the healed suite five times, it passed five times, about nine seconds a run. That's the claim I can defend."

Final line:

> "Microsoft gave away the healer. What we built is the layer that decides whether healing is **allowed** — a gate you can see the arithmetic of, an ambiguity rule that refuses to guess, and a refusal path that blocks the release instead of lying to you. Release decision: BLOCK. One reason. One owner."

---

## If something breaks

| Problem | Do this |
|---|---|
| Dashboard blank or WS dead | `node engine/run.js` in a large-font terminal. Every number is identical. Say the UI is a reader, not the product. |
| Heal scores below the gate | *"It just told you it isn't confident enough — that is the entire point."* Pivot to the refusal beat; it's stronger anyway. |
| `chromium.launch()` fails | Already handled — `channel: 'chrome'`. Fallback `npx playwright install chromium`. |
| Anything wedged | `node scripts/mutate.js reset && npm run baseline` |

**Never skip the baseline after a reset.** Without fingerprints, healing silently no-ops with no error.
