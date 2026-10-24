/**
 * lifegame viewer — the archives route: the exported sessions, managed.
 *
 * An archive is a file the core wrote into the data directory. This page lists
 * what the service says is there, names a file to write, and renames, deletes or
 * loads one. Three rules shape it, and all three are the service's rather than
 * this page's:
 *
 * - **The page cannot see the filesystem**, so the list is the service's answer
 *   and never something derived here. A name the service would refuse to act on
 *   must not appear as a row the user can then fail to click.
 * - **A request names an archive; it does not choose a path.** The name is a
 *   plain file name and the service resolves it inside the data directory.
 * - **Opening an archive as a session is a command the protocol does not have
 *   yet.** The page reports the core's refusal in the reader's language rather
 *   than showing a success that did not happen.
 *
 * The words, the theme, the error banner and the language switch are the shell's
 * (`../app.js`); this module asks for the shared context over the handshake in
 * `../link.mjs` and never imports the shell.
 */

import { connectShell } from '../link.mjs';

// -- the shared context, filled by the shell ------------------------------

let state = null;
const dom = {};
let t = (key) => key;
let describeError = () => '';
let postJson = async () => ({ response: { ok: false, status: 0 }, reply: {} });
let apiUrl = (path) => path;
let readJson = async () => ({ ok: false, error: 'bad_reply', message: 'no shell' });
let absorb = (payload) => payload;
let showError = () => {};

function fill(context) {
  state = context.state;
  // The shared containers join this page's own, which are bound at module scope
  // below because a module script runs after the document is parsed and the
  // event wiring needs them then, whichever order the shell loads in.
  Object.assign(dom, context.dom);
  t = context.t;
  describeError = context.describeError;
  postJson = context.postJson;
  apiUrl = context.apiUrl;
  readJson = context.readJson;
  absorb = context.absorb;
  showError = context.showError;
  registerHooks(context.on);
}

/**
 * The elements this page reads. Literal `getElementById` calls, because the
 * contract test reads this list out of the file as text and asserts the archives
 * fragment declares every id in it.
 */
function bindOwnDom() {
  dom.archiveName = document.getElementById('archive-name');
  dom.archiveList = document.getElementById('archive-list');
  dom.archiveNote = document.getElementById('archive-note');
  dom.archiveRefresh = document.getElementById('archive-refresh');
  dom.exportArchive = document.getElementById('export-archive');
}

let hooksRegistered = false;
function registerHooks(on) {
  if (hooksRegistered) return;
  hooksRegistered = true;
  on('retranslate', renderArchives);
  on('state', updateArchiveControls);
  on('hello', updateArchiveControls);
}

function missingContainers() {
  return ownKeys.filter((name) => dom[name] === null || dom[name] === undefined);
}

// -- the list -------------------------------------------------------------

/** A size a person can read, in the units the locale table names. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return t('value.none');
  if (bytes < 1024) return t('unit.bytes', { value: bytes });
  if (bytes < 1024 * 1024) return t('unit.kilobytes', { value: (bytes / 1024).toFixed(1) });
  return t('unit.megabytes', { value: (bytes / (1024 * 1024)).toFixed(1) });
}

function formatModified(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? t('value.none') : at.toLocaleString(state.locale);
}

function archiveNote(key, params) {
  dom.archiveNote.textContent = key === null || key === undefined ? '' : t(key, params);
}

/**
 * Ask the service what is in the archive directory.
 *
 * The list is the service's answer rather than something the page derives: the
 * page cannot see the filesystem, and a name the service would refuse to act on
 * must not appear as a row the user can then fail to click.
 */
async function refreshArchives() {
  try {
    const response = await fetch('/api/archives');
    const reply = await readJson(response);
    state.archives = Array.isArray(reply.archives) ? reply.archives : [];
  } catch {
    state.archives = [];
  }
  renderArchives();
  updateArchiveControls();
}

/**
 * Exporting is only possible when the core is recording something.
 *
 * Read from the shared state rather than asked for here: the shell has already
 * heard whether the core keeps a history, on every state reply and on the
 * stream's `hello`, so this page does not ask a second time.
 */
function updateArchiveControls() {
  dom.exportArchive.disabled = state.history !== true;
}

function renderArchives() {
  if (state.archives.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'archive-figures';
    empty.textContent = t('archive.empty');
    dom.archiveList.replaceChildren(empty);
    return;
  }
  dom.archiveList.replaceChildren(...state.archives.map(archiveRow));
}

