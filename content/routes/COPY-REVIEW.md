# Route copy review

Five route drafts in this directory were edited for a proof pass by an earlier agent
that failed before writing its review. This is that review.

**How it was produced.** Every change below is read off `git diff` against `HEAD`, one
file at a time, not from memory of what a proof pass usually does. Claims were checked
against each file's own sources table, against the research note behind the Gastown
route (`01-gastown.slots.md`), and, where the claim is about hours, distance or a count
over the database, against `prisma/dev.db` read only on 2026-11-02. External source pages
were not re-fetched, with one exception noted in the claims section, so "the sources
table states it" is the ceiling of what this review can confirm.

**Word counts** are whitespace-separated tokens over the whole file, tables and headings
included. The before count is `git show HEAD:content/routes/<file>`. The method matters
because a table row and a sentence count the same here, so the counts track volume, not
prose quality.

**What this review changed.** One thing, in the Mount Pleasant evening route: three
happy-hour prices that no sources row carried. It is marked where it appears in that
changelog and listed in the claims section. Everything else here is diagnosis.

---

## Gastown: coffee to last call

### Core Critique

The edit is mostly subtraction, and the subtraction is mostly right: hedges and
atmosphere went, and what stayed is checkable. It then did the opposite of what a proof
pass is for in two places, turning a 2013 design note into a present-tense seat count
and keeping an unsourced negative about the venue's upstairs room. The intro also
repeats Guilt & Co's three closing times that sit ten lines below in bold, which is
detail doing no work.

### Changelog

- **Intro rewritten.** "Four blocks, one afternoon" and the stop-sequence sentence went.
  In their place: the start stop at 10:00, Guilt & Co's three closing times, and the
  692m total. Every figure is in the hours line or the legs table.
- **East Van Roasters' hedge cut.** The old intro said "a bean-to-bar chocolate stop
  while it is still open". The "while it is still open" qualifier went. The hours line
  carries the 17:00 close, so nothing unsupported was added, but the doubt the writer
  had is no longer visible anywhere.
- **Timbertrain: cut "it roasts on site".** No row covered roasting, so this was cut for
  lack of a source and the cut is correct. The venue name still says "Roasters", which
  is the only place the idea survives. The replacement, "Open by 10:00 every day the
  route runs", reads straight off the hours column.
- **Timbertrain: made worse.** "The room was built as sixteen seats" became "The room is
  sixteen seats". The only row is a Scout design piece from 2013, and this route's own
  research note says "the room may have changed since". The edit turned a dated build
  fact into a current count. This is the clearest regression in the five files.
- **Six Acres: cut "the people-watching seat on this block".** The research note sources
  that phrase to a Vancouver Magazine patio piece, so this was cut for length, not for
  lack of a source. The two prices and the patio sentence were kept and the rows still
  match them.
- **East Van Roasters: fallback lost, made worse.** The Aiyaohno Cafe alternative
  (103m, Tuesday to Saturday) was cut. The one that remains, Buro Coffee Bar, is open
  Tuesday to Friday until 20:30, so on a Saturday, which is a route day, the only
  fallback offered is shut.
- **L'Abattoir: sentence split, claim kept.** "Two ways in" became "Two ways to order".
  "There is no upstairs bar — the second-floor space is private dining" was split into
  two sentences, and the claim is still standing with no row behind it. The research note
  marks the upstairs bar as not found and says the house names a bar without giving its
  floor.
- **Guilt & Co: cut "at Alexander and Water".** The address line below the heading still
  carries 1 Alexander Street, so only the corner was lost.

**Left blank.** All eight items in "Still not verified" are still open: four at
Timbertrain as a group, whether the room is quiet at 10:00, the patio in November,
whether lunch needs a booking, the 15:00 selection, the bar-hour booking, Guilt & Co's
cover amount, and whether to arrive before 20:00. The edit filled none of them and
invented no new ones.

**Word count:** 909 before, 877 after.

---

## Mount Pleasant: coffee roasted here, beer brewed here

### Core Critique

This is the cleanest edit of the five. It cut framing, tightened two sentences that had
reservations performing actions, and left every sourced figure and its row intact. The
one cost is that the intro's "chocolate and pastry on 10th" became "pastry on 10th",
which drops half of what the 10:30 stop is.

### Changelog

- **Intro rebuilt.** The "order the district makes things" framing went. In its place: a
  five-stop summary naming 14:30 and 17:00. The 900m figure is stated in the intro and
  still matches the legs table total.
- **"Brunch on Main" became "lunch on Main".** That is the right call on the file's own
  evidence, which says in "Still not verified" that which menu Barney's runs at noon on
  a Tuesday is unknown. A brunch claim would have been a guess.
