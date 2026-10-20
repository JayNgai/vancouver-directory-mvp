/**
 * One place that decides what an error is ALLOWED to say to a caller.
 *
 * Returning `error.message` verbatim handed an unauthenticated caller a Prisma invocation (model,
 * filter shape, arguments), the internal path of the route file, and source lines from it - free
 * reconnaissance, on every endpoint. The fix is not to stop logging: the DETAIL goes to the log, the
 * caller gets a generic body, and the status code stays honest.
 *
 * CR_ERROR_DETAIL=1 (default OFF) restores verbose client errors for local debugging. Keep it OFF
 * anywhere the app is reachable by anything other than localhost.
 */
const VERBOSE = process.env.CR_ERROR_DETAIL === '1';

/** The full detail, server-side only. */
function detail(scope, error) {
  const text = (error && error.stack) ? error.stack : String(error);
  console.error(`[${scope}] ${text}`);
}

function generic(status, publicMessage) {
  if (publicMessage) return publicMessage;
  if (status === 400) return 'Bad request';
  if (status === 404) return 'Not found';
  return 'Internal error';
}

/** JSON error for the API routes. The status is preserved - a 400 stays a 400. */
function failJson(res, scope, error, status = 500, publicMessage) {
  detail(scope, error);
  const body = { success: false, error: VERBOSE && error ? String(error.message || error) : generic(status, publicMessage) };
  return res.status(status).json(body);
}

/** Plain-text error for the HTML routes. */
function failText(res, scope, error, status = 500, publicMessage) {
  detail(scope, error);
  return res.status(status).send(VERBOSE && error ? String(error.message || error) : generic(status, publicMessage));
}

module.exports = { failJson, failText, generic, VERBOSE };
