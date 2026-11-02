# Itinerary copy pass

The presets are not curated. They are a generated set wearing a curated voice, and
this document measures it rather than asserting it.

Measured on 2026-11-02 with `.audit/itinerary-audit.cjs`, read-only against
`prisma/dev.db`.

## What is there now

26 itineraries. **23 of them score 4 or less out of 8** on a rubric a reader can
check: at least four stops, more than one category, no computed filler tips, notes
that differ, a walk between 400m and 5km, a business on every step, venue
descriptions present, and a description longer than 40 words.

| itinerary | steps | categories | templated tips | walk | words | score |
|---|---|---|---|---|---|---|
| Chinatown Bar Crawl | 4 | 1 | 4 | 1.1 km | 24 | 4 |
| Coal Harbour Coffee Walk | 5 | 1 | 5 | 0.4 km | 22 | 3 |
| Commercial Drive Coffee Walk | 5 | 1 | 5 | 0.2 km | 22 | 2 |
| Downtown Culture & Waterfront Aburi Sushi | 4 | 3 | 0 | 1.1 km | 23 | 5 |
| Downtown Vancouver Coffee Walk | 5 | 1 | 5 | 0.3 km | 24 | 2 |
| Fairview Coffee Walk | 5 | 1 | 5 | 0.5 km | 22 | 4 |
| False Creek Coffee Walk | 5 | 1 | 5 | 0.5 km | 24 | 3 |
| Gastown Coffee Walk | 5 | 1 | 5 | 0.3 km | 22 | 2 |
| Gastown Historic & Culinary Stroll | 4 | 3 | 0 | 0.8 km | 13 | 5 |
| Grandview-Woodland Coffee Walk | 5 | 1 | 5 | 1.2 km | 22 | 4 |
| Hastings-Sunrise Coffee Walk | 5 | 1 | 5 | 2.7 km | 23 | 4 |
| Kerrisdale Coffee Walk | 5 | 1 | 5 | 0.6 km | 21 | 4 |
| Killarney Coffee Walk | 4 | 1 | 4 | 1.1 km | 22 | 4 |
| Kitsilano Beach & West 4th Lifestyle Day | 4 | 3 | 0 | 1.4 km | 22 | 5 |
| Kitsilano Coffee Walk | 5 | 1 | 5 | 1.1 km | 24 | 4 |
| Marpole Coffee Walk | 5 | 1 | 5 | 0.8 km | 22 | 3 |
| Mount Pleasant Coffee Walk | 5 | 1 | 5 | 0.3 km | 23 | 2 |
| Oakridge Coffee Walk | 5 | 1 | 5 | 1.1 km | 22 | 3 |
| Point Grey Coffee Walk | 5 | 1 | 5 | 1.5 km | 27 | 4 |
| Renfrew-Collingwood Coffee Walk | 5 | 1 | 5 | 0.9 km | 23 | 4 |
| South Granville Coffee Walk | 5 | 1 | 5 | 0.7 km | 20 | 4 |
| Strathcona Coffee Walk | 5 | 1 | 5 | 2.8 km | 21 | 4 |
| Sunset Coffee Walk | 5 | 1 | 5 | 0.7 km | 20 | 4 |
| Victoria-Fraserview Sweet Stops | 3 | 1 | 3 | 1.1 km | 18 | 3 |
| West End Coffee Walk | 5 | 1 | 5 | 0.2 km | 20 | 2 |
| Yaletown Coffee Walk | 5 | 1 | 5 | 0.6 km | 19 | 4 |

## The verdict, by group

**Retire: the 19 "<District> Coffee Walk" routes.** They are one template stamped
across the city: five cafés, one category, a 20–27 word description, and five tips
that say *"walk to the next stop about 1 min"*. A route that could describe any
district describes none. Nineteen of these make the presets look generated, which
is precisely the thing the site cannot afford.

**Retire: Victoria-Fraserview Sweet Stops.** Three stops, one category, 1.1 km, and
three computed tips. Not a day.

**Rewrite: Chinatown Bar Crawl.** It has a real premise and four bars, but four
templated tips and one category. The bones are good; the copy is filler.