- **Made worse, mildly.** The intro's "chocolate and pastry on 10th" became "pastry on
  10th", so a stop whose paragraph lists chocolates, macarons and canapés now reads as a
  pastry stop in the summary. The stop paragraph itself is unchanged and correct.
- **Headings lost their addresses.** Elysian and Thierry now carry the venue name only,
  with the address on the lines below. That matches the other four files, so this is
  consistency, not loss.
- **Wording only.** "The roasts are sold as" became "Beans are sold as"; "Reservations
  run inside" became "Reservations are for the inside room", which removes a reading in
  which somebody else runs the reservations.
- **Barney's prices reflowed.** Three amounts were folded into one sentence. All three
  are still in the row, and the gate below confirms it.
- **No claim was cut for lack of a source. No gap was filled. Nothing added a fact.**

**Word count:** 973 before, 949 after.

---

## Chinatown: pastry at nine, small plates at half past five

### Core Critique

The edit is punctuation and compression, and it reads better for it: the Annabelle's
sentence, the siopao brackets and the Dalina alternative all parse on first pass now.
Two specific facts went, one of them the warmest sentence in the file, and the intro
gained a district claim nobody asked for and no row supports. The route still cannot
tell a reader what anything costs, and the edit did not change that.

### Changelog

- **Intro: added claim.** "481m between the first stop and the last" became "481m end to
  end, all inside the district". The second half is new and has no sources row. All five
  stops are filed under Chinatown in the database, so it holds in that sense. 620 Quebec
  Street sits east of Gore Avenue, which is normally the district's eastern edge, so a
  reader checking a map may not agree. Added without provenance.
- **Annabelle's and New Town: punctuation.** A semicolon replaced a clause break, and
  the em dashes around "siopao" became brackets. No fact changed.
- **Chinatown BBQ: cut the notice sentence.** "The notice on the site thanks the
  customers who kept ordering takeout" went. The row covers the claim, so this was cut
  for length, not for lack of a source. It was the only sentence in the file that
  described the venue in its own voice.
- **Dalina: cut the catering arm, orphaned a row clause.** The copy no longer mentions
  corporate catering, but the row still reads "Dalina breakfast and lunch; corporate
  catering". Table and copy no longer match clause for clause, which is a small
  maintenance cost rather than an error.
- **Bao Bei: attribution shortened.** "Which is how the restaurant describes its own
  menu" became "in the restaurant's own words". Same claim, fewer words.
- **Fallback reworded.** The Annabelle's alternative now reads "the fourth stop on this
  route taken out of order", which is grammatical. The old version was not.

**Left blank.** The "still not verified" list is unchanged, including the line that
matters most for a food route: the price of anything at four of the five stops.

**Word count:** 984 before, 942 after.

---

## Kitsilano: waffles at eight, dinner at the west end

### Core Critique

The edit fixed the weakest two sentences in the file and correctly cut one unsourced
claim ("made locally"). It then left a retail claim about beans standing with a row that
only counts cafés, and it left the 400m claim about neighbouring bars as an assertion
with no method attached. The route reads well; the provenance is still uneven.

### Changelog

- **Intro names the endpoints.** "West along the strip" became "west from 1728 West 2nd
  to 2724 West 4th", both addresses taken from the stop headings. "2038m in one line"
  became "2038m walked". Neither changes a fact.
- **Lebeau: claim softened to match its row.** "Waffles and a case of European pastries,
  made fresh daily" became "Waffles are worked each morning, and the case carries
  European pastries". That is the row's own wording ("worked each morning"), so the
  stronger daily claim went and the supported one stayed.
- **49th Parallel: claim kept, row still thin.** "From the same company" was cut. What
  remains, "Espresso and filter; beans sold by the bag", is not supported by the only
  row for this venue, which counts cafés in Vancouver and Montreal. The claim had no row
  before the edit and has none after it.
- **Chewies: cut "It is a small chain".** No row said so, so this was cut for lack of a
  source and the cut is correct. The 400m claim beside it was kept and still has no row.
  See the claims section.
- **The Naam: cut "made locally".** The row says organic tofu, tempeh and maple syrup
  and makes no local-sourcing claim. This is the best cut in the five files: a specific
  detail removed because the source did not carry it, with the rest of the sentence left
  standing.
- **Wording only.** "Open since 1988, with a menu that is brunch and comfort food" became
  two sentences. "Plus a separate line for large parties" became "A separate line takes
  large parties and events".

