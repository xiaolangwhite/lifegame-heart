/**
 * The report: one machine-readable file, one human-readable file, one exit code.
 *
 * The two forms answer different questions and both are required. A gate needs
 * `report.json` so it can decide without reading prose; a person needs text
 * that says what was expected, what was measured and what it means, because the
 * defects this tool was written for were invisible until somebody read two
 * numbers side by side.
 *
 * The exit code is derived, never set by hand:
 *
 * | Code | Meaning |
 * |---|---|
 * | 0 | every check passed (skipped checks do not fail a run) |
 * | 1 | the tool ran, and at least one declared expectation did not hold |
 * | 2 | the tool could not run, or could not clean up after itself |
 *
 * A skip is deliberately not a pass. "Not run" and "no problem found" are
 * different statements, and this repository has been burned by the difference:
 * a gate that cannot run must never be reported as a gate that passed.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ensureDir } from './paths.mjs';

/** The report format's own number, so a consumer can refuse one it predates. */
export const REPORT_SCHEMA = 1;

const OUTCOME_TEXT = {
  passed: 'passed',
  mismatch: 'mismatch',
  not_run: 'not run',
};

/** A new, empty report. `meta` carries the identity of the run. */
export function createReport(meta) {
  return {
    schema: REPORT_SCHEMA,
    tool: 'browser-probe',
    startedAt: meta.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    command: meta.command ?? [],
    status: 'not_run',
    exitCode: 2,
    target: meta.target ?? null,
    browser: meta.browser ?? null,
    mode: meta.mode ?? [],
    checks: [],
    probes: {},
    cleanup: { pids: [], stopped: [], leftBehind: [], profileRemoved: null, ok: null, notes: [] },
    artifacts: [],
    notices: [],
    failure: null,
  };
}

/**
 * Add one check, ignoring a repeat of an id that is already recorded.
 *
 * The dedupe is what lets a probe declare its own expectations without knowing
 * whether an earlier probe already recorded the same fact.
 */
export function addCheck(report, entry) {
  if (report.checks.some((existing) => existing.id === entry.id)) return false;
  report.checks.push(entry);
  return true;
}

/** Add a check and return it, for a caller that wants to keep the reference. */
export function record(report, entry) {
  addCheck(report, entry);
  return entry;
}

export function addNotice(report, notice) {
  if (typeof notice === 'string' && notice !== '' && !report.notices.includes(notice)) {
    report.notices.push(notice);
  }
}

export function addArtifact(report, file) {
  if (typeof file === 'string' && file !== '') report.artifacts.push(file);
}

/** Store one probe's measurements under the probe's own name. */
export function setProbe(report, name, measurements) {
  report.probes[name] = measurements;
}

/**
 * Decide the outcome and the exit code.
 *
 * A leftover process outranks a failed check: the run is reported as not
 * completed, because the tool did not finish the job it promised — it must not
 * leave an orphan behind, and a report that hides one is worse than a red one.
 *
 * The profile directory is part of that verdict. A Chromium browser runs some
 * of its children with a restricted token; such a child can survive a process
 * tree kill and cannot always be attributed by its command line, but it cannot
 * hide the files it holds open. A profile directory that survives its own
 * removal is therefore evidence of a browser process still running, and it is
 * treated the same way a surviving pid is.
 */
export function finalize(report) {
  const failed = report.checks.filter((entry) => entry.status === 'fail');
  const skipped = report.checks.filter((entry) => entry.status === 'skip');
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  const profileHeld = report.cleanup.profileRemoved === false;
  report.cleanup.ok = report.cleanup.leftBehind.length === 0 && !profileHeld;

  if (report.failure !== null || report.cleanup.ok === false) {
    report.status = 'not_run';
    report.exitCode = 2;
  } else if (failed.length > 0) {
    report.status = 'mismatch';
    report.exitCode = 1;
  } else {
    report.status = 'passed';
    report.exitCode = 0;
  }
  report.summary = {
    checks: report.checks.length,
    passed: report.checks.filter((entry) => entry.status === 'pass').length,
    failed: failed.length,
    skipped: skipped.length,
  };
  return report;
}

