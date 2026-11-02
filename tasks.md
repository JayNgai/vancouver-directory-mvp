# VDMVP v2 — tasks and phases

The build order for `spec.md`. Each task is one coherent change that can be
reviewed on its own. A phase ends with its exit check; nothing in the next phase
starts until the exit check passes.

## Progress — 2026-11-02

| phase | state |
|---|---|
| 0 Guardrails | done — gate green, 28 baseline shots, `.audit/gate-inventory.md` |
| 1 Frame | done — 57px mobile bar with menu, footer licence disclosure, 44px targets, focus ring |
| 2 Concierge | engine verified; result surface now a timetable (times in a gutter, rules, not cards); hero takeover and composer-state polish pending |
| 3 Directory | done — seven-track row with thumbnail, mobile filters, counts |
| 4 Content | done — About page, 73-character measure, compact district masthead, business H1 carries the branch, Details/Getting-there sections, emoji and coordinates removed, photo stat gone, "View" label |
| 5 Data honesty | columns pushed to `prisma/dev.db` (backup kept); JSON-LD rewritten in `src/lib/jsonld.js` and staged; photo-tier code waiting on a `prisma generate` |
| 6 Launch hardening | staged: sitemap escaping (verified), robots three groups, `llms.txt`, `security.txt`, concierge limiter, business titles and descriptions. Pending: 31 slug redirects, social image, favicon |
| 7 Delivery gate | not started |

**Open blocker:** the live site on port 5050 runs a process owned by another
account and cannot be restarted from this session (`stop-site.cmd` returns Access
denied). The engine change is verified against the database and on a second
instance at `127.0.0.1:5051`; the 5050 instance still serves the old planner until
it is restarted.

Verification shorthand used throughout:

- **gate** — `npm test` (which includes `npm run check`).
- **probe** — `.audit/probe.mjs` at 320, 375, 768, 1440.
- **shots** — screenshot set in `.audit/shots/v2/`.
- **audit** — squirrel MCP, offline surface, compared against `.audit/technical.md`.

---

## Phase 0 — Guardrails

| task | what | files | verify |
|---|---|---|---|
| Baseline capture | Record current scores, screenshots and gate state before anything changes | `.audit/shots/v2/before/` | gate green, 7 pages × 4 widths captured |
| Gate scripts inventory | List every assertion the nine `check-*` scripts make, so no task silently breaks one | `.audit/gate-inventory.md` | one line per assertion, with the file it guards |

**Exit:** a green gate and a screenshot baseline exist, and the assertion inventory
is written.

## Phase 1 — Frame

| task | what | files | verify |
|---|---|---|---|
| Mobile header | 56px bar below 600px: wordmark, menu button, no six-link wrap | `templates/base.html`, `public/mobile.css`, `public/styles.css` | probe header height ≤ 88px at 375; shots |
| Menu | Keyboard-reachable menu holding the six links plus claim; `Escape` closes; current page marked | `templates/base.html`, new `public/nav.js`, `src/scripts/check-*.js` | manual keyboard pass; probe tap targets |
| Footer disclosure | Licence stack behind a disclosure; every sentence verbatim | `templates/base.html`, `templates/_attribution.html`, CSS | diff the text against `_attribution.html`; shots at 320 |
| Focus rings | 2px pine ring at 3:1 on both surfaces, never removed | `public/styles.css` | contrast check; tab pass |

**Exit:** header, menu and footer pass probe and shots at four widths.

## Phase 2 — The concierge as hero

| task | what | files | verify |
|---|---|---|---|
| Seed district | When no district is given, pick one before selecting stops, so the day is walkable | `src/lib/concierge.js` | `.audit/concierge-budget.mjs` |
| Walk-leg cap | No single leg over 25 minutes; re-check the clock after every leg | `src/lib/concierge.js` | same script, `maxWalkLeg` ≤ 25 |
| Composer states | Idle, loading, empty, error, result each designed | `templates/_studio_dock.html`, `_studio_results.html`, `public/studio.js`, `public/studio.css` | shots of all five at 375 and 1440 |
| Chips to 44px | Composer chips meet the rule the rest of the site already states | `public/studio.css` | probe target count = 0 under 44px |
| Result surface | Stops as timetable rows on rules, times in a monospace gutter | `public/studio.css`, `templates/_studio_results.html` | shots; gate (studio dock assertions) |
| Result announcement | `aria-live` summary, map labelled, route summary in text | `templates/_studio_results.html`, `public/studio.js` | screen-reader pass; audit a11y errors = 0 |
| Hero takeover | After a plan exists the headline shrinks and the result occupies the band | `templates/index.html`, `public/studio.css` | shots at 1440 and 375 |

**Exit:** `.audit/concierge-budget.mjs` passes on all six prompts, five states are
captured, and the gate is green.

## Phase 3 — Directory surfaces

