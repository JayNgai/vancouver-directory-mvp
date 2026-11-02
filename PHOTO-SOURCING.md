# Sourcing genuine photographs of each venue

The directory holds 2,958 listings and **20 distinct stock images**. The 400 image
files are those 20 recycled: one picture covers 42 venues. Stand-ins are labelled
honestly, which is why the site is not lying, but a visitor looking at 42 cafés
with the same photo learns that the photography is not real.

This plan replaces stand-ins with photographs of the actual venues, in an order
that keeps the cost near zero until it is proven.

## The rule that decides everything

A photo may claim a venue only when all five hold (from
`.audit/schema-and-photos-plan.md`):

1. a licence that permits commercial display, with its terms and a URL;
2. an attribution string stored on the row;
3. an identity check tying the image to **this branch**, not this brand;
4. a named reviewer and a review date;
5. the file itself, at a usable size.

The database already has the columns: `imageKind`, `imageLicence`,
`imageLicenceUrl`, `imageReviewer`, `imageReviewedAt`. The renderer already refuses
to print a photo without an `imageKind`. The missing pieces are a source of real
images and a review step.

## What must not be done

- **No scraping Google Maps, Yelp, TripAdvisor or Instagram photos.** Their terms
  do not grant redistribution, and a directory that exists by citing its sources
  cannot steal its photography.
- **No photo of a different branch of the same chain.** That is the identity check.
- **No photo without a rights grant**, even from a friendly owner in an email that
  says "sure".

## The four sources, best first

### 1. Owners, through the claim flow (highest value, zero licence risk)

The site already runs a claim funnel whose copy promises "add your own photos".
The cheapest real photography is the owner's own, because the rights come with the
person who owns the place.

Needed: an upload on `/claim`, a rights checkbox ("I took this or have permission
to grant it"), a size check, and a review queue in `/admin`. `multer` is already a
dependency, and `/admin` already exists behind the loopback guard.

Cost: build time only. Rights: granted by the uploader. Coverage: only owners who
claim, which today is few, so this alone will not fill 2,958 rows.

### 2. A licensed photo agency, per district

For venues without owners in the loop, buy coverage district by district:
Shutterstock / Getty / Adobe Stock have Vancouver coverage with standard licences
that permit commercial display with attribution.

Cost: roughly one image per venue at marketplace rates. Buying 100 Gastown venues
is a bounded spend that proves the pipeline; buying 2,958 up front is not.

Risk: an agency photo of a chain branch may not be *this* branch. The identity
check applies here more than anywhere.

### 3. A commissioned walk, by district

One photographer, one afternoon, one district: shoot 20–30 venues from the street,
with a consent form and a licence granting the site display rights. This produces
genuine, current, correctly identified images.

Cost: a day rate per district. It scales honestly, district by district, and it
solves the identity problem because the photographer stands in front of the door.

### 4. Openly licensed sources, opportunistically

Wikimedia Commons, Openverse, Flickr CC-BY: mostly landmarks, occasionally a
venue. Worth a search per venue before buying, never worth depending on.

## The pipeline, in order

1. **Extend the claim flow with photo upload** and the rights checkbox. This is the
   only source that scales for free, and it is already promised in the product copy.
2. **Build the review queue** in `/admin`: image, venue, proposed licence, approve
   or reject, which writes `imageReviewer` and `imageReviewedAt`.
3. **Pilot 20 venues** across two districts, using the mix above, and measure:
   hours per venue, rejection rate, licence costs, and whether the identity check
   catches the branch trap.
4. **Then go district by district**, worst-covered first, rather than across the
   whole city at once.
5. **Retire the stand-in tier per venue** as real photos land, and only then bring
   the "photographed" count back to the homepage, counting `owner` and `licensed`
   only.

## What "done" looks like

- Every listing has either a photo of that venue or the designed no-photo block.
- No two rows share an image unless they are genuinely the same place.
- Each photo row carries licence, attribution, reviewer and date.
- The homepage count equals `count({ where: { imageKind: { in: ['owner','licensed'] } } })`,
  which is zero today and honest while it stays zero.

## Effort, stated as a range

The pilot answers this properly. A reasonable prior: a commissioned walk covers
20–30 venues per day; owner uploads arrive at the rate owners claim; agency
sourcing is minutes per venue once the licence template exists. The review step is
the bottleneck at roughly 2–3 minutes per image.
