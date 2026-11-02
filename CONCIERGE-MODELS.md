# The concierge's model layer

Today the concierge is deterministic: `src/lib/concierge.js` parses the prompt with
keyword rules, pulls candidate venues, sequences them by walking distance and
budgets the clock. It cannot invent a restaurant, and that is its best property.

This plan adds **two** components with different jobs: an **LLM** that reads and
writes language, and **JEV** that makes the choice. They are not alternatives; the
earlier "one model or the other" ruling was about the decision model, and JEV is
that model.

## The flow Jay specified

1. The visitor types what they want to do.
2. An **LLM** reads it and turns it into the structured input JEV can answer:
   activity, constraints, district, duration, time of day.
3. **JEV** returns the matches — `Choice` over the candidate list, `Score` where
   the code needs to rank.
4. A **LLM** turns the chosen stops into the written itinerary.
5. VDMVP captures all of it and renders the same result screen: stops, distance,
   time, start and end, the stop list, the embedded map, and the Google and Apple
   Maps links. **The result surface does not change.**

### The guardrail that makes step 4 safe

The narration step receives the exact steps the database returned, with their
fields. It may order words around those facts; it may not add a venue, a price, an
opening time or a rating. Enforcement is the same rule as everywhere else in this
plan: the copy is generated **from a supplied list of names**, and the server
checks that no proper noun appears in the prose that was not in that list. If the
check fails, the templated reasons from `reasons.js` are used instead.

That check is one function, and it is the difference between a concierge that
narrates and a concierge that invents.

## What JEV actually is

JEV is TypeSafe AI's System One model, and it is **not a text generator**. It takes
a typed *state* and a set of typed *questions*, and returns structured answers your
code consumes directly: a `Choice` (pick one option from a list, with probabilities
and confidence), a `Score` (rate the state on a rubric), or a `Noul` (is this
statement true, 0–1). See [TypeSafe's docs](https://docs.typesafe.ai/introduction)
and the [quickstart](https://www.typesafeai.org/guides/jev-api-quickstart).

That shape suits this problem better than an LLM would:

- the "choose a venue" task *is* the `Choice` primitive, with the candidate list
  supplied;
- ranking under constraints *is* `Score`, decomposed into separate questions
  (walkable from the last stop, matches the mood, open when you arrive) that our
  code weighs;
- **it cannot write prose**, so explanations stay templated from `reasons.js`,
  which reads database fields and cannot hallucinate.

One consequence worth stating: JEV does not write the prose. It decides. The
writing is the LLM's job in step 4, from the decided stops only.

## The one rule a model may not break

**The model never names a venue.** It chooses among ids we supply, and the server
rejects any id it did not supply. Every string a visitor reads is rendered from a
database field.

With JEV this is structural rather than a promise: `Choice` has no way to return an
option that was not in the list.

## Where JEV helps

| job | today | with JEV |
|---|---|---|
| picking the first stop for "somewhere warm for a rainy Tuesday" | completeness + density | `Score` against the parsed constraints, one question per constraint |
| ordering four eligible stops | nearest-neighbour | `Choice` over the remaining candidates, given the walk time so far |
| deciding whether a parsed intent is actually satisfied | keyword match | `Noul` — "does this venue serve a rainy-day coffee crawl" — with confidence, which the code thresholds |
| writing the reasons | `reasons.js` | unchanged. JEV does not generate text. |

The plans free-text parser stays. JEV does not replace it; it raises the quality of
the decision that follows.

## Architecture

```
src/lib/planner/
  index.js        the only entry point: plan(input) -> itinerary
  adapters/
    rules.js      today's engine, unchanged, the default and the fallback
    llm.js        step 2 (read the prompt) and step 4 (write the itinerary)
    jev.js        step 3 (Choice / Score / Noul against the TypeSafe API)
  schema.js       the JSON shape every adapter must return
  validate.js     rejects unknown ids, unknown categories, and prose that names a
                  venue not in the supplied list
  eval/           golden prompts and assertions
```

Three adapters. `rules.js` remains the default and the fallback for both model
steps, so a model outage degrades to today's behaviour instead of an error page.

## Cost

One request per itinerary build, not one per stop: the planner runs once, and a
visitor builds a handful of days at most. JEV evaluates several questions in one
request, so adding a constraint barely moves latency ([TypeSafe](https://docs.typesafe.ai/introduction)).

**JEV's price is not published where this session could read it.** If the key is on
a free tier, the zero-cost goal holds as stated. If it is metered, that number is
Jay's to accept, and "zero cost" should be restated as a known figure rather than
an assumption.

The local alternative was dropped by Jay's decision on 2026-11-02 — one model or
the other, never both. LFM3's ~2B text model remains the fallback plan if JEV's
cost or availability rules it out, and nothing here builds for it in advance.

## The proof of concept

1. **Build the eval before the model.** Thirty prompts with known-good shapes: a
   rainy-Tuesday prompt, a two-intent prompt, a chain-branch prompt, a district
   prompt, a prompt naming nothing, a prompt asking for something absent from the
   data. Assertions: every stop exists in the database; the plan fits its window;
   no invented names; latency inside budget.
2. **Run the rules adapter** through it and record the score. That is the bar.
3. **Run the JEV adapter** on ranking only, with the same candidate sets the rules
   use. Compare on the prompts the rules fail, not on the easy ones.
4. **Promote only on evidence:** the eval score rises, no invented id survives
   validation in any run, and latency stays inside budget.

## What it needs from Jay

- **The LLM is settled for the proof of concept:** a DeepSeek key, which Jay is
  creating. For launch it moves to a lightweight model hosted locally so the
  running cost stays at zero. The `llm.js` adapter takes the endpoint from the
  environment, so the swap is configuration, not code.
- **JEV's price**, free tier or metered. One number decides whether the zero-cost
  claim survives. (JEV itself stays hosted in both phases; it is the decision
  model, not the text model.)

## What does not change

The itinerary surface, the swap behaviour, the walking budget and the honesty
rules all stay. The model sits behind the planner, not in front of it, and every
plan a visitor sees is still built from rows in the database.
