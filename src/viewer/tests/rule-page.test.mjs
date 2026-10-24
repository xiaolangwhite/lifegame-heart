/**
 * The rule editor, executed — the page's half of the `set_rule` protocol.
 *
 * The contract this file drives is the one `rule.test.mjs` cannot reach: the
 * editor is wiring, and wiring is where a defect hides from `node --check`
 * because the syntax is fine and the binding is not. Each case here runs the
 * real shell plus the real world page module through the synthetic browser in
 * `dom-stub.mjs`, so the ids are the ids the served page declares and the
 * requests are the ones the page actually sent.
 *
 * Four claims are asserted, and each is a claim the version makes:
 *
 * 1. **A preset sends `set_rule` at once.** The payload is a string comparison
 *    of the rule, because the core's parser is where that string is obeyed.
 * 2. **A hand-typed rule is normalised before it is sent.** `b3/s23` and
 *    `B3/S32` both reach the core as `B3/S23`.
 * 3. **A malformed value sends nothing at all.** Five shapes of malformed, one
 *    per reason, and the count of commands stays at zero: the user is told
 *    locally instead of waiting for a refusal they could have been spared.
 * 4. **A refusal from the core changes nothing.** The core has the last word,
 *    its reason is what is shown, and the rule in force — the readout, the
 *    select and the world — is untouched.
 *
 * The stub core answers `set_rule` in the shape the protocol fixes, and can be
 * told to refuse a particular rule, so the "the core still has the last word"
 * case is the same code path a real kernel would take.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installBrowser,
  jsonResponse,
  readRoutePage,
  settle,
  StubEventSource,
} from './dom-stub.mjs';
import { RULE_PRESETS } from '../public/rule.mjs';

/** The rule the stub core reports at handshake and after a refusal. */
const INITIAL_RULE = 'B3/S23';

/** The core's answer for a rule it accepted: canonical text and both lists. */
function ruleReply(rule) {
  const match = /^B(\d*)\/S(\d*)$/.exec(rule);
  return {
    ok: true,
    rule,
    birth: [...(match?.[1] ?? '')].map(Number),
    survival: [...(match?.[2] ?? '')].map(Number),
  };
}

/**
 * A core that speaks the rule half of the protocol, and nothing else.
 *
 * Only the endpoints the world page reaches before it settles are offered: the
 * state reply, the frame it draws, the subscription it publishes and the one
 * command this file is about. A request this stub does not know answers 404,
 * which makes an unexpected request fail a case rather than pass silently.
 */
