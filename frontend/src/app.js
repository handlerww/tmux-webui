import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { parseAnsiLines } from './ansi.js';
import { nextThemeSetting, readThemeSetting, resolveTheme, storeThemeSetting } from './theme.js';
import './style.css';

const elements = {
  welcome: document.querySelector('#welcome'),
  terminalView: document.querySelector('#terminal-view'),
  terminal: document.querySelector('#terminal'),
  terminalShell: document.querySelector('#terminal-shell'),
  terminalHint: document.querySelector('#terminal-hint'),
  readerView: document.querySelector('#reader-view'),
  readerContent: document.querySelector('#reader-content'),
  readerStatus: document.querySelector('#reader-status'),
  readerComposer: document.querySelector('#reader-composer'),
  readerInput: document.querySelector('#reader-input'),
  readerMode: document.querySelector('#reader-mode-button'),
  terminalMode: document.querySelector('#terminal-mode-button'),
  readerFollow: document.querySelector('#reader-follow-button'),
  readerKeys: document.querySelectorAll('[data-key]'),
  readerActions: document.querySelectorAll('.reader-action'),
  terminalActions: document.querySelectorAll('.terminal-action'),
  sessionList: document.querySelector('#session-list'),
  sessionSearch: document.querySelector('#session-search-input'),
  sessionSearchClear: document.querySelector('#session-search-clear'),
  themeButton: document.querySelector('#theme-button'),
  refresh: document.querySelector('#refresh-button'),
  activeName: document.querySelector('#active-name'),
  sessionNameDisplay: document.querySelector('#session-name-display'),
  renameButton: document.querySelector('#rename-button'),
  renameForm: document.querySelector('#rename-form'),
  renameInput: document.querySelector('#rename-input'),
  renameSave: document.querySelector('#rename-save'),
  renameCancel: document.querySelector('#rename-cancel'),
  activePath: document.querySelector('#active-path'),
  connectionDot: document.querySelector('#connection-dot'),
  connectionText: document.querySelector('#connection-text'),
  copy: document.querySelector('#copy-button'),
  paste: document.querySelector('#paste-button'),
  reconnect: document.querySelector('#reconnect-button'),
  toast: document.querySelector('#toast'),
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const fitAddon = new FitAddon();
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const terminalThemes = {
  light: {
    background: '#fbfaf7',
    foreground: '#252824',
    cursor: '#de6b48',
    cursorAccent: '#fbfaf7',
    selectionBackground: '#b8d9d2aa',
    selectionInactiveBackground: '#d8e6e2aa',
    black: '#242824',
    red: '#bd4b3f',
    green: '#5d7e5a',
    yellow: '#9b7525',
    blue: '#496f91',
    magenta: '#8a5d86',
    cyan: '#3d7d7a',
    white: '#e8e6df',
    brightBlack: '#6f746e',
    brightRed: '#d76755',
    brightGreen: '#759a6e',
    brightYellow: '#bd9140',
    brightBlue: '#648aad',
    brightMagenta: '#a675a1',
    brightCyan: '#58a09b',
    brightWhite: '#ffffff',
  },
  dark: {
    background: '#181d1b',
    foreground: '#dfe5e0',
    cursor: '#e78361',
    cursorAccent: '#181d1b',
    selectionBackground: '#47756c99',
    selectionInactiveBackground: '#354e4899',
    black: '#202624',
    red: '#e07a6e',
    green: '#91b88a',
    yellow: '#d3aa58',
    blue: '#82a9cb',
    magenta: '#bd8bb7',
    cyan: '#72b5b0',
    white: '#d9ddd9',
    brightBlack: '#7e8983',
    brightRed: '#f08d7d',
    brightGreen: '#a6cb9e',
    brightYellow: '#e4bd6c',
    brightBlue: '#99bddc',
    brightMagenta: '#cfa1ca',
    brightCyan: '#8bc9c4',
    brightWhite: '#f5f7f4',
  },
};
let themeSetting = readThemeSetting();
let resolvedTheme = resolveTheme(themeSetting, systemThemeQuery.matches);
const terminal = new Terminal({
  allowTransparency: false,
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorInactiveStyle: 'outline',
  fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.32,
  letterSpacing: 0,
  scrollback: 20000,
  scrollOnUserInput: true,
  smoothScrollDuration: 120,
  rightClickSelectsWord: true,
  theme: terminalThemes[resolvedTheme],
});

terminal.loadAddon(fitAddon);
terminal.open(elements.terminal);

let sessions = [];
let selectedSession = null;
let socket = null;
let toastTimer = null;
let resizeTimer = null;
let readerResizeTimer = null;
let refreshInFlight = false;
let viewMode = 'reader';
let readerLines = [];
let captureInFlight = false;
let captureController = null;
let captureTimer = null;
let readerJumpPending = false;
let renameInFlight = false;
let readerAutoFollow = readReaderAutoFollow();
elements.readerFollow.setAttribute('aria-pressed', String(readerAutoFollow));
applyTheme(themeSetting, false);

terminal.onData((data) => {
  sendInput(data);
});

terminal.onSelectionChange(() => {
  elements.copy.disabled = !terminal.hasSelection();
});

terminal.attachCustomKeyEventHandler((event) => {
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
    if (event.type === 'keydown') copySelection();
    return false;
  }
  return true;
});