function archiveRow(entry) {
  const row = document.createElement('li');
  row.className = 'archive-row';
  if (state.exported === entry.name) row.dataset.current = 'true';

  if (state.renaming === entry.name) {
    // Renaming in place, with the name in an input: a native prompt cannot be
    // driven from a test and cannot be translated, so it is not used anywhere
    // in this page.
    const input = document.createElement('input');
    input.className = 'archive-rename-input';
    input.type = 'text';
    input.value = entry.name;
    input.dataset.role = 'rename-input';

    const actions = document.createElement('div');
    actions.className = 'archive-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = t('action.rename');
    save.addEventListener('click', () => void renameArchive(entry.name, input.value));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('action.narrow');
    cancel.addEventListener('click', () => {
      state.renaming = null;
      renderArchives();
    });
    actions.append(save, cancel);
    row.append(input, actions);
    return row;
  }

  const name = document.createElement('span');
  name.className = 'archive-name';
  name.textContent = entry.name;

  const figures = document.createElement('span');
  figures.className = 'archive-figures';
  const generations =
    entry.generations === null || entry.generations === undefined
      ? t('archive.unknownGenerations')
      : String(entry.generations);
  figures.textContent = `${generations} · ${formatBytes(entry.bytes)} · ${formatModified(entry.modified)}`;

  const actions = document.createElement('div');
  actions.className = 'archive-actions';

  const load = document.createElement('button');
  load.type = 'button';
  load.textContent = t('action.import');
  load.addEventListener('click', () => void importArchive(entry.name));

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.textContent = t('action.rename');
  rename.addEventListener('click', () => {
    state.renaming = entry.name;
    state.confirmingDelete = null;
    renderArchives();
  });

  // Deleting a file is the one action here that cannot be undone by pressing
  // something else, so it takes two presses of the same button.
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent =
    state.confirmingDelete === entry.name ? t('action.deleteConfirm') : t('action.delete');
  remove.addEventListener('click', () => {
    if (state.confirmingDelete === entry.name) {
      void deleteArchive(entry.name);
      return;
    }
    state.confirmingDelete = entry.name;
    state.renaming = null;
    renderArchives();
  });

  actions.append(load, rename, remove);
  row.append(name, figures, actions);
  return row;
}

// -- the three operations -------------------------------------------------

/** Write the recorded session to a named file, and show the list again. */
async function exportArchive() {
  const typed = (dom.archiveName.value ?? '').trim();
  const name = typed === '' ? 'archive.jsonl' : typed;
  try {
    const { response, reply } = await postJson(apiUrl('/api/archive'), { name });
    if (!response.ok || reply.ok === false) {
      archiveNote('archive.failed', {
        message: describeError(state.locale, reply.error ?? 'internal', reply.message),
      });
      return;
    }
    state.exported = reply.name ?? name;
    archiveNote('archive.exported', { count: reply.generations, name: state.exported });
    await refreshArchives();
  } catch (error) {
    archiveNote('archive.failed', { message: error.message });
  }
}

async function importArchive(name) {
  try {
    const { response, reply } = await postJson(apiUrl('/api/archive/import'), { name });
    if (!response.ok || reply.ok === false) {
      const code = reply.error ?? 'internal';
      archiveNote(
        code === 'archive_import_unsupported' ? 'archive.importUnsupported' : 'archive.failed',
        code === 'archive_import_unsupported'
          ? undefined
          : { message: describeError(state.locale, code, reply.message) },
      );
      return;
    }
    archiveNote('archive.imported', { name });
    if (reply.state !== undefined) absorb(reply.state);
    await refreshArchives();
  } catch (error) {
    archiveNote('archive.failed', { message: error.message });
  }
}

async function renameArchive(from, to) {
  const wanted = String(to ?? '').trim();
  if (wanted === '' || wanted === from) {
    state.renaming = null;
    renderArchives();
    return;
  }
  try {
    const { response, reply } = await postJson('/api/archive/rename', { name: from, to: wanted });
    if (!response.ok || reply.ok === false) {
      archiveNote('archive.failed', {
        message: describeError(state.locale, reply.error ?? 'internal', reply.message),
      });
      return;
    }
    state.renaming = null;
    state.archives = Array.isArray(reply.archives) ? reply.archives : state.archives;
    archiveNote('archive.renamed', { from: reply.from, to: reply.to });
    renderArchives();
  } catch (error) {
    archiveNote('archive.failed', { message: error.message });
  }
}

async function deleteArchive(name) {
  try {
    const { response, reply } = await postJson('/api/archive/delete', { name });
    state.confirmingDelete = null;
    if (!response.ok || reply.ok === false) {
      archiveNote('archive.failed', {
        message: describeError(state.locale, reply.error ?? 'internal', reply.message),
      });
      return;
    }
    state.archives = Array.isArray(reply.archives) ? reply.archives : state.archives;
    if (state.exported === name) state.exported = null;
    archiveNote('archive.deleted', { name: reply.name ?? name });
    renderArchives();
  } catch (error) {
    archiveNote('archive.failed', { message: error.message });
  }
}

// -- events ---------------------------------------------------------------

// The page's own elements, bound now: this module runs after the document is
// parsed, and the controls below are wired onto them.
bindOwnDom();
const ownKeys = Object.keys(dom);

dom.archiveRefresh.addEventListener('click', () => void refreshArchives());
dom.exportArchive.addEventListener('click', () => void exportArchive());
dom.archiveName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void exportArchive();
  }
});

// -- start ----------------------------------------------------------------

function start() {
  const missing = missingContainers();
  if (missing.length > 0) {
    showError(t('error.missingContainers', { names: missing.join(', ') }));
    return;
  }
  updateArchiveControls();
  void refreshArchives();
}

connectShell(fill, start);
