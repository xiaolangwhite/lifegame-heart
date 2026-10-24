/**
 * lifegame viewer — the values the browser and the service must agree on.
 *
 * This module exists because a shared number with two declarations drifts. It is
 * written as a plain ES module in `public/` so that **both sides can import the
 * same file**: the service reaches it by relative path (`./public/shared.mjs`)
 * and the browser loads it over `/static/shared.mjs`, which is the same bytes
 * served by the same static handler. There is no build step and no second copy.
 *
 * What belongs here is exactly that intersection — a rule or a bound that one
 * side computes and the other must not recompute:
 *
 * - **The frame admission rule.** The core's encoder chooses the coordinate
 *   encoding while `8 * live <= ceil(w / 8) * h`, which is `live * 64 <= area` up
 *   to rounding, and that path never builds a dense grid. A rectangle that cannot
 *   take that path is capped at `MAX_FRAME_CELLS`, because the bitmap path
 *   allocates `w * h` bytes and a design-target request would ask for gigabytes.
 *   The REST route and the push transport both apply it, and so does the page's
 *   zoom range, which is why it cannot live in one of them.
 * - **How much of the live set one request may carry.** Every canvas that has to
 *   choose a point inside the world reads the live set once per selection, and
 *   that payload is bounded here so the page and the service cannot disagree
 *   about when the cheap path stops being cheap.
 * - **How a core's declared limits are read.** The core publishes
 *   `hello.limits`; nobody else may invent a bound the core would refuse. This
 *   module turns the reply into a plain object, and returns *null* for a bound
 *   the core did not declare rather than substituting a plausible number — a
 *   page that offers a rate the core rejects is a page that lies.
 *
 * **There is no default view here.** The view a page opens with is a function of
 * the canvas it was given — one cell per `DEFAULT_PIXELS_PER_CELL` CSS pixels —
 * and that rule lives in `viewport.mjs`, beside the rest of the arithmetic, as
 * its only declaration. A second, fixed default on the service side would be the
 * copy that drifts, so a subscription that has not named a rectangle is not
 * subscribed to at all: see `events.mjs`.
 *
 * Authority for the encoder rule: src/lifegame/world/bridge.py `encode_frame`
 * and its `hello` handler.
 */

/**
 * The largest rectangle the `bits` encoding may be asked to build.
 *
 * 16 Mi cells is 2 MiB of payload and 16 MiB of transient storage in the core —
 * bounded and quick. Above it, only a rectangle whose coordinate encoding is
 * guaranteed is admissible.
 */
export const MAX_FRAME_CELLS = 16 * 1024 * 1024;

/**
 * The largest live set one client may be handed in a single reply, in cells.
 *
 * A page that has to centre a preview on the nearest live cell reads the whole
 * live set once per selection and scans it in the browser. That payload is the
 * core's `cells` export: eight bytes per cell on the wire before base64, so this
 * cap is 128 KiB of payload and about 171 KiB of base64 — one request a person
 * waits for. Above it the page is told the population instead, and falls back to
 * the centre of `state.bounds`, which is a coarser answer rather than a slower
 * one. The service applies the cap and the page renders the degradation, so the
 * number is declared once, here, for both.
 */
export const MAX_CELLS_FOR_NEAREST = 1 << 14;

/**
 * Decide whether a frame rectangle may be asked for.
 *
 * `population` is an upper bound for the live cells inside the rectangle, so
 * satisfying the encoder's inequality *guarantees* the coordinate encoding. The
 * guarantee is made against the last reported population, so a world that grows
 * between the last report and the request can still take the bitmap path — and
 * then the area cap bounds the allocation at `maxFrameCells` bytes, which is
 * what the cap is for.
 *
 * @param {{area: number, population: number, maxFrameCells?: number}} options
 * @returns {{error: string, message: string} | null} null when admissible
 */
export function frameAdmission(options) {
  const { area, population, maxFrameCells = MAX_FRAME_CELLS } = options;
  const cellsEncodingGuaranteed = population * 64 <= area;
  if (cellsEncodingGuaranteed || area <= maxFrameCells) return null;
  return {
    error: 'bad_request',
    message:
      `frame area ${area} exceeds ${maxFrameCells} cells, and the last reported population ` +
      `(${population}) is too large for the cells encoding; zoom in or wait for the population to fall`,
  };
}

/** What a core that declared no limits is treated as having declared. */
export const NO_LIMITS = Object.freeze({
  ticksPerSecond: null,
  stepsPerRequest: null,
  maxCoordinate: null,
  representations: Object.freeze([]),
});

/**
 * Read `hello.limits` into the shape the page and the service use.
 *
 * A bound the core did not declare becomes `null`, never a default. The caller
 * that finds a `null` must disable the affordance rather than guess: that is the
 * difference between a control that is unavailable and a control that produces a
 * refusal the user cannot explain.
 *
 * @param {{limits?: object} | null | undefined} hello the core's `hello` reply
 */
export function readLimits(hello) {
  const limits = hello?.limits;
  if (limits === null || typeof limits !== 'object') return { ...NO_LIMITS };

  const tickBounds = limits.ticksPerSecond;
  const min = integerOrNull(tickBounds?.min);
  const max = integerOrNull(tickBounds?.max);
  const ticksPerSecond = min !== null && max !== null && max >= min && min >= 1 ? { min, max } : null;

  const representations = Array.isArray(limits.representations)
    ? limits.representations.filter((name) => typeof name === 'string' && name !== '')
    : [];

  return {
    ticksPerSecond,
    stepsPerRequest: integerOrNull(limits.stepsPerRequest),
    maxCoordinate: integerOrNull(limits.maxCoordinate),
    representations,
  };
}

/**
 * A tick rate the core will accept, or `null` when it declared no range.
 *
 * Clamping rather than refusing: a slider already constrains the value, and this
 * is the last line of defence behind it.
 */
export function clampTicksPerSecond(value, limits) {
  const bounds = limits?.ticksPerSecond;
  if (!bounds) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return bounds.min;
  return Math.min(Math.max(Math.round(number), bounds.min), bounds.max);
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}
