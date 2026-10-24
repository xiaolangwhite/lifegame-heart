/**
 * lifegame viewer — every word the user can read, in one table.
 *
 * The interface has no user-visible text of its own. The shared layout and the
 * three page fragments carry structure and `data-i18n` keys; the shell fills
 * every text node and every `title` and `aria-label` from here. A string that
 * appears anywhere else is a string that cannot be translated, so the rule is
 * total rather than approximate.
 *
 * Three decisions are worth stating:
 *
 * - **Entries are templates, not fragments.** An entry holds a whole phrase with
 *   `{name}` placeholders, never a word that another entry concatenates onto. A
 *   language that orders the sentence differently cannot be served by gluing
 *   translated halves together, and neither can a language with a different
 *   plural rule — so an entry that needs one is a function of its parameters.
 * - **The core's `message` is not translated.** It is a diagnostic written by
 *   the Python core, in English, naming the field or the bound that was wrong. A
 *   translation of it would be a second, drifting description of the same fact.
 *   What *is* translated is the **label** for a known `error` code; the core's
 *   message is appended to it as detail. See README.md.
 * - **Key sets are identical.** A test asserts that `en` and `zh` have exactly
 *   the same keys and no empty values, so a string added to one language and
 *   forgotten in the other fails rather than falling back silently.
 */

export const LOCALE_STORAGE_KEY = 'lifegame.viewer.locale';

/** The languages the page offers, in the order the control lists them. */
export const LOCALES = Object.freeze(['en', 'zh']);

/** The language used when nothing else decides. */
export const DEFAULT_LOCALE = 'en';

/**
 * The hint line, as segments.
 *
 * Declared here rather than in a fragment because the hint *is* copy: its
 * separators, its order and which tokens are keyboard keys all differ between
 * languages. `key` names an entry holding the key cap to show before the text.
 */
export const HINT_SEGMENTS = Object.freeze([
  { text: 'hint.click' },
  { text: 'hint.drag' },
  { text: 'hint.wheel' },
  { text: 'hint.pinch' },
  { text: 'hint.space', key: 'key.space' },
  { text: 'hint.step', key: 'key.dot' },
  { text: 'hint.undo', key: 'key.undo' },
  { text: 'hint.panel', key: 'key.h' },
  { text: 'hint.wide', key: 'key.w' },
  { text: 'hint.stream' },
]);

/** The error codes the page has a label for. */
export const KNOWN_ERROR_CODES = Object.freeze([
  'bad_request',
  'unknown_command',
  'bad_arguments',
  'bad_rule',
  'out_of_bounds',
  'internal',
  'unknown_client',
  'switch_in_progress',
  'core_unavailable',
  'core_timeout',
  'not_found',
  'forbidden',
  'export_failed',
  'import_failed',
  'bad_reply',
  'no_history',
  'archive_exists',
  'archive_import_unsupported',
  'unknown_session',
  'unknown_pattern',
  'bad_placement',
  'default_session',
  'session_queue_full',
  'service_closing',
  'edit_active',
  'stale_base',
  'stale_generation',
  'duplicate_tx',
  'not_editing',
  'unknown_transaction',
  'too_large',
]);

