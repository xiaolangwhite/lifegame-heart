/**
 * lifegame viewer — the routed pages, composed on the server.
 *
 * The interface used to be one document. It grew until a change to the history
 * touched the same file as a change to the canvas, so it is now three pages,
 * each composed here from two pieces: the shared layout
 * (`public/pages/layout.html`) and one fragment per page
 * (`public/pages/world.html`, `history.html`, `archives.html`).
 *
 * **This module is the only route table.** The dispatch in `server.mjs`, the
 * `<nav>` every page carries and the script set a page loads are all read from
 * `ROUTES` below, so a route cannot exist in the navigation without existing in
 * the service, and a page cannot be served without the module that drives it.
 * That is the whole point of the file: two lists would drift.
 *
 * **The composition is string concatenation, not a template engine.** A classic
 * `<script>` in the layout has to set the theme before the first paint and
 * cannot import a module, so the layout is HTML with `{{slot}}` placeholders;
 * `fill()` replaces them and *fails* on a placeholder nobody supplied rather
 * than emitting `{{content}}` into a page. Zero dependencies, as everywhere
 * else in this module.
 *
 * **A fragment is a fragment.** It carries no `<html>`, `<head>` or `<body>`,
 * so a composed page has exactly one of each and exactly one `<title>`; a
 * fragment that grew one would produce nested documents, which is one of the
 * two defects that blanked the page when this split was first attempted.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the browser side of the interface lives. */
export const defaultPublicDir = path.join(here, 'public');

/** The shared layout, relative to the public directory. */
export const LAYOUT_FILE = 'pages/layout.html';

/**
 * The one script every route loads: the shell.
 *
 * It owns the language, the theme, the status line, the error banner, the API
 * client and the event stream. A page module never imports it — the two talk
 * over the `lifegame:shell` events described in `public/pages/link.mjs` — so
 * this is the only place the shell is named for a page.
 */
export const SHELL_SCRIPT = '/static/app.js';

/**
 * The routes, in the order the navigation lists them.
 *
 * `paths` is a list because the world has two names: `/` is what a person types
 * and what the launcher's smoke test probes, `/world` is what the navigation
 * links to. Both serve the same fragment, so they are one route with two paths
 * rather than two routes with one page each.
 */
export const ROUTES = Object.freeze([
  Object.freeze({
    id: 'world',
    paths: Object.freeze(['/', '/world']),
    href: '/world',
    fragment: 'pages/world.html',
    script: '/static/pages/world.js',
    navKey: 'nav.world',
  }),
  Object.freeze({
    id: 'history',
    paths: Object.freeze(['/history']),
    href: '/history',
    fragment: 'pages/history.html',
    script: '/static/pages/history.js',
    navKey: 'nav.history',
  }),
  Object.freeze({
    id: 'archives',
    paths: Object.freeze(['/archives']),
    href: '/archives',
    fragment: 'pages/archives.html',
    script: '/static/pages/archives.js',
    navKey: 'nav.archives',
  }),
]);

/** The navigation, derived from the routes so the two cannot disagree. */
export const NAV_ITEMS = Object.freeze(
  ROUTES.map((route) => Object.freeze({ id: route.id, href: route.href, labelKey: route.navKey })),
);

/** The placeholder names `layout.html` may use. A test compares the two sets. */
export const LAYOUT_SLOTS = Object.freeze(['page-id', 'nav', 'content', 'scripts']);

/** The route serving a path, or `null` when nothing serves it. */
export function routeFor(pathname) {
  return ROUTES.find((route) => route.paths.includes(pathname)) ?? null;
}

/** The scripts a route loads, in order: the shell first, then its own module. */
export function scriptsFor(route) {
  return [SHELL_SCRIPT, route.script];
}

/** The fragment file a route is composed from. */
export function fragmentFor(route) {
  return route.fragment;
}

/**
 * Replace every `{{slot}}` in a template.
 *
 * An unsupplied slot throws. Emitting the placeholder instead would ship a page
 * whose navigation says `{{nav}}`, which looks like a rendering bug in the
 * browser and is invisible in the composer.
 */
export function fillSlots(template, values, where) {
  return template.replace(/\{\{([a-z0-9-]+)\}\}/g, (whole, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`${where}: no value for the placeholder ${whole}`);
    }
    return values[name];
  });
}

/** Every `{{slot}}` name a template uses, without repeats. */
export function slotsIn(template) {
  return [...new Set([...template.matchAll(/\{\{([a-z0-9-]+)\}\}/g)].map((match) => match[1]))];
}

/**
 * The navigation, as markup.
 *
 * The current route is marked with `aria-current="page"` rather than with a
 * second class, because that is the attribute a screen reader understands and
 * the stylesheet can select. Every page gets the same navigation from this one
 * function, which is what makes the tab bar identical across the routes.
 */
export function renderNav(currentId) {
  const links = NAV_ITEMS.map((item) => {
    const current = item.id === currentId ? ' aria-current="page"' : '';
    return `<a class="tab" href="${item.href}" data-i18n="${item.labelKey}"${current}></a>`;
  });
  return `\n      ${links.join('\n      ')}\n    `;
}

/** The script tags a route loads. The shell is always first so it is listening. */
export function renderScripts(route) {
  return scriptsFor(route)
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join('\n    ');
}

/**
 * A composer for one public directory.
 *
 * The layout and the fragments are read once and kept: they are files this
 * service ships, and a change to them is a restart, not a request. Reading them
 * per request would put four synchronous file reads in front of every page for
 * no benefit.
 */
export function createPageRenderer(publicDir = defaultPublicDir) {
  const root = path.resolve(publicDir);
  const cache = new Map();

  const read = (relative) => {
    if (!cache.has(relative)) {
      // Normalised to LF so a checkout with autocrlf cannot change the bytes a
      // test compares against, the same rule the rest of the project follows.
      const text = readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
      cache.set(relative, text);
    }
    return cache.get(relative);
  };

  /**
   * The composed page for a path, or `null` when no route serves it.
   *
   * `null` rather than a default page: a path nobody serves must answer 404,
   * and falling back to the world would make every typo look like a working
   * address.
   */
  const render = (pathname) => {
    const route = routeFor(pathname);
    if (route === null) return null;
    const layout = read(LAYOUT_FILE);
    const content = read(route.fragment);
    return fillSlots(
      layout,
      {
        'page-id': route.id,
        nav: renderNav(route.id),
        content: content.replace(/\s+$/, ''),
        scripts: renderScripts(route),
      },
      LAYOUT_FILE,
    );
  };

  return { root, render, layout: () => read(LAYOUT_FILE), fragment: (route) => read(route.fragment) };
}

/** The composer for the directory this module ships with. */
export const defaultPageRenderer = createPageRenderer(defaultPublicDir);

/** The composed markup of a route by id, for a test or a report. */
export function renderRoute(id) {
  const route = ROUTES.find((entry) => entry.id === id);
  if (route === undefined) throw new Error(`no route with id ${JSON.stringify(id)}`);
  return defaultPageRenderer.render(route.paths[0]);
}