function createCoreStub(options = {}) {
  const commands = [];
  const archived = [];
  const refuse = new Set(options.refuse ?? []);
  const world = { width: 64, height: 64 };
  let rule = options.rule ?? INITIAL_RULE;
  const history = options.history === true;
  // A handshake the case releases by hand, so the order a real browser produces
  // can be reproduced: the shell publishes its context before it has fetched its
  // state, so the page module starts while the rule is still unknown.
  let releaseState = () => {};
  const stateGate = options.holdState === true ? new Promise((resolve) => {
    releaseState = resolve;
  }) : null;

  const handler = async (url, init = {}) => {
    const path = new URL(url, 'http://127.0.0.1').pathname;
    if (path === '/api/state') {
      if (stateGate !== null) await stateGate;
      return jsonResponse({
        ok: true,
        world,
        rule,
        generation: 0,
        population: 0,
        bounds: null,
        running: false,
        tps: 10,
        limits: {
          ticksPerSecond: { min: 1, max: 60 },
          stepsPerRequest: 100000,
          maxCoordinate: 65535,
          representations: ['sparse', 'tiled'],
        },
        history,
        representation: 'sparse',
      });
    }
    if (path === '/api/frame') {
      const query = new URL(url, 'http://127.0.0.1').searchParams;
      return jsonResponse({
        ok: true,
        frame: {
          x0: Number(query.get('x0')),
          y0: Number(query.get('y0')),
          w: Number(query.get('w')),
          h: Number(query.get('h')),
          generation: 0,
          population: 0,
          format: 'cells',
          data: '',
        },
      });
    }
    if (path === '/api/subscription') {
      return jsonResponse({ ok: true, clientId: 1 });
    }
    if (path === '/api/history') {
      return jsonResponse(
        history
          ? { ok: true, session: 1, current: 0, head: null, count: 0, generations: [], history: true }
          : {
              ok: false,
              error: 'no_history',
              message: 'this core was started without a history',
              history: false,
              generations: [],
            },
      );
    }
    if (path === '/api/command') {
      const body = JSON.parse(init.body ?? '{}');
      commands.push(body);
      if (body.cmd === 'set_rule') {
        const wanted = String(body.rule ?? '');
        if (refuse.has(wanted)) {
          return jsonResponse({
            ok: false,
            error: 'bad_rule',
            message: `${wanted} names a neighbour count this core does not have`,
          });
        }
        rule = wanted;
        return jsonResponse(ruleReply(wanted));
      }
      if (body.cmd === 'run') return jsonResponse({ ok: true, running: true, tps: body.tps ?? 10 });
      if (body.cmd === 'pause') return jsonResponse({ ok: true, running: false });
      if (body.cmd === 'step') return jsonResponse({ ok: true, generation: body.count ?? 1 });
      if (body.cmd === 'clear') return jsonResponse({ ok: true, generation: 0, population: 0 });
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  };

  return {
    handler,
    commands,
    archived,
    releaseState,
    get rule() {
      return rule;
    },
  };
}

/**
 * The world route, with its shell and its page module loaded over it.
 *
 * The order is the one the layout writes: the shell first, settled, then the
 * page module. The stream is opened by the shell and `hello` is delivered to it
 * here, because that is where the rule the core is running arrives from.
 */
async function loadWorld(options = {}) {
  const browser = installBrowser({
    html: readRoutePage(options.route ?? 'world'),
    language: options.language ?? 'en-US',
    storage: options.storage ?? {},
  });
  browser.route = options.route ?? 'world';
  const core = createCoreStub(options.core);
  browser.setFetchHandler(core.handler);
  StubEventSource.reset();

  caseCounter += 1;
  await import(`../public/app.js?case=${caseCounter}`);
  await settle(3);
  await import(`../public/pages/world.js?case=${caseCounter}`);
  await settle(6);

  const stream = StubEventSource.latest;
  if (stream !== null) {
    stream.emit('hello', {
      clientId: 1,
      rule: options.helloRule ?? core.rule,
      representation: 'sparse',
      world: { width: 64, height: 64 },
      limits: { ticksPerSecond: { min: 1, max: 60 }, representations: ['sparse', 'tiled'] },
      history: false,
    });
    await settle(4);
  }
  return { browser, core };
}

/** A fresh module instance per case: the page runs on import. */
let caseCounter = 0;

function teardown(t, browser) {
  t.after(async () => {
    // A world left running would reschedule its poll timer, and that timer reads
    // `globalThis.fetch` at fire time — so it would land in the next case's
    // stub. The step button is disabled exactly while the world runs.
    try {
      const step = browser.elements.get('step-once');
      if (step && step.disabled === true) {
        browser.elements.get('toggle-run').dispatch('click');
        await settle(3);
      }
    } catch {
      // Nothing to stop.
    } finally {
      browser.restore();
    }
  });
}

/** The rule commands the page sent, in order. */
function ruleCommands(core) {
  return core.commands.filter((command) => command.cmd === 'set_rule');
}

function readoutOf(browser) {
  return browser.elements.get('readout-rule').textContent;
}

function errorOf(browser) {
  return browser.elements.get('rule-error');
}

/** The entry the preset select is showing, as its value. */
function selectedPreset(browser) {
  return browser.elements.get('rule-preset').value;
}

/** Type into the text field, as a person does before pressing something. */
function typeRule(browser, text) {
  browser.elements.get('rule-custom').value = text;
}

// -- the control is where the page says it is -----------------------------

test('the field opens on the running rule, which arrives after the page has started', async (t) => {
  // The order a real browser produces, and the one the suite did not: the shell
  // publishes its context before it has fetched its state, so the page module
  // runs while the rule is still unknown. The field used to be filled only
  // during start-up, so on a fresh load it stayed empty and pressing set refused
  // an empty string in words instead of applying the rule the readout was
  // already showing. A browser found it; this case keeps it found.
  const { browser, core } = await loadWorld({ core: { holdState: true } });
  t.after(() => {
    core.releaseState();
  });
  assert.equal(browser.elements.get('rule-custom').value, '', 'the core has said nothing yet');

  core.releaseState();
  await settle(12);
  assert.equal(readoutOf(browser), INITIAL_RULE, 'the handshake arrived');
  assert.equal(
    browser.elements.get('rule-custom').value,
    INITIAL_RULE,
    'and the field opened on it, although the page had already started',
  );

  browser.elements.get('rule-apply').dispatch('click');
  await settle(6);
  assert.deepEqual(
    core.commands.filter((command) => command.cmd === 'set_rule').map((command) => command.rule),
    [INITIAL_RULE],
    'pressing set applies that rule rather than refusing an empty field',
  );
});

test('the rule editor is in the world page, and every id it binds is declared', async (t) => {
  const { browser } = await loadWorld();
  teardown(t, browser);

  const declared = browser.declaredIds();
  for (const id of ['rule-preset', 'rule-custom', 'rule-apply', 'rule-error']) {
    assert.ok(declared.has(id), `the world page must declare #${id}`);
    assert.ok(browser.elements.has(id), `#${id} must be an element of the loaded page`);
  }
  assert.deepEqual(browser.missingIds(), [], 'the page asked for an id its markup does not declare');
});

test('the preset select is built from the one list that owns it', async (t) => {
  const { browser } = await loadWorld();
  teardown(t, browser);

  const select = browser.elements.get('rule-preset');
  // A custom entry is always offered, last: a rule the core reports which is
  // none of the presets has to have somewhere to be shown.
  assert.deepEqual(
    select.options.map((option) => option.value),
    [...RULE_PRESETS.map((preset) => preset.rule), 'custom'],
  );
  // Every option carries words, and the preset entries carry the rule itself, so
  // the control is readable without hovering it.
  for (const option of select.options) {
    assert.notEqual(option.textContent.trim(), '', `${option.value} has no label`);
  }
  for (const preset of RULE_PRESETS) {
    const option = select.options.find((entry) => entry.value === preset.rule);
    assert.ok(option.textContent.includes(preset.rule), `${preset.rule} is not named in its entry`);
  }
});

// -- a preset -------------------------------------------------------------

test('choosing a preset sends it at once and the readout follows', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);
  assert.equal(readoutOf(browser), INITIAL_RULE, 'the handshake rule is the first readout');

  const select = browser.elements.get('rule-preset');
  select.value = 'B36/S23';
  select.dispatch('change');
  await settle(4);

  const sent = ruleCommands(core);
  assert.equal(sent.length, 1, 'one choice is one request');
  assert.deepEqual(sent[0], { cmd: 'set_rule', rule: 'B36/S23' });
  assert.equal(core.rule, 'B36/S23', 'the core is running the chosen rule');
  assert.equal(readoutOf(browser), 'B36/S23', 'the readout follows the core, not the control');
  assert.equal(selectedPreset(browser), 'B36/S23', 'and the select stays on the rule in force');
  assert.equal(errorOf(browser).hidden, true, 'a rule the core accepted is not an error');
});

