/**
 * The stylesheet, audited against the pages it styles.
 *
 * Two defects prompted this file, and both were structural rather than visual:
 * the layout rule for a control group listed the groups by name, so the storage
 * select had no layout; and the `select` appearance rule was scoped to one
 * control's class, so a second select rendered with the browser's own chrome.
 * Neither was visible in the stylesheet — a missing rule is invisible — and
 * neither would fail any test that only renders the page.
 *
 * A third and a fourth defect, from the first attempt at routing the interface,
 * are why the audit is now what it is:
 *
 * - the panel's three states were written as `.stage[data-panel='…']` while the
 *   routed markup kept the id `stage` and changed the class to `page page-split`,
 *   so collapse and full-width matched **nothing** at all. The logic had tests;
 *   the styles did not.
 * - the class check was too weak. It asked whether a class appeared *anywhere*
 *   in the markup or the script text, which `page`, `archives` and four dead
 *   `.stage` rules all satisfied while matching no element. It now asks whether
 *   the class appears in a **class-bearing position** — a `class="…"` attribute,
 *   a `className = '…'` assignment, or a `classList.add/remove/toggle('…')` call
 *   — and separately whether the element a state selector hangs off really
 *   carries both the class and the attribute.
 *
 * **What this can and cannot prove.** It reads the stylesheet, the composed
 * markup and the scripts as text; it does not evaluate selectors, so it cannot
 * prove that a rule matches an element at run time, nor that a transition
 * animates. It proves that every token a rule names exists in a position that
 * puts it on an element, which is the class of defect that survived the previous
 * version of this file. The visual remainder — that `:hover` really reveals the
 * node details, that the panel really collapses — needs a browser, and is
 * recorded as the remaining weak point in README.md rather than claimed here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES, defaultPageRenderer } from '../routes.mjs';
import { MAX_INDENT_LEVELS } from '../public/history.mjs';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (relative) => readFileSync(path.join(publicDir, relative), 'utf8').replace(/\r\n/g, '\n');

const css = read('style.css');

/** The composed markup of every route: what the service actually sends. */
const pages = ROUTES.map((route) => defaultPageRenderer.render(route.paths[0]));
const markup = pages.join('\n');

/** The scripts that put a class on an element, and only those. */
const scriptNames = ['app.js', ...ROUTES.map((route) => route.script.replace('/static/', ''))];
const scripts = scriptNames.map(read).join('\n');

/** The stylesheet with its comments removed, so prose is not audited as CSS. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every selector in the file, one per comma-separated part. */
function selectors() {
  const stripped = withoutComments(css).replace(/@[a-z-]+[^{]*\{[^}]*\}/gi, '');
  const found = [];
  for (const match of stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    for (const part of match[2].split(',')) {
      const selector = part.trim();
      if (selector !== '') found.push(selector);
    }
  }
  return found;
}

