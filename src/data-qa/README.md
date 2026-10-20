'use strict';
/**
 * Directory data QA — the D4 JEV pilot, behind our own interface.
 * ==============================================================
 *
 * This folder is a DATA-QA TOOL that runs *alongside* the site. It does not change any
 * user-facing behaviour and it is not part of the Smart Concierge. Nothing in the running
 * Express app requires or imports it.
 *
 * What it does (deterministic baseline, no model):
 *   - duplicate / near-duplicate detection across the live directory DB
 *   - category-correctness checks
 *   - a quality score 0-100, built additively so every point has a named reason
 *
 * What the JEV pilot adds (only once a key exists): a swappable classifier behind one narrow
 * interface, measured against that baseline on the same records. If it does not beat the
 * baseline, we drop it (assessment §5, recommendation 3).
 *
 * SCOPE GUARANTEE — this never touches a risk gate, a rule engine or position sizing. A model
 * is only ever allowed to emit QA *verdicts*. See the assessment §4.2 and §5.4.
 *
 * ---------------------------------------------------------------------------------------------
 * FILES
 * ---------------------------------------------------------------------------------------------
 *   load.js         read-only loader for prisma/dev.db (node:sqlite, readOnly)
 *   normalize.js    shared deterministic helpers (name/address normalise, haversine, validity)
 *   baseline.js     deterministic scorer: scoreRecord, detectDuplicates, runBaseline
 *   classifier.js   the ONE interface + three implementations (baseline | stub | jev)
 *   run-baseline.js CLI: baseline over the live DB
 *   compare.js      CLI: candidate-vs-baseline harness with a verdict metric
 *
 * ---------------------------------------------------------------------------------------------
 * RUN IT (no key needed)
 * ---------------------------------------------------------------------------------------------
 *   npm run qa:baseline                       # baseline over all 2958 records
 *   npm run qa:baseline -- --limit 500        # deterministic first-500 sample
 *   npm run qa:compare -- --candidate stub --limit 300
 *
 * ---------------------------------------------------------------------------------------------
 * ENABLING JEV LATER (when the key lands)
 * ---------------------------------------------------------------------------------------------
 * 1. KEY. Put the key in the PROFILE .env ONLY — never in chat, never printed, never committed,
 *    never written into a document. The adapter reads it from the environment at runtime:
 *
 *        # C:\Users\jayng\AppData\Local\hermes\profiles\gemini\.env
 *        TYPESAFE_API_KEY=...        # (JEV_API_KEY is also accepted)
 *
 *    Get a key at https://console.typesafe.ai/keys. The .env is gitignored, so the key can
 *    never be committed by accident. Never echo it — `echo $TYPESAFE_API_KEY` prints a secret
 *    to the terminal and the scrollback; use `test -n "$TYPESAFE_API_KEY"` to check presence.
 *
 * 2. ENDPOINT. The official evaluation endpoint (verified from the vendor docs, 2026-10-16):
 *
 *        POST https://api.typesafe.ai/v1/systemone
 *        Authorization: Bearer <API_KEY>
 *        Content-Type: application/json
 *        body: { "model": "jev-latest", "state": "<string>", "questions": { ... } }
 *
 *    Each question is typed — {"type":"noul"} for yes/no, {"type":"choice"} with a criteria
 *    map, {"type":"score"} with ordered bands — and the response is { model, answers, usage }.
 *    We ask three bounded questions per record (is_duplicate, category_correct, quality) and
 *    keep `state` to only the fields those questions need (JEV suffers from context rot).
 *    Base URL and model are overridable via JEV_BASE_URL / JEV_MODEL.
 *
 * 3. RE-RUN THE COMPARISON:
 *
 *        node src/data-qa/compare.js --candidate jev --limit 300
 *
 *    With no key the adapter refuses to construct a client and throws a key-free error; the
 *    stub path (`--candidate stub`) proves the whole pipeline end-to-end without it.
 *
 * 4. MEASURE "bEATS THE BASELINE". Agreement alone is not "beats" — it means the candidate
 *    makes the same calls. To measure a real win, hand-label a sample of records and pass it:
 *
 *        node src/data-qa/compare.js --candidate jev --limit 300 --labels labels/duplicates.json
 *
 *    The harness then prints duplicate precision/recall/F1 for BOTH classifiers and a verdict
 *    of candidate_beats_baseline / baseline_better / tie.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS UNTESTABLE UNTIL A JEV KEY EXISTS
 * ---------------------------------------------------------------------------------------------
 *   - the live HTTP call to api.typesafe.ai and its response mapping
 *   - JEV's actual duplicate/category/score decisions, and whether they beat the baseline
 *   - cost/latency at our volume
 *   Everything else (baseline, interface, stub, harness, verdict logic) runs today.
 */