const en = {
  'brand.title': 'lifegame viewer',

  'nav.world': 'world',
  'nav.history': 'history',
  'nav.archives': 'archives',

  'status.connecting': 'connecting…',
  'status.ok': 'core ok · {rule} · {representation}',
  'status.okRuleOnly': 'core ok · {rule}',
  'status.serviceUnreachable': 'service unreachable',
  'status.coreUnavailable': 'world core unavailable',
  'status.switching': 'switching to {representation}…',
  'status.limitsMissing': 'the core declared no limits; the rate control is unavailable',

  'action.run': 'Run',
  'action.pause': 'Pause',
  'action.step': 'Step',
  'action.clear': 'Clear',
  'action.theme': 'Theme: {theme}',
  'action.themeTitle': 'switch to the {theme} palette',
  'action.rollback': 'roll back',
  'action.rollbackTitle': 'restore generation {generation}',
  'action.stepBack': '◀ one generation',
  'action.stepForward': 'one generation ▶',
  'action.export': 'Export archive',
  'action.earlier': (params) =>
    params.count === 1 ? 'show 1 earlier generation' : `show ${params.count} earlier generations`,
  'action.collapse': '▸ hide panel',
  'action.expand': '◂ show panel',
  'action.wide': '⤢ full width',
  'action.narrow': '⤡ column',
  'action.import': 'load',
  'action.rename': 'rename',
  'action.delete': 'delete',
  'action.deleteConfirm': 'confirm delete',
  'action.refresh': 'refresh',

  'panel.history': 'history',
  'panel.archives': 'archives',
  'panel.readout': 'readout',
  'panel.collapseTitle': 'hide the panel and give the space to the canvas',
  'panel.expandTitle': 'show the panel again',
  'panel.wideTitle': 'let the panel take the whole width',
  'panel.narrowTitle': 'return the panel to a column beside the canvas',
  'panel.handleTitle': 'show the panel',

  'archive.empty': 'no archive has been written yet',
  'archive.name': 'name',
  'archive.size': 'size',
  'archive.modified': 'modified',
  'archive.generations': 'generations',
  'archive.nameLabel': 'file name',
  'archive.placeholder': 'history.jsonl',
  'archive.exported': 'wrote {count} generation(s) to {name}',
  'archive.imported': 'loaded {name}',
  'archive.renamed': 'renamed {from} to {to}',
  'archive.deleted': 'deleted {name}',
  'archive.failed': 'the archive operation failed: {message}',
  'archive.importUnsupported':
    'this core cannot load an archive yet: the protocol has no command that imports one as a session',
  'archive.unknownGenerations': 'unknown',

  'unit.bytes': '{value} B',
  'unit.kilobytes': '{value} kB',
  'unit.megabytes': '{value} MB',

  'label.tps': 'tps',
  'label.grid': 'grid',
  'label.storage': 'storage',
  'label.pattern': 'pattern',
  'label.session': 'session',
  'label.queued': '{count} waiting',
  'label.language': 'language',
  'label.rulePreset': 'rule',
  'label.ruleCustom': 'custom',
  'label.rulePresetTitle': 'the rules people ask for by name; choosing one is sent at once',
  'label.ruleCustomTitle': 'a rule to send as B…/S…, with digits 0-8',
  'label.generation': 'generation',
  'label.population': 'population',
  'label.origin': 'origin',
  'label.span': 'span',
  'label.rule': 'rule',
  'label.world': 'world',
  'label.cell': 'cell',
  'label.gridWidth': '{width} px',
  'label.gridWidthTitle': 'grid line width in pixels',
  'label.storageTitle': 'how the core stores the world',
  'label.languageTitle': 'the language of this page',

  'unit.px': '{value} px',
  'unit.cellsPerPx': '{value} cells/px',
  'unit.spanLimited': '{span} (limited by frame budget)',
  'value.none': '—',

  'locale.en': 'English',
  'locale.zh': '中文',

  'theme.dark': 'dark',
  'theme.light': 'light',
  'representation.sparse': 'sparse',
  'representation.tiled': 'tiled',

  /* The rule editor. The names are the reasons `parseRule` refuses a value, so
     the message the user reads names the thing that was wrong with what they
     typed, and the core is still free to refuse the value for a reason of its
     own. The presets are data in rule.mjs; only their names are here. */
  'action.setRule': 'set',
  'action.place': 'place',
  'action.newSession': 'new session',
  'action.undo': 'undo',
  'action.redo': 'redo',
  'action.editMode': 'edit',
  'action.editModeDone': 'done editing',
  'action.saveSnippet': 'save selection',
  'action.publish': 'publish',
  'label.tool': 'tool',
  'label.snippetName': 'snippet name',
  'label.transform': 'transform',
  'label.mode': 'mode',
  'label.snippet': 'snippet',
  'tool.paint': 'paint',
  'tool.erase': 'erase',
  'tool.line': 'line',
  'tool.rect': 'rectangle',
  'tool.select': 'select',
  'tool.stamp': 'stamp',
  'tool.pan': 'pan',
  'transform.none': 'none',
  'transform.rotate90': 'rotate 90',
  'transform.rotate180': 'rotate 180',
  'transform.rotate270': 'rotate 270',
  'transform.flipH': 'flip horizontal',
  'transform.flipV': 'flip vertical',
  'mode.overwrite': 'overwrite',
  'mode.merge': 'merge',
  'status.snippetSaved': 'selection saved as a draft',
  'status.snippetPublished': 'snippet published',
  'status.editResynced': 'the document moved; the edit state was refreshed',
  'status.editActive': 'editing — the world is paused',
  'status.editPresence': 'editing with {authors}',
  'status.editRemote': '{author} committed an edit',
  'error.editFailed': 'the edit was refused: {message}',
  'hint.undo': 'undo',
  'key.undo': 'Ctrl+Z',
  'label.undoTitle': 'undo the last cell edit (Ctrl+Z)',
  'label.runTitle': 'run the world (Space)',
  'label.pauseTitle': 'pause the world (Space)',
  'label.stepTitle': 'advance one generation (.)',
  'label.clearTitle': 'remove every cell and reset the generation',
  'label.placeTitle': 'place the selected pattern at the centre of the view',
  'label.editModeTitle': 'edit the world as atomic transactions (pauses the run)',
  'label.newSessionTitle': 'create a session at this world size',
  'error.unknown_session': 'no such session; it may have been closed or the service restarted',
  'error.unknown_pattern': 'this library does not contain that pattern',
  'error.bad_placement': 'that pattern does not fit at that position',
  'error.default_session': 'the default session cannot be closed',
  'error.service_closing': 'the service is shutting down',
  /* The history page's one rule action: adopt the rule the selected generation
     was recorded under. It names the rule, so the press says what it will do. */
  'action.adoptRule': 'use {rule}',
  'action.adoptRuleTitle': 'set the rule in force to {rule}',
  'rule.custom': 'custom · {rule}',
  'rule.error.missingB': 'a rule needs a B section for births, as in B3/S23',
  'rule.error.missingS': 'a rule needs an S section for survivals, as in B3/S23',
  'rule.error.badCharacter': 'a rule holds digits 0-8 and one slash, as in B3/S23',
  'rule.error.outOfRange': '9 is not a neighbour count: a cell has at most 8',
  'rule.error.duplicateDigit': 'the same digit is listed twice in one section',
  'rule.error.badFormat': 'that is not a rule; write it as B…/S…, as in B3/S23',
  'rule.preset.conway': 'Conway (B3/S23)',
  'rule.preset.highlife': 'HighLife (B36/S23)',
  'rule.preset.maze': 'Maze (B3/S12345)',
  'rule.preset.seeds': 'Seeds (B2/S)',
  'rule.preset.eight': 'eight neighbours (B/S012345678)',
  'rule.preset.dayAndNight': 'Day & Night (B3678/S34678)',
  'rule.preset.replicator': 'Replicator (B1357/S1357)',
  'rule.preset.lifeWithoutDeath': 'Life without Death (B3/S012345678)',

  'hint.click': 'click a cell to toggle it',
  'hint.drag': 'drag to pan',
  'hint.wheel': 'wheel to zoom',
  'hint.space': 'runs and pauses',
  'hint.step': 'steps once',
  'hint.stream': 'changes arrive over one event stream',
  'hint.pinch': 'pinch to zoom on a touch screen',
  'hint.panel': 'toggles the panel',
  'hint.wide': 'toggles full width',
  'hint.history': 'click a node to preview it · drag the tree to pan · hover for its numbers',
  'key.space': 'Space',
  'key.dot': '.',
  'key.h': 'H',
  'key.w': 'W',

  'timeline.title': 'history',
  'timeline.empty': 'this core is not recording a history',
  'timeline.noGenerations': 'no generation has been recorded yet',
  'timeline.generation': 'generation',
  'timeline.storage': 'stored as',
  'timeline.population': 'population',
  'timeline.changed': 'changed',
  'timeline.born': 'born',
  'timeline.died': 'died',
  'timeline.keyframe': 'keyframe',
  'timeline.delta': 'delta',
  'timeline.at': 'at {time}',
  'timeline.current': 'current',
  'timeline.head': 'working point',
  'timeline.selected': 'selected',
  'timeline.fork': 'fork',
  'timeline.branch': 'branch',
  'timeline.branchLabel': (params) => `branch ${params.branch}`,
  'timeline.selectTitle': 'preview generation {generation} and work on from it',
  'timeline.selectFailed': 'the selection failed: {message}',
  /* The selected generation's own rule, when the world is running another one.
     Both strings are the rules themselves, because that is the whole statement:
     which rule produced the generation and which one is in force. */
  'timeline.ruleGap': 'generation {generation} ran {rule}; the current rule is {current}',
  'timeline.rollbackFailed': 'the rollback failed: {message}',
  'timeline.exported': 'wrote {count} generation(s) to {path}',
  'timeline.exportFailed': 'the archive failed: {message}',
  'timeline.archivePath': 'data/archive.jsonl',

  'preview.title': 'preview',
  'preview.empty': 'click a generation to preview it here',
  'preview.note.cell':
    'generation {generation} · the live cell nearest {x}, {y} is in the middle',
  'preview.note.bounds':
    'generation {generation} · {population} live cells is above the {cap}-cell limit, so the middle of their bounds is in the middle instead',
  'preview.note.world':
    'generation {generation} · nothing is alive in it, so the middle of the world is in the middle',
  'preview.failed': 'cannot draw this generation: {message}',

  'error.title': '{label}: {message}',
  'error.labelOnly': '{label}',
  'error.streamOpen': 'cannot open the event stream ({message}); polling instead',
  'error.streamLost': 'the event stream dropped; polling instead',
  'error.draw': 'cannot draw this frame: {message}',
  'error.switchFailed': 'cannot switch representation: {message}',
  'error.patternFailed': 'cannot place the pattern: {message}',
  'error.sessionFailed': 'cannot create a session: {message}',
  'error.session_queue_full': 'the session queue is full',
  'error.edit_active': 'the session is in the editing mode; commit or leave it first',
  'error.stale_base': 'the document moved since this edit was built; it was refreshed',
  'error.stale_generation': 'the world moved since this edit was built; it was refreshed',
  'error.duplicate_tx': 'this transaction was already committed',
  'error.not_editing': 'the session is not in the editing mode',
  'error.unknown_transaction': 'there is no transaction to undo or redo',
  'error.too_large': 'that edit is larger than the mode allows',
  'error.serviceUnreachable': 'the service is unreachable: {message}',
  'error.coreUnavailable': 'the world core is unavailable: {message}',
  'error.missingContainers':
    'this page is missing the containers it needs, so it cannot work: {names}',

  'error.bad_request': 'the request was rejected',
  'error.unknown_command': 'the core does not know that command',
  'error.bad_arguments': 'the arguments were not accepted',
  'error.bad_rule': 'the core refused that rule',
  'error.out_of_bounds': 'that is outside the world',
  'error.internal': 'the core failed internally',
  'error.unknown_client': 'that event stream is not open',
  'error.switch_in_progress': 'a representation switch is already running',
  'error.core_unavailable': 'the world core is not running',
  'error.core_timeout': 'the world core did not answer in time',
  'error.not_found': 'no such route or file',
  'error.forbidden': 'that path is not served',
  'error.export_failed': 'the world could not be read out of the core',
  'error.import_failed': 'the core refused the imported world',
  'error.bad_reply': 'the service sent something unreadable',
  'error.no_history': 'this core is not recording a history',
  'error.archive_exists': 'an archive with that name already exists',
  'error.archive_import_unsupported': 'this core cannot import an archive',
};

