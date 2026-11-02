# VDMVP v2 — specification

Status: **draft, awaiting greenlight**. Written 2026-11-02 from the audit in
`.audit/` and Jay's answers on scope, brand and technical policy. The schema,
photography and agent-surface detail lives in
`.audit/schema-and-photos-plan.md`; this document states the decisions, that one
carries the measurements and the field-level instructions.

The spec is the contract. After greenlight, any disagreement between this document
and the code returns to Jay rather than being resolved silently.

---

## 1. Scope and boundaries

**In scope:** every visitor-facing template in `templates/`, the five CSS layers in
`public/`, the composer and its result surface (`public/studio.js`), the concierge
engine's planning behaviour (`src/lib/concierge.js`), the directory and district
surfaces, the business detail layout, the page shell (header, footer), and the
indexing surface (sitemap, slugs, schema, robots).

**Preserved exactly:**

- **Routes and information architecture.** No page is removed. The 31 business URLs
  whose slugs carry `&` or accented characters are replaced by ASCII slugs, each
  with a permanent redirect from the old URL (`/businesses/tv-dinner-market-&-café`
  to `/businesses/tv-dinner-market-and-cafe`).
- **Brand tokens.** Pine `#12564A`, warm paper `#F4F1EA`, ink `#10231F`, marker red
  `#C8452B` as a graphic accent only; Playfair Display, Outfit, JetBrains Mono. No
  new colour enters `tokens.css`. Colour is not the layout; layout is free.
- **Legal text.** The attribution block in `templates/_attribution.html` and the
  footer's licence sentences keep their wording verbatim. Presentation may change.
  Wording may not.
- **The stand-in disclosure.** `templates/_listing-photo.html` prints the stand-in
  caption unconditionally, even when the attribution field is empty. That
  behaviour is a safety property, not a style choice, and it stays.
- **The claim flow** (`/claim`, `/claim/thanks`, `src/routes/claims.js`) keeps its
  behaviour and its promise. Only its visual presentation changes.
- **The privacy page** keeps its content.
- **The check gate.** `npm run check` remains the definition of done. Where a task
  changes a class name or a string the gate asserts, the assertion is updated in the
  same task. No assertion is deleted to make a change pass.

**Out of scope, explicitly:**

- Pricing, ratings, review counts, booking or commerce of any kind. The site
  states it will not show what free data cannot confirm, and that stands.
- Authentication, user accounts, a CMS, analytics or tracking changes.
- Database schema changes, except the per-branch identity work in §5, which needs
  its own approval before any migration runs.
- Scraping or bulk-importing photography. Photos are sourced by a reviewed
  workflow, not harvested.
- Internationalisation, a native app, or a design system beyond this site.
- Any new runtime dependency not named in this document.

---

## 2. Design direction

**Name: Atlas, tightened.**

The current site is already not AI slop. It has one hue, three typefaces doing
distinct jobs, rules instead of shadows, and three section shapes that differ. The
problems are residue, not direction: a hero band that holds a card, a table that
drops a column, a sticky header that eats a third of a phone, and a hero feature
whose result looks like a form output rather than a route.

What changes is where the weight sits.

- **The composer is the page.** On `/` the headline shrinks after a plan is built
  and the result occupies the hero band. The feature is the product, so it lives
  where the attention already is instead of 700px below it.
- **Timetable, not cards, for a route.** Stops become rows on rules with times in a
  fixed monospace gutter. A walking day is a schedule; it should read like one.
- **Rules stay, radius does not spread.** `--radius: 0` governs rows, tables,
  panels. The composer keeps `--radius-card: 18px` because it is the one
  conversational surface. No new rounded cards.
- **Status is type first.** "Open till 9:30 pm" in ink with one small marker dot,
  not a green pill. Colour is never the only carrier of meaning.
- **Photography is full-bleed and captioned.** 4:3, one scrim for labels, a 12px
  caption that names the stand-in. No overlapping card-on-photo compositions.
- **Mobile is a different shape, not a narrower one.** 56px header with a menu,
  a full-bleed composer, single-column results, the map after the second stop.

