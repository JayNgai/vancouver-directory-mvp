'use strict';
/**
 * The pluggable classifier behind the Directory data-QA pipeline.
 *
 * ONE narrow interface — `classify(record, ctx) -> Verdict` — with three interchangeable
 * implementations:
 *   - BaselineClassifier  the deterministic reference (wraps ./baseline.js)
 *   - StubClassifier      a local stand-in so the pipeline runs end-to-end with no key
 *   - JevClassifier       the hosted JEV adapter, enabled only when a key is present
 *
 * SCOPE GUARANTEE: a classifier only ever produces QA *verdicts* (is this a duplicate, is the
 * category right, what is the quality score). It is never wired into a risk gate, a rule engine
 * or position sizing, and nothing in the site consumes it. Per the D4 decision and the JEV
 * assessment (§4.2, §5.4): never let a model own a hard limit.
 *
 * Verdict shape (stable contract every implementation must return):
 *   {
 *     isDuplicate: boolean|null,
 *     duplicateOf: string|null,      // id of the record it duplicates, when known
 *     categoryCorrect: boolean|null,
 *     suggestedCategory: string|null,
 *     qualityScore: number|null,     // 0..100
 *     confidence: number,            // 0..1
 *     rationale: string,             // human-readable justification
 *     model: string                  // which classifier produced this
 *   }
 */

const n = require('./normalize');
const { scoreRecord } = require('./baseline');

const CANONICAL_CATEGORIES = n.CANONICAL_CATEGORIES;

// ---------------------------------------------------------------------------------------------
// 1. Baseline classifier — the deterministic reference.
// ---------------------------------------------------------------------------------------------
class BaselineClassifier {
  constructor() {
    this.name = 'baseline';
  }

