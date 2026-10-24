/**
 * The locale table, asserted as a table.
 *
 * The failure this file exists to prevent is asymmetric translation: a string
 * added to one language and forgotten in the other. That cannot be caught by
 * reading the page, because the missing entry falls back to English and looks
 * deliberate. So the key sets are compared directly, and a key with an empty
 * value fails as loudly as a missing one — an empty label is worse than an
 * English one, because it looks like a rendering bug.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCALE,
  HINT_SEGMENTS,
  KNOWN_ERROR_CODES,
  LOCALES,
  LOCALE_STORAGE_KEY,
  MESSAGES,
  describeError,
  resolveLocale,
  translate,
} from '../public/locales.mjs';

test('both languages are offered and English is the fallback', () => {
  assert.deepEqual([...LOCALES], ['en', 'zh']);
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.equal(LOCALE_STORAGE_KEY, 'lifegame.viewer.locale');
});

test('the two tables have exactly the same keys', () => {
  const en = Object.keys(MESSAGES.en).sort();
  const zh = Object.keys(MESSAGES.zh).sort();
  assert.deepEqual(
    en.filter((key) => !zh.includes(key)),
    [],
    'a key exists in English and not in Chinese',
  );
  assert.deepEqual(
    zh.filter((key) => !en.includes(key)),
    [],
    'a key exists in Chinese and not in English',
  );
  assert.ok(en.length > 80, `the table looks too small to be complete: ${en.length} keys`);
});

test('no entry is empty, in either language', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(MESSAGES[locale])) {
      if (typeof value === 'function') continue;
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.notEqual(value.trim(), '', `${locale}.${key} is empty`);
    }
  }
});

test('every error code has a label in both languages', () => {
  for (const code of KNOWN_ERROR_CODES) {
    for (const locale of LOCALES) {
      const label = translate(locale, `error.${code}`);
      assert.notEqual(label, `error.${code}`, `${locale} has no label for ${code}`);
    }
  }
});

test('every hint segment and key cap is in the table', () => {
  for (const locale of LOCALES) {
    for (const segment of HINT_SEGMENTS) {
      assert.notEqual(translate(locale, segment.text), segment.text, segment.text);
      if (segment.key) {
        assert.notEqual(translate(locale, segment.key), segment.key, segment.key);
      }
    }
  }
});

test('a stored choice wins, then the browser, then English', () => {
  assert.equal(resolveLocale('zh', 'en-US'), 'zh', 'an explicit choice is absolute');
  assert.equal(resolveLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveLocale(null, 'zh-CN'), 'zh');
  assert.equal(resolveLocale(null, 'zh-Hans-CN'), 'zh', 'a regional tag matches its primary subtag');
  assert.equal(resolveLocale(null, 'zh_TW'), 'zh');
  assert.equal(resolveLocale(null, 'en-GB'), 'en');
  assert.equal(resolveLocale(null, 'fr-FR'), 'en', 'an unoffered language falls back');
  assert.equal(resolveLocale(null, undefined), 'en');
  assert.equal(resolveLocale('nonsense', 'de'), 'en', 'a value from an older build falls back');
});

test('placeholders are filled from the parameters', () => {
  assert.equal(translate('en', 'unit.px', { value: '1.50' }), '1.50 px');
  assert.equal(translate('zh', 'unit.px', { value: '1.50' }), '1.50 像素');
  assert.equal(
    translate('en', 'status.ok', { rule: 'B3/S23', representation: 'sparse' }),
    'core ok · B3/S23 · sparse',
  );
});

test('a missing key is visible rather than blank', () => {
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
  assert.equal(translate('zh', 'no.such.key'), 'no.such.key');
});

test('a missing parameter leaves its placeholder visible', () => {
  const text = translate('en', 'unit.px', {});
  assert.match(text, /\{value\}/);
});

test('the rule statement and its button exist in both languages', () => {
  // The history page's statement about a generation recorded under another rule,
  // and the one press that adopts it. The two rules are what the sentence is
  // about, so both are placeholders rather than words: the strings that reach the
  // reader are the core's own notation.
  for (const locale of LOCALES) {
    for (const key of ['timeline.ruleGap', 'action.adoptRule', 'action.adoptRuleTitle']) {
      assert.notEqual(translate(locale, key), key, `${locale} has no words for ${key}`);
    }
  }
  const stated = translate('en', 'timeline.ruleGap', {
    generation: 2,
    rule: 'B3/S23',
    current: 'B36/S23',
  });
  assert.match(stated, /B3\/S23/, 'the rule the generation ran is named');
  assert.match(stated, /B36\/S23/, 'and the rule in force is named');
  assert.match(stated, /2/);
  assert.match(translate('en', 'action.adoptRule', { rule: 'B3/S23' }), /B3\/S23/);
  assert.match(translate('zh', 'action.adoptRule', { rule: 'B3/S23' }), /B3\/S23/);
});

test('an entry that needs a plural is a function of its parameters', () => {
  // English needs "1 generation" and "3 generations"; Chinese does not inflect.
  assert.equal(translate('en', 'action.earlier', { count: 1 }), 'show 1 earlier generation');
  assert.equal(translate('en', 'action.earlier', { count: 3 }), 'show 3 earlier generations');
  assert.equal(translate('zh', 'action.earlier', { count: 3 }), '显示更早的 3 代');
});

test('an error is a translated label plus the message the core wrote', () => {
  const described = describeError('en', 'out_of_bounds', '(70000, 1) is outside a 64 x 64 world');
  assert.match(described, /that is outside the world/);
  assert.match(described, /\(70000, 1\) is outside a 64 x 64 world/);

  const chinese = describeError('zh', 'out_of_bounds', '(70000, 1) is outside');
  assert.match(chinese, /该位置在世界之外/);
  // The diagnostic itself is never translated: it names the field that was
  // wrong, and a translation would be a second description of the same fact.
  assert.match(chinese, /\(70000, 1\) is outside/);
});

test('an unknown code is shown as itself with no invented label', () => {
  assert.equal(describeError('en', 'some_new_code', 'the core said so'), 'some_new_code: the core said so');
  assert.equal(describeError('en', 'some_new_code', ''), 'some_new_code');
});

test('a labelled error with no message shows only the label', () => {
  assert.equal(describeError('en', 'core_unavailable', ''), 'the world core is not running');
});