function tokensIn(selector) {
  const classes = [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]);
  const ids = [...selector.matchAll(/#([A-Za-z][\w-]*)/g)].map((match) => match[1]);
  return { classes, ids };
}

/**
 * Every class a piece of markup puts on an element.
 *
 * A `class="…"` attribute is the only way markup carries one, and the tokens are
 * whitespace separated, so `class="stage page page-world"` yields three.
 */
function classesInMarkup(source) {
  const found = new Set();
  for (const match of source.matchAll(/\bclass="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name !== '') found.add(name);
  }
  return found;
}

/**
 * Every class a script puts on an element.
 *
 * Three ways, and no fourth: assigning `className` (which replaces the whole
 * list), calling `classList.add`/`remove`/`toggle`, or `setAttribute('class', …)`.
 * A class that appears in a script only as a string — the argument to
 * `classList.contains`, a key in a map, a comment — is deliberately *not*
 * counted: the old check counted those, which is how dead rules hid here.
 */
function classesInScripts(source) {
  const found = new Set();
  const add = (value) => {
    for (const name of String(value).split(/\s+/)) if (name !== '') found.add(name);
  };
  for (const match of source.matchAll(/\bclassName\s*=\s*(['"])([^'"]*)\1/g)) add(match[2]);
  for (const match of source.matchAll(/\bclassList\.(?:add|remove|toggle)\(\s*(['"])([^'"]+)\1/g)) {
    add(match[2]);
  }
  for (const match of source.matchAll(/\bsetAttribute\(\s*(['"])class\1\s*,\s*(['"])([^'"]*)\2/g)) {
    add(match[3]);
  }
  return found;
}

const markupClasses = classesInMarkup(markup);
const scriptClasses = classesInScripts(scripts);
const appliedClasses = new Set([...markupClasses, ...scriptClasses]);

test('every class the stylesheet names is put on an element by markup or by a script', () => {
  const dead = [];
  for (const selector of selectors()) {
    for (const name of tokensIn(selector).classes) {
      if (!appliedClasses.has(name)) dead.push(`${selector} -> .${name}`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    'a class in the stylesheet is never put on an element in a class-bearing position',
  );
});

test('every id the stylesheet names is declared by a composed page', () => {
  const declared = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const missing = [];
  for (const selector of selectors()) {
    for (const name of tokensIn(selector).ids) {
      if (!declared.has(name)) missing.push(`${selector} -> #${name}`);
    }
  }
  assert.deepEqual(missing, [], 'the stylesheet styles an id no page declares');
});

test('the only id selector is the canvas, which needs one', () => {
  // Styling by id is how a rule ends up applying to exactly one control, which
  // is the defect this file was written after. The canvas is the exception
  // because it *is* the stage: there is exactly one, and its size is what the
  // drawing code measures.
  const ids = new Set();
  for (const selector of selectors()) {
    for (const name of tokensIn(selector).ids) ids.add(name);
  }
  assert.deepEqual([...ids].sort(), ['grid']);
});

test('the panel-state rules hang off an element that really carries the attribute', () => {
  // This is the defect that made the panel's three states a no-op in the
  // browser: the rules named a class (`stage`) the routed markup no longer had
  // on the element carrying `data-panel`. The check is about the *compound*
  // part of each selector — the one before the descendant combinator — because
  // that is the part that has to match the stage.
  const stateSelectors = selectors().filter((selector) => selector.includes('data-panel'));
  assert.ok(
    stateSelectors.length >= 3,
    `the three panel states need rules, saw ${stateSelectors.length}`,
  );

  const carriers = [...markup.matchAll(/<[^>]*\bdata-panel="[^"]*"[^>]*>/g)].map((match) => match[0]);
  assert.ok(carriers.length >= 1, 'a composed page must carry data-panel');
  const carrierClasses = new Set();
  for (const tag of carriers) {
    const attribute = /\bclass="([^"]*)"/.exec(tag);
    if (attribute !== null) for (const name of attribute[1].split(/\s+/)) carrierClasses.add(name);
  }

  for (const selector of stateSelectors) {
    const subject = selector.split(/\s+/)[0];
    const { classes } = tokensIn(subject);
    assert.ok(classes.length >= 1, `${selector}: the state needs a class to select, not an id alone`);
    for (const name of classes) {
      assert.ok(
        carrierClasses.has(name),
        `${selector} -> the markup's data-panel element does not carry .${name}`,
      );
    }
    // The descendant the rule styles must exist in the markup too.
    const rest = selector.split(/\s+/).slice(1).join(' ');
    for (const name of tokensIn(rest).classes) {
      assert.ok(markupClasses.has(name), `${selector} -> no element carries .${name}`);
    }
  }
});

test('the panel rules follow the attribute from the stylesheet to the markup', () => {
  const cssText = withoutComments(css);
  assert.match(cssText, /\[data-panel='collapsed'\][^{]*\{[^}]*display:\s*none/);
  assert.match(cssText, /\[data-panel='wide'\][^{]*\{/);
  // And the page module sets the same attribute from the same three names.
  const worldScript = read('pages/world.js');
  assert.match(worldScript, /dataset\.panel\s*=/);
});

test('a node\'s details are collapsed until the pointer or the keyboard opens them', () => {
  const cssText = withoutComments(css);
  const collapsed = /\.timeline-detail\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(collapsed, 'the node details need their own rule');
  assert.match(collapsed[1], /transition/, 'the reveal must be a transition, not a jump');
  assert.match(collapsed[1], /opacity:\s*0/, 'and the details must start hidden');
  assert.match(collapsed[1], /max-inline-size:\s*0/, 'taking no space while hidden');

  // The state that opens them is one attribute, set by the page for the pointer
  // and for the keyboard alike. It used to be `:hover`/`:focus-visible`, which
  // meant the two paths were two rules the stylesheet had to keep in step and
  // neither could be exercised without a browser; the page sets one state now,
  // and the case below drives it.
  const opened = /\.timeline-row\[data-open='true'\]\s+\.timeline-detail\s*\{([^}]*)\}/.exec(
    cssText,
  );
  assert.ok(opened, 'the row\'s open state must be what reveals the details');
  assert.match(opened[1], /opacity:\s*1/);
  assert.match(opened[1], /max-inline-size:\s*\d+ch/, 'and give it room again');

  const historyScript = read('pages/history.js');
  assert.match(historyScript, /dataset\.open\s*=\s*'true'/, 'the page must set the open state');
  assert.match(historyScript, /dataset\.open\s*=\s*'false'/, 'and clear it again');
  for (const listener of ["addEventListener('pointerenter'", "addEventListener('pointerleave'", "addEventListener('focus'", "addEventListener('blur'"]) {
    assert.ok(
      historyScript.includes(listener),
      `the open state must follow ${listener}: the pointer and the keyboard are one behaviour`,
    );
  }

  // The row is a button, which is what makes it focusable by Tab at all: a plain
  // <span> cannot be focused.
  assert.match(scripts, /createElement\('button'\)/);
  assert.match(scripts, /className = 'timeline-row'/);
  assert.match(scripts, /className = 'timeline-kind timeline-detail'/);
});

test('a row\'s numbers cannot change how tall the row is', () => {
  // The defect this guards is the one the history route shipped with: the
  // details were in the row's own layout, so a row grew when it was looked at
  // and the rows below it moved. Both the overlay that holds them and the
  // connector gutter are out of the flow, which is what makes the row's height a
  // function of its line box and nothing else. `page.test.mjs` measures the
  // rendered rows; this is the stylesheet half.
  const cssText = withoutComments(css);
  const overlay = /\.timeline-overlay\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(overlay, 'the details need a container of their own');
  assert.match(overlay[1], /position:\s*absolute/, 'the overlay must be out of the row\'s flow');

  const guides = /\.timeline-guides\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(guides, 'the connectors need a container of their own');
  assert.match(guides[1], /position:\s*absolute/, 'and the gutter must be out of the flow too');
});

/** The declarations of one rule, as text, with the file's comments already gone. */
function ruleBody(cssText, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(cssText);
  if (match === null) throw new Error(`the stylesheet has no rule for ${selector}`);
  return match[1];
}

test('the node overlay cannot widen the tree it is scrolled in', () => {
  // A person reported the newest generation's row flickering against the tree's
  // own horizontal scrollbar. Measured in a real browser (Edge 155, headless,
  // driven over CDP against the served page): with the pointer on that row,
  // opening the overlay took `#timeline`'s `scrollWidth` from 319 px to 329 px,
  // and the horizontal scrollbar that appeared took 15 px off its `clientHeight`
  // (145 -> 130). That bar lands on the bottom of the last row — which is the
  // newest generation, the row the pointer is on — so the overlay closed, the
  // scrollbar went away, the pointer was over the row again, and it repeated for
  // as long as the pointer stayed there.
  //
  // What this asserts is the structure that removes the *cause*: the overlay's box
  // is bounded by the row, and its content is clipped to that box, so it can add
  // nothing to the scroll container's scrollable overflow. What it cannot prove is
  // the layout itself — `scrollWidth === clientWidth` needs a browser, and the
  // measurement above is the evidence for it, not this file.
  const cssText = withoutComments(css);
  const overlay = ruleBody(cssText, '.timeline-overlay');
  // Both inline insets: a box that is only *started* is sized by its content, and
  // this content is a node's numbers, wider than the tree it is drawn in.
  const insets = /inset-inline:\s*calc\(.*\)\s+(\d+)px;/.exec(overlay);
  assert.ok(insets, 'the overlay must set both inline insets, not only its start');
  assert.match(overlay, /overflow:\s*hidden/, 'and clip its own content to that box');

  // The start and the end are the row's own column geometry, read from the row's
  // rule rather than restated: the same base indent, the same one-level step, the
  // same generation column, the same gap, and the same inline padding on the far
  // side. A number copied here instead is the number that drifts.
  const rowPadding =
    /padding-inline:\s*calc\(\s*(\d+)px\s*\+\s*var\(--depth[^)]*\)\s*\*\s*(\d+)px\s*\)\s+(\d+)px/.exec(
      ruleBody(cssText, '.timeline-row'),
    );
  assert.ok(rowPadding, 'the row is indented by --depth times one level width');
  const start =
    /inset-inline:\s*calc\(\s*(\d+)px\s*\+\s*var\(--depth[^)]*\)\s*\*\s*(\d+)px\s*\+\s*(\d+)ch\s*\+\s*(\d+)px\s*\)/.exec(
      overlay,
    );
  assert.ok(start, "the overlay starts from the row's own columns, not from a fixed offset");
  assert.equal(Number(start[1]), Number(rowPadding[1]), 'the same base indent as the row');
  assert.equal(
    Number(start[2]),
    Number(rowPadding[2]),
    'the same indent step, or the overlay drifts one level per fork',
  );
  const columns = /grid-template-columns:\s*(\d+)ch\s/.exec(ruleBody(cssText, '.timeline-row'));
  assert.ok(columns, "the row's first column is the generation");
  assert.equal(Number(start[3]), Number(columns[1]), 'the same generation column');
  const gap = /gap:\s*\d+\w*\s+(\d+)px/.exec(ruleBody(cssText, '.timeline-row'));
  assert.ok(gap, 'the row has a column gap');
  assert.equal(Number(start[4]), Number(gap[1]), 'the same column gap');
  assert.equal(
    Number(insets[1]),
    Number(rowPadding[3]),
    "and the overlay ends where the row's own content ends",
  );

  // The fix is not a way of hiding the bar: the tree still scrolls both ways, and
  // nothing is delayed to paper over the cycle.
  const timeline = ruleBody(cssText, '.timeline');
  assert.match(timeline, /overflow:\s*auto/, 'the tree is still a scroll container');
  assert.ok(!/overflow-x:\s*hidden/.test(cssText), 'the horizontal bar is not suppressed');
  assert.ok(!/transition-delay/.test(cssText), 'and no delay is used to hide the cycle');
});

test('a collapsed node overlay covers none of the row it is drawn in', () => {
  // The other half of the same rule, and the other half of the report: "a white
  // box over the 工作 of 工作点". Measured in the same browser: while nothing was
  // open, the overlay's box was 20 px wide — the two 8 px gaps between three
  // collapsed details plus 4 px of padding — painted in `var(--panel)`, which is
  // `#ffffff` in the light theme, at a fixed offset that ignored the row's
  // indentation. On the working-point row, the one row that paints a background
  // of its own, it covered 20 px of the 43 px badge: the first two of its three
  // characters. It was invisible on every other row only because an opaque box of
  // the panel's own colour over the panel's own colour is not a box you can see.
  //
  // The assertion is the geometry, not the paint: a collapsed overlay occupies no
  // inline size, so it cannot intersect the row's text at any offset. What it
  // cannot prove is the composited result on the row that *is* highlighted — the
  // overlap was re-measured in the browser for that, and the number is 0 px.
  const cssText = withoutComments(css);
  const overlay = ruleBody(cssText, '.timeline-overlay');
  assert.match(overlay, /max-inline-size:\s*0\b/, 'a collapsed overlay must take no inline size');
  assert.ok(
    !/padding-inline-end/.test(overlay),
    'and no padding may survive the collapsed state, which would be a box again',
  );
  assert.match(overlay, /pointer-events:\s*none/, 'what it is drawn over must still be reachable');

  const open = ruleBody(cssText, ".timeline-row[data-open='true'] .timeline-overlay");
  assert.match(open, /max-inline-size:\s*none/, 'the open state takes the row\'s own column');
  assert.match(open, /padding-inline-end:\s*\d+px/, 'and only then spends the room it has');
});

test('the indentation cap, the level width and the connector cell agree', () => {
  // The stylesheet moves a row by one level per `--depth`; the module caps that
  // depth. A cap larger than the panel can hold is a row that cannot be read,
  // and a connector cell that is not the same width as a level is a line that
  // does not meet the row it belongs to.
  const cssText = withoutComments(css);
  const padding = /\.timeline-row\s*\{[^}]*padding-inline:\s*calc\(\s*(\d+)px\s*\+\s*var\(--depth[^)]*\)\s*\*\s*(\d+)px\s*\)/.exec(
    cssText,
  );
  assert.ok(padding, 'the row must be indented by --depth times one level width');
  const base = Number(padding[1]);
  const perLevel = Number(padding[2]);
  const widest = base + perLevel * MAX_INDENT_LEVELS;
  assert.ok(
    widest <= 120,
    `the deepest indent is ${widest}px, which is more than a panel column can spare`,
  );

  const guide = /\.timeline-guide\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(guide, 'one connector cell per level needs a rule');
  const cell = /inline-size:\s*(\d+)px/.exec(guide[1]);
  assert.ok(cell, 'a connector cell must have a width');
  assert.equal(
    Number(cell[1]),
    perLevel,
    'a connector cell and a level of indentation must be the same width, or the lines miss their rows',
  );
  assert.match(guide[1], /position:\s*relative/, 'and it must be positioned for its own connectors');
});

test('every control group shares one layout rule', () => {
  const groups = [...markup.matchAll(/<label class="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(groups.length >= 4, `expected the control groups, found ${groups.length}`);
  for (const group of groups) {
    assert.ok(
      group.split(/\s+/).includes('control'),
      `a control group lacks the shared class: ${group}`,
    );
  }
  assert.match(css, /^\.control\s*\{/m, 'the shared layout rule must exist');
});

test('no appearance rule is scoped to a single control', () => {
  // `select` and `button` are dressed by element, so a control added tomorrow
  // looks like the ones here. A rule that reaches `select` only through one
  // control's class is the defect that made the storage select unstyled.
  const scoped = selectors().filter((selector) => {
    if (!/\b(select|button|input|output)\b/.test(selector)) return false;
    return /^\.[\w-]+\s+/.test(selector) && !selector.startsWith('.control');
  });
  assert.deepEqual(scoped, [], 'a form control is dressed through its own container');
});

test('button and select share one appearance rule', () => {
  const shared = /button,\s*\n?\s*select\s*\{/.test(withoutComments(css));
  assert.ok(shared, 'button and select must share one appearance rule');
});

test('the toolbar cannot reflow when the language changes', () => {
  // English and Chinese labels differ in width; without a floor the row shifts
  // and the control the user was reaching for moves.
  assert.match(withoutComments(css), /\.control\s*>\s*span\s*\{[^}]*min-inline-size/, 'labels need a minimum width');
  assert.match(withoutComments(css), /button\s*\{[^}]*min-inline-size/, 'buttons need a minimum width');
});

test('the hidden attribute beats the timeline display rule', () => {
  // `.timeline` is a flex container, and `display: flex` would otherwise win
  // over `[hidden]`, leaving an empty tree for a core with no history.
  assert.match(withoutComments(css), /\.timeline\[hidden\]\s*\{[^}]*display:\s*none/);
});

test('the stylesheet is not empty and has no leftover comment markers', () => {
  assert.ok(withoutComments(css).length > 2000, 'the stylesheet looks truncated');
  assert.ok(!withoutComments(css).includes('*/'), 'an unterminated comment');
});