elements.refresh.addEventListener('click', () => loadSessions(true));
elements.themeButton.addEventListener('click', () => applyTheme(nextThemeSetting(themeSetting)));
systemThemeQuery.addEventListener('change', () => {
  if (themeSetting === 'system') applyTheme('system', false);
});
elements.sessionSearch.addEventListener('input', () => {
  elements.sessionSearchClear.hidden = elements.sessionSearch.value.length === 0;
  renderSessions();
});
elements.sessionSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.sessionSearch.value) {
    clearSessionSearch();
  }
});
elements.sessionSearchClear.addEventListener('click', clearSessionSearch);
elements.copy.addEventListener('click', copySelection);
elements.paste.addEventListener('click', pasteClipboard);
elements.reconnect.addEventListener('click', () => connect(selectedSession));
elements.renameButton.addEventListener('click', startRename);
elements.renameCancel.addEventListener('click', () => cancelRename(true));
elements.renameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  renameSelectedSession();
});
elements.renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !renameInFlight) {
    event.preventDefault();
    cancelRename(true);
  }
});
elements.readerMode.addEventListener('click', () => setViewMode('reader'));
elements.terminalMode.addEventListener('click', () => setViewMode('terminal'));
elements.readerFollow.addEventListener('click', toggleReaderAutoFollow);
elements.readerComposer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitReaderInput();
});
elements.readerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitReaderInput();
  }
});
elements.readerInput.addEventListener('input', resizeReaderInput);
for (const button of elements.readerKeys) {
  button.addEventListener('click', () => sendReaderKey(button.dataset.key));
}

new ResizeObserver(() => scheduleFit()).observe(elements.terminalShell);
new ResizeObserver(() => scheduleReaderSize()).observe(elements.readerView);
window.addEventListener('resize', () => {
  scheduleFit();
  scheduleReaderSize();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadSessions(false);
    refreshReader(false);
  }
});
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    elements.sessionSearch.focus();
  }
});

function applyTheme(setting, persist = true) {
  themeSetting = persist ? storeThemeSetting(setting) : setting;
  resolvedTheme = resolveTheme(themeSetting, systemThemeQuery.matches);
  document.documentElement.dataset.theme = themeSetting;
  document.documentElement.dataset.colorScheme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]').content = resolvedTheme === 'dark' ? '#151a18' : '#f3f1eb';
  terminal.options.theme = terminalThemes[resolvedTheme];
  updateThemeControls();
}