test('every preset in the list is sent as its own rule string', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  const select = browser.elements.get('rule-preset');
  // The rule already in force is the first preset, so choosing it is not a
  // change and not a request: the loop starts at the second entry, and the
  // exact payloads are compared afterwards.
  for (const preset of RULE_PRESETS.slice(1)) {
    select.value = preset.rule;
    select.dispatch('change');
    await settle(4);
    assert.equal(core.rule, preset.rule, `${preset.rule} must reach the core`);
  }
  assert.deepEqual(
    ruleCommands(core).map((command) => command.rule),
    RULE_PRESETS.slice(1).map((preset) => preset.rule),
  );
  // The last one is the rule in force, and the readout says so.
  assert.equal(readoutOf(browser), RULE_PRESETS.at(-1).rule);
  // Re-choosing the rule that is already running is not a request either: the
  // core would be asked to set what it is already doing.
  select.value = RULE_PRESETS.at(-1).rule;
  select.dispatch('change');
  await settle(3);
  assert.equal(ruleCommands(core).length, RULE_PRESETS.length - 1);
});

// -- a hand-typed rule ----------------------------------------------------

test('a typed rule is sent by the button, canonicalised', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  typeRule(browser, 'B36/S23');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(4);

  assert.deepEqual(ruleCommands(core), [{ cmd: 'set_rule', rule: 'B36/S23' }]);
  assert.equal(readoutOf(browser), 'B36/S23');
});

test('Enter in the text field submits, as the button does', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  typeRule(browser, 'B2/S');
  browser.elements.get('rule-custom').dispatch('keydown', { key: 'Enter' });
  await settle(4);

  assert.deepEqual(ruleCommands(core), [{ cmd: 'set_rule', rule: 'B2/S' }]);
  assert.equal(readoutOf(browser), 'B2/S');
});

