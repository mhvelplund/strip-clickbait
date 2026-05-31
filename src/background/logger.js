/**
 * Lightweight diagnostic logger.
 *
 * All extension modules import this and call log.debug / log.info / log.warn /
 * log.error instead of console.* directly.  Diagnostic output is gated on a
 * runtime flag stored in browser.storage.local so it can be toggled from the
 * options page without reloading the extension.
 *
 * Usage:
 *   import { log } from "./logger.js";
 *   log.debug("fetch started", { url });
 *   log.error("something broke", err);
 */

const STORAGE_KEY = "diagnosticsEnabled";

let _enabled = false;

// Load the initial value once at module evaluation time.
browser.storage.local.get(STORAGE_KEY).then((stored) => {
  _enabled = Boolean(stored[STORAGE_KEY]);
});

// React to live changes from the options page.
browser.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEY in changes) {
    _enabled = Boolean(changes[STORAGE_KEY].newValue);
  }
});

function fmt(level, args) {
  return [`[SCB:${level}]`, ...args];
}

export const log = {
  debug: (...args) => { if (_enabled) console.debug(...fmt("DEBUG", args)); },
  info:  (...args) => { if (_enabled) console.info(...fmt("INFO",  args)); },
  warn:  (...args) => { console.warn(...fmt("WARN",   args)); },
  // Errors are always logged regardless of the flag.
  error: (...args) => { console.error(...fmt("ERROR",  args)); },
};