  classify(record, ctx = {}) {
    const base = scoreRecord(record);
    const dupRels = ctx.duplicateById ? ctx.duplicateById.get(record.id) || [] : [];
    const isDuplicate = dupRels.length > 0 || (ctx.duplicateIds ? ctx.duplicateIds.has(record.id) : false);
    const qualityScore = Math.max(0, base.score - (isDuplicate ? 20 : 0));
    const categoryCorrect = base.flags.categoryCanonical && base.flags.primaryMatchesCategory;
    return {
      isDuplicate,
      duplicateOf: dupRels.length ? dupRels[0].id : null,
      categoryCorrect,
      suggestedCategory: categoryCorrect ? record.category : null,
      qualityScore,
      confidence: 1.0,
      rationale: isDuplicate
        ? `deterministic: near-duplicate of ${dupRels.map((d) => d.name).join(', ')}`
        : `deterministic: ${base.reasons.filter((r) => r.ok).length}/${base.reasons.length} checks passed`,
      model: this.name
    };
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Stub classifier — a local stand-in so the pipeline is exercisable with no key today.
//    Deliberately naive ("trusts OSM"): flags no duplicates, trusts the given category, and
//    scores only on a couple of obvious fields. It exists to prove the harness runs and
//    differentiates a candidate from the baseline — NOT to be accurate.
// ---------------------------------------------------------------------------------------------
class StubClassifier {
  constructor({ name = 'stub' } = {}) {
    this.name = name;
  }

  classify(record) {
    const hasCoords = n.coordsInsideVancouver(record);
    const hasName = Boolean(record.name && record.name.trim().length >= 2);
    const qualityScore = Math.max(0, Math.min(100, (hasName ? 10 : 0) + (hasCoords ? 15 : 0) + 60));
    return {
      isDuplicate: false,
      duplicateOf: null,
      categoryCorrect: true,
      suggestedCategory: record.category || null,
      qualityScore,
      confidence: 0.5,
      rationale: 'stub: naive stand-in, trusts OSM fields without cross-checking',
      model: this.name
    };
  }
}

// ---------------------------------------------------------------------------------------------
// 3. JEV classifier — the hosted adapter. Only constructible when a key is present.
//
//    The key is read from the environment ONLY (profile .env). It is never printed, never
//    written to a file, never committed, never included in a rationale or an error message.
// ---------------------------------------------------------------------------------------------
const JEV_BASE_URL = process.env.JEV_BASE_URL || 'https://api.typesafe.ai';
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest';

class JevClassifier {
  constructor({ fetchImpl, baseUrl = JEV_BASE_URL, model = JEV_MODEL } = {}) {
    this.name = 'jev';
    this.baseUrl = baseUrl;
    this.model = model;
    this.fetch = fetchImpl || globalThis.fetch;
    this.keyPresent = Boolean(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
    if (!this.fetch) {
      throw new Error('JevClassifier: no fetch implementation available (need Node 18+).');
    }
  }

  /** Read the key without ever exposing it. Throws a key-free error when absent. */
  _key() {
    const key = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
    if (!key) {
      throw new Error(
        'JevClassifier: no JEV key found. Set TYPESAFE_API_KEY in the profile .env ' +
          '(never in code, chat or any document). See src/data-qa/README.md.'
      );
    }
    return key;
  }

  /** Build the bounded state + typed questions for one record. Kept minimal (JEV context rot). */
  buildRequest(record, ctx = {}) {
    const dupRels = ctx.duplicateById ? ctx.duplicateById.get(record.id) || [] : [];
    const state = {
      name: record.name,
      category: record.category,
      address: record.address,
      tags: n.tagsParse(record.tags) || [],
      candidate_duplicates: dupRels.map((d) => ({ id: d.id, name: d.name, reason: d.reason }))
    };
    return {
      model: this.model,
      state: JSON.stringify(state),
      questions: {
        is_duplicate: {
          type: 'noul',
          instructions:
            'Is this record the same physical business as one of its candidate_duplicates? ' +
            'Answer yes only if at least one candidate is clearly the same venue.'
        },
        category_correct: {
          type: 'choice',
          instructions: 'Which category best fits this business?',
          criteria: Object.fromEntries(CANONICAL_CATEGORIES.map((c) => [c, c]))
        },
        quality: {
          type: 'score',
          instructions: 'How complete and trustworthy is this directory record?',
          criteria: [
            'Unusable: missing identity or coordinates',
            'Poor: identity present but little else',
            'Adequate: usable, some gaps',
            'Good: complete and consistent',
            'Excellent: fully enriched and verified'
          ]
        }
      }
    };
  }

  async classify(record, ctx = {}) {
    const key = this._key();
    const body = this.buildRequest(record, ctx);
    const res = await this.fetch(`${this.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      // Never include the request headers (which carry the key) in any error text.
      throw new Error(`JevClassifier: systemone returned HTTP ${res.status}`);
    }
    const json = await res.json();
    return this.mapResponse(json, record);
  }

  /** Map the typed answers onto the shared Verdict contract. Defensive about field names. */
  mapResponse(json, record = {}) {
    const answers = (json && json.answers) || {};
    const conf = (...keys) => {
      for (const a of keys) {
        const v = answers[a];
        if (v && typeof v.confidence === 'number') return v.confidence;
      }
      return 0.5;
    };
    const valueOf = (a) => {
      const v = answers[a];
      if (!v) return null;
      return v.value !== undefined ? v.value : v.choice !== undefined ? v.choice : v.probability !== undefined ? v.probability : null;
    };

    const prob = valueOf('is_duplicate');
    const isDuplicate = typeof prob === 'number' ? prob >= 0.5 : Boolean(prob);
    const suggested = valueOf('category_correct');
    const rawScore = valueOf('quality');
    // score questions return a band index or a 0..1 value; normalise to 0..100.
    let qualityScore = null;
    if (typeof rawScore === 'number') {
      qualityScore = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
    } else if (typeof rawScore === 'string') {
      const idx = ['Unusable', 'Poor', 'Adequate', 'Good', 'Excellent'].findIndex((b) => rawScore.startsWith(b));
      if (idx >= 0) qualityScore = [10, 35, 60, 80, 95][idx];
    }

    return {
      isDuplicate,
      duplicateOf: null,
      categoryCorrect: Boolean(suggested && suggested === record.category),
      suggestedCategory: suggested || null,
      qualityScore,
      confidence: conf('is_duplicate', 'category_correct', 'quality'),
      rationale: 'jev: typed systemone answers',
      model: this.name
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------
function createClassifier(which, opts = {}) {
  switch (which) {
    case 'baseline':
      return new BaselineClassifier();
    case 'stub':
    case 'mock':
      return new StubClassifier(opts);
    case 'jev':
      return new JevClassifier(opts);
    default:
      throw new Error(`Unknown classifier "${which}" (use: baseline | stub | jev)`);
  }
}

module.exports = {
  BaselineClassifier,
  StubClassifier,
  JevClassifier,
  createClassifier,
  VERDICT_KEYS: ['isDuplicate', 'duplicateOf', 'categoryCorrect', 'suggestedCategory', 'qualityScore', 'confidence']
};