function updateThemeControls() {
  elements.themeButton.dataset.themeSetting = themeSetting;
  const label = `${themeSetting[0].toUpperCase()}${themeSetting.slice(1)}`;
  const resolvedLabel = `${resolvedTheme[0].toUpperCase()}${resolvedTheme.slice(1)}`;
  const next = nextThemeSetting(themeSetting);
  const nextLabel = `${next[0].toUpperCase()}${next.slice(1)}`;
  const description = `Theme: ${label}${themeSetting === 'system' ? ` (${resolvedLabel})` : ''}. Switch to ${nextLabel}`;
  elements.themeButton.title = description;
  elements.themeButton.setAttribute('aria-label', description);
}

async function loadSessions(showFeedback = false) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  elements.refresh.classList.add('spinning');
  try {
    const response = await fetch('/api/sessions', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    sessions = body.sessions ?? [];
    if (selectedSession) {
      const refreshed = sessions.find((item) => item.id === selectedSession.id);
      if (refreshed) {
        selectedSession = refreshed;
        updateActiveIdentity();
      } else if (!renameInFlight) {
        setConnection('ended', 'Ended');
        socket?.close();
      }
    }
    renderSessions();
    if (showFeedback) showToast('Updated');
  } catch (error) {
    renderSessionError();
    if (showFeedback) showToast('Could not refresh');
  } finally {
    refreshInFlight = false;
    elements.refresh.classList.remove('spinning');
  }
}

function renderSessions() {
  elements.sessionList.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-sessions';
    empty.innerHTML = '<span class="empty-icon">◇</span><strong>No sessions</strong><small>Run tmux new -s work</small>';
    elements.sessionList.append(empty);
    return;
  }

  const query = elements.sessionSearch.value.trim().toLocaleLowerCase();
  const visibleSessions = (query
    ? sessions.filter((session) => session.name.toLocaleLowerCase().includes(query) || (session.path || '').toLocaleLowerCase().includes(query))
    : sessions
  ).slice().sort((left, right) => (
    sessionNameCollator.compare(left.name, right.name)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ));

  if (visibleSessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-sessions search-empty';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.textContent = '⌕';
    const title = document.createElement('strong');
    title.textContent = 'No matches';
    const hint = document.createElement('small');
    hint.textContent = 'Search by name or path';
    empty.append(icon, title, hint);
    elements.sessionList.append(empty);
    return;
  }

  for (const session of visibleSessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-card';
    button.disabled = renameInFlight;
    button.classList.toggle('active', selectedSession?.id === session.id);
    button.addEventListener('click', () => selectSession(session));

    const top = document.createElement('span');
    top.className = 'session-card-top';
    const name = document.createElement('strong');
    name.textContent = session.name;
    const activity = document.createElement('span');
    activity.className = 'activity-time';
    activity.textContent = relativeTime(session.lastActivity);
    top.append(name, activity);

    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    meta.append(dot, `${session.windows} ${plural(session.windows, 'window')}`);
    if (session.attached > 0) meta.append(` · ${session.attached} ${plural(session.attached, 'client')}`);
    const sessionPath = document.createElement('span');
    sessionPath.className = 'session-path';
    sessionPath.textContent = session.path || 'Path unavailable';
    sessionPath.title = session.path || '';
    button.append(top, sessionPath, meta);
    elements.sessionList.append(button);
  }
}

function clearSessionSearch() {
  elements.sessionSearch.value = '';
  elements.sessionSearchClear.hidden = true;
  renderSessions();
  elements.sessionSearch.focus();
}

function renderSessionError() {
  elements.sessionList.replaceChildren();
  const error = document.createElement('button');
  error.type = 'button';
  error.className = 'session-error';
  error.textContent = 'Could not load. Retry';
  error.addEventListener('click', () => loadSessions(false));
  elements.sessionList.append(error);
}

