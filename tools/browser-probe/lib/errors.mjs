/**
 * The one error type this tool raises deliberately.
 *
 * The distinction the type carries is the whole exit-code contract: an
 * `ToolError` means "the probe could not run" (exit 2) — no browser, no
 * service, a report that would land outside the repository. Anything a probe
 * *found* is a check with status `fail` (exit 1) and never an exception. A tool
 * that cannot run must say so rather than report a pass, which is why the two
 * are not the same kind of thing.
 */
export class ToolError extends Error {
  /**
   * @param {string} message what could not be done, and what to try instead
   * @param {{code?: string, cause?: unknown}} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ToolError';
    this.code = options.code ?? 'tool_error';
  }
}

/** True for the errors a caller is expected to handle by exiting 2. */
export function isToolError(error) {
  return error instanceof ToolError;
}