function formatCheckLine(entry, indent = '  ') {
  const lines = [`${indent}${entry.status.toUpperCase().padEnd(4)}  ${entry.id}`];
  if (entry.expected !== undefined) lines.push(`${indent}        expected: ${entry.expected}`);
  if (entry.actual !== undefined) lines.push(`${indent}        actual:   ${entry.actual}`);
  if (entry.detail !== undefined && entry.detail !== null) lines.push(`${indent}        detail:   ${entry.detail}`);
  return lines.join('\n');
}

/** One request as a line a person can scan: transport, method, url, status. */
function formatRequest(entry) {
  const status = entry.status === null || entry.status === undefined ? 'no reply' : String(entry.status);
  const transport = entry.transport ?? 'http';
  const error = entry.error === undefined ? '' : ` (${entry.error})`;
  return `${transport.padEnd(11)} ${String(entry.method ?? 'GET').padEnd(5)} ${status.padEnd(7)} ${entry.url}${error}`;
}

/**
 * The requests the page issued, with the ones made before the press separated
 * from the ones the press caused.
 *
 * This is the evidence behind an `interaction.request:` check: when a click is
 * supposed to select a generation and nothing was selected, the request that
 * should have followed the press is the thing that is missing, and it has to be
 * visible without opening the JSON.
 */
function renderRequests(interaction, limit = 25) {
  if (interaction === undefined || interaction === null) return [];
  const load = Array.isArray(interaction.loadRequests) ? interaction.loadRequests : [];
  const input = Array.isArray(interaction.inputRequests) ? interaction.inputRequests : [];
  if (load.length === 0 && input.length === 0) return ['  none: the page issued no request that the probe could see'];
  const lines = [];
  lines.push(`  during load (${load.length})`);
  for (const entry of load.slice(0, limit)) lines.push(`    ${formatRequest(entry)}`);
  if (load.length > limit) lines.push(`    and ${load.length - limit} more`);
  lines.push(`  caused by the press (${input.length})`);
  for (const entry of input.slice(0, limit)) lines.push(`    ${formatRequest(entry)}`);
  if (input.length > limit) lines.push(`    and ${input.length - limit} more`);
  return lines;
}