function selectSession(session) {
  const changed = selectedSession?.id !== session.id;
  cancelRename(false);
  selectedSession = session;
  if (changed) resetSessionOutput();
  updateActiveIdentity();
  elements.welcome.hidden = true;
  elements.terminalView.hidden = false;
  renderSessions();
  requestAnimationFrame(() => {
    if (viewMode === 'terminal') {
      fitAddon.fit();
    } else {
      fitReaderTerminal();
    }
    connect(session);
    refreshReader(true);
    focusActiveView();
  });
}

function resetSessionOutput() {
  clearTimeout(captureTimer);
  captureController?.abort();
  captureController = null;
  captureInFlight = false;
  readerJumpPending = true;
  terminal.reset();
  terminal.clear();
  readerLines = [];
  elements.readerContent.replaceChildren();
  elements.readerStatus.hidden = false;
  elements.readerStatus.classList.add('loading');
  elements.readerStatus.textContent = 'Loading output';
}

function updateActiveIdentity() {
  if (!selectedSession) return;
  elements.activeName.textContent = selectedSession.name;
  elements.activeName.title = selectedSession.name;
  elements.activePath.textContent = selectedSession.path || 'Path unavailable';
  elements.activePath.title = selectedSession.path || '';
}

function startRename() {
  if (!selectedSession || renameInFlight) return;
  elements.renameInput.value = selectedSession.name;
  elements.sessionNameDisplay.hidden = true;
  elements.renameForm.hidden = false;
  elements.terminalView.classList.add('renaming');
  requestAnimationFrame(() => {
    elements.renameInput.focus();
    elements.renameInput.select();
  });
}

function cancelRename(restoreFocus) {
  if (renameInFlight) return;
  elements.renameForm.hidden = true;
  elements.sessionNameDisplay.hidden = false;
  elements.terminalView.classList.remove('renaming');
  if (restoreFocus) elements.renameButton.focus();
}

async function renameSelectedSession() {
  if (!selectedSession || renameInFlight) return;
  const sessionID = selectedSession.id;
  const previousName = selectedSession.name;
  const name = elements.renameInput.value.trim();
  if (!name) {
    showToast('Enter a session name');
    elements.renameInput.focus();
    return;
  }
  if (name === previousName) {
    cancelRename(true);
    return;
  }

  renameInFlight = true;
  elements.renameInput.disabled = true;
  elements.renameSave.disabled = true;
  elements.renameCancel.disabled = true;
  renderSessions();
  try {
    const response = await fetch('/api/sessions/rename', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionID, name }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not rename session');

    sessions = sessions.map((session) => (session.id === sessionID ? { ...session, name: body.name || name } : session));
    if (selectedSession?.id === sessionID) {
      selectedSession = { ...selectedSession, name: body.name || name };
      updateActiveIdentity();
    }
    elements.renameForm.hidden = true;
    elements.sessionNameDisplay.hidden = false;
    elements.terminalView.classList.remove('renaming');
    renderSessions();
    showToast(`Renamed to ${body.name || name}`);
    loadSessions(false);
  } catch (error) {
    showToast(error.message || 'Could not rename session');
    elements.renameInput.focus();
    elements.renameInput.select();
  } finally {
    renameInFlight = false;
    elements.renameInput.disabled = false;
    elements.renameSave.disabled = false;
    elements.renameCancel.disabled = false;
    renderSessions();
  }
}