**Type and spacing:** unchanged tokens. Display sizes step down on mobile
(68→40, 48→34, 34→26). Spacing stays on `--s1..--s6`; no new increments.

**Motion budget:** opacity and transform only, 200ms, `--ease`. The result surface
fades in over 120ms. Nothing animates layout, nothing parades, no parallax.
`prefers-reduced-motion: reduce` removes all of it.

**References** (my picks, replaceable): a printed city guide's front matter, a
transit timetable, a newspaper's data page. What they share is a fixed grid,
figures that line up, and a single display face doing the shouting.

**Anti-references** (named so nobody has to guess): gradient hero over a dark
photo; three identical feature cards; glassmorphism; emoji as iconography; a
"Trusted by" logo row; animated counters; a floating pill nav; a hero that shows a
laptop mockup; indigo-to-purple anything.

---

## 3. Prioritised design fixes

### Home `/`

1. **Composer sits above the fold and results replace the band.** Today the dock
   is a card inside a 460px dark band and the result renders in a separate
   container below it, so a built plan pushes the page down rather than taking the
   stage. Files: `templates/index.html`, `public/studio.css`, `public/atlas.css`.
2. **The photo stat goes.** "400 Photographed so far" counts stock files
   downloaded, not venues photographed: 400 files are 20 distinct pictures, and no
   photograph of a listed venue exists in the database today. The tile is removed,
   leaving places, districts and itineraries, until real coverage exists. Wording
   and the path back in are set in §5.
3. **"Open →" stops doing three jobs.** The action column, the "Open now" filter
   and the "Opens 9 am" status all say open. The action becomes "View".
4. **The footer's licence stack** moves into a disclosure that keeps every sentence
   verbatim and shows three lines by default.

### Directory `/businesses`

5. **The sixth column exists.** `.atlas-row` defines five tracks while the markup
   supplies six children, so every row drops its action under the rank number.
   Fix in `public/atlas.css`; row anatomy also gains a 56px thumbnail slot.
6. **Mobile sort control is wide enough for its own labels.**
   "Most complete first" currently truncates to "Most complete firs" at 375px.
7. **Counts use the existing `num` filter.** `2958` becomes `2,958`.
8. **Filters collapse behind a "Filters" button below 600px**, with the active
   filter chips visible and removable.

### District `/neighborhoods/:slug`

9. **Body measure.** `p.body-lede` is 820px at 16.5px, about 104 characters per
   line. Cap at 68ch; keep the cards as they are at 47ch.
10. **Masthead height.** The 240px dark band holding one word collapses to a
    compact header that carries the district, the place count and a breadcrumb.

### Business `/businesses/:slug`

11. **Structure.** The page has no H2 and 86 words. It gains sections with real
    headings: the listing facts, the branch it belongs to, and what to expect
    nearby, all generated from data the database already holds.
12. **Branch named in the identity.** "Ajiya Sushi" becomes "Ajiya Sushi,
    Kitsilano" in the H1 and the breadcrumb, so a visitor knows which branch
    they are being sent to. Ties to §5.
13. **Coordinates row removed** from the public view unless the map needs it.
14. **Card width.** The 1,200px card keeps its grid but the definition list takes
    the full measure it currently wastes.

### Every page

15. **Header: 260px is not a header.** Below 600px the bar is 56px, holds the
    wordmark and a menu button, and the six links move into that menu. The
    existing loopback admin, the search affordance and the claim link stay
    reachable.
16. **Tap targets.** `.composer-chip` (30px) and `.atlas-more` (29px) come up to
    the 44px `mobile.css` already states for everything else.
17. **Focus.** A visible 2px focus ring on the pine at 3:1 against both surfaces.

---

## 4. Prioritised technical fixes

### Accessibility first

| fix | target | where |
|---|---|---|
| label the two unlabelled search inputs | every input has an accessible name | `templates/neighborhoods.html:13`, `templates/itineraries.html:13` |
| give `#neighborhood` a visible label | accessible name contains the visible value | `templates/concierge.html:64` |
| fix three H1→H3 skips | no skipped level | `/claim`, `/itineraries`, `/neighborhoods` |
| 44px touch targets | zero elements under 44px at 320 | `mobile.css` |
| map has a text alternative | route summary in text, map `role="img"` labelled | `#routeMap` |
| results announce | `aria-live="polite"` on the result summary | `#itiSummary` |

