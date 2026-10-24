/**
 * What the probe installs into the page, and the page-side measurements it can
 * take.
 *
 * The agent lives in `page-agent.js` and is read as text: it is injected with
 * `Page.addScriptToEvaluateOnNewDocument`, so it runs before the first byte of
 * the page's own scripts. Keeping it as a real file rather than a string built
 * here has two consequences worth stating — it is checked as JavaScript like
 * every other file in this tool, and it cannot accidentally close over anything
 * in this module, because nothing in this module is in scope for it.
 *
 * `pageSnapshot` is a page-side function serialised with
 * `Function.prototype.toString` and invoked with a JSON argument, so the
 * measurement code is ordinary JavaScript with no escaping layer between the
 * tool and the browser. It must therefore stay self-contained: no imports, no
 * closure over anything in this module.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The source installed into every new document, read from its own file. */
export const agentSource = readFileSync(path.join(here, 'page-agent.js'), 'utf8');

/**
 * The page-side measurements the geometry and interaction probes read back.
 *
 * @param {{selectors: string[], topmost: string[], points: Array<{x: number, y: number}>, container: string|null}} params
 */
export function pageSnapshot(params) {
  function describe(node) {
    if (node === null || node === undefined) return 'none';
    if (node === globalThis) return 'window';
    if (node === document) return '#document';
    const tag = node.tagName ? String(node.tagName).toLowerCase() : '?';
    const id = node.id ? '#' + node.id : '';
    let first = '';
    const className = node.className;
    if (typeof className === 'string' && className.trim() !== '') first = '.' + className.trim().split(/\s+/)[0];
    return tag + id + first;
  }
  function rect(element) {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      right: box.right,
      bottom: box.bottom,
      visible: style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0,
    };
  }
  function scrollOf(element) {
    if (!element) return null;
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
      verticalOverflow: element.scrollHeight > element.clientHeight,
    };
  }

  const agent = globalThis.__browserProbe;
  const scrolling = document.scrollingElement || document.documentElement;
  const selectors = Array.isArray(params.selectors) ? params.selectors : [];
  const topmostSelectors = Array.isArray(params.topmost) ? params.topmost : [];
  const points = Array.isArray(params.points) ? params.points : [];
  const containerSelector = params.container || null;

  const elements = selectors.map(function (selector) {
    let found = [];
    try {
      found = Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (error) {
      return { selector: selector, error: String(error.message), found: false, count: 0, rects: [] };
    }
    return {
      selector: selector,
      found: found.length > 0,
      count: found.length,
      first: rect(found[0]),
      rects: found.slice(0, 8).map(rect),
    };
  });

  const topmost = topmostSelectors.map(function (selector) {
    let found = [];
    try {
      found = Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (error) {
      return { selector: selector, error: String(error.message), found: false };
    }
    if (found.length === 0) return { selector: selector, found: false };
    const element = found[0];
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      selector: selector,
      found: true,
      count: found.length,
      rect: rect(element),
      center: { x: x, y: y },
      hit: describe(hit),
      hitTag: hit ? hit.tagName : null,
      isSelfOrDescendant: hit !== null && (hit === element || element.contains(hit)),
    };
  });

  const container = containerSelector === null ? null : { selector: containerSelector };
  if (container !== null) {
    let found = [];
    try {
      found = Array.prototype.slice.call(document.querySelectorAll(containerSelector));
    } catch (error) {
      container.error = String(error.message);
    }
    container.found = found.length > 0;
    container.count = found.length;
    if (found.length > 0) {
      container.rect = rect(found[0]);
      const metrics = scrollOf(found[0]);
      for (const key in metrics) container[key] = metrics[key];
    }
  }

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio },
    document: rect(document.documentElement),
    scroll: scrollOf(scrolling),
    bodyChildren: document.body ? document.body.childElementCount : 0,
    elements: elements,
    topmost: topmost,
    points: points.map(function (point) {
      const hit = document.elementFromPoint(point.x, point.y);
      return { x: point.x, y: point.y, hit: describe(hit), hitTag: hit ? hit.tagName : null };
    }),
    container: container,
    agent: agent
      ? {
          installed: true,
          events: agent.events.slice(-200),
          requests: agent.requests.slice(-200),
          errors: agent.errors.slice(-50),
          truncated: agent.truncated === true,
        }
      : { installed: false },
  };
}
