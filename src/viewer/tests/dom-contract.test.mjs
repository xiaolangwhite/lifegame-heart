/**
 * The wiring between each routed page, its scripts and the modules they load.
 *
 * The interface is three pages, each composed from the shared layout and one
 * fragment, and served with the shell plus one page module. Nothing checks that
 * pairing at run time in a browser — a page module that binds an id its fragment
 * does not carry is a null dereference in the console, and `node --check` does
 * not help, because it resolves grammar and not bindings. Reading the files here
 * turns both into failures with names.
 *
 * Two rules this file exists for, in particular:
 *
 * - **Every id a route's scripts bind is declared by that route.** The synthetic
 *   document in `page.test.mjs` enforces the runtime half (it answers null for
 *   an undeclared id); this is the static half, so the failure names the file.
 * - **A page module never imports the shell.** The first attempt at this split
 *   did exactly that, and the test suite's fresh-module-per-case loading meant
 *   the page module received a shell instance with no data in it: an empty tree
 *   in a real browser, with every test green. The handshake is an event, and the
 *   last case here pins that.
 *
 * The rest is the single-page contract restated per route: no user-visible text
 * in the markup, no hardcoded phrase in a script, the theme bootstrap reading
 * the key `theme.mjs` owns, and every imported name actually exported.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { THEMES, THEME_STORAGE_KEY, parseColor } from '../public/theme.mjs';
import {
  LAYOUT_SLOTS,
  ROUTES,
  SHELL_SCRIPT,
  defaultPageRenderer,
  fillSlots,
  fragmentFor,
  slotsIn,
} from '../routes.mjs';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const read = (relative) => readFileSync(path.join(publicDir, relative), 'utf8').replace(/\r\n/g, '\n');

const layout = read('pages/layout.html');
const shellSource = read('app.js');
const shellName = SHELL_SCRIPT.replace('/static/', '');

/** Every script the routes load, by name, so a case can be about all of them. */
const scripts = new Map([[shellName, shellSource]]);
/** The page module of each route, by route id. */
const pageScripts = new Map();
for (const route of ROUTES) {
  const name = route.script.replace('/static/', '');
  const source = read(name);
  scripts.set(name, source);
  pageScripts.set(route.id, source);
}

/** The composed page of each route, which is what the service actually sends. */
const pages = new Map(ROUTES.map((route) => [route.id, defaultPageRenderer.render(route.paths[0])]));

