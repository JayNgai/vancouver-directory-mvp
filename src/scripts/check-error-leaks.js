/**
 * Guards the error path: no route may hand a client the INTERNALS of a failure.
 *
 * WHY: a verbatim error.message gave an unauthenticated caller a Prisma invocation (model, filter
 * shape, arguments), the internal path of the route file, and source lines from it. The detail is
 * still logged - only the CLIENT stops receiving it. Run:  node src/scripts/check-error-leaks.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
const check = (cond, label, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

// ---------- 1. STATIC: no route leaks a raw error into a response ----------
console.log('--- no route hands an error message to the client ---');
const files = [];
for (const f of fs.readdirSync(path.join(ROOT, 'src', 'routes'))) {
  if (f.endsWith('.js')) files.push(path.join('src', 'routes', f));
}
files.push('server.js');
let hits = 0;
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  src.split('\n').forEach((line, i) => {
    // a response line that also carries an error message or a stack is the leak shape
    const isResponse = /\bres\.(status|send|json|render)\b/.test(line);
    if (isResponse && /(\.message|\.stack)\b/.test(line) && !/success:\s*false,\s*error:\s*['"]/.test(line)) {
      hits++;
      console.log(`      ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}
check(hits === 0, `no route sends .message / .stack to a client`, hits ? `${hits} site(s)` : '');

// ---------- 2. RUNTIME: the helper is generic by default, detailed in the log ----------
console.log('\n--- the helper, with a realistic Prisma-style error ---');
const { failJson, failText } = require(path.join(ROOT, 'src', 'lib', 'errors.js'));
const nasty = new Error([
  'Invalid prisma.business.findMany() invocation in',
  path.join(ROOT, 'src', 'routes', 'api.js') + ':93:22',
  'Unknown argument mode.',
].join('\n'));

const captured = [];
const realErr = console.error;
console.error = (...a) => captured.push(a.join(' '));
let sent = null;
const fakeRes = { status(c) { this.code = c; return this; }, json(b) { sent = b; return this; } };
try { failJson(fakeRes, 'GET /businesses', nasty); } finally { console.error = realErr; }

const body = JSON.stringify(sent);
check(sent && sent.error === 'Internal error', 'the client gets a generic message', JSON.stringify(sent && sent.error));
check(!/prisma/i.test(body), 'no Prisma invocation reaches the client');
check(!body.includes('routes'), 'no internal file path reaches the client');
check(!/Unknown argument/.test(body), 'no source detail reaches the client');
check(fakeRes.code === 500, 'a 500 is still reported as 500');
check(captured.join(' ').includes('prisma'), 'the DETAIL still reaches the log', `${captured.length} log line(s)`);
check(captured.join(' ').includes('api.js'), 'the log keeps the file path for the developer');

console.log('\n--- honest status codes are preserved ---');
let s400 = null;
const res400 = { status(c) { this.code = c; return this; }, json(b) { s400 = b; return this; } };
const quiet = console.error; console.error = () => {};
try { failJson(res400, 'POST /concierge', new Error('x'), 400, 'Unknown neighborhood: gastown'); } finally { console.error = quiet; }
check(res400.code === 400, 'a 400 is NOT collapsed into a 500');
check(s400.error === 'Unknown neighborhood: gastown', 'a deliberate, safe message survives verbatim');

console.log('\n--- the verbose flag defaults OFF ---');
check(process.env.CR_ERROR_DETAIL !== '1', 'CR_ERROR_DETAIL is not set in this environment');
const { execFileSync } = require('child_process');
const verboseOut = execFileSync(process.execPath, ['-e', `
  const { failJson } = require(${JSON.stringify(path.join(ROOT, 'src', 'lib', 'errors.js'))});
  const quiet = console.error; console.error = () => {};
  let sent = null;
  failJson({ status(c){ return this; }, json(b){ sent = b; } }, 't', new Error('the raw detail'));
  console.error = quiet;
  console.log(sent.error);
`], { encoding: 'utf8', env: { ...process.env, CR_ERROR_DETAIL: '1' } }).trim();
check(verboseOut === 'the raw detail', 'CR_ERROR_DETAIL=1 restores verbose errors for local debugging', JSON.stringify(verboseOut));

console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
