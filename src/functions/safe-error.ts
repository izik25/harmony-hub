/**
 * Server functions in this app throw plain short codes (e.g. "invalidCredentials") for
 * expected business-logic failures — those are safe to show the client as-is (see
 * translateServerError in lib/i18n.ts). Anything else — a DB driver error, a network
 * timeout, whatever — carries internal detail (queries, params, stack traces) that must
 * never reach the browser. This narrows any caught error down to one of our own known
 * codes, or a generic fallback, logging the real cause server-side either way.
 */
const CLEAN_CODE = /^[a-zA-Z]+$/;

export function toSafeError(error: unknown): Error {
  if (error instanceof Error && CLEAN_CODE.test(error.message)) return error;
  console.error(error);
  return new Error("unexpectedError");
}