### Performance

| fix | target |
|---|---|
| concatenate `tokens`, `styles`, `atlas`, `mobile` into one blocking request; load `studio.css` only where the composer is used | render-blocking CSS ≤ 2 |
| image budget in `build:images` | no hero or card image over 120 KB; `-2x` only served to `dpr ≥ 2` |
| stop lazy-loading above-fold images | zero `loading="lazy"` within the first viewport |
| TTFB on district pages | under 300ms locally, measured with the probe |
| defer `maps-url.js` and `studio.js` | no blocking script |

### SEO

| fix | target |
|---|---|
| escape `&` and percent-encode non-ASCII in `/sitemap.xml` | file parses as XML; 3,014 `<loc>` valid |
| ASCII slugs for 31 URLs plus 301s | 0 slugs with `&` or non-ASCII |
| titles ≥ 30 characters on the five templates | 0 short titles |
| descriptions 110–160 characters, unique per page | 0 duplicates, 0 short |
| `og:image` and favicon | present on every page |
| per-branch JSON-LD: `@id`, `url`, `branchOf`, breadcrumb, opening hours | one entity per branch, no conflicts; postal code emitted only where a source holds one |
| `robots.txt` AI-friendly, plus `llms.txt` | see §5 |

### Security

| fix | target |
|---|---|
| dedicated limiter on `POST /api/concierge` | 20 requests per minute per address |
| `security.txt` | published at `/.well-known/security.txt` |
| CSP nonce migration | decision pending; not a launch blocker |

---

## 5. Functional changes

1. **The plan fits the window it was asked for.** Measured across six prompts
   (`.audit/concierge-budget.mjs`): the four dock chips land within 2 minutes of
   their window, and a free-text "dinner, 2 hours" lands at 121 minutes. One case
   fails badly. "Coffee, 3 hours" with no district returns 4 stops, 4h44m and
   14.7 km walked, a 58% overrun that includes a 92-minute walk leg, because a
   city-wide pool lets the planner pick stops across Vancouver and only the stop
   time is budgeted. The engine must pick a seed district when none is given, cap
   any single walk leg at 25 minutes, and re-check the clock after every leg.
   Where the data cannot fill the window, the result says so in the reasons it
   already prints.
2. **One entity per branch.** 175 names sit on 651 rows (22% of the directory),
   and every one of those rows already has its own slug, address and often its own
   phone. The contradiction is an identity gap, not a data gap. Each branch gets
   `{publicBaseUrl}/businesses/{slug}#business`, resolved from the slug that is
   already unique across all 2,958 rows, a `branchOf` link to a brand node declared
   in the same `@graph`, its own `url`, a `BreadcrumbList` mirroring the trail the
   page already prints, and `openingHoursSpecification` built from the existing
   `parseHoursWindows`. Postal codes are emitted only where the data holds one
   (6 rows today), and a street line that says "not mapped" is omitted rather than
   published as an address.
   **Hard prerequisite:** `PUBLIC_BASE_URL` must be the final public origin before
   any `@id` is published, because a published `@id` is permanent. Until then the
   template emits neither `@id` nor `url`, so the change is safe to merge before
   the hostname is chosen.
3. **Photo tiers become explicit.** `imageKind` gains `licensed` alongside `standin`
   and `owner`, plus three licence columns: terms, attribution string, and a
   reviewer with a date. A photo may only claim a venue when all of those are
   present and the image is tied to this branch. The homepage reports venues with
   a photo of *that* venue; the tile stays absent until the count is above zero,
   then returns as real coverage.
4. **About and Contact exist.** Drafts supplied in this spec's companion file;
   both are written from facts already in the repository, with no invented
   biography, no team photos, no testimonials.
5. **Composer states.** Idle, loading, empty result, error, and result are each a
   designed state. Today the error is a sentence in `#dockStatus` and the empty
   result is an empty grid.
