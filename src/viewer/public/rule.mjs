/**
 * lifegame viewer — the rule vocabulary: the presets, and one parser.
 *
 * A life-like rule is `B<digits>/S<digits>`: the neighbour counts that bring a
 * dead cell to life, and the counts that keep a live one alive. The core is the
 * authority on what it accepts — it answers `bad_rule` with a reason — but a
 * page that waits for a round trip to say "you typed a 9" is a page that makes
 * the user wait for arithmetic. So the same rule is expressed here once, as a
 * pure function, for two callers: the editor, which refuses a malformed value
 * before it sends anything, and the test suite, which asserts every branch of
 * that refusal.
 *
 * Three decisions are worth stating:
 *
 * - **The parse normalises; it does not merely accept.** `b3/s23`, `S32/B3` and
 *   `B03/S23` all describe the same rule, and the payload the page sends is the
 *   canonical form `B3/S23` — so what the user typed and what the readout shows
 *   are the same string after one keystroke of round trip, and the record of
 *   what was run is a canonical one. `S32` is the case that matters: the digit
 *   order carries no meaning, so sorting it is part of understanding it.
 * - **Every rejection names why.** A parser that returns only `null` cannot say
 *   which of five things was wrong, and the message the user needs is different
 *   for each. The reasons are codes, not sentences: the words live in the
 *   locale table, where every other word the user can read lives.
 * - **The preset list is data, and the names are keys.** The eight rules below
 *   are the ones people ask for by name; the name of each is a locale key, so
 *   the list holds no English and no Chinese.
 *
 * The core remains the authority. This module is the *first* check, never the
 * last: a value that passes here can still come back `bad_rule`, and the editor
 * shows the core's own reason and leaves the running rule alone.
 */

/** The value of the select's custom entry: a rule that is none of the presets. */
export const CUSTOM_RULE = 'custom';

/**
 * The rules a person asks for by name, in the order the control lists them.
 *
 * `key` names the locale entry holding the display name, so the words are in the
 * table and the rule string is here.
 */
export const RULE_PRESETS = Object.freeze([
  Object.freeze({ rule: 'B3/S23', key: 'rule.preset.conway' }),
  Object.freeze({ rule: 'B36/S23', key: 'rule.preset.highlife' }),
  Object.freeze({ rule: 'B3/S12345', key: 'rule.preset.maze' }),
  Object.freeze({ rule: 'B2/S', key: 'rule.preset.seeds' }),
  Object.freeze({ rule: 'B/S012345678', key: 'rule.preset.eight' }),
  Object.freeze({ rule: 'B3678/S34678', key: 'rule.preset.dayAndNight' }),
  Object.freeze({ rule: 'B1357/S1357', key: 'rule.preset.replicator' }),
  Object.freeze({ rule: 'B3/S012345678', key: 'rule.preset.lifeWithoutDeath' }),
]);

/** Every rule string the preset list offers, for a membership test. */
export const PRESET_RULES = Object.freeze(RULE_PRESETS.map((entry) => entry.rule));

/**
 * The reasons a rule is refused, each of which the locale table has a sentence
 * for. Exported so a test can assert that every one of them has words.
 */
export const RULE_REASONS = Object.freeze([
  'missingB',
  'missingS',
  'badCharacter',
  'outOfRange',
  'duplicateDigit',
  'badFormat',
]);

/**
 * Parse and normalise a life-like rule.
 *
 * Accepts `B<digits>/S<digits>` in any case, with the digits in any order, and
 * pads nothing: `B2/S` is the rule in which a live cell with no neighbours dies,
 * which is a rule and not a typo.
 *
 * @param {unknown} text what the user typed
 * @returns {{ok: true, rule: string, birth: number[], survival: number[]}
 *   | {ok: false, reason: string}}
 */
export function parseRule(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'badFormat' };
  const canonical = text.trim().toUpperCase();
  if (canonical === '') return { ok: false, reason: 'badFormat' };

  // The two sections in order, and nothing else in the string: an embedded
  // space, a second slash or a trailing note is a value this page does not
  // understand, and guessing at it would send the core something the user did
  // not write.
  const match = /^B(\d*)\/S(\d*)$/.exec(canonical);
  if (match === null) {
    if (!canonical.includes('B')) return { ok: false, reason: 'missingB' };
    if (!canonical.includes('S')) return { ok: false, reason: 'missingS' };
    // Both sections are there but something else is wrong with the shape: a
    // missing or doubled slash, a space in the middle, a letter among the
    // digits. The user typed something that looks like a rule and is not one.
    return { ok: false, reason: 'badCharacter' };
  }

  const birth = readDigits(match[1]);
  if (birth.reason !== undefined) return { ok: false, reason: birth.reason };
  const survival = readDigits(match[2]);
  if (survival.reason !== undefined) return { ok: false, reason: survival.reason };

  return {
    ok: true,
    rule: `B${birth.digits.join('')}/S${survival.digits.join('')}`,
    birth: birth.digits,
    survival: survival.digits,
  };
}

/**
 * One section's digits: in range, once each, in ascending order.
 *
 * An empty section is legal and yields an empty list — `B/S` is the rule in
 * which nothing is ever born and nothing survives.
 */
function readDigits(section) {
  const digits = [];
  for (const character of section) {
    if (character === '9') return { reason: 'outOfRange' };
    const digit = Number(character);
    if (digit < 0 || digit > 8) return { reason: 'badCharacter' };
    if (digits.includes(digit)) return { reason: 'duplicateDigit' };
    digits.push(digit);
  }
  digits.sort((left, right) => left - right);
  return { digits };
}

/**
 * The option a rule string corresponds to: its own name, or the custom entry.
 *
 * This is what keeps the control honest when the running rule is not one of the
 * presets: the select shows the custom entry rather than the nearest preset, and
 * a test can assert which of the two states the control is in without a browser.
 *
 * @param {string} rule the rule the core is running
 * @returns {string} the preset's rule string, or `CUSTOM_RULE`
 */
export function presetFor(rule) {
  return PRESET_RULES.includes(rule) ? rule : CUSTOM_RULE;
}

/**
 * The rule a `set_rule` reply says is running.
 *
 * The contract fixes the field on the reply itself. A service that also carries
 * a state reply — which is what the viewer does for the commands that move the
 * world — names the same fact in `state.rule`, so both are read and neither can
 * disagree about what the core took. The value that was *sent* is the last
 * resort, for a core that answered `ok` without repeating the field.
 *
 * @param {object|null|undefined} reply the core's answer
 * @param {string} sent the canonical rule the request carried
 * @returns {string} the rule the core reports, or `sent` when it reports none
 */
export function reportedRule(reply, sent) {
  if (typeof reply?.rule === 'string' && reply.rule !== '') return reply.rule;
  if (typeof reply?.state?.rule === 'string' && reply.state.rule !== '') return reply.state.rule;
  return sent;
}
