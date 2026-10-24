/**
 * lifegame viewer — building a `<select>` from the list that owns it.
 *
 * Two routes build selects and both build them the same way: the shell fills the
 * language list from `locales.mjs`, the world page fills the grid widths from
 * `theme.mjs` and the representations from the core's `hello.limits`. The rule is
 * the same in every case — the options are *not* in the markup, because a
 * `<select>` that lists its options in HTML is a second copy of a list a module
 * already owns — so the mechanism lives here once instead of twice.
 *
 * Keeping the current value is part of it. A switch that relabels its options
 * (a language change) must not move the user's selection, and a list that is
 * rebuilt from the core (a representation switch) must keep the value that is
 * actually running.
 */

/**
 * Replace a select's options with `values`, keeping the current value when it is
 * still offered, and label every option through `labelOption`.
 *
 * @param {HTMLSelectElement} select
 * @param {readonly string[]} values
 * @param {(value: string) => string} labelOption
 */
export function fillOptions(select, values, labelOption) {
  const previous = select.value;
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    select.append(option);
  }
  if (values.includes(previous)) select.value = previous;
  labelOptions(select, labelOption);
}

/**
 * Relabel the options already in a select, in place.
 *
 * Used on a language change: the values are the same and only the words differ,
 * so rebuilding the list would be a needless second place that can lose the
 * selection.
 */
export function labelOptions(select, labelOption) {
  for (const option of select.options) option.textContent = labelOption(option.value);
}
