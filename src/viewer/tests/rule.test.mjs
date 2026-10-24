/**
 * The rule vocabulary, asserted as a function.
 *
 * The editor's first check is a pure function in `public/rule.mjs`, and this is
 * where every branch of it is pinned: what a good rule normalises to, and the
 * five distinct reasons a bad one is refused. The reason matters as much as the
 * refusal — it is what the user is told, and "not a rule" is not an answer when
 * the field says `B3S23`.
 *
 * What is *not* here is the wiring: that the button and Enter both reach this
 * function, that a refusal sends nothing, and that the core's own refusal leaves
 * the running rule alone. Those are `rule-page.test.mjs`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MESSAGES } from '../public/locales.mjs';
import {
  CUSTOM_RULE,
  PRESET_RULES,
  RULE_PRESETS,
  RULE_REASONS,
  parseRule,
  presetFor,
  reportedRule,
} from '../public/rule.mjs';

/** The rules the version requires the preset list to offer, by name. */
const REQUIRED_PRESETS = [
  'B3/S23',
  'B36/S23',
  'B3/S12345',
  'B2/S',
  'B/S012345678',
  'B3678/S34678',
  'B1357/S1357',
  'B3/S012345678',
];

test('the preset list offers the eight rules by name, in one place', () => {
  assert.deepEqual([...PRESET_RULES], REQUIRED_PRESETS);
  assert.equal(RULE_PRESETS.length, REQUIRED_PRESETS.length);
  for (const preset of RULE_PRESETS) {
    assert.ok(REQUIRED_PRESETS.includes(preset.rule), `${preset.rule} is not a required preset`);
    assert.match(preset.key, /^rule\.preset\./, `${preset.rule} must be named by a locale key`);
  }
  // A duplicated rule would put two identical entries in the select, and the
  // second would be unreachable.
  assert.equal(new Set(PRESET_RULES).size, PRESET_RULES.length);
});

test('every preset name and every refusal reason has words in both languages', () => {
  for (const locale of ['en', 'zh']) {
    for (const preset of RULE_PRESETS) {
      const label = MESSAGES[locale][preset.key];
      assert.equal(typeof label, 'string', `${locale}.${preset.key} must be a string`);
      assert.notEqual(label.trim(), '', `${locale}.${preset.key} is empty`);
    }
    for (const reason of RULE_REASONS) {
      const label = MESSAGES[locale][`rule.error.${reason}`];
      assert.equal(typeof label, 'string', `${locale}: no sentence for ${reason}`);
      assert.notEqual(label.trim(), '', `${locale}.rule.error.${reason} is empty`);
    }
  }
});

test('a well-formed rule is accepted and normalised', () => {
  assert.deepEqual(parseRule('B3/S23'), {
    ok: true,
    rule: 'B3/S23',
    birth: [3],
    survival: [2, 3],
  });
  // The canonical spelling is what the payload carries, whatever case it was
  // typed in: the record of what was run must not depend on the shift key.
  assert.equal(parseRule('b3/s23').rule, 'B3/S23');
  assert.equal(parseRule('  B3/S23  ').rule, 'B3/S23');
  // The digit order carries no meaning, so sorting it is part of reading it.
  assert.deepEqual(parseRule('B3/S32').survival, [2, 3]);
  assert.equal(parseRule('B3/S32').rule, 'B3/S23');
  assert.equal(parseRule('b63/S23').rule, 'B36/S23');
  assert.equal(parseRule('S32/B3').ok, false, 'the sections have an order and it is B then S');
  // A section may be empty, and one of the named rules is exactly that: in Seeds
  // nothing survives.
  assert.deepEqual(parseRule('B2/S'), { ok: true, rule: 'B2/S', birth: [2], survival: [] });
  assert.deepEqual(parseRule('B/S'), { ok: true, rule: 'B/S', birth: [], survival: [] });
});