**Left blank.** The "still not verified" list is unchanged and still ends with "any
price on this route: none was read, so none is printed". The edit invented no price,
which is the right outcome for a route with no menu source in the table.

**Word count:** 939 before, 905 after.

---

## Mount Pleasant evening: a cocktail at five, dinner at a Michelin counter, a last room on Main

### Core Critique

This file had the most to lose and lost the most: 81 words of the earlier agent's cuts
and three prices from this review's gate pass. The compression is good and one claim is
now true where it was false ("the longest one" became "the latest close"). The Kobo cut
moved the reason for the seasonal hours out of the stop, leaving the reader's most likely
landing place bare.

### Changelog

- **Intro and days compressed.** The days paragraph became "Burdock closes Tuesday and
  Wednesday; the other three are open daily", and the table below still shows the same
  thing day by day. The walk explanation became a colon and two clauses. No fact changed.
- **Cascade Room: phrasing and reflow.** "Happy hour is the reason for the hour" became
  "The hour is set for happy hour". The four drink prices and the $7 fries were reflowed
  into two sentences and every amount is still in the row.
- **Burdock: cut a sourced locational detail.** "At the east end of Main" went, and the
  Scout row carries that phrase. "Seven-course tasting at $175" became "seven courses at
  $175". Cut for length, not for lack of a source.
- **Kobo: made worse, mildly.** The paragraph explaining why the September to May rule is
  the one running in November was cut from the stop. The table note above the stops
  still says it and the hour-conflicts section still carries the reasoning, so the fact
  survives twice. The stop itself now prints seasonal hours with no caveat in place,
  which is where a reader arriving at that heading will look.
- **Kobo: a list fixed.** "Tahini and roasted walnut" became "tahini, roasted walnut",
  which stops two flavours being read as one.
- **Uncle Abe's: a false claim replaced with a true one.** "The last room, and the
  longest one" became "the latest close". Nothing in the file supported "longest" (695m
  is not a long walk) and the hours do support "latest".
- **Uncle Abe's: prices cut, this review's change.** The paragraph carried "$10 for a 2oz
  cocktail, $5 for a 16oz lager and $5 for a pickleback". The row says "happy hour
  16:00–18:00 and prices" and carries no amounts, and the venue's own page renders its
  body by script, so the amounts could not be re-read. The happy-hour window and the
  caveat that the route arrives after it stay; the three amounts went. This is the only
  change in this review that touches a route file.

**Left blank.** The "still not verified" list is unchanged, including what Uncle Abe's
regular list costs, what a scoop costs at Kobo, and whether four people get onto the
patio on a Friday.

**Word count:** 1531 before, 1450 after the earlier agent's edit, 1443 now.

---

## Claims that lost their source

Each item names a specific detail in the edited copy that the file's sources table does
not support, or supports only in a way the sentence has outgrown. Ordered by how likely
a reader is to be misled.

**Gastown, L'Abattoir: "There is no upstairs bar. The second-floor space is private
dining."** No row covers either sentence. The route's research note records the upstairs
bar as "not found" and says the house "names a bar without giving its floor". The edit
re-punctuated the sentence and left the negative standing as fact while the evidence file
behind it says unverified. Either the venue's private-dining page goes in the sources
table with the date it was read, or the sentence goes.

**Gastown, Timbertrain: "The room is sixteen seats, built as pairs in booths along one
wall."** The row exists, and it is a 2013 design piece. The research note says the room
may have changed since. The old text said "was built as", which carried the date; the new
text says "is", which does not. The number is sourced to a thirteen-year-old article and
is now printed as a current count.

**Gastown, Six Acres: "The beer list leans on local breweries and Belgian classics."**
The row cites a 2016 Vancouver Magazine patio piece, and the research note says the beer
range "was not re-checked against the current list". The price claim in the same
paragraph is dated to the current menu; this one is not.

**Kitsilano, Chewies: "It is the only bar within 400m that publishes hours; the two
independent rooms next door, The Ellis and Mount Everest Kitchen & Bar, publish none."**
No row, before the edit or after it. It is a count and two negatives computed over the
database. Checked in this pass and it holds: within 420m of Chewies the bar rows are
Local Public Eatery at 156m with hours, The Ellis at 74m and Mount Everest at 72m with
none, and Kitsilano Wine Cellar at 320m with none. A true claim with no record of how it
was made needs a row like "database, stored coordinates and hours, 2026-11-02".

**Kitsilano, 49th Parallel: "Espresso and filter; beans sold by the bag."** The only row
for this venue covers the café count. The retail claim was in the draft before this edit
and survived it unchanged.

