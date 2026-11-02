# VDMVP v2 — handover

Written 2026-11-02, after Phases 0 to 4 and most of 5 and 6. This is the resume
point: read it, then `spec.md` for the contract and `tasks.md` for the plan.

## Where it stands

| phase | state | evidence |
|---|---|---|
| 0 Guardrails | done | gate green, 28 baseline shots, `.audit/gate-inventory.md` |
| 1 Frame | done | header 260px → 57px at 320; footer licence disclosure |
| 2 Concierge | engine done, UI half done | 8 prompts pass; route reads as a timetable |
| 3 Directory | done | `.go` aligned 24/24 rows, `maxDelta 0`; counts `2,958` |
| 4 Content | done | About page, 73-char measure, district masthead, branch in the H1 |
| 5 Data honesty | half done | columns pushed; JSON-LD live; photo tier idle |
| 6 Launch hardening | mostly done | sitemap valid, robots three groups, slugs migrated |
| 7 Delivery gate | not started | — |

Verified live on 2026-11-02: uptime seconds, `/about` 200, `/llms.txt` 200,
`/.well-known/security.txt` 200, `/sitemap.xml` 3,015 URLs parsing with 0 bare
ampersands, listing JSON-LD emitting `@graph` + `BreadcrumbList` and no `@id`
(the loopback guard working). `npm test` exit 0.

## What is left

### Needs one restart (three things, batch them)

1. **301 from old slugs.** `src/routes/views.js` now redirects an alias to the
   canonical slug, but routes load at boot. Until then an old slug returns the page
   instead of redirecting. No 404s either way.
2. **`prisma generate`.** It fails with `EPERM` while the server holds
   `query_engine-windows.dll.node`. Run it after stopping the process, before
   starting it. Nothing reads the new columns yet, so this is only needed before
   the photo-tier code lands.
3. **Photo-tier read path.** The columns exist (`imageLicence`,
   `imageLicenceUrl`, `imageReviewer`, `imageReviewedAt`) and `imageKind` is
   documented as gaining `licensed`, but no code reads them and nothing writes
   them. `templates/_listing-photo.html` still renders only `standin` and `owner`.

### Design work, no approval needed

4. **Hero takeover.** A built plan should replace the lower hero band and shrink
   the headline, per `spec.md` §3.1. Today the result renders in a separate
   container below the band, so building a plan pushes the page down.
5. **Composer states.** Loading and error exist as a status line; empty and
   result are unstyled. `spec.md` §5.5 asks for all five states designed.

### Assets, needs a brand decision

6. **Favicon.** None exists. A "VD" monogram in pine on warm paper is the obvious
   mark, but the mark is a brand decision, not a build task.
7. **Social share image.** `og:image` is absent on every page, so every share is a
   bare link. Needs a 1200×630 template: wordmark, one line of copy, no stock photo.

### Decisions only Jay can make

8. **Contact page.** Parked until a site mailbox exists.
   `CONTACT_EMAIL` is `jayngai718@gmail.com` today.
9. **Photo sourcing.** The workflow is written in
   `.audit/schema-and-photos-plan.md`: licence terms, attribution string, an
   identity check tying the image to the branch, and a named reviewer. Nobody has
   been named as the reviewer, and no venue photo has been sourced.
10. **Training-crawler policy.** `robots.txt` refuses GPTBot, ClaudeBot,
    Google-CloudVertexBot and CCBot while allowing the nine search and assistant
    fetchers. Confirm that stays at launch.
11. **The flip.** `SITE_NOINDEX=false`, plus adding the `Sitemap:` line back to
    the launch robots body. One deliberate step, not a side effect.

### Measured nowhere yet

12. **Phase 7 audit.** The before/after comparison has not been run. Baseline is
    in `.audit/technical.md`: overall 28, Accessibility 79, Performance 50, Core
    SEO 43, Structured Data 39.
13. **Broken links, orphans, weak inbound links** beyond the 100 pages the crawl
    reached.
14. **Core Web Vitals, TLS, HSTS, compression, caching.** Nine transport rules are
    recorded as not applicable against loopback. They need the tunnel hostname.
15. **The claim flow, end to end.** The form has never been submitted.
16. **The composer limiter.** 20 a minute per visitor is configured; the 429 path
    has not been exercised.

## Traps, so the next session does not pay for them again

- **The 5050 process runs in Session 0 under SYSTEM.** `stop-site.cmd` and
  `taskkill` fail with Access denied from a normal shell, and starting the
  scheduled task alone leaves the port held by the orphan. Restart needs an
  elevated `Stop-Process` followed by `Start-ScheduledTask`.
- **`prisma generate` cannot run while the server is up.** It needs the engine
  DLL, which the process holds. Stop, generate, start.
- **The datasource is SQLite at `prisma/dev.db`, not PostgreSQL.** The workspace
  notes say Postgres; they are wrong. `prisma db push` is the migration tool here,
  and it is safe for additive nullable columns. Back the file up first.
- **Never rewrite a template with `Get-Content -Raw | Set-Content`.** Windows
  PowerShell converts the encoding and turns em dashes into `â€”`. The gate does
  not check encoding. Use the `edit` tool, or the .NET UTF-8 read/write pair.
- **`check-studio-dock.js` runs page scripts in a stub DOM** with no `matchMedia`
  and a `navSearch` element that only has `style`. Code that touches the navbar
  search must feature-test and write `style.visibility`, because that is what the
  harness asserts. No assertion was edited.
- **`PUBLIC_BASE_URL` is `http://127.0.0.1:5050`.** While it stays loopback, the
  JSON-LD builder suppresses `@id`, `url` and the brand node on purpose. A
  published `@id` is permanent, so set the real origin before launch and not after.
- **`ch` is not an average character in Playfair or Outfit.** 68ch rendered 736px
  and 93 characters. Measure in rem.
- **A bare `1fr` grid track sizes to content.** That is how the map stretched
  every stop row to 1,282px on a 375 screen. Use `minmax(0, 1fr)`.

## Best actions going forward

**One.** Batch a single restart for the three restart items, so the site is stopped
once. Order: stop, `npx prisma generate`, start, then verify the 301 with an old
slug and re-run `npm test`.

**Two.** Do the assets next, because they are cheap and visible: favicon and
`og:image`, once a mark is agreed. Both are brand calls; neither is a build risk.

**Three.** Finish the hero. The takeover and the composer states are the last
pieces of the concierge claim, and the claim is the product. Everything else is
maintenance by comparison.

**Four.** Run the photo-sourcing pilot on 20 venues before touching 2,958. It
proves the licence, attribution and review fields against real rows, and it is
reversible.

**Five.** Then Phase 7: re-run the audit at the same settings, put the scores
beside the baseline, and check every criterion in `spec.md` §6 with the tool
named there. Publish the failures, not only the wins.

**Six.** Only then discuss launch: real `PUBLIC_BASE_URL`, `SITE_NOINDEX=false`,
the `Sitemap:` line, and the training-crawler decision.

Do not start Phase 7 before the hero is finished. A delivery report that measures
a half-built hero reports the wrong thing.
