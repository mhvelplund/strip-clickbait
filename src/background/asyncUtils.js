/**
 * Async utility helpers used across the extension background scripts.
 *
 * - withTimeout: race a promise against a wall-clock deadline.
 * - withRetry:   retry a failing async operation with exponential back-off.
 */

/**
 * Race `promise` against a timeout.  Rejects with a descriptive Error if the
 * timeout fires first.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms          - Timeout in milliseconds.
 * @param {string} [label]     - Included in the error message for diagnostics.
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Execute fetch with an AbortController-backed timeout so the underlying
 * request is cancelled when the deadline expires.
 *
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(
  input,
  init,
  ms,
  label = "operation",
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry `fn` up to `maxAttempts` times with exponential back-off.
 * Only retries on transient errors (network, 5xx); re-throws immediately on
 * 4xx-style errors since those won't be fixed by retrying.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=500]
 * @param {(err: Error, attempt: number) => void} [opts.onRetry]
 * @returns {Promise<T>}
 */
export async function withRetry(
  fn,
  { maxAttempts = 3, baseDelayMs = 500, onRetry } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Don't retry on 4xx (auth, not-found, etc.)
      if (/API error 4\d\d/.test(err?.message ?? "")) throw err;

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        onRetry?.(err, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