function idsIn(markup) {
  return [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function idsBoundByScript(source) {
  return [...source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]);
}

/** The text nodes of a page, with the pre-paint script taken out. */
function textNodes(markup) {
  return [...markup.replace(/<script>[\s\S]*?<\/script>/g, '').matchAll(/>([^<>]+)</g)]
    .map((match) => match[1].trim())
    .filter((text) => text !== '' && !/^[\s·|]+$/.test(text));
}

/** A script with its comments removed, so prose is not read as copy. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// -- the ids --------------------------------------------------------------

test('every id a route\'s scripts bind is declared by that route', () => {
  for (const route of ROUTES) {
    const declared = new Set(idsIn(pages.get(route.id)));
    const bound = [...idsBoundByScript(shellSource), ...idsBoundByScript(pageScripts.get(route.id))];
    // The world page is the one that carries the controls and the readouts; the
    // other two are a tree and a file list. Both floors are real sets.
    const floor = route.id === 'world' ? 15 : 8;
    assert.ok(
      bound.length >= floor,
      `${route.id}: expected the scripts to bind the page's controls, saw ${bound.length}`,
    );
    for (const id of bound) {
      assert.ok(declared.has(id), `the ${route.id} page has no element with id="${id}"`);
    }
  }
});

test('no composed page declares the same id twice', () => {
  for (const [id, markup] of pages) {
    const ids = idsIn(markup);
    const duplicates = ids.filter((entry, index) => ids.indexOf(entry) !== index);
    assert.deepEqual(duplicates, [], `${id}: a duplicate id makes getElementById pick one silently`);
  }
});

test('the two controls a page binds are bound and present', () => {
  // `toggle-theme` belongs to the shell and therefore to every route;
  // `grid-width` belongs to the world page and only to that route. Both are
  // bound by a script, and both are declared where that script runs.
  for (const [routeId, source, id] of [
    ['world', shellSource, 'toggle-theme'],
    ['history', shellSource, 'toggle-theme'],
    ['archives', shellSource, 'toggle-theme'],
    ['world', pageScripts.get('world'), 'grid-width'],
  ]) {
    assert.ok(idsBoundByScript(source).includes(id), `a script of ${routeId} must bind #${id}`);
    assert.ok(
      idsIn(pages.get(routeId)).includes(id),
      `the ${routeId} page must provide #${id}`,
    );
  }
});

test('every select is empty in the markup and filled from its declared source', () => {
  // The options are not markup. A `<select>` that lists its options in HTML is a
  // second copy of a list a module already owns: the grid widths are theme.mjs's,
  // the representations are the core's (`hello.limits`) and the languages are
  // locales.mjs's. `page.test.mjs` asserts the built options equal those sources;
  // this asserts the markup offers none of its own.
  const selects = [
    ['world', 'grid-width'],
    ['world', 'representation'],
    ['world', 'locale'],
    ['history', 'locale'],
    ['archives', 'locale'],
  ];
  for (const [routeId, id] of selects) {
    const select = new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`).exec(pages.get(routeId));
    assert.ok(select, `the ${routeId} page must contain the ${id} select`);
    assert.equal(
      (select[0].match(/<option/g) ?? []).length,
      0,
      `#${id} must offer no hardcoded option; its options come from its module`,
    );
  }
});

// -- the text -------------------------------------------------------------

test('no user-visible text is left in any page', () => {
  // Every string is in public/locales.mjs. The product name is the single
  // deliberate exception: it is the same word in every language.
  for (const [id, markup] of pages) {
    const unexpected = textNodes(markup).filter((text) => text !== 'lifegame');
    assert.deepEqual(
      unexpected,
      [],
      `${id}: every text node must either carry data-i18n or be the product name`,
    );
  }
});

test('no user-visible phrase is hardcoded in a page or a script', () => {
  // A phrase that appears here instead of in locales.mjs is a phrase that cannot
  // be translated, and `node --check` sees nothing wrong with it. The list is
  // the vocabulary the viewer used before it had a locale table.
  const phrases = [
    'Run',
    'Pause',
    'Step',
    'Clear',
    'Theme:',
    'connecting',
    'core ok',
    'service unreachable',
    'world core unavailable',
    'generation',
    'population',
    'origin',
    // "span" is left out on purpose: it is also an HTML tag name, so the
    // literal `'span'` is a `createElement` argument rather than copy.
    'rule',
    'world',
    'cell',
    'click a cell',
    'drag to pan',
    'wheel to zoom',
    'steps once',
    'switch to the',
    'limited by frame budget',
    'cells/px',
    'cannot draw this frame',
    'is unreachable',
    'no generation has been recorded',
    'roll back',
    'Export archive',
    'show 1 earlier generation',
  ];
  const found = [];
  for (const [id, markup] of pages) {
    // Only text nodes: an attribute value is an identifier, and
    // `data-i18n="label.generation"` containing an English word is the point —
    // it names the entry rather than being the copy.
    for (const line of textNodes(markup)) {
      for (const phrase of phrases) {
        if (line.includes(phrase)) found.push(`${id}: ${JSON.stringify(phrase)}`);
      }
    }
  }
  for (const [name, source] of scripts) {
    // Only string literals, and never comments: `'action.run'` is a key, while
    // `'Run'` would be copy.
    const body = withoutComments(source);
    for (const phrase of phrases) {
      if ([`'${phrase}'`, `"${phrase}"`, `\`${phrase}\``].some((quoted) => body.includes(quoted))) {
        found.push(`${name}: ${JSON.stringify(phrase)}`);
      }
    }
  }
  assert.deepEqual(found, [], 'a user-visible phrase is hardcoded rather than in locales.mjs');
});

// -- the composition ------------------------------------------------------

test('the layout carries the placeholders the composer supplies, and no others', () => {
  const used = slotsIn(layout);
  assert.deepEqual([...used].sort(), [...LAYOUT_SLOTS].sort());
  for (const [id, markup] of pages) {
    assert.doesNotMatch(markup, /\{\{/, `${id}: a placeholder was left unfilled`);
  }
});

test('a fragment is a fragment, and a composed page has one of everything', () => {
  // A fragment that grew its own <html>, <head>, <body> or <title> would nest
  // documents, which is one of the two defects that blanked the page when this
  // split was first attempted. The composer would happily concatenate it.
  for (const route of ROUTES) {
    const fragment = read(fragmentFor(route)).toLowerCase();
    for (const tag of ['<!doctype', '<html', '<head', '<body', '<title']) {
      assert.ok(
        !new RegExp(`${tag}[\\s>]`).test(fragment),
        `${fragmentFor(route)} must not carry ${tag}: it is a fragment, not a document`,
      );
    }
    const markup = pages.get(route.id);
    for (const tag of ['<title', '<html', '<head', '<body']) {
      const count = (markup.match(new RegExp(`${tag}[\\s>]`, 'g')) ?? []).length;
      assert.equal(count, 1, `${route.id} must have exactly one ${tag}`);
    }
  }
});

test('every fragment id reaches the composed page, and only its own route', () => {
  for (const route of ROUTES) {
    const own = idsIn(read(fragmentFor(route)));
    const markup = pages.get(route.id);
    for (const id of own) {
      assert.ok(markup.includes(`id="${id}"`), `${route.id}: the fragment lost #${id}`);
    }
  }
});

test('a placeholder nobody supplies fails loudly', () => {
  // A page must never be served with `{{nav}}` still in it: that reads as a
  // rendering bug in the browser and is invisible in the composer.
  assert.throws(
    () => fillSlots('<p>{{nav}}</p>', {}, 'layout.html'),
    /no value for the placeholder \{\{nav\}\}/,
  );
  assert.equal(fillSlots('<p>{{nav}}</p>', { nav: 'x' }, 'layout.html'), '<p>x</p>');
});

// -- the theme and the palette --------------------------------------------

test('the pre-paint bootstrap uses the storage key the module owns', () => {
  const bootstrap = /<script>([\s\S]*?)<\/script>/.exec(layout);
  assert.ok(bootstrap, 'the layout must carry the pre-paint theme script');
  const source = bootstrap[1];

  assert.ok(
    source.includes(`'${THEME_STORAGE_KEY}'`),
    `the bootstrap must read ${THEME_STORAGE_KEY}; the key is owned by public/theme.mjs`,
  );
  for (const theme of THEMES) {
    assert.ok(source.includes(`'${theme}'`), `the bootstrap must accept the ${theme} theme`);
  }
  assert.match(
    source,
    /dataset\.theme|setAttribute\(\s*['"]data-theme/,
    'the bootstrap must set data-theme before the first paint',
  );
  assert.match(source, /prefers-color-scheme/, 'the bootstrap must fall back to the system preference');
});

test('the stylesheet defines both themes and the colours the canvas reads', () => {
  const css = read('style.css');
  assert.match(css, /:root\[data-theme='dark'\]/, 'a dark palette block is required');
  assert.match(css, /:root\[data-theme='light'\]/, 'a light palette block is required');

  // The canvas reads these back through getComputedStyle, so every theme block
  // has to define them or the colour silently stays at the previous value.
  for (const key of ['--alive', '--dead', '--grid']) {
    const occurrences = css.split(`${key}:`).length - 1;
    assert.ok(occurrences >= 2, `${key} must be defined once per theme, saw ${occurrences}`);
  }
});

test('the module that paints a canvas reads its colours from the stylesheet', () => {
  // The palette and the two render paths moved into `frame-draw.mjs` when the
  // history preview gained a canvas: two canvases that painted the same world
  // with two copies of this code would be two worlds the first time one of them
  // changed. The subject of this case moved with the code, and the world page is
  // asserted to go through the shared drawer rather than to own a copy of it.
  const drawSource = read('frame-draw.mjs');
  for (const key of ['--alive', '--dead', '--grid']) {
    assert.ok(drawSource.includes(`'${key}'`), `the frame drawer must read ${key}`);
  }
  // The names must be gone everywhere, not merely un-declared: `node --check`
  // resolves syntax, not identifiers, so a leftover reference to a deleted
  // constant passes a syntax check and throws on the first frame that uses it.
  // That is exactly what happened once while this change was written.
  for (const name of ['ALIVE_RGB', 'DEAD_CSS', 'GRID_CSS']) {
    assert.doesNotMatch(
      drawSource,
      new RegExp(`\\b${name}\\b`),
      `${name} was replaced by the palette; a leftover reference throws at runtime`,
    );
  }
  const worldSource = pageScripts.get('world');
  assert.match(worldSource, /drawFrame\(/, 'the world page must draw through the shared frame drawer');
  assert.match(worldSource, /readPalette\(/, 'and read its palette through it, not through its own copy');
});

test('the grid line width is no longer hard-coded', () => {
  const drawSource = read('frame-draw.mjs');
  assert.doesNotMatch(
    drawSource,
    /lineWidth\s*=\s*1\s*;/,
    'the grid line width comes from the control, not from a literal',
  );
  assert.match(drawSource, /deviceLineWidth\(/, 'the width must be snapped to device pixels');
  assert.match(drawSource, /snapLineCenter\(/, 'the line centres must be snapped to device pixels');
});

test('every canvas colour the stylesheet defines can actually be parsed', () => {
  // This is the bridge between the two halves of the palette. The canvas reads
  // these three properties back as text; a notation the parser refuses leaves
  // the previous colour in place, so a light theme written in `oklch()` or
  // `light-dark()` would silently paint the dark palette and no test would
  // notice. Checking the stylesheet's own text closes that.
  const css = read('style.css');
  for (const theme of THEMES) {
    const selector = `:root[data-theme='${theme}']`.replace(/[[\]]/g, '\\$&');
    const block = new RegExp(`${selector}[^{}]*\\{([^{}]*)\\}`).exec(css);
    assert.ok(block, `style.css must carry a ${theme} palette block`);

    for (const key of ['--alive', '--dead', '--grid']) {
      const declaration = new RegExp(`${key}\\s*:\\s*([^;]+);`).exec(block[1]);
      assert.ok(declaration, `the ${theme} palette must define ${key}`);
      assert.notEqual(
        parseColor(declaration[1]),
        null,
        `${key} in the ${theme} palette is ${declaration[1].trim()}, which the canvas cannot read`,
      );
    }
  }
});

test('the two palettes actually differ', () => {
  // A copy-paste that leaves one palette equal to the other is invisible in a
  // screenshot of a single theme.
  const css = read('style.css');
  const paletteOf = (theme) => {
    const selector = `:root[data-theme='${theme}']`.replace(/[[\]]/g, '\\$&');
    const block = new RegExp(`${selector}[^{}]*\\{([^{}]*)\\}`).exec(css)[1];
    return ['--ink', '--background', '--alive', '--dead', '--grid']
      .map((key) => new RegExp(`${key}\\s*:\\s*([^;]+);`).exec(block)[1].trim())
      .join(' ');
  };
  assert.notEqual(paletteOf('dark'), paletteOf('light'));
});

test('every palette field the frame drawer reads is one the palette declares', () => {
  // The palette replaced three module constants, and a mistyped field name is
  // another runtime-only failure of exactly that kind. The fields are read
  // through the object, so the object's own literal is the authority — and the
  // literal lives in `frame-draw.mjs`, where both canvases read it.
  const drawSource = read('frame-draw.mjs');
  const literal = /const DEFAULT_PALETTE = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(drawSource);
  assert.ok(literal, 'the frame drawer must declare the default palette');
  const declared = new Set([...literal[1].matchAll(/^\s*(\w+):/gm)].map((match) => match[1]));
  assert.ok(declared.size >= 3, `expected the palette fields, saw ${[...declared].join(', ')}`);

  const used = [...drawSource.matchAll(/\bpalette\.(\w+)/g)].map((match) => match[1]);
  assert.ok(used.length >= 3, 'the palette must actually be read');
  for (const field of new Set(used)) {
    assert.ok(declared.has(field), `palette.${field} is read but never declared`);
  }
});

// -- the modules ----------------------------------------------------------

test('every name a script imports actually exists in the module', async () => {
  // A mistyped or removed export is a syntax-level failure in the browser and
  // invisible to `node --check`, which resolves grammar, not bindings. The
  // scripts cannot be imported here — they touch the DOM at module scope — so
  // the check reads their import statements and asks each module what it
  // exports. Only modules that are safe to import in Node are checked; those are
  // every module except the shell and the page modules themselves.
  const importable = {
    './decode.mjs': await import('../public/decode.mjs'),
    './focus.mjs': await import('../public/focus.mjs'),
    './frame-draw.mjs': await import('../public/frame-draw.mjs'),
    './history.mjs': await import('../public/history.mjs'),
    './link.mjs': await import('../public/link.mjs'),
    './locales.mjs': await import('../public/locales.mjs'),
    './options.mjs': await import('../public/options.mjs'),
    './panel.mjs': await import('../public/panel.mjs'),
    './rule.mjs': await import('../public/rule.mjs'),
    './shared.mjs': await import('../public/shared.mjs'),
    './theme.mjs': await import('../public/theme.mjs'),
    './viewport.mjs': await import('../public/viewport.mjs'),
    '../decode.mjs': await import('../public/decode.mjs'),
    '../edit-tools.mjs': await import('../public/edit-tools.mjs'),
    '../focus.mjs': await import('../public/focus.mjs'),
    '../frame-draw.mjs': await import('../public/frame-draw.mjs'),
    '../history.mjs': await import('../public/history.mjs'),
    '../link.mjs': await import('../public/link.mjs'),
    '../locales.mjs': await import('../public/locales.mjs'),
    '../options.mjs': await import('../public/options.mjs'),
    '../panel.mjs': await import('../public/panel.mjs'),
    '../rule.mjs': await import('../public/rule.mjs'),
    '../shared.mjs': await import('../public/shared.mjs'),
    '../theme.mjs': await import('../public/theme.mjs'),
    '../viewport.mjs': await import('../public/viewport.mjs'),
  };

  let checked = 0;
  for (const [name, source] of scripts) {
    for (const [specifier, module] of Object.entries(importable)) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${escaped}'`, 'g');
      const names = [...source.matchAll(pattern)]
        .flatMap((match) => match[1].split(','))
        // `clampViewport as clampViewportTo` binds the first name; the module
        // must export that one, and the alias is the page's own business.
        .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
        .filter((entry) => entry !== '');
      for (const imported of names) {
        assert.ok(imported in module, `${name}: ${specifier} has no export named ${imported}`);
        checked += 1;
      }
    }
    // Every relative import of the file must be one this check understands, or
    // an unlisted module would silently stop being checked.
    const specifiers = [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(
        Object.hasOwn(importable, specifier),
        `${name} imports ${specifier}, which the contract check does not know about`,
      );
    }
  }
  assert.ok(checked >= 30, `expected a real import surface, checked ${checked}`);
});

test('no page module imports the shell', () => {
  // This is the defect the whole handshake exists for: a page module that
  // imported `app.js` would receive a second shell instance — the test suite
  // loads a fresh one per case — and render nothing while every assertion passed.
  for (const [id, source] of pageScripts) {
    assert.doesNotMatch(
      source,
      /from\s+'[^']*app\.js'/,
      `${id} must ask the shell over the handshake, not import it`,
    );
    assert.match(
      source,
      /connectShell\(/,
      `${id} must connect to the shell through public/link.mjs`,
    );
  }
});

test('the shell answers the handshake the page modules use', () => {
  const names = ['lifegame:shell', 'lifegame:shell-request'];
  for (const name of names) {
    assert.ok(read('link.mjs').includes(`'${name}'`), `link.mjs must own ${name}`);
  }
  // The shell imports the names rather than restating them, so the two sides
  // cannot listen on two spellings of one handshake.
  assert.match(shellSource, /from\s+'\.\/link\.mjs'/, 'the shell must import the handshake names');
  assert.match(shellSource, /SHELL_REQUEST_EVENT/, 'the shell must answer the request');
  assert.doesNotMatch(
    shellSource,
    /'lifegame:shell'/,
    'the shell must not restate the event name link.mjs owns',
  );
});