6. **Mobile navigation is a menu**, reachable by keyboard, closing on `Escape` and
   on navigation, with the current page marked.
7. **`robots.txt` opens to assistants before it opens to search engines.** Three
   groups: everything allowed with `/admin`, `/out/`, `/search` and `/api/`
   disallowed; the named AI search indexers and assistant fetchers allowed with
   the same four disallowed lines repeated, because a crawler matching a named
   group obeys only that group; training-only crawlers disallowed, since this
   directory earns its keep by being cited with a link back. The soft-launch body
   stays in place while `SITE_NOINDEX` is on, and carries no sitemap line.
   **The sitemap escaping ships before the flip, not after**: two flips would
   advertise an invalid sitemap in between. `/llms.txt` describes the directory,
   one listing template, the owner path, and states plainly that the site serves
   HTML, not Markdown.

---

## 6. Success criteria

Each is measurable with a tool already in this repo or a script the plan adds.

| criterion | how it is measured |
|---|---|
| the plan fits its window: for each of the 6 baseline prompts, total elapsed ≤ requested + 15 min | `.audit/concierge-budget.mjs`, reading `estimatedDuration` and `walkToNextMinutes` |
| no single walk leg over 25 minutes | same script, `maxWalkLeg` |
| no horizontal overflow at 320 and 375 | `probe.mjs` `scrollWidth === clientWidth` |
| header ≤ 88px at ≤ 600px viewport | `getBoundingClientRect().height` |
| zero interactive elements under 44px at 320 | probe count |
| directory rows render on one line at ≥ 1024 | every `.go` cell shares its siblings' `top` |
| district lede 45–75 characters per line | probe ch-per-line estimate |
| zero duplicate and zero short descriptions across the five templates | squirrel `content/duplicate-description`, `core/meta-description` |
| `/sitemap.xml` parses | XML parse in the check gate |
| zero expired 404s from the 31 slug redirects | crawl of the old URL list returns 301 to the new URL |
| `npm test` green after every task | the gate itself |
| accessibility errors at zero on `/`, `/businesses`, `/businesses/:slug`, `/neighborhoods/:slug`, `/concierge` | squirrel `a11y/*` at error severity |
| render-blocking CSS ≤ 2, no image over 120 KB, no above-fold lazy image | squirrel `perf/*`, `images/*` |
| LCP on a throttled 4G profile | **not measurable yet**: needs the tunnel hostname and a lab run. Recorded as a launch-gate criterion, not a build criterion |

The audit's baseline to beat or hold: overall 28, Accessibility 79, Performance 50,
Core SEO 43, Structured Data 39. Accessibility may never fall below 79.

---

## 7. Implementation plan

Eight phases. Each ends in a state a reviewer can look at, and no phase starts
before the previous one is accepted. `tasks.md` carries the same breakdown with
per-task verification.

**Phase 0 — Guardrails.** Record decisions; run `npm test` for a green baseline;
capture the 7-page, 4-width screenshot set. Nothing else changes.

**Phase 1 — Frame.** Header and menu, footer disclosure, focus rings, tap targets.
The shell every other phase sits inside.

**Phase 2 — The concierge as hero.** Engine duration and walk budget first, then
the composer states, then the result surface. This phase carries the product's
main claim, so it goes before cosmetics on the other pages.

**Phase 3 — Directory surfaces.** Table grid and row anatomy, filters on mobile,
count formatting, empty state.

**Phase 4 — Content surfaces.** District measure and masthead, business detail
structure and branch identity in the H1, home section rhythm, About and Contact.

**Phase 5 — Data honesty.** Per-branch JSON-LD and the photo tier plus sourcing
workflow. Contains the only schema change, so it stops for approval before any
migration.

**Phase 6 — Launch hardening.** Sitemap, slugs and redirects, titles and
descriptions, social images, robots and `llms.txt`, remaining accessibility,
composer limiter, `security.txt`.

**Phase 7 — Delivery gate.** Re-run the audit, compare against baseline, verify
every success criterion with its named tool, and present the before/after.

Phases 1 to 4 are the visual tune-up. Phase 5 and 6 can run in either order after
Phase 4; both end at the launch gate.