const zh = {
  'brand.title': '生命游戏 查看器',

  'nav.world': '世界',
  'nav.history': '历史',
  'nav.archives': '存档',

  'status.connecting': '正在连接…',
  'status.ok': '内核正常 · {rule} · {representation}',
  'status.okRuleOnly': '内核正常 · {rule}',
  'status.serviceUnreachable': '服务不可达',
  'status.coreUnavailable': '世界内核不可用',
  'status.switching': '正在切换到 {representation}…',
  'status.limitsMissing': '内核未声明任何上限，速率控件不可用',

  'action.run': '运行',
  'action.pause': '暂停',
  'action.step': '单步',
  'action.clear': '清空',
  'action.theme': '主题：{theme}',
  'action.themeTitle': '切换到{theme}配色',
  'action.rollback': '回退',
  'action.rollbackTitle': '恢复到第 {generation} 代',
  'action.stepBack': '◀ 后退一代',
  'action.stepForward': '前进一代 ▶',
  'action.export': '导出存档',
  'action.earlier': (params) => `显示更早的 ${params.count} 代`,
  'action.collapse': '▸ 收起面板',
  'action.expand': '◂ 展开面板',
  'action.wide': '⤢ 占满全宽',
  'action.narrow': '⤡ 收回侧栏',
  'action.import': '载入',
  'action.rename': '重命名',
  'action.delete': '删除',
  'action.deleteConfirm': '确认删除',
  'action.refresh': '刷新',

  'panel.history': '历史',
  'panel.archives': '存档',
  'panel.readout': '读数',
  'panel.collapseTitle': '收起面板，把空间让给画布',
  'panel.expandTitle': '重新显示面板',
  'panel.wideTitle': '让面板占满整个宽度',
  'panel.narrowTitle': '把面板收回画布旁的侧栏',
  'panel.handleTitle': '显示面板',

  'archive.empty': '还没有写出任何存档',
  'archive.name': '名称',
  'archive.size': '大小',
  'archive.modified': '修改时间',
  'archive.generations': '世代数',
  'archive.nameLabel': '文件名',
  'archive.placeholder': 'history.jsonl',
  'archive.exported': '已写出 {count} 代到 {name}',
  'archive.imported': '已载入 {name}',
  'archive.renamed': '已把 {from} 重命名为 {to}',
  'archive.deleted': '已删除 {name}',
  'archive.failed': '存档操作失败：{message}',
  'archive.importUnsupported': '该内核尚不能导入存档：协议里还没有把它导入为新会话的命令',
  'archive.unknownGenerations': '未知',

  'unit.bytes': '{value} 字节',
  'unit.kilobytes': '{value} 千字节',
  'unit.megabytes': '{value} 兆字节',

  'label.tps': '速率',
  'label.grid': '网格',
  'label.storage': '存储',
  'label.pattern': '图案',
  'label.session': '会话',
  'label.queued': '{count} 个排队',
  'label.language': '语言',
  'label.rulePreset': '规则',
  'label.ruleCustom': '自定义',
  'label.rulePresetTitle': '按名字被点到的那些规则；选中即发送',
  'label.ruleCustomTitle': '要发送的规则，形如 B…/S…，数字为 0-8',
  'label.generation': '世代',
  'label.population': '存活',
  'label.origin': '原点',
  'label.span': '跨度',
  'label.rule': '规则',
  'label.world': '世界',
  'label.cell': '细胞',
  'label.gridWidth': '{width} 像素',
  'label.gridWidthTitle': '网格线宽（像素）',
  'label.storageTitle': '内核用哪种方式存储世界',
  'label.languageTitle': '本页面的语言',

  'unit.px': '{value} 像素',
  'unit.cellsPerPx': '每像素 {value} 格',
  'unit.spanLimited': '{span}（受取帧预算限制）',
  'value.none': '—',

  'locale.en': 'English',
  'locale.zh': '中文',

  'theme.dark': '深色',
  'theme.light': '浅色',
  'representation.sparse': '稀疏',
  'representation.tiled': '瓦片',

  'action.setRule': '设置',
  'action.place': '放置',
  'action.newSession': '新会话',
  'action.undo': '撤销',
  'action.redo': '重做',
  'action.editMode': '编辑',
  'action.editModeDone': '完成编辑',
  'action.saveSnippet': '保存选区',
  'action.publish': '发布',
  'label.tool': '工具',
  'label.snippetName': '片段名称',
  'label.transform': '变换',
  'label.mode': '模式',
  'label.snippet': '片段',
  'tool.paint': '画笔',
  'tool.erase': '橡皮',
  'tool.line': '直线',
  'tool.rect': '矩形',
  'tool.select': '选择',
  'tool.stamp': '放置',
  'tool.pan': '平移',
  'transform.none': '不变',
  'transform.rotate90': '旋转 90',
  'transform.rotate180': '旋转 180',
  'transform.rotate270': '旋转 270',
  'transform.flipH': '水平翻转',
  'transform.flipV': '垂直翻转',
  'mode.overwrite': '覆盖',
  'mode.merge': '合并',
  'status.snippetSaved': '选区已保存为草稿',
  'status.snippetPublished': '片段已发布',
  'status.editResynced': '文档已变化，编辑状态已刷新',
  'status.editActive': '编辑中——世界已暂停',
  'status.editPresence': '正在与 {authors} 协同编辑',
  'status.editRemote': '{author} 提交了一次编辑',
  'error.editFailed': '编辑被拒绝：{message}',
  'hint.undo': '撤销',
  'key.undo': 'Ctrl+Z',
  'label.undoTitle': '撤销上一次单元格编辑（Ctrl+Z）',
  'label.runTitle': '运行世界（空格）',
  'label.pauseTitle': '暂停世界（空格）',
  'label.stepTitle': '前进一代（.）',
  'label.clearTitle': '清除所有细胞并重置代数',
  'label.placeTitle': '在视图中央放置所选图案',
  'label.newSessionTitle': '按当前世界大小新建会话',
  'label.editModeTitle': '以原子事务编辑世界（会暂停运行）',
  'error.unknown_session': '没有该会话；它可能已被关闭，或服务已重启',
  'error.unknown_pattern': '图案库中没有该图案',
  'error.bad_placement': '该图案无法放在该位置',
  'error.default_session': '默认会话不能被关闭',
  'error.service_closing': '服务正在关闭',
  'action.adoptRule': '采用 {rule}',
  'action.adoptRuleTitle': '把当前规则设为 {rule}',
  'rule.custom': '自定义 · {rule}',
  'rule.error.missingB': '规则需要 B 段来表示出生，例如 B3/S23',
  'rule.error.missingS': '规则需要 S 段来表示存活，例如 B3/S23',
  'rule.error.badCharacter': '规则只含 0-8 的数字和一个斜杠，例如 B3/S23',
  'rule.error.outOfRange': '9 不是邻居数：一个格子最多有 8 个邻居',
  'rule.error.duplicateDigit': '同一段里有一个数字重复出现',
  'rule.error.badFormat': '这不是一条规则；请写成 B…/S…，例如 B3/S23',
  'rule.preset.conway': 'Conway（B3/S23）',
  'rule.preset.highlife': 'HighLife（B36/S23）',
  'rule.preset.maze': 'Maze（B3/S12345）',
  'rule.preset.seeds': 'Seeds（B2/S）',
  'rule.preset.eight': '八邻居（B/S012345678）',
  'rule.preset.dayAndNight': 'Day & Night（B3678/S34678）',
  'rule.preset.replicator': 'Replicator（B1357/S1357）',
  'rule.preset.lifeWithoutDeath': 'Life without Death（B3/S012345678）',

  'hint.click': '点击格子可切换生死',
  'hint.drag': '拖拽可平移',
  'hint.wheel': '滚轮可缩放',
  'hint.space': '运行与暂停',
  'hint.step': '单步前进',
  'hint.stream': '变化通过一条事件流推送',
  'hint.pinch': '触屏可双指捏合缩放',
  'hint.panel': '收起或展开面板',
  'hint.wide': '切换全屏宽度',
  'hint.history': '点击节点即可预览 · 拖动树可平移 · 悬停查看数值',
  'key.space': '空格',
  'key.dot': '.',
  'key.h': 'H',
  'key.w': 'W',

  'timeline.title': '历史',
  'timeline.empty': '该内核未在记录历史',
  'timeline.noGenerations': '尚未记录任何世代',
  'timeline.generation': '世代',
  'timeline.storage': '存储方式',
  'timeline.population': '存活',
  'timeline.changed': '变化',
  'timeline.born': '出生',
  'timeline.died': '死亡',
  'timeline.keyframe': '关键帧',
  'timeline.delta': '差分',
  'timeline.at': '{time}',
  'timeline.current': '当前',
  'timeline.head': '工作点',
  'timeline.selected': '已选中',
  'timeline.fork': '分叉',
  'timeline.branch': '分支',
  'timeline.branchLabel': (params) => `分支 ${params.branch}`,
  'timeline.selectTitle': '预览第 {generation} 代，并从此继续',
  'timeline.selectFailed': '选择失败：{message}',
  'timeline.ruleGap': '第 {generation} 代跑的是 {rule}，当前规则是 {current}',
  'timeline.rollbackFailed': '回退失败：{message}',
  'timeline.exported': '已写出 {count} 代到 {path}',
  'timeline.exportFailed': '导出存档失败：{message}',
  'timeline.archivePath': 'data/archive.jsonl',

  'preview.title': '预览',
  'preview.empty': '点击某个世代即可在此预览',
  'preview.note.cell': '第 {generation} 代 · 视口中心是距 {x}, {y} 最近的存活细胞',
  'preview.note.bounds':
    '第 {generation} 代 · 存活细胞数 {population} 超过上限 {cap}，已退化为以包围盒中心居中',
  'preview.note.world': '第 {generation} 代 · 其中没有存活细胞，已退回以世界中心居中',
  'preview.failed': '无法绘制该世代：{message}',

  'error.title': '{label}：{message}',
  'error.labelOnly': '{label}',
  'error.streamOpen': '无法打开事件流（{message}），改用轮询',
  'error.streamLost': '事件流已断开，改用轮询',
  'error.draw': '无法绘制该帧：{message}',
  'error.switchFailed': '无法切换表示：{message}',
  'error.patternFailed': '无法放置图案：{message}',
  'error.sessionFailed': '无法创建会话：{message}',
  'error.session_queue_full': '会话队列已满',
  'error.edit_active': '会话处于编辑模式；请先提交或退出',
  'error.stale_base': '文档已变化，本次编辑已刷新',
  'error.stale_generation': '世界已变化，本次编辑已刷新',
  'error.duplicate_tx': '该事务已提交',
  'error.not_editing': '会话不在编辑模式',
  'error.unknown_transaction': '没有可撤销或重做的事务',
  'error.too_large': '该编辑超出了编辑模式允许的大小',
  'error.serviceUnreachable': '服务不可达：{message}',
  'error.coreUnavailable': '世界内核不可用：{message}',
  'error.missingContainers': '本页缺少必需的容器，无法工作：{names}',

  'error.bad_request': '请求被拒绝',
  'error.unknown_command': '内核不认识该命令',
  'error.bad_arguments': '参数未被接受',
  'error.bad_rule': '内核拒绝了这个规则',
  'error.out_of_bounds': '该位置在世界之外',
  'error.internal': '内核内部出错',
  'error.unknown_client': '该事件流未打开',
  'error.switch_in_progress': '已有一次表示切换在进行',
  'error.core_unavailable': '世界内核未在运行',
  'error.core_timeout': '世界内核未及时应答',
  'error.not_found': '没有该路由或文件',
  'error.forbidden': '不提供该路径',
  'error.export_failed': '无法从内核读出世界',
  'error.import_failed': '内核拒绝了这个导入的世界',
  'error.bad_reply': '服务返回了无法解析的内容',
  'error.no_history': '该内核未在记录历史',
  'error.archive_exists': '已存在同名存档',
  'error.archive_import_unsupported': '该内核无法导入存档',
};

