/**
 * Idempotent .env updater (never prints secret values).
 *
 * Sets / corrects the non-secret site settings so the file matches how the site actually runs:
 *   PORT=5050 (the site listens on 5050; 3000 was stale)
 *   SITE_NOINDEX=true
 *   CONTACT_EMAIL=jayngai718@gmail.com
 *   PUBLIC_BASE_URL=http://127.0.0.1:5050  (change to the tunnel hostname once it exists)
 *
 * Existing keys are rewritten in place; missing keys are appended. Everything else, including
 * secrets, is preserved untouched. Run:  node src/scripts/update-env.js
 */
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '..', '.env');

const WANTED = [
  ['PORT', '5050'],
  ['SITE_NOINDEX', 'true'],
  ['CONTACT_EMAIL', 'jayngai718@gmail.com'],
  ['PUBLIC_BASE_URL', 'http://127.0.0.1:5050']
];

if (!fs.existsSync(ENV)) {
  console.error('.env not found:', ENV);
  process.exit(1);
}

const original = fs.readFileSync(ENV, 'utf8');
const lines = original.split(/\r?\n/);
const seen = new Set();
const changed = [];

for (const [key, value] of WANTED) {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) {
    seen.add(key);
    const current = lines[index].split('=').slice(1).join('=').trim();
    if (current !== value) {
      lines[index] = `${key}=${value}`;
      changed.push(`${key}: (was different) -> ${value}`);
    }
  } else {
    seen.add(key);
    changed.push(`${key}: added -> ${value}`);
  }
}

// Append any that were still missing, keeping the file readable.
for (const [key, value] of WANTED) {
  if (!lines.some((line) => new RegExp(`^\\s*${key}\\s*=`).test(line))) {
    lines.push(`${key}=${value}`);
  }
}

const backup = `${ENV}.before-env-update`;
if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, 'utf8');
fs.writeFileSync(ENV, lines.join('\n'), 'utf8');

console.log(changed.length ? changed.join('\n') : 'no changes needed');
console.log('keys now present:', [...seen].sort().join(', '));
console.log('keys in file:', lines.filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]).sort().join(', '));