test('the ends of the digit range are accepted', () => {
  const everything = parseRule('B/S012345678');
  assert.equal(everything.ok, true);
  assert.deepEqual(everything.survival, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const allBirths = parseRule('B012345678/S');
  assert.deepEqual(allBirths.birth, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(allBirths.rule, 'B012345678/S');
  // 0 and 8 are counts, not bounds: a cell with no neighbours is born under
  // `B0`, and one with all eight survives under `S8`.
  assert.equal(parseRule('B0/S8').ok, true);
});

test('a rule with no B section is refused, and says so', () => {
  for (const text of ['S23', '/S23', '23/3']) {
    assert.deepEqual(parseRule(text), { ok: false, reason: 'missingB' }, text);
  }
  // `hello` has neither section; the first one found missing is the one named,
  // and the message tells the user to write the other one too.
  assert.deepEqual(parseRule('hello'), { ok: false, reason: 'missingB' });
});

test('a rule with no S section is refused, and says so', () => {
  for (const text of ['B3', 'B3/', 'B3/2']) {
    assert.deepEqual(parseRule(text), { ok: false, reason: 'missingS' }, text);
  }
});

test('a neighbour count above eight is refused as out of range', () => {
  assert.deepEqual(parseRule('B9/S23'), { ok: false, reason: 'outOfRange' });
  assert.deepEqual(parseRule('B3/S9'), { ok: false, reason: 'outOfRange' });
  assert.deepEqual(parseRule('B39/S23'), { ok: false, reason: 'outOfRange' });
});

test('a repeated digit is refused, in either section', () => {
  assert.deepEqual(parseRule('B33/S23'), { ok: false, reason: 'duplicateDigit' });
  assert.deepEqual(parseRule('B3/S223'), { ok: false, reason: 'duplicateDigit' });
  // Across the two sections a digit is not repeated: births and survivals are
  // different questions, and `B3/S23` is the canonical example.
  assert.equal(parseRule('B3/S3').ok, true);
});

test('a character that is not part of a rule is refused', () => {
  for (const text of ['B3/S2x', 'B3/ S23', 'B3/S23!', 'B3S23', 'B3//S23']) {
    assert.deepEqual(parseRule(text), { ok: false, reason: 'badCharacter' }, text);
  }
});

test('something that is not a rule at all is refused as a format', () => {
  // Empty is the state of a field nobody has typed into, and a value that is not
  // even text is refused rather than coerced: `String(null)` is `'null'`, which
  // would otherwise be reported to the user as a character problem in a field
  // they never typed into.
  for (const text of ['', '   ']) {
    assert.deepEqual(parseRule(text), { ok: false, reason: 'badFormat' }, JSON.stringify(text));
  }
  for (const value of [null, undefined, 3, {}, []]) {
    assert.deepEqual(parseRule(value), { ok: false, reason: 'badFormat' });
  }
});

test('every refusal names a reason the table has words for', () => {
  const inputs = ['', '  ', null, 'S23', 'B3', 'B9/S23', 'B33/S23', 'B3/S2x', 'hello', 'B/S/2'];
  const reasons = new Set();
  for (const text of inputs) {
    const parsed = parseRule(text);
    assert.equal(parsed.ok, false, `${JSON.stringify(text)} must be refused`);
    reasons.add(parsed.reason);
  }
  // Five reasons, and every one of them is a key rather than a sentence.
  assert.deepEqual([...reasons].sort(), [...RULE_REASONS].sort());
});

test('a rule is matched to a preset by its own string, and to nothing else', () => {
  for (const rule of REQUIRED_PRESETS) {
    assert.equal(presetFor(rule), rule, `${rule} must select its own entry`);
  }
  // Everything the presets do not name is the custom entry: a rule the user
  // typed, a rule a future core reports, and the empty state before the core has
  // said anything at all.
  for (const rule of ['B3/S12', 'B1357/S02468', 'B/S', 'B3/S23 ', '']) {
    assert.equal(presetFor(rule), CUSTOM_RULE, `${JSON.stringify(rule)} must be custom`);
  }
  assert.equal(CUSTOM_RULE, 'custom');
});

test('the rule a reply reports is read from the reply, then from its state', () => {
  // The contract fixes `rule` on the reply itself; a service that carries a
  // state reply alongside the command names the same fact in `state.rule`.
  assert.equal(reportedRule({ ok: true, rule: 'B36/S23' }, 'B3/S23'), 'B36/S23');
  assert.equal(reportedRule({ ok: true, state: { rule: 'B36/S23' } }, 'B3/S23'), 'B36/S23');
  // The reply's own field wins when both are present, because it is the field
  // the command's own answer owns.
  assert.equal(
    reportedRule({ ok: true, rule: 'B36/S23', state: { rule: 'B3/S12345' } }, 'B2/S'),
    'B36/S23',
  );
  // A core that does not repeat the rule has accepted the one it was sent.
  assert.equal(reportedRule({ ok: true }, 'B2/S'), 'B2/S');
  assert.equal(reportedRule(null, 'B2/S'), 'B2/S');
  // An empty string is not a rule: it is a field a core filled in badly, and
  // showing it would blank the readout.
  assert.equal(reportedRule({ ok: true, rule: '' }, 'B2/S'), 'B2/S');
  assert.equal(reportedRule({ ok: true, rule: 3, state: { rule: null } }, 'B2/S'), 'B2/S');
});