function connect(session) {
  if (!session) return;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  setConnection('connecting', 'Connecting');
  if (viewMode === 'terminal') {
    fitAddon.fit();
  } else {
    fitReaderTerminal();
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({
    session: session.name,
    cols: String(terminal.cols),
    rows: String(terminal.rows),
  });
  const currentSocket = new WebSocket(`${protocol}//${location.host}/ws?${query}`);
  currentSocket.binaryType = 'arraybuffer';
  socket = currentSocket;

  currentSocket.addEventListener('open', () => {
    if (socket !== currentSocket) return;
    setConnection('connected', 'Live');
    sendResize();
    focusActiveView();
  });
  currentSocket.addEventListener('message', (event) => {
    if (socket !== currentSocket) return;
    if (event.data instanceof ArrayBuffer) {
      terminal.write(decoder.decode(new Uint8Array(event.data), { stream: true }));
    }
  });
  currentSocket.addEventListener('close', () => {
    if (socket !== currentSocket) return;
    socket = null;
    setConnection('disconnected', 'Disconnected');
  });
  currentSocket.addEventListener('error', () => {
    if (socket === currentSocket) setConnection('disconnected', 'Connection failed');
  });
}

function setViewMode(mode) {
  if (mode !== 'reader' && mode !== 'terminal') return;
  viewMode = mode;
  const reader = mode === 'reader';
  elements.readerView.hidden = !reader;
  elements.readerComposer.hidden = !reader;
  elements.terminalShell.hidden = reader;
  elements.terminalHint.hidden = reader;
  elements.readerMode.setAttribute('aria-pressed', String(reader));
  elements.terminalMode.setAttribute('aria-pressed', String(!reader));
  for (const action of elements.readerActions) action.hidden = !reader;
  for (const action of elements.terminalActions) action.hidden = reader;

  if (reader) {
    fitReaderTerminal();
    sendResize();
    refreshReader(true);
  } else {
    clearTimeout(captureTimer);
    requestAnimationFrame(() => {
      fitAddon.fit();
      sendResize();
      terminal.focus();
    });
  }
}

function focusActiveView() {
  if (viewMode === 'reader') {
    elements.readerInput.focus();
  } else {
    terminal.focus();
  }
}

async function refreshReader(jumpToBottom = false) {
  if (jumpToBottom) readerJumpPending = true;
  if (viewMode !== 'reader' || !selectedSession || document.hidden || captureInFlight) return;
  captureInFlight = true;
  const sessionName = selectedSession.name;
  const controller = new AbortController();
  captureController = controller;
  clearTimeout(captureTimer);
  try {
    const query = new URLSearchParams({ session: sessionName });
    const response = await fetch(`/api/capture?${query}`, {
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    if (selectedSession?.name === sessionName) {
      const shouldJumpToBottom = readerJumpPending;
      readerJumpPending = false;
      renderReader(content, shouldJumpToBottom);
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (selectedSession?.name === sessionName && readerLines.length === 0) {
      elements.readerStatus.hidden = false;
      elements.readerStatus.classList.remove('loading');
      elements.readerStatus.textContent = 'Output unavailable';
    }
  } finally {
    if (captureController !== controller) return;
    captureController = null;
    captureInFlight = false;
    if (viewMode === 'reader' && selectedSession) {
      captureTimer = setTimeout(() => refreshReader(false), selectedSession.name === sessionName ? 850 : 0);
    }
  }
}

function renderReader(content, jumpToBottom) {
  const nextLines = parseAnsiLines(content);

  let prefix = 0;
  while (prefix < readerLines.length && prefix < nextLines.length && readerLines[prefix] === nextLines[prefix].key) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < readerLines.length - prefix
    && suffix < nextLines.length - prefix
    && readerLines[readerLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix].key
  ) {
    suffix += 1;
  }

  const removeCount = readerLines.length - prefix - suffix;
  for (let index = 0; index < removeCount; index += 1) {
    elements.readerContent.children[prefix]?.remove();
  }

  const fragment = document.createDocumentFragment();
  for (const line of nextLines.slice(prefix, nextLines.length - suffix)) {
    const row = document.createElement('div');
    row.className = 'reader-line';
    renderAnsiLine(row, line.segments);
    fragment.append(row);
  }
  elements.readerContent.insertBefore(fragment, elements.readerContent.children[prefix] ?? null);
  readerLines = nextLines.map((line) => line.key);
  elements.readerStatus.hidden = nextLines.length > 0;
  elements.readerStatus.classList.remove('loading');
  if (nextLines.length === 0) elements.readerStatus.textContent = 'Waiting for output';

  if (jumpToBottom || readerAutoFollow) scrollReaderToBottom();
}

function renderAnsiLine(row, segments) {
  if (segments.length === 0) {
    row.textContent = '\u00a0';
    return;
  }
  for (const segment of segments) {
    if (Object.keys(segment.style).length === 0) {
      row.append(document.createTextNode(segment.text));
      continue;
    }
    const span = document.createElement('span');
    span.textContent = segment.text;
    Object.assign(span.style, segment.style);
    row.append(span);
  }
}

function scrollReaderToBottom() {
  requestAnimationFrame(() => {
    elements.readerView.scrollTo({ top: elements.readerView.scrollHeight, behavior: 'instant' });
  });
}

function readReaderAutoFollow() {
  try {
    return localStorage.getItem('tmux-webui.readerAutoFollow') === 'true';
  } catch {
    return false;
  }
}

function toggleReaderAutoFollow() {
  readerAutoFollow = !readerAutoFollow;
  elements.readerFollow.setAttribute('aria-pressed', String(readerAutoFollow));
  try {
    localStorage.setItem('tmux-webui.readerAutoFollow', String(readerAutoFollow));
  } catch {
    // The setting still applies for this page when browser storage is unavailable.
  }
  if (readerAutoFollow) scrollReaderToBottom();
}

function submitReaderInput() {
  if (socket?.readyState !== WebSocket.OPEN) {
    showToast('Not connected');
    return;
  }
  terminal.paste(elements.readerInput.value);
  sendInput('\r');
  elements.readerInput.value = '';
  resizeReaderInput();
  elements.readerInput.focus();
  setTimeout(() => refreshReader(false), 80);
}

function sendReaderKey(key) {
  const values = { escape: '\u001b', interrupt: '\u0003', tab: '\t' };
  if (!values[key]) return;
  if (!sendInput(values[key])) {
    showToast('Not connected');
    return;
  }
  elements.readerInput.focus();
  setTimeout(() => refreshReader(false), 80);
}

function sendInput(data) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(encoder.encode(data));
  return true;
}

function resizeReaderInput() {
  elements.readerInput.style.height = 'auto';
  elements.readerInput.style.height = `${Math.min(elements.readerInput.scrollHeight, 150)}px`;
}

function scheduleReaderSize() {
  if (elements.terminalView.hidden || viewMode !== 'reader') return;
  clearTimeout(readerResizeTimer);
  readerResizeTimer = setTimeout(() => {
    fitReaderTerminal();
    sendResize();
  }, 100);
}

function fitReaderTerminal() {
  const width = elements.readerView.clientWidth || 900;
  const contentStyle = getComputedStyle(elements.readerContent);
  const horizontalPadding = (Number.parseFloat(contentStyle.paddingLeft) || 0)
    + (Number.parseFloat(contentStyle.paddingRight) || 0);
  const contentWidth = Math.max(320, width - horizontalPadding);
  const columns = Math.max(40, Math.min(500, Math.floor(contentWidth / 8.2)));
  const rows = Math.max(16, Math.min(100, Math.floor((elements.readerView.clientHeight || 576) / 18)));
  if (terminal.cols !== columns || terminal.rows !== rows) terminal.resize(columns, rows);
}

function scheduleFit() {
  if (elements.terminalView.hidden || viewMode !== 'terminal') return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitAddon.fit();
    sendResize();
  }, 80);
}

function sendResize() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
}

async function copySelection() {
  const selection = terminal.getSelection();
  if (!selection) return;
  try {
    await writeClipboard(selection);
    showToast('Copied');
  } catch {
    showToast('Copy failed');
  }
}

async function pasteClipboard() {
  terminal.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) terminal.paste(text);
    showToast(text ? 'Pasted' : 'Clipboard is empty');
  } catch {
    showToast('Press Ctrl / ⌘ + V');
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function setConnection(state, label) {
  elements.connectionDot.dataset.state = state;
  elements.connectionText.textContent = label;
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2200);
}

loadSessions(false);
setInterval(() => loadSessions(false), 5000);