test('a key that is not Enter submits nothing', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  typeRule(browser, 'B2/S');
  for (const key of ['Space', 'a', 'Escape', 'Tab']) {
    browser.elements.get('rule-custom').dispatch('keydown', { key });
    await settle(2);
  }
  assert.deepEqual(ruleCommands(core), [], 'typing is not submitting');
});

test('case and digit order are normalised before the request', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  for (const [typed, canonical] of [
    ['b36/s23', 'B36/S23'],
    ['B3/S32', 'B3/S23'],
    ['  b3/s23  ', 'B3/S23'],
    ['B/S', 'B/S'],
  ]) {
    const before = ruleCommands(core).length;
    typeRule(browser, typed);
    browser.elements.get('rule-apply').dispatch('click');
    await settle(4);
    const sent = ruleCommands(core);
    assert.equal(sent.length, before + 1, `${typed} must be sent`);
    assert.equal(sent.at(-1).rule, canonical, `${typed} must be sent as ${canonical}`);
    assert.equal(readoutOf(browser), canonical, `the readout must show ${canonical}`);
  }
});

test('a rule that is typed and then accepted clears an earlier refusal', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  typeRule(browser, 'B33/S23');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(2);
  assert.equal(errorOf(browser).hidden, false, 'the duplicate is reported');

  typeRule(browser, 'B36/S23');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(4);
  assert.equal(errorOf(browser).hidden, true, 'the good rule clears the message');
  assert.equal(readoutOf(browser), 'B36/S23');
  assert.equal(ruleCommands(core).length, 1, 'only the good rule was ever sent');
});

// -- a malformed value is refused here, not by the core -------------------

test('a malformed rule is refused locally and sends nothing', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  const cases = [
    ['S23', 'section', 'no B section'],
    ['B3', 'section', 'no S section'],
    ['B9/S23', 'neighbour count', 'a count above eight'],
    ['B33/S23', 'twice', 'a repeated digit'],
    ['B3/S2x', 'digits', 'a character that is not part of a rule'],
  ];
  for (const [typed, fragment, why] of cases) {
    typeRule(browser, typed);
    browser.elements.get('rule-apply').dispatch('click');
    await settle(3);

    const error = errorOf(browser);
    assert.equal(error.hidden, false, `${typed} must be reported locally`);
    assert.match(error.textContent, new RegExp(fragment), `${typed}: the message must name ${why}`);
    assert.equal(readoutOf(browser), INITIAL_RULE, 'a refusal leaves the readout where it was');
    assert.equal(selectedPreset(browser), 'B3/S23', 'and the select on the rule in force');
  }
  assert.deepEqual(ruleCommands(core), [], 'not one malformed value reached the core');
});

test('an empty field is refused rather than sent', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  typeRule(browser, '');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(3);

  assert.equal(errorOf(browser).hidden, false);
  assert.deepEqual(ruleCommands(core), []);
});

// -- the core has the last word -------------------------------------------

test('a rule the core refuses is shown with the core\'s reason, and changes nothing', async (t) => {
  // The stub refuses this one rule, which is well-formed by the client's rule,
  // so the case is about the second opinion and not about the first.
  const { browser, core } = await loadWorld({ core: { refuse: ['B3/S12'] } });
  teardown(t, browser);

  typeRule(browser, 'B3/S12');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(4);

  assert.deepEqual(ruleCommands(core), [{ cmd: 'set_rule', rule: 'B3/S12' }]);
  const error = errorOf(browser);
  assert.equal(error.hidden, false, 'the refusal is reported');
  // The label is the viewer's and translated; the reason is the core's own text.
  assert.match(error.textContent, /refused that rule/);
  assert.match(
    error.textContent,
    /B3\/S12 names a neighbour count this core does not have/,
    "the core's own reason must be what is shown",
  );
  assert.equal(core.rule, INITIAL_RULE, 'the core is still running the old rule');
  assert.equal(readoutOf(browser), INITIAL_RULE, 'the readout must not claim the refused rule');
  assert.equal(selectedPreset(browser), 'B3/S23', 'nor must the select');
  assert.equal(
    browser.elements.get('rule-custom').value,
    'B3/S12',
    'the refused text stays in the field, so it can be corrected rather than retyped',
  );
});

