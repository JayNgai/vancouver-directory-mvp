# /concierge Smart Directory Blueprint (v0.1)

## 🎯 GOAL
To serve as the primary revenue and utility hub, generating structured itineraries based on user input while simultaneously optimizing for local SEO authority signals (`Service Schema`).

## 🏗️ I. ARCHITECTURE & STRUCTURE
**Technology Stack:** Node/Express/Nunjucks (Existing: Directory MVP)
**Endpoint:** `/concierge`

**Required Components:**
1.  **Input Form (Front-end):** Captures user intent parameters.
    *   `user_prompt`: Free text (e.g., "Romantic afternoon in Kyoto").
    *   `duration`: Dropdown (2 hours, Full Day, etc.).
    *   `time_of_day`: Radio/Dropdown (Morning, Afternoon, Evening).
    *   `location_focus`: Selector for the primary service cluster (e.g., Travel, Local Errands, Dining).
2.  **Server-Side Logic (`server/conciergeHandler.js`):** The core orchestration logic.

## ⚙️ II. CORE FUNCTIONALITY FLOW (The "Smart" part)
1.  User submits form $\rightarrow$ Triggers backend function `generateItinerary(prompt, duration, time)`.
2.  `generateItinerary`:
    a. **Keyword Mapping:** Uses the input parameters to query the site's structured directory data (e.g., looking up 'Romantic' + 'Kyoto' in the database). *This is where the keyword strategy feeds into the feature.*
    b. **Content Selection:** Selects 3-5 relevant, high-value services from the database that match criteria (e.g., a specific dinner venue, a walking tour, etc.).
    c. **Output Assembly:** Assembles the itinerary using Nunjucks templates: Title $\rightarrow$ Time Slot $\rightarrow$ Venue Name $\rightarrow$ Description/Callout $\rightarrow$ Actionable Link (booking link/affiliate).

## 🏷️ III. SEO & SCHEMA REQUIREMENTS
**A. Schema Markup:**
*   The entire page should utilize **`WebSite` Schema**.
*   Each generated itinerary or core service listing must be marked with **`Service` Schema**, including:
    *   `@type`: Service
    *   `name`: The specific activity/venue (e.g., "Raku Museum Visit").
    *   `description`: Unique, rich copy for that service.
    *   `areaServed`/`geo`: Geo-coordinates and city served.

**B. Internal Linking:**
*   The generated itinerary must contain contextually linked anchor text pointing back to the *original directory category page* of every service used (e.g., "Book a similar **local activity** in this area").

## 💎 IV. MONETIZATION INTEGRATION
*   Every selected venue/service must have an associated tracking ID/Affiliate link that is swapped into the Nunjucks template output *before* rendering.
*   The feature should offer a clear CTA to "Become a Featured Partner" at the bottom, linking to the B2B sponsorship portal page.