**Chinatown, intro: "all inside the district".** New in this edit and unsupported by any
row. The database does file all five stops under Chinatown, so it is true in that sense.
620 Quebec Street is east of Gore Avenue, so a reader with a map may read it as false.

**Chinatown, the closing section: "three bars with published hours … 518m … 1017m …
55m".** The only row cited in that section is the Keefer Bar's hours. The count and the
three distances are computed over the database. Re-run in this pass: the Chinatown bar
rows with hours are Alibi Room, The Ivanhoe Pub and The Keefer Bar, so the count of three
is exact, and the distances are straight-line from stored coordinates.

**Chinatown, New Town: "Dine-in closes at 19:00."** The row carries the last order at
18:45 and the hours line carries 20:30, but nothing states 19:00. The file's own
"still not verified" section flags the 19:30 and 20:30 conflict, so the writer knew the
number was soft.

**Mount Pleasant evening, Uncle Abe's: the three happy-hour prices.** Cut by this review,
not by the earlier agent. The row states that prices are published and carries none of
them, and the page could not be read to recover them.

**Mount Pleasant evening, Uncle Abe's: "The last room, and the latest close."** The
superlative is true against the hours in this file and the alternatives listed, and no
row states the comparison. Lower risk than the rest, because the hours that prove it are
in the file, but a comparative claim is still a claim.

**Mount Pleasant, one route clean.** No claim in the Mount Pleasant daytime route lost
its source. Every figure in it, including all three Barney's prices and both brewery
prices, is carried by a row for that venue.

---

## Claims cut by the marker pass

The five routes now carry claim-level provenance. A sentence with a price, a capacity
or count, a date, a year, an opening time in prose, or a distance that is not in the
legs table carries a `[[sN]]` marker, and each marker resolves to a row in that file's
`## Sources` register (`| key | source | read |`). `src/scripts/check-route-copy.js`
enforces both directions: a claim sentence with no resolvable marker fails, a marker
with no row fails, a register row that no marker references fails, and so does a marker
that is not exactly `[[sN]]`. The old version of the gate asked a venue-level question —
does some row name this stop — which a single "Scout Magazine place page" row answered
for a seat count, a price and an opening year at once. That is gone.

Three specific claims had no row to point at. They were cut rather than sourced.

**Chinatown, intro: "all inside the district".** The sentence was "481m end to end, all
inside the district." The 481m is the legs-table total and now carries its marker. The
second clause was added by the earlier proof pass with no row behind it, and 620 Quebec
Street sits east of Gore Avenue, normally the district's eastern edge, so a reader with
a map can read it as false. The clause is gone; the distance stays.

**Chinatown, New Town Bakery: "Dine-in closes at 19:00."** Nothing in the file states
19:00. The venue row carries the last order at 18:45, the hours line below the heading
carries 20:30, and the file's own "still not verified" section already flagged 19:30 as
its site's claim against 20:30 as the database's. The sentence now reads "The last order
is at 18:45", which is the figure the row carries, marked `[[s4]]`.

**Kitsilano, 49th Parallel: "Espresso and filter; beans sold by the bag."** The only row
for this venue counts its cafés in Vancouver and Montreal and says nothing about retail.
The claim had no row before the earlier edit and none after it, which is what the
provenance section above records. The sentence went; the café count stands, marked
`[[s5]]`.

Two things changed without being cut, and both are worth reading next to the cuts:

- **Gastown, Timbertrain: "The room is sixteen seats."** The row behind it is a 2013
  design piece and the research note says the room may have changed since, so the
  sentence is back to "The room was built as sixteen seats", which is what the row
  supports, with `[[s3]]` sitting next to the 2013 date it rests on. This answers the
  second item in "Claims that lost their source" above without inventing anything.
- **Rows that carry no read date.** Eight of the forty-nine register rows name a source
  but no date it was read — seven in Gastown, one in Kitsilano (Au Comptoir's site,
  whose URL this file never recorded). Their `read` cells say `not recorded`. No date
  was filled in for them here: an invented read date is the same failure as an invented
  price.

The register also lost a row. Gastown's "Guilt & Co two shows" row now carries the
closing times it was already the evidence for, and Chinatown's Keefer Bar hours row is
part of the bars-with-hours row (`s8`) that the closing section actually cites;
Kitsilano's Au Comptoir row is new, because that conflict section cites the site and had
nothing to point at. Mount Pleasant evening lost its Burdock Scout row: the two facts it
carried, the east end of Main and the natural wine, were cut from the copy before this
pass, so the row had no sentence left to support.

**Left blank.** Every item in each file's "still not verified" section is still open.
No gap was filled, and no price, count, date or hour was added anywhere.
