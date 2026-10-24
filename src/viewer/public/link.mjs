/**
 * lifegame viewer — how the shell and a page module find each other.
 *
 * A page module (`pages/world.js`, `pages/history.js`, `pages/archives.js`) must
 * not import the shell. `app.js` runs on import and touches the DOM, so the test
 * suite loads it with a fresh module URL per case (`app.js?case=7`); a page
 * module that imported it by a plain path would resolve to a *different* copy of
 * the shell — one that has run, found no data, and thrown away its state. That is
 * not a hypothetical: it is the reason the first attempt at this split rendered
 * no tree at all in the browser while the tests passed.
 *
 * So the two sides talk over the document instead:
 *
 * 1. the page module registers a listener for `lifegame:shell` and then
 *    dispatches `lifegame:shell-request`;
 * 2. the shell answers every request with the context in `event.detail`, and it
 *    also publishes once when it starts.
 *
 * Both load orders therefore work. **Page first**: its request is dispatched
 * before the shell exists and is lost, but the shell's own start-up publication
 * arrives afterwards. **Shell first** — the order the layout uses, because the
 * shell's `<script>` tag is written before the page's — the request is answered
 * directly.
 *
 * The page hands its module-level bindings to `fill`, so its functions read
 * `state`, `dom` and `t` exactly as they did when all of this was one file.
 *
 * This module owns both event names, and the shell imports them from here: the
 * two sides of one handshake cannot end up listening on two spellings of it.
 */

/** The shell's publication. */
export const SHELL_EVENT = 'lifegame:shell';

/** A page's request for the context. */
export const SHELL_REQUEST_EVENT = 'lifegame:shell-request';

/**
 * Connect a page module to the shell.
 *
 * @param {(context: object) => void} fill receives the context; called again if
 *   the shell publishes more than once, so a page that wants to re-read the
 *   shared state can simply assign what it needs.
 * @param {() => void} [ready] called once, the first time a context arrives.
 * @returns {() => void} the adopted listener, so a test can drop it.
 */
export function connectShell(fill, ready) {
  let connected = false;
  const adopt = (event) => {
    const context = event === null || event === undefined ? null : event.detail;
    if (context === null || typeof context !== 'object') return;
    fill(context);
    if (connected) return;
    connected = true;
    if (typeof ready === 'function') ready();
  };
  document.addEventListener(SHELL_EVENT, adopt);
  // Ask now as well: if the shell is already listening — the usual order — this
  // is what delivers the context, and the answer arrives synchronously.
  document.dispatchEvent(new CustomEvent(SHELL_REQUEST_EVENT));
  return adopt;
}