test('the refusal is in the language on screen, and is gone once a rule is taken', async (t) => {
  const { browser, core } = await loadWorld({ core: { refuse: ['B3/S12'] } });
  teardown(t, browser);

  typeRule(browser, 'B33/S23');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(3);
  const english = errorOf(browser).textContent;

  // The shell owns the language control; choosing 中文 relabels everything,
  // including the sentence this page shows for a refusal.
  browser.elements.get('locale').value = 'zh';
  browser.elements.get('locale').dispatch('change');
  await settle(2);
  typeRule(browser, 'B33/S23');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(3);
  const chinese = errorOf(browser).textContent;

  assert.notEqual(english, '');
  assert.notEqual(chinese, english, 'the message is the one for the language on screen');

  typeRule(browser, 'B2/S');
  browser.elements.get('rule-apply').dispatch('click');
  await settle(4);
  assert.equal(errorOf(browser).hidden, true);
  assert.equal(core.rule, 'B2/S');
  assert.equal(readoutOf(browser), 'B2/S');
});

// -- the rule and the transport are separate ------------------------------

test('a rule can be changed while the world runs, and the run is not disturbed', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  // Run, then change the rule. Nothing about the transport belongs to the rule
  // editor: the run continues, and the core is not asked to pause or step.
  browser.elements.get('toggle-run').dispatch('click');
  await settle(4);
  assert.equal(browser.elements.get('toggle-run').textContent, 'Pause', 'the world is running');

  const select = browser.elements.get('rule-preset');
  select.value = 'B1357/S1357';
  select.dispatch('change');
  await settle(4);

  assert.deepEqual(
    ruleCommands(core).map((command) => command.rule),
    ['B1357/S1357'],
    'changing the rule sends the rule and nothing else',
  );
  assert.deepEqual(
    core.commands.filter((command) => command.cmd === 'pause' || command.cmd === 'step'),
    [],
    'the run is not interrupted by a rule change',
  );
  assert.equal(browser.elements.get('toggle-run').textContent, 'Pause', 'and it is still running');
  assert.equal(browser.elements.get('step-once').disabled, true, 'which is what disables Step');
  assert.equal(readoutOf(browser), 'B1357/S1357');
});

// -- the handshake is the first value -------------------------------------

test('the rule the core reports at handshake is the readout and the select', async (t) => {
  // A rule that is not in the preset list, so the custom entry is what has to
  // carry it — the case the entry exists for.
  const { browser } = await loadWorld({ core: { rule: 'B1357/S02468' }, helloRule: 'B1357/S02468' });
  teardown(t, browser);

  assert.equal(readoutOf(browser), 'B1357/S02468');
  assert.equal(selectedPreset(browser), 'custom', 'a rule no preset names is the custom entry');
  const option = browser.elements.get('rule-preset').options.find((entry) => entry.value === 'custom');
  assert.match(option.textContent, /B1357\/S02468/, 'and the entry says which rule it is');
});

test('a preset the core reports selects its own entry, not the custom one', async (t) => {
  const { browser } = await loadWorld({ core: { rule: 'B36/S23' }, helloRule: 'B36/S23' });
  teardown(t, browser);

  assert.equal(readoutOf(browser), 'B36/S23');
  assert.equal(selectedPreset(browser), 'B36/S23');
});

test('the entry that means "not one of these" is a label, not a request', async (t) => {
  const { browser, core } = await loadWorld();
  teardown(t, browser);

  const select = browser.elements.get('rule-preset');
  select.value = 'custom';
  select.dispatch('change');
  await settle(3);

  assert.deepEqual(ruleCommands(core), [], 'the custom entry is never sent as a rule');
  // Choosing it asks for the text field instead, which is the one useful thing
  // the entry can mean.
  assert.equal(browser.document.activeElement, browser.elements.get('rule-custom'));
  assert.equal(readoutOf(browser), INITIAL_RULE, 'and the rule in force is untouched');
});

test('a readout redraw does not move the field out from under the typist', async (t) => {
  const { browser } = await loadWorld();
  teardown(t, browser);

  // Half-typed text is the user's, and a tick or a frame must not replace it
  // with the running rule: the readout is where the truth is shown.
  typeRule(browser, 'B36/S2');
  browser.window.dispatch('resize');
  await settle(3);

  assert.equal(browser.elements.get('rule-custom').value, 'B36/S2');
  assert.equal(readoutOf(browser), INITIAL_RULE);
});
