# Vancouver Neighborhood Directory & Experience Curator (Plan 3.1)

**Project Location:** `<project-root>`  
**Status:** ✅ **Fully Built & Server Running Locally** (`http://localhost:5050`)  
**Stack:** Node.js + Express + Nunjucks + Prisma + SQLite  

---

## 🎯 OVERVIEW

A modern local directory and experience curator for Vancouver, British Columbia. Built on **Plan 3.1 ("Smart Experience Curator")**, combining verified local business listings with step-by-step interactive walking itineraries and 1-click Google Maps export navigation.

---

## 🚀 QUICK START

### 1. Run the Server
```bash
cd "<project-root>"

# Install Node modules
npm install

# Seed SQLite database with verified Vancouver data
node prisma/seed.js

# Start the server
node server.js
```

### 2. Open in Browser
Visit `http://localhost:5050` in your web browser.

---

## ✨ KEY FEATURES IMPLEMENTED

1. **5 Flagship Neighborhood Guides:**
   - **Gastown** (Historic District & Steam Clock)
   - **Kitsilano** (Beach, Fitness & West 4th Ave)
   - **Downtown Vancouver** (Culture, Art Gallery & Burrard Inlet)
   - **Yaletown** (Waterfront & Warehouse Patios)
   - **West End** (Stanley Park & English Bay Sunset)

2. **11 Verified Local Businesses:**
   - Real, verified local venues with real addresses, phone numbers, ratings, coordinates (`latitude`/`longitude`), and tag pills (`#patio`, `#craft-beer`, `#sushi`, `#live-jazz`).

3. **Curated Interactive Itineraries:**
   - *Gastown Historic & Culinary Stroll*
   - *Kitsilano Beach & West 4th Lifestyle Day*
   - *Downtown Culture & Waterfront Aburi Sushi*

4. **Hero Feature — 1-Click Google Maps Export:**
   - Every itinerary dynamically generates a `googleMapsUrl` walking directions export link that opens turn-by-turn navigation directly on mobile phones or web.

5. **Search & Filter Directory:**
   - Filter by keyword search, category dropdown, neighborhood dropdown, or tag pills (`#patio`, `#craft-beer`, etc.).

6. **B2B Business Claiming Portal:**
   - Venue claiming portal (`/claim`) for venue owners to submit ownership verification and select pricing tiers ($0 Free / $29 Featured / $79 Itinerary Spotlight).

---

## 🛠️ TECH STACK

- **Server:** Node.js + Express
- **View Engine:** Nunjucks (hot-reloading enabled for dev)
- **Database:** Prisma ORM on SQLite (`prisma/dev.db`)
- **Styling:** Custom responsive CSS (`/public/styles.css`)

---

## 📍 LIVE LOCAL URLs

- **Homepage:** `http://localhost:5050/`
- **Neighborhood List:** `http://localhost:5050/neighborhoods`
- **Neighborhood Detail:** `http://localhost:5050/neighborhoods/gastown`
- **Search Directory:** `http://localhost:5050/businesses`
- **Itineraries List:** `http://localhost:5050/itineraries`
- **Itinerary Detail (with Google Maps export):** `http://localhost:5050/itineraries/gastown-historic-culinary-stroll`
- **Claim Business Portal:** `http://localhost:5050/claim`
- **API Health Check:** `http://localhost:5050/api/health`

---

## 🧪 DIRECTORY DATA QA (D4 JEV pilot — tooling, not user-facing)

A deterministic data-QA tool runs alongside the site (it does not change any page or the Smart
Concierge). It finds duplicate records, checks category correctness, and scores each record
0–100 from its own fields. A swappable classifier sits behind one interface so a candidate model
(JEV) can be plugged in and measured against the baseline later — with a local stub today.

```bash
npm run qa:baseline                          # baseline over all records
npm run qa:compare -- --candidate stub --limit 300
```

See `src/data-qa/README.md` for how to enable JEV when a key lands (profile `.env` only) and the
rule that it must never touch a risk gate, a rule engine or position sizing.