/** The tables, keyed by language. Exported so a test can compare key sets. */
export const MESSAGES = Object.freeze({ en: Object.freeze(en), zh: Object.freeze(zh) });

/**
 * The language to use, given what was stored and what the browser asks for.
 *
 * A stored value that names an offered language is an explicit choice and wins.
 * Anything else means "follow the browser", whose `navigator.language` may be a
 * regional tag — `zh-Hans-CN`, `en-GB` — so only the primary subtag is matched.
 *
 * @param {unknown} stored the value read from storage
 * @param {unknown} navigatorLanguage `navigator.language`, or anything else
 * @returns {'en' | 'zh'}
 */
export function resolveLocale(stored, navigatorLanguage) {
  if (typeof stored === 'string' && LOCALES.includes(stored)) return stored;
  if (typeof navigatorLanguage === 'string') {
    const primary = navigatorLanguage.trim().toLowerCase().split(/[-_]/)[0];
    if (LOCALES.includes(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * The text for a key, with `{name}` placeholders filled from `params`.
 *
 * A missing key returns the key itself rather than an empty string: a blank
 * button hides the defect, while a visible `action.run` names it. A missing
 * parameter leaves its placeholder visible for the same reason.
 */
export function translate(locale, key, params = {}) {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const entry = table[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(params);
  return entry.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/**
 * A lead error code and the core's own message, rendered for a person.
 *
 * The label is translated; the message is not, because it is a diagnostic the
 * core wrote and translating it would create a second description of the same
 * fact. An unknown code is shown as itself, label-free.
 */
export function describeError(locale, code, message) {
  const label = KNOWN_ERROR_CODES.includes(code) ? translate(locale, `error.${code}`) : null;
  if (label === null) {
    return message === undefined || message === null || message === ''
      ? String(code)
      : translate(locale, 'error.title', { label: code, message });
  }
  if (message === undefined || message === null || message === '') {
    return translate(locale, 'error.labelOnly', { label });
  }
  return translate(locale, 'error.title', { label, message });
}
