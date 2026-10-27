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