| task | what | files | verify |
|---|---|---|---|
| Sixth column | `.atlas-row` gains the track the markup already supplies, plus a 56px thumbnail slot | `public/atlas.css`, `templates/search.html` | probe: every `.go` shares its siblings' `top` |
| Row anatomy | Thumbnail, name, branch, category, district, status, action | `templates/search.html`, `public/atlas.css` | shots at 1440 and 375 |
| Mobile sort | Control wide enough for "Most complete first" | `public/mobile.css` | shots at 375 |
| Counts | `num` filter on the directory count | `templates/search.html` | `2,958` renders |
| Mobile filters | Collapsed behind a button, active chips removable | `templates/search.html`, `public/filter.js` | manual pass; probe |

**Exit:** one-line rows at 1024 and above, no truncated labels, gate green.

## Phase 4 — Content surfaces

| task | what | files | verify |
|---|---|---|---|
| District measure | Ledé capped at 68ch | `public/styles.css` | probe characters per line |
| District masthead | 240px band becomes a compact header with count and breadcrumb | `templates/neighborhood-detail.html`, `public/atlas.css` | shots |
| Business structure | H2 sections: facts, branch, nearby | `templates/business-detail.html` | heading outline has no skip |
| Branch in the H1 | "Ajiya Sushi, Kitsilano" in title, H1 and breadcrumb | `templates/business-detail.html`, `src/routes/views.js` | shots; gate (copy checks) |
| Coordinates | Removed from the public view unless the map consumes them | `templates/business-detail.html` | visual diff |
| Home rhythm | Stat relabel, action column wording, section spacing | `templates/index.html`, `templates/search.html` | shots |
| About and Contact | Pages built from the approved draft | new `templates/about.html`, `contact.html`, `src/routes/views.js` | render at four widths; contact address is not `example.com` |

**Exit:** measure, heading order and copy checks pass; About and Contact render.

## Phase 5 — Data honesty

**This phase needs its own approval before the first migration runs.**

| task | what | files | verify |
|---|---|---|---|
| Branch identity | `@id` as `{base}/businesses/{slug}#business`, `url`, `branchOf` to a brand node, `BreadcrumbList`, `openingHoursSpecification`; postal code only where the row holds one | `src/routes/views.js` or the JSON-LD partial | squirrel `schema/*` errors = 0; entity graph shows one `@id` per branch |
| Base-URL guard | Emit `@id` and `url` only when `PUBLIC_BASE_URL` is a real origin; keep today's output on loopback | `templates/business-detail.html`, `server.js:118` | loopback render has no `@id`; a test origin produces one |
| Photo tier | `licensed` tier plus licence terms, attribution and reviewer columns; only reviewed photos claim a venue | `prisma/schema.prisma`, `templates/_listing-photo.html`, `prisma/migrations/` | migration reviewed; stand-in caption still unconditional |
| Sourcing workflow | Reviewed intake for real venue photos, with licence and attribution recorded | `.audit/schema-and-photos-plan.md` as the source | first 20 venues processed and reversible |
| Stat honesty | Drop the "Photographed so far" tile; return it only when the count of venue-owned photos is above zero | `templates/index.html`, `src/routes/views.js` | the rendered stat matches `count({ where: { imageKind: 'owner' } })` |

**Exit:** schema validates, entity conflicts are gone, and the stat equals a query.

## Phase 6 — Launch hardening

| task | what | files | verify |
|---|---|---|---|
| Sitemap escaping | Escape `&`, percent-encode non-ASCII | `server.js:89-92`, gate script | XML parses; 3,014 valid locs |
| Slugs and redirects | ASCII slugs for 31 URLs, 301 from each old path | `prisma/seed.js` or a data script, `server.js` | old URL list returns 301 to new |
| Titles and descriptions | 30–60 character titles, 110–160 descriptors, unique | templates, `views.js` | audit: zero short, zero duplicate |
| Social images | `og:image` and favicon | `templates/base.html`, `public/` | audit `core/og-tags`, `core/favicon` |
| robots and llms | AI-friendly robots with a soft-launch switch, `/llms.txt` | `src/middleware/exposure.js`, `server.js` | file contents match the approved plan |
| Composer limiter | 20/minute per address on the concierge POST | `src/middleware/exposure.js`, `src/routes/api.js` | burst test returns 429 after the limit |
| security.txt | Published disclosure contact | `public/.well-known/security.txt` or a route | 200 at the path |
| Accessibility tail | Remaining labels, heading order, contrast | templates, CSS | audit a11y errors = 0 on five pages |

**Exit:** audit re-run shows Accessibility ≥ 79 (target 90+), Core SEO above 43,
Structured Data above 39, and the gate is green.

## Phase 7 — Delivery gate

| task | what | verify |
|---|---|---|
| Re-audit | Same crawl settings as the baseline | scores compared in one table |
| Success criteria | Every line of `spec.md` §6 run with its named tool | a result per criterion, pass or fail |
| Screenshot set | Same 7 pages × 4 widths | before/after pairs |
| Handover | What shipped, what was cut, what remains | one page, evidence-linked |

---

## Ordering rules

- Phase 2 before Phase 3: the concierge is the product claim; a tidy directory
  above a mis-budgeted planner would be polishing the wrong surface.
- Phase 5 before Phase 6: `llms.txt` and the sitemap quote slugs, so slugs settle
  first.
- Any task that changes a gate assertion updates that assertion in the same task,
  and the updated assertion is named in the review.
