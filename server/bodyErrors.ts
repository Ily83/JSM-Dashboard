/**
 * Client errors that express.json reports for a request body (malformed,
 * oversized or compressed JSON), and what the API answers for them.
 */

const BODY_ERROR_MESSAGE: Partial<Record<number, string>> = {
  413: 'The request is too large.',
  415: 'Unsupported request encoding.',
};

/** The 4xx status of a body-parser error, or null for any other error. */
export function bodyErrorStatus(error: unknown): number | null {
  const status = typeof error === 'object' && error !== null && 'type' in error && 'status' in error ? error.status : null;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/** The answer to a body-parser error with that status. */
export function bodyErrorMessage(status: number): string {
  return BODY_ERROR_MESSAGE[status] ?? 'The request body is not valid.';
}