**Keep and deepen: the three multi-category routes.** Downtown Culture & Waterfront
Aburi Sushi, Gastown Historic & Culinary Stroll, Kitsilano Beach & West 4th. These
have a shape (culture, food, water), three categories, and no filler tips. All
three still have descriptions of 13–24 words, and two have a step with no business
attached.

Net: **21 retired or rewritten, 3 kept and deepened**, which is a rebuilding job,
not a copy edit. That is the honest read.

## Why they read as slop

1. **No premise.** A curated route answers "why this, why here, why in this
   order". The generated set answers "which five cafés are in this district".
2. **Computed tips.** `reasons.js` prints walking minutes as prose. It is true and
   it is worthless to a reader deciding where to go.
3. **One category per route.** Five cafés in a row is a list, not a day.
4. **Thin descriptions.** 13–27 words cannot carry a recommendation.
5. **No venue detail behind the stops.** Almost every step's business has no
   description, so the page cannot say anything the listing page does not.
6. **Inconsistent shape.** Walks range from 202m to 2.8km with identical 5-hour
   durations attached.

## What a curated itinerary is

Six properties, each checkable:

- **A premise in the title.** "Coffee in Kerrisdale" is a location. "Rainy-day
  coffee and a used-book crawl in Kerrisdale" is a route.
- **A shape**: an anchor (the reason you go), a discovery (the reason you are glad
  you did), a pause (somewhere to sit or look), and an end that hands you back to
  transit or the next district.
- **Four to six stops, at least two categories.**
- **A reason per stop** that is specific to that venue: what to order, which room
  to sit in, what it is near, when it is quiet.
- **Real numbers**: distance, walking time, dwell time, total, and a start time
  that matches the venue's opening hours.
- **A voice**: one writer, one point of view, no template sentences.

## The plan

### Phase A — prove the format on four routes (a week)

Pick four districts with different characters: **Gastown** (history and bars),
**Mount Pleasant** (makers and coffee), **Chinatown** (food and late nights), and
**Kitsilano** (beach and shopping). Write each to the six properties above, with a
300–500 word description, five stops, two categories minimum, and a specific tip on
every stop.

Each route is checked against the database: every stop exists, the hours support
the start time, and the walking distance is within 10% of what the copy claims.
Anything that cannot be verified is cut rather than softened.

### Phase B — retire the generated set (the same week)

Remove the 19 coffee walks and Victoria-Fraserview from the published list. Leaving
them up while four good routes exist is worse than four routes alone: the weak ones
are the majority and they set the expectation.

Nothing is deleted from the database. They get a `status` of `draft` — a small
migration, approved separately — so the content is recoverable and the counts stay
honest.

### Phase C — build the rest by district (four to six weeks)

Two routes per district that can carry one, prioritising districts with the most
listings and the most photographed venues. That is roughly 20–24 routes total.

At one writer-day per route, including the verification pass, the whole set is
about a month of focused work. That is the real cost of "content is king" here, and
it is worth stating before it starts.

### Phase D — keep them true

- **Hours drift.** A monthly check re-verifies each route's start time against the
  venues' hours, and flags any route whose anchor has closed.
- **The concierge should learn from them.** Each curated route is a worked example
  of the planner's judgement: premise, shape, reasons. Once three exist, they
  become eval cases for the JEV work — the planner should not propose a route a
  human curator would call slop.

## Copy template

```
Title: <premise> in <district>
Description (300–500 words): why this route, who it suits, what the day feels
like, where it starts, where it ends, what to skip.
Per stop:
  Time + duration (checked against opening hours)
  Venue + what to do there (specific, no adjectives doing the work)
  Why it is on this route
  Walk to the next stop, only when the walk itself is interesting
```

Banned in route copy: "walk to the next stop about N min" unless the walk is
described; "a great spot for"; "hidden gem"; any claim about ratings, prices or
crowds that the data cannot support.

## Definition of done

- Every published route scores 7 or 8 of 8 on the audit script.
- Zero templated tips anywhere in the published set.
- Every stop has a business, and that business has its own description.
- The start time on every route is inside the anchor venue's opening hours.
- The stated distance is within 10% of the measured distance.