/** The report as text a person reads. */
export function renderText(report) {
  const lines = [];
  lines.push('browser-probe - a real browser, measured against a running service');
  lines.push(`started  ${report.startedAt}`);
  if (report.target !== null) {
    const started = report.target.serviceStarted === true ? 'started by this tool' : 'attached, not started here';
    lines.push(`service  ${report.target.service} (${started})`);
    // A report written after a failure that happened before the plan existed
    // has no route facts. The renderer therefore prints what is there rather
    // than assuming the shape of a complete run: a crash while explaining a
    // failure would replace one honest exit code with a meaningless one.
    if (typeof report.target.route === 'string') lines.push(`route    ${report.target.route}`);
    if (Array.isArray(report.target.routes)) {
      lines.push(`routes   ${report.target.routes.join(', ')} [${report.target.routesSource ?? 'unknown source'}]`);
    }
    if (report.target.history !== undefined) {
      lines.push(`history  ${report.target.history === null ? 'off' : report.target.history}`);
    }
  }
  if (report.browser !== null) {
    const product = report.browser.product ?? 'unknown product';
    const version = report.browser.version ?? 'unknown version';
    lines.push(`browser  ${report.browser.path} (${product} ${version}, source: ${report.browser.source})`);
    lines.push(`cdp      http://127.0.0.1:${report.browser.cdpPort}/json/version`);
  }
  lines.push(`mode     ${report.mode.join(', ')}`);
  lines.push('');

  for (const name of Object.keys(report.probes)) {
    const entries = report.checks.filter((entry) => entry.probe === name);
    lines.push(`${name.toUpperCase()} (${entries.length} check${entries.length === 1 ? '' : 's'})`);
    if (entries.length === 0) lines.push('  (no check)');
    for (const entry of entries) lines.push(formatCheckLine(entry));
    if (name === 'interaction') {
      lines.push('  REQUESTS');
      for (const line of renderRequests(report.probes.interaction)) lines.push(line);
    }
    lines.push('');
  }

  const cleanup = report.cleanup;
  lines.push('CLEANUP');
  if (cleanup.pids.length === 0) {
    lines.push('  nothing was started, so nothing had to be stopped');
  } else {
    lines.push(`  attributed  ${cleanup.pids.length} process(es) to this run`);
    lines.push(`  stopped     ${cleanup.stopped.length}`);
    lines.push(
      `  left behind ${cleanup.leftBehind.length}${cleanup.leftBehind.length === 0 ? ' (verified)' : `: ${cleanup.leftBehind.join(', ')}`}`,
    );
    if (cleanup.profileRemoved !== null && cleanup.profileRemoved !== undefined) {
      lines.push(
        `  profile     ${cleanup.profileRemoved ? 'released and removed' : 'STILL IN USE, so a browser process may remain'}`,
      );
    }
  }
  for (const note of cleanup.notes) lines.push(`  note        ${note}`);
  lines.push('');

  if (report.artifacts.length > 0) {
    lines.push('ARTIFACTS');
    for (const artifact of report.artifacts) lines.push(`  ${artifact}`);
    lines.push('');
  }

  if (report.notices.length > 0) {
    lines.push('NOTICES');
    for (const notice of report.notices) lines.push(`  ${notice}`);
    lines.push('');
  }

  const summary = report.summary ?? { checks: 0, passed: 0, failed: 0, skipped: 0 };
  const skipped = summary.skipped > 0 ? `, ${summary.skipped} skipped` : '';
  if (report.status === 'passed') {
    lines.push(`RESULT  passed: ${summary.passed} of ${summary.checks} check(s)${skipped} (exit 0)`);
  } else if (report.status === 'mismatch') {
    lines.push(`RESULT  mismatch: ${summary.failed} of ${summary.checks} check(s) failed${skipped} (exit 1)`);
    for (const entry of report.checks.filter((item) => item.status === 'fail')) {
      lines.push(`  - ${entry.id}`);
    }
  } else {
    const reason =
      report.failure === null
        ? 'a process or a profile directory this run started was still held at the end'
        : report.failure.message;
    lines.push(`RESULT  ${OUTCOME_TEXT.not_run}: ${reason} (exit 2)`);
  }
  return lines.join('\n');
}

/**
 * Serialise as JSON with every non-ASCII character escaped as `\uXXXX`.
 *
 * The machine-readable report is the one a gate reads, so it must not depend on
 * the reader guessing the code page. The measured page's own text can be
 * non-ASCII — a title, an error message — and on a machine whose default
 * encoding is not UTF-8 (this repository's Windows shell among them) a reader
 * that decodes the file as ANSI produces mojibake *inside a JSON string*, which
 * is enough to make a strict parser reject the whole document. Escaping keeps
 * the bytes ASCII, the escapes are ordinary JSON that every parser understands,
 * and the values survive intact. The text report stays UTF-8 for people.
 */
export function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Write both forms into the run's output directory.
 *
 * @returns {{json: string, text: string}}
 */
export function writeReports(report, outDir) {
  const directory = ensureDir(outDir, 'report directory');
  const jsonPath = path.join(directory, 'report.json');
  const textPath = path.join(directory, 'report.txt');
  writeFileSync(jsonPath, `${asciiJson(report)}\n`, 'utf8');
  writeFileSync(textPath, `${renderText(report)}\n`, 'utf8');
  return { json: jsonPath, text: textPath };
}
