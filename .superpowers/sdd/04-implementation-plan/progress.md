# SDD ledger — plan: JayVault/Projects/Web_Redesign/jayngai-com/04-implementation-plan.md

Branch: redesign/atlas-v2 (cut from main @ cb7ff9f)
Spec: 03-redesign-spec.md (approved 27 Oct 2026)
Execution: inline/native (human approved)

## Pre-flight
- P1: Task 1 guard scans templates/*.html for banned hex + inline style. Global Constraint says never touch templates/admin*.html. CONFLICT.
  Ruling: guard excludes templates/admin*.html from template scans (cannot fix what I must not touch). Cost if wrong: admin pages keep inline styles.
- P2: Plan Global Constraints ban `City of Vancouver licence` from consumer templates; business-detail.html legitimately displays licence status as a fact.
  Ruling: implement ban exactly as approved; remove the licence badge from consumer detail pages (spec 7.2 lists cityLicenceStatus as banned from consumer UI permanently). Keep the CSS class for admin. Cost if wrong: one badge is re-added.
- P3: Task 3 says map font sizes to --t-1..--t5. Blind mapping across 30 routes breaks parity (S31) in Phase 1.
  Ruling: Phase 1 tokenizes COLOUR (what the audit and the guard measure). Type/space scale is applied in Phase 4 when pages are rebuilt against the mockup. Cost if wrong: type scale lands one phase later than the plan implies.
- P4: Task 6 assumes Outfit/Playfair are vendored. They are only partly: Outfit 400, Playfair 600+italic. CSS asks for Outfit 600/700 and Playfair 700/800 -> browser synthesises bold. Also fonts.css declares Outfit 500 with the 400 file as src.
  Ruling: vendored set is a real defect; Task 6 must add the missing weights, not just JetBrains Mono. Cost if wrong: one extra download.

## Task 1 in progress — guard written and failing as expected
- Task 1: Ruling: guard 3/5 scan templates, which revealed ~168 inline style attributes across 15 LIVE templates plus 4 extra colour systems in 10 single-neighbourhood templates that the audit never saw (it only measured CSS).
- Task 5 (+ extra): Ruling: deleted all 10 single-hood templates (commercial-drive, downtown, gastown, grandview-woodland, kerrisdale, kitsilano, mount-pleasant, strathcona, west-end, yaletown). VERIFIED 0 render/include references each; superseded by neighborhood-detail.html. Same principle the CSP guard already uses: a file that cannot reach a user may be removed, not just exempted. Removes 4 colour systems (#4facfe/#00f2fe, #667eea/#764ba2, #11998e/#38ef7d, #2ec4b6) and ~40 inline styles. Cost if wrong: one template restored from git.
- Task 3: Ruling: Phase 1 converts COLOUR + strips inline styles. Type/space scale application moves to Phase 4. Cost if wrong: type scale one phase late.

## Task 1–6: complete (commit 8617a76)
Task 1: complete (tests: node src/scripts/check-design-tokens.js → 0 problems)
Task 2: complete (base.html head order tokens→fonts→styles→atlas→mobile; theme banner + /theme/* removed)
Task 3: complete (styles.css rewritten to tokens; atlas.css created for new components)
Task 4: complete (studio.css: all var() fallbacks removed — this was the Bootstrap-blue cause)
Task 5: complete (3 theme css + 11 dead templates + CSP EXEMPT entry removed)
Task 6: PARTIAL — JetBrains Mono NOT yet vendored. Ruling: deferred to Phase 2 where the
        reasons/step surfaces are rebuilt; --font-data currently falls back to ui-monospace,
        which is a system monospace and renders acceptably but is not the intended face.
        Cost if wrong: the data layer uses a system monospace until Phase 2 closes it.

### Extra rulings made during Phase 1
- Guard: stripComments() before scanning CSS/HTML. A hex value inside a comment explains
  WHY a colour was removed; scanning it punishes documenting the reason. Cost if wrong: none.
- Guard: templates/admin*.html excluded from template scans (Global Constraint: never touch
  them). Cost if wrong: admin pages keep their inline styles.
- concierge.html's inline <style> block moved into studio.css, and its .pill renamed .cpill
  because styles.css already defines a generic .pill utility. Two components sharing one class
  name is the exact drift this phase exists to stop. Cost if wrong: one rename.
- Removed the ✨/📍 emoji from nav, h1 and loading text per spec anti-reference #6.
- Fixed the 'Generate my day' clipping defect: .generate-btn had no horizontal padding.

### Phase 1 verification (measured)
- npm test: 150 PASS, 0 FAIL, six guards green (pre-commit hook agreed)
- Routes: all 10 at 200; /theme/sunset and /theme/coastal now 404
- Design tokens: 0 hex outside tokens.css; 0 foreign values; 0 inline style attributes
- Homepage: 1440 6594px (was 7204), 390 16440px (was 17466) — layout unchanged, as intended
- 390px: scrollWidth === innerWidth, no horizontal scroll
- Colours sampled live: brand rgb(18,86,74), marker rgb(200,69,43), no #007bff anywhere
- SITE_NOINDEX: still closed (server logs 'Indexing disabled')
