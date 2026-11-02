# Content strategy: food, drinks, entertainment

VDMVP is a directory with a smart concierge as its hero. Content is the product, so
this document covers what the database holds, what is missing, how to get more, and
who to work with.

Measured 2026-11-02 with `.audit/category-audit.cjs` (read-only).

## What the directory holds

2,958 listings. **2,814 of them (95%) are already food, drinks or entertainment** —
the focus is not a change of direction, it is where the data already points.

| category | listings | with a photo | with a description | with hours |
|---|---|---|---|---|
| Restaurant | 1,759 | 202 | 2 | 616 |
| Cafe | 591 | 125 | 2 | 211 |
| Bar / Pub | 219 | 37 | 1 | 65 |
| Bakery | 113 | 25 | 0 | 43 |
| Dessert | 63 | 9 | 0 | 23 |
| Fast Food | 60 | 2 | 0 | 11 |
| Arts & Culture | 9 | 0 | 0 | 0 |
| Entertainment | **0** | — | — | — |

The gaps are stark and specific:

- **Entertainment is empty.** Nine arts and culture listings, zero entertainment.
  A directory promising "food, drinks and entertainment" cannot deliver the third.
- **Drinks is thin.** 219 bars for a city with a serious cocktail and brewery
  scene, against 2,586 food listings — an 11:1 ratio.
- **Photography covers 13%.** 2,558 listings have no image at all.
- **Descriptions are effectively absent.** 29 rows out of 2,958. Every curated
  itinerary entry depends on this, which is why the itinerary copy reads as filler.

## How to acquire more listings

### 1. Fill entertainment from sources with a licence to use

Zero entertainment rows is not a data-quality problem, it is a collection gap. The
sources worth pursuing, in order:

- **Municipal open data.** The City of Vancouver publishes business licences by
  category; venues with an entertainment or liquor-primary licence are the honest
  seed list. Same licence terms as the data already used.
- **Ticket and venue feeds.** Live-music venues, theatres, comedy clubs and cinemas
  keep public venue directories. Anything ingested needs a check first that the feed
  permits reuse; most event APIs do not.
- **BC liquor licence data.** Already partially ingested for serving hours, and it
  tells you which venues are licensed for entertainment, not just for pouring.

### 2. Deepen drinks by district

Bars are also undercounted by category, not by demand: a cocktail bar filed under
"Restaurant" is invisible to a drinks filter. A pass over the 1,759 restaurants to
promote venues whose own description, hours or licence says bar, brewery or
cocktail is cheap and doubles the drinks shelf without inventing anything.

### 3. Raise the floor on every listing

Photography and descriptions are the difference between a directory and a list of
names. The sourcing plan in `PHOTO-SOURCING.md` covers the images. Descriptions have
a cheaper first step: 1,406 restaurants publish a website, and the owner-submitted
description arriving through the claim flow is the only version that is both free
and licensed.

### 4. Close the hours gap

616 of 1,759 restaurants carry hours. An itinerary that starts at 10am is worthless
if the café opens at 11. Hours are also the field the concierge reasons about most.

## Working with local media

The Vancouver food and drink press is small, active and reachable. The honest
strategies are the ones where both sides gain something:

| outlet type | example | the ask | what they get |
|---|---|---|---|
| City magazines | [Vancouver Magazine](https://vanmag.com/taste/food-news/michelin-guide-vancouver-2026/), [Scout](https://scoutmagazine.ca/) | a curated route credited to their writer, or a data citation | a route page that links to them, and a link from a directory with 2,958 listings |
| Ranking lists | [Canada's 100 Best](https://canadas100best.com/stories/vancouver-top-5-restaurants-2026-2-2-2/) | permission to cite a placement, with a link | clean attribution and traffic |
| Guides | [Michelin Guide Vancouver](https://guide.michelin.com/en/article/dining-out/dine-out-vancouver-festival-michelin-star-guide-restaurant-week) | a permitted citation of star and bib listings | correct attribution |
| Neighbourhood BIAs | Gastown, Mount Pleasant, Commercial Drive associations | their member list as a seed, and their events | a district page that promotes their members |
| Event organisers | Dine Out Vancouver, comedy and music festivals | a venue list for the run of the festival | a route per festival, built on their programme |

Four rules for all of it:

1. **Never copy blog copy.** A collaboration is permission, a credit and a link.
   Scraping a roundup into a description is the one move that would poison every
   partnership on this list.
2. **Link out generously.** The site already credits its data sources; extending
   that to editorial sources costs nothing and is what makes a citation request
   reasonable.
3. **Give before asking.** Publish three genuinely good routes first. A cold ask
   from an empty directory reads as a favour; an ask from a site with curated
   Gastown and Chinatown routes reads as coverage.
4. **One asset worth writing about.** The concierge is the story: a planner that
   builds a walking day from real listings and refuses to invent a venue. That is
   the pitch, not "please link to our directory".

## The itineraries, in this light

`ITINERARY-PASS.md` retires 21 of 26 presets and rebuilds them. The strategy and the
content work are the same work: a curated route is the unit that local media will
cite, that the concierge learns from, and that a visitor saves.

The four proving routes should be chosen from the strongest data, not the prettiest
idea:

- **Gastown** — history, bars, late kitchens. Already the second-best covered.
- **Mount Pleasant** — makers, coffee, breweries.
- **Chinatown** — food and late nights, and the district with the strongest story.
- **Kitsilano** — beach, shopping, the West 4th strip.

## Sequence

1. **Promote bars out of Restaurant** and fill entertainment from municipal licence
   data. Two weeks of data work, no new dependencies.
2. **Four curated routes**, each verified against opening hours and distance.
3. **Retire the generated set** as `draft`, reversible.
4. **First outreach round**: three BIAs and two city magazines, with the four routes
   as the opening offer.
5. **Photo and description passes**, district by district, starting where the routes
   are.
6. **Measure**: listings per category, photo coverage, description coverage,
   referring domains, published routes.

## What "content is king" costs here

About a month of writing for the route set, plus a data pass per district, plus the
outreach. That is the honest number. The alternative — 19 templated coffee walks —
is already in the database and is why this document exists.
