import '@xterm/xterm/css/xterm.css';
import { SessionEditor } from './editor.js';
import { addRecentPath, nextNumericSessionName, sessionPathOptions } from './session-create.js';
import { nextThemeSetting, readThemeSetting, resolveTheme, storeThemeSetting } from './theme.js';
import {
  activateTab,
  closeMissingSessionTabs,
  closeTab,
  createWorkspace,
  cycleTab,
  editorDropPosition,
  findCreateTab,
  findGroup,
  findTab,
  findTabById,
  groupsInOrder,
  moveTab,
  openCreateTab,
  openSession,
  placeSessionInGroup,
  resizeSplit,
  replaceCreateTab,
  sanitizeWorkspace,
  splitTab,
  workspaceForStorage,
} from './workspace.js';
import './style.css';

const elements = {
  welcome: document.querySelector('#welcome'),
  workspaceLayout: document.querySelector('#workspace-layout'),
  sidebar: document.querySelector('#sidebar'),
  sidebarResizer: document.querySelector('#sidebar-resizer'),
  sidebarBackdrop: document.querySelector('#sidebar-backdrop'),
  mobileSessionToggle: document.querySelector('#mobile-session-toggle'),
  mobileSidebarClose: document.querySelector('#mobile-sidebar-close'),
  mobileActiveName: document.querySelector('#mobile-active-name'),
  sessionList: document.querySelector('#session-list'),
  sessionSearch: document.querySelector('#session-search-input'),
  sessionSearchClear: document.querySelector('#session-search-clear'),
  themeButton: document.querySelector('#theme-button'),
  createSessionButton: document.querySelector('#create-session-button'),
  createSessionForm: document.querySelector('#create-session-form'),
  createSessionPath: document.querySelector('#create-session-path'),
  createSessionName: document.querySelector('#create-session-name'),
  recentSessionPaths: document.querySelector('#recent-session-paths'),
  createSessionSave: document.querySelector('#create-session-save'),
  createSessionCancel: document.querySelector('#create-session-cancel'),
  refresh: document.querySelector('#refresh-button'),
  toast: document.querySelector('#toast'),
};

const sessionNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const mobileLayoutQuery = window.matchMedia('(max-width: 520px)');
const sidebarWidthSetting = 'tmux-webui.sidebarWidth';
const workspaceSetting = 'tmux-webui.workspace.v1';
const readerAutoFollowSetting = 'tmux-webui.readerAutoFollow';
const recentPathsSetting = 'tmux-webui.recentPaths.v1';
const maximumRecentPaths = 10;
const defaultSidebarWidth = 282;
const minimumSidebarWidth = 220;
const compactMinimumSidebarWidth = 190;
const maximumSidebarWidth = 520;
const minimumWorkspaceWidth = 360;
const terminalThemes = {
  light: {
    background: '#fbfaf7', foreground: '#252824', cursor: '#de6b48', cursorAccent: '#fbfaf7',
    selectionBackground: '#b8d9d2aa', selectionInactiveBackground: '#d8e6e2aa', black: '#242824',
    red: '#bd4b3f', green: '#5d7e5a', yellow: '#9b7525', blue: '#496f91', magenta: '#8a5d86',
    cyan: '#3d7d7a', white: '#e8e6df', brightBlack: '#6f746e', brightRed: '#d76755',
    brightGreen: '#759a6e', brightYellow: '#bd9140', brightBlue: '#648aad', brightMagenta: '#a675a1',
    brightCyan: '#58a09b', brightWhite: '#ffffff',
  },
  dark: {
    background: '#181d1b', foreground: '#dfe5e0', cursor: '#e78361', cursorAccent: '#181d1b',
    selectionBackground: '#47756c99', selectionInactiveBackground: '#354e4899', black: '#202624',
    red: '#e07a6e', green: '#91b88a', yellow: '#d3aa58', blue: '#82a9cb', magenta: '#bd8bb7',
    cyan: '#72b5b0', white: '#d9ddd9', brightBlack: '#7e8983', brightRed: '#f08d7d',
    brightGreen: '#a6cb9e', brightYellow: '#e4bd6c', brightBlue: '#99bddc', brightMagenta: '#cfa1ca',
    brightCyan: '#8bc9c4', brightWhite: '#f5f7f4',
  },
};

let nextID = Date.now();
const ids = {
  group: () => `group-${++nextID}`,
  tab: () => `tab-${++nextID}`,
  split: () => `split-${++nextID}`,
};
let sessions = [];
let workspace = createWorkspace(ids.group());
let workspaceRestored = false;
let editorViews = new Map();
let refreshInFlight = false;
let createInFlight = false;
let pendingCreatedSession = null;
let draggedItem = null;
let toastTimer = null;
let sidebarWidth = readSidebarWidth();
let readerAutoFollow = readReaderAutoFollow();
let recentPaths = readRecentPaths();
let themeSetting = readThemeSetting();
let resolvedTheme = resolveTheme(themeSetting, systemThemeQuery.matches);

bindPageEvents();
applyTheme(themeSetting, false);
applySidebarWidth(sidebarWidth, false);
syncMobileSidebar();
loadSessions(false);
setInterval(() => loadSessions(false), 5000);

function bindPageEvents() {
  elements.refresh.addEventListener('click', () => loadSessions(true));
  elements.mobileSessionToggle.addEventListener('click', () => setMobileSidebarOpen(true));
  elements.mobileSidebarClose.addEventListener('click', () => setMobileSidebarOpen(false, true));
  elements.sidebarBackdrop.addEventListener('click', () => setMobileSidebarOpen(false, true));
  mobileLayoutQuery.addEventListener('change', syncMobileSidebar);
  elements.sidebarResizer.addEventListener('pointerdown', startSidebarResize);
  elements.sidebarResizer.addEventListener('keydown', resizeSidebarWithKeyboard);
  elements.sidebarResizer.addEventListener('dblclick', () => applySidebarWidth(defaultSidebarWidth));
  elements.themeButton.addEventListener('click', () => applyTheme(nextThemeSetting(themeSetting)));
  systemThemeQuery.addEventListener('change', () => {
    if (themeSetting === 'system') applyTheme('system', false);
  });
  elements.sessionSearch.addEventListener('input', () => {
    elements.sessionSearchClear.hidden = elements.sessionSearch.value.length === 0;
    renderSessions();
  });
  elements.sessionSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.sessionSearch.value) clearSessionSearch();
  });
  elements.sessionSearchClear.addEventListener('click', clearSessionSearch);
  elements.createSessionButton.addEventListener('click', startCreateSession);
  elements.createSessionCancel.addEventListener('click', () => cancelCreateSession(true));
  elements.createSessionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    createSession();
  });
  elements.createSessionPath.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !createInFlight) {
      event.preventDefault();
      cancelCreateSession(true);
    }
  });
  window.addEventListener('resize', () => applySidebarWidth(sidebarWidth, false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    loadSessions(false);
    for (const editor of editorViews.values()) editor.refreshReader(false);
  });
  document.addEventListener('keydown', handleWorkspaceShortcut);
  document.addEventListener('dragend', clearWorkspaceDrag);
  elements.welcome.addEventListener('dragenter', showWelcomeDropTarget);
  elements.welcome.addEventListener('dragover', showWelcomeDropTarget);
  elements.welcome.addEventListener('dragleave', (event) => {
    if (!elements.welcome.contains(event.relatedTarget)) elements.welcome.classList.remove('drag-target');
  });
  elements.welcome.addEventListener('drop', dropSessionOnWelcome);
}

function handleWorkspaceShortcut(event) {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  const commandKey = event.ctrlKey || event.metaKey;
  if (event.key === '/' && !isTyping && !commandKey && !event.altKey) {
    event.preventDefault();
    elements.sessionSearch.focus();
    return;
  }
  if (event.key === 'Escape' && mobileLayoutQuery.matches && elements.sidebar.classList.contains('open') && !isTyping) {
    setMobileSidebarOpen(false, true);
    return;
  }
  if (!commandKey || event.altKey) return;
  const group = findGroup(workspace, workspace.activeGroupId);
  if (!group?.activeTabId) return;
  if (event.key.toLowerCase() === 'w') {
    event.preventDefault();
    closeWorkspaceTab(group.activeTabId);
  } else if (event.key === 'Tab') {
    event.preventDefault();
    if (cycleTab(workspace, group.id, event.shiftKey ? -1 : 1)) commitWorkspace(true);
  } else if (event.key === '\\') {
    event.preventDefault();
    splitActiveTab(group.id, 'right');
  }
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
    if (pendingCreatedSession) {
      if (!sessions.some((item) => item.id === pendingCreatedSession.id)) sessions.push(pendingCreatedSession);
      pendingCreatedSession = null;
    }
    const initialWorkspaceRender = !workspaceRestored;
    let closedTabs = [];
    if (initialWorkspaceRender) {
      workspace = sanitizeWorkspace(readStoredWorkspace(), new Set(sessions.map((session) => session.id)), ids);
      workspaceRestored = true;
    } else {
      closedTabs = closeMissingSessionTabs(workspace, new Set(sessions.map((session) => session.id)), ids.group);
      if (closedTabs.length > 0) persistWorkspace();
    }
    syncEditors();
    renderSessions();
    // Keep mounted editors in place during polling so native Reader/xterm state,
    // including scroll position and selection, survives session metadata updates.
    if (initialWorkspaceRender || closedTabs.length > 0) renderWorkspace();
    else refreshWorkspaceSessions();
    if (showFeedback) showToast('Updated');
  } catch {
    renderSessionError();
    if (showFeedback) showToast('Could not refresh');
  } finally {
    refreshInFlight = false;
    elements.refresh.classList.remove('spinning');
  }
}

function renderSessions() {
  renderCreateSessionOptions();
  elements.sessionList.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-sessions';
    empty.innerHTML = '<span class="empty-icon">◇</span><strong>No sessions</strong><small>Use + to create one</small>';
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
    empty.innerHTML = '<span class="empty-icon">⌕</span><strong>No matches</strong><small>Search by name or path</small>';
    elements.sessionList.append(empty);
    return;
  }

  const activeSessionId = activeTab()?.sessionId;
  for (const session of visibleSessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-card';
    button.disabled = createInFlight;
    button.draggable = !createInFlight;
    button.title = `Open ${session.name}. Drag into the workspace to place it`;
    button.classList.toggle('active', activeSessionId === session.id);
    button.classList.toggle('open', Boolean(findTab(workspace, session.id)));
    button.addEventListener('click', () => openSessionTab(session));
    button.addEventListener('dragstart', (event) => startSessionDrag(event, session.id));

    const top = document.createElement('span');
    top.className = 'session-card-top';
    const name = document.createElement('strong');
    name.textContent = session.name;
    const activity = document.createElement('span');
    activity.className = 'activity-time';
    activity.textContent = relativeTime(session.lastActivity);
    top.append(name, activity);
    const sessionPath = document.createElement('span');
    sessionPath.className = 'session-path';
    sessionPath.textContent = session.path || 'Path unavailable';
    sessionPath.title = session.path || '';
    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    meta.append(dot, `${session.windows} ${plural(session.windows, 'window')}`);
    if (session.attached > 0) meta.append(` · ${session.attached} ${plural(session.attached, 'client')}`);
    button.append(top, sessionPath, meta);
    elements.sessionList.append(button);
  }
}

function openSessionTab(session) {
  rememberRecentPath(session.path);
  openSession(workspace, session.id, ids.tab);
  setMobileSidebarOpen(false);
  commitWorkspace(true);
}

function renderWorkspace(focus = false) {
  syncEditors();
  const groups = groupsInOrder(workspace.root);
  const visibleTabIds = new Set(groups.map((group) => group.activeTabId).filter(Boolean));
  for (const [tabId, editor] of editorViews) {
    if (!visibleTabIds.has(tabId)) editor.setVisible(false);
  }
  const hasTabs = groups.some((group) => group.tabs.length > 0);
  elements.welcome.hidden = hasTabs;
  elements.workspaceLayout.hidden = !hasTabs;
  elements.workspaceLayout.replaceChildren();
  if (!hasTabs) {
    elements.mobileActiveName.textContent = 'Sessions';
    renderSessions();
    return;
  }
  elements.workspaceLayout.append(renderLayoutNode(workspace.root));
  for (const group of groups) {
    if (!group.activeTabId) continue;
    const editor = editorViews.get(group.activeTabId);
    editor?.setVisible(true, focus && group.id === workspace.activeGroupId);
  }
  const session = sessionForTab(activeTab());
  elements.mobileActiveName.textContent = activeTab()?.kind === 'create' ? 'New session' : session?.name ?? 'Sessions';
  elements.createSessionButton.setAttribute('aria-expanded', String(Boolean(findCreateTab(workspace))));
  renderSessions();
}

function refreshWorkspaceSessions() {
  for (const item of elements.workspaceLayout.querySelectorAll('.editor-tab[data-tab-id]')) {
    const found = findTabById(workspace, item.dataset.tabId);
    if (!found) continue;
    if (found.tab.kind === 'create') continue;
    const liveSession = sessions.find((candidate) => candidate.id === found.tab.sessionId);
    const session = liveSession ?? editorViews.get(found.tab.id)?.session;
    const label = item.querySelector('.tab-label');
    const close = item.querySelector('.tab-close');
    const name = session?.name ?? 'Session ended';
    item.classList.toggle('ended', !liveSession);
    item.title = session?.path || session?.name || 'Session ended';
    if (label) label.textContent = name;
    if (close) close.setAttribute('aria-label', `Close ${name}`);
  }
  const session = sessionForTab(activeTab());
  elements.mobileActiveName.textContent = activeTab()?.kind === 'create' ? 'New session' : session?.name ?? 'Sessions';
}

function renderLayoutNode(node) {
  if (node.type === 'group') return renderEditorGroup(node);
  const split = document.createElement('div');
  split.className = `editor-split ${node.direction}`;
  split.dataset.splitId = node.id;
  const first = document.createElement('div');
  const second = document.createElement('div');
  first.className = 'split-child';
  second.className = 'split-child';
  first.style.flexBasis = `${node.ratio * 100}%`;
  second.style.flexBasis = `${(1 - node.ratio) * 100}%`;
  first.append(renderLayoutNode(node.children[0]));
  second.append(renderLayoutNode(node.children[1]));
  const divider = document.createElement('div');
  divider.className = 'split-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', node.direction === 'horizontal' ? 'vertical' : 'horizontal');
  divider.tabIndex = 0;
  divider.addEventListener('pointerdown', (event) => startSplitResize(event, node, split, first, second));
  divider.addEventListener('keydown', (event) => resizeSplitWithKeyboard(event, node));
  split.append(first, divider, second);
  return split;
}

function renderEditorGroup(group) {
  const container = document.createElement('section');
  container.className = 'editor-group';
  container.classList.toggle('active', group.id === workspace.activeGroupId);
  container.dataset.groupId = group.id;
  container.addEventListener('pointerdown', () => setActiveGroup(group.id));

  const tabbar = document.createElement('div');
  tabbar.className = 'editor-tabbar';
  tabbar.setAttribute('role', 'tablist');
  const tabs = document.createElement('div');
  tabs.className = 'editor-tabs';
  tabs.addEventListener('dragover', (event) => event.preventDefault());
  tabs.addEventListener('drop', (event) => dropItemInGroup(event, group.id, group.tabs.length));
  for (const [index, tab] of group.tabs.entries()) tabs.append(renderTab(group, tab, index));
  const actions = document.createElement('div');
  actions.className = 'group-actions';
  const creating = group.tabs.find((tab) => tab.id === group.activeTabId)?.kind === 'create';
  actions.append(
    groupAction('Split right', 'split-right', () => splitActiveTab(group.id, 'right'), creating),
    groupAction('Split down', 'split-down', () => splitActiveTab(group.id, 'bottom'), creating),
  );
  tabbar.append(tabs, actions);

  const body = document.createElement('div');
  body.className = 'editor-group-body';
  if (creating) body.append(renderCreateSessionPanel());
  else {
    const editor = editorViews.get(group.activeTabId);
    if (editor) body.append(editor.panel);
  }
  body.append(createDropZones(group.id));
  container.append(tabbar, body);
  return container;
}

function renderTab(group, tab, index) {
  const creating = tab.kind === 'create';
  const session = sessionForTab(tab);
  const item = document.createElement('div');
  item.className = 'editor-tab';
  item.classList.toggle('active', group.activeTabId === tab.id);
  item.classList.toggle('create', creating);
  item.classList.toggle('ended', !creating && !sessions.some((candidate) => candidate.id === tab.sessionId));
  item.dataset.tabId = tab.id;
  item.draggable = !creating;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', String(group.activeTabId === tab.id));
  item.title = creating ? 'Create tmux session' : session?.path || session?.name || 'Session ended';
  item.addEventListener('click', () => {
    activateTab(workspace, group.id, tab.id);
    commitWorkspace(true);
  });
  if (!creating) item.addEventListener('dragstart', (event) => startTabDrag(event, tab.id));
  item.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const before = event.clientX < item.getBoundingClientRect().left + item.offsetWidth / 2;
    item.dataset.dropSide = before ? 'before' : 'after';
  });
  item.addEventListener('dragleave', () => delete item.dataset.dropSide);
  item.addEventListener('drop', (event) => {
    event.stopPropagation();
    const targetIndex = index + (item.dataset.dropSide === 'after' ? 1 : 0);
    delete item.dataset.dropSide;
    dropItemInGroup(event, group.id, targetIndex);
  });

  const icon = document.createElement('span');
  icon.className = 'tab-terminal-icon';
  icon.textContent = creating ? '+' : '>_';
  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = creating ? 'New session' : session?.name ?? 'Session ended';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.title = 'Close tab';
  close.setAttribute('aria-label', `Close ${label.textContent}`);
  close.textContent = '×';
  close.disabled = creating && createInFlight;
  close.addEventListener('pointerdown', (event) => event.stopPropagation());
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeWorkspaceTab(tab.id);
  });
  item.append(icon, label, close);
  return item;
}

function renderCreateSessionPanel() {
  const panel = document.createElement('section');
  panel.className = 'create-session-panel';
  elements.createSessionForm.hidden = false;
  panel.append(elements.createSessionForm);
  return panel;
}

function createDropZones(groupId) {
  const overlay = document.createElement('div');
  overlay.className = 'editor-drop-overlay';
  const preview = document.createElement('div');
  preview.className = 'editor-drop-preview';
  preview.dataset.position = 'center';
  overlay.append(preview);

  const updatePreview = (event) => {
    event.preventDefault();
    preview.dataset.position = editorDropPosition(event.clientX, event.clientY, overlay.getBoundingClientRect());
  };
  overlay.addEventListener('dragenter', updatePreview);
  overlay.addEventListener('dragover', updatePreview);
  overlay.addEventListener('dragleave', (event) => {
    if (!overlay.contains(event.relatedTarget)) preview.dataset.position = 'center';
  });
  overlay.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedItem) return;
    const position = editorDropPosition(event.clientX, event.clientY, overlay.getBoundingClientRect());
    if (draggedItem.type === 'tab') {
      if (position === 'center') moveTab(workspace, draggedItem.tabId, groupId, findGroup(workspace, groupId)?.tabs.length ?? 0, ids.group);
      else splitTab(workspace, draggedItem.tabId, groupId, position, ids, false);
    } else {
      const placed = placeSessionInGroup(workspace, draggedItem.sessionId, groupId, ids);
      if (placed && position !== 'center') splitTab(workspace, placed.tab.id, groupId, position, ids, false);
    }
    clearWorkspaceDrag();
    commitWorkspace(true);
  });
  return overlay;
}

function groupAction(label, kind, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `group-action ${kind}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.innerHTML = kind === 'split-right'
    ? '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>'
    : '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/></svg>';
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', action);
  return button;
}

function startTabDrag(event, tabId) {
  draggedItem = { type: 'tab', tabId };
  const tabElement = event.currentTarget;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', tabId);
  document.body.classList.add('workspace-item-dragging');
  requestAnimationFrame(() => tabElement.classList.add('dragging'));
}

function startSessionDrag(event, sessionId) {
  draggedItem = { type: 'session', sessionId };
  const sessionCard = event.currentTarget;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-tmux-session', sessionId);
  event.dataTransfer.setData('text/plain', sessionId);
  document.body.classList.add('workspace-item-dragging');
  requestAnimationFrame(() => sessionCard.classList.add('dragging'));
}

function clearWorkspaceDrag() {
  draggedItem = null;
  document.body.classList.remove('workspace-item-dragging');
  elements.welcome.classList.remove('drag-target');
  for (const item of document.querySelectorAll('.editor-tab.dragging, .editor-tab[data-drop-side], .session-card.dragging')) {
    item.classList.remove('dragging');
    delete item.dataset.dropSide;
  }
}

function dropItemInGroup(event, groupId, index) {
  event.preventDefault();
  if (!draggedItem) return;
  if (draggedItem.type === 'tab') {
    moveTab(workspace, draggedItem.tabId, groupId, index, ids.group);
  } else {
    const placed = placeSessionInGroup(workspace, draggedItem.sessionId, groupId, ids);
    if (placed) moveTab(workspace, placed.tab.id, groupId, index, ids.group);
  }
  clearWorkspaceDrag();
  commitWorkspace(true);
}

function showWelcomeDropTarget(event) {
  if (draggedItem?.type !== 'session') return;
  event.preventDefault();
  elements.welcome.classList.add('drag-target');
}

function dropSessionOnWelcome(event) {
  if (draggedItem?.type !== 'session') return;
  event.preventDefault();
  const session = sessions.find((candidate) => candidate.id === draggedItem.sessionId);
  clearWorkspaceDrag();
  if (session) openSessionTab(session);
}

function splitActiveTab(groupId, position) {
  const group = findGroup(workspace, groupId);
  if (!group?.activeTabId) return;
  if (group.tabs.find((tab) => tab.id === group.activeTabId)?.kind === 'create') return;
  splitTab(workspace, group.activeTabId, groupId, position, ids, true);
  commitWorkspace(true);
}

function closeWorkspaceTab(tabId) {
  const found = findTabById(workspace, tabId);
  if (found?.tab.kind === 'create' && createInFlight) return;
  closeTab(workspace, tabId, ids.group);
  if (found?.tab.kind === 'create') {
    elements.createSessionForm.hidden = true;
    elements.createSessionButton.setAttribute('aria-expanded', 'false');
  }
  commitWorkspace(true);
}

function setActiveGroup(groupId) {
  if (workspace.activeGroupId === groupId) return;
  workspace.activeGroupId = groupId;
  persistWorkspace();
  for (const group of document.querySelectorAll('.editor-group')) {
    group.classList.toggle('active', group.dataset.groupId === groupId);
  }
  const session = sessionForTab(activeTab());
  elements.mobileActiveName.textContent = activeTab()?.kind === 'create' ? 'New session' : session?.name ?? 'Sessions';
  renderSessions();
}

function startSplitResize(event, node, split, first, second) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  document.body.classList.add(node.direction === 'horizontal' ? 'split-resizing-horizontal' : 'split-resizing-vertical');
  const move = (moveEvent) => {
    const rect = split.getBoundingClientRect();
    const ratio = node.direction === 'horizontal'
      ? (moveEvent.clientX - rect.left) / rect.width
      : (moveEvent.clientY - rect.top) / rect.height;
    resizeSplit(workspace, node.id, ratio);
    first.style.flexBasis = `${node.ratio * 100}%`;
    second.style.flexBasis = `${(1 - node.ratio) * 100}%`;
  };
  const stop = (stopEvent) => {
    event.currentTarget.removeEventListener('pointermove', move);
    event.currentTarget.removeEventListener('pointerup', stop);
    event.currentTarget.removeEventListener('pointercancel', stop);
    if (event.currentTarget.hasPointerCapture(stopEvent.pointerId)) event.currentTarget.releasePointerCapture(stopEvent.pointerId);
    document.body.classList.remove('split-resizing-horizontal', 'split-resizing-vertical');
    persistWorkspace();
  };
  event.currentTarget.addEventListener('pointermove', move);
  event.currentTarget.addEventListener('pointerup', stop);
  event.currentTarget.addEventListener('pointercancel', stop);
}

function resizeSplitWithKeyboard(event, node) {
  const delta = event.shiftKey ? 0.1 : 0.04;
  const decrease = node.direction === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
  const increase = node.direction === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
  if (!decrease && !increase) return;
  event.preventDefault();
  resizeSplit(workspace, node.id, node.ratio + (increase ? delta : -delta));
  persistWorkspace();
  renderWorkspace();
}

function syncEditors() {
  const tabs = groupsInOrder(workspace.root).flatMap((group) => group.tabs);
  const liveTabIds = new Set(tabs.map((tab) => tab.id));
  for (const [tabId, editor] of editorViews) {
    if (liveTabIds.has(tabId)) continue;
    editor.destroy();
    editorViews.delete(tabId);
  }
  for (const tab of tabs) {
    const liveSession = sessions.find((session) => session.id === tab.sessionId);
    const existing = editorViews.get(tab.id);
    if (existing) {
      existing.updateSession(liveSession ?? existing.session, Boolean(liveSession));
      continue;
    }
    if (!liveSession) continue;
    editorViews.set(tab.id, new SessionEditor(tab.id, liveSession, {
      getTerminalTheme: () => terminalThemes[resolvedTheme],
      getAutoFollow: () => readerAutoFollow,
      onAutoFollowChange: setReaderAutoFollow,
      onFocus: focusEditorTab,
      onRename: renameSession,
      onToast: showToast,
    }));
  }
}

function focusEditorTab(tabId) {
  for (const group of groupsInOrder(workspace.root)) {
    if (group.activeTabId !== tabId) continue;
    setActiveGroup(group.id);
    return;
  }
}

async function renameSession(sessionID, name) {
  const response = await fetch('/api/sessions/rename', {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionID, name }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not rename session');
  sessions = sessions.map((session) => (session.id === sessionID ? { ...session, name: body.name || name } : session));
  syncEditors();
  refreshWorkspaceSessions();
  renderSessions();
  showToast(`Renamed to ${body.name || name}`);
  loadSessions(false);
}

function commitWorkspace(focus = false) {
  persistWorkspace();
  renderWorkspace(focus);
}

function activeTab() {
  const group = findGroup(workspace, workspace.activeGroupId);
  return group?.tabs.find((tab) => tab.id === group.activeTabId) ?? null;
}

function sessionForTab(tab) {
  if (!tab) return null;
  return sessions.find((session) => session.id === tab.sessionId) ?? editorViews.get(tab.id)?.session ?? null;
}

function readStoredWorkspace() {
  try {
    return JSON.parse(localStorage.getItem(workspaceSetting));
  } catch {
    return null;
  }
}

function persistWorkspace() {
  try {
    const stored = workspaceForStorage(workspace);
    if (stored) localStorage.setItem(workspaceSetting, JSON.stringify(stored));
    else localStorage.removeItem(workspaceSetting);
  } catch {
    // The current page keeps working when browser storage is unavailable.
  }
}

function readReaderAutoFollow() {
  try {
    return localStorage.getItem(readerAutoFollowSetting) === 'true';
  } catch {
    return false;
  }
}

function setReaderAutoFollow(value) {
  readerAutoFollow = Boolean(value);
  try {
    localStorage.setItem(readerAutoFollowSetting, String(readerAutoFollow));
  } catch {
    // The current page keeps working when browser storage is unavailable.
  }
  for (const editor of editorViews.values()) editor.updateAutoFollow();
}

function applyTheme(setting, persist = true) {
  themeSetting = persist ? storeThemeSetting(setting) : setting;
  resolvedTheme = resolveTheme(themeSetting, systemThemeQuery.matches);
  document.documentElement.dataset.theme = themeSetting;
  document.documentElement.dataset.colorScheme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]').content = resolvedTheme === 'dark' ? '#151a18' : '#f3f1eb';
  elements.themeButton.dataset.themeSetting = themeSetting;
  const label = capitalize(themeSetting);
  const resolvedLabel = capitalize(resolvedTheme);
  const next = nextThemeSetting(themeSetting);
  const description = `Theme: ${label}${themeSetting === 'system' ? ` (${resolvedLabel})` : ''}. Switch to ${capitalize(next)}`;
  elements.themeButton.title = description;
  elements.themeButton.setAttribute('aria-label', description);
  for (const editor of editorViews.values()) editor.updateTheme();
}

function startCreateSession() {
  if (createInFlight) return;
  const existing = findCreateTab(workspace);
  if (!existing) {
    const activePath = sessionForTab(activeTab())?.path;
    elements.createSessionPath.value = activePath || recentSessionPaths()[0] || '';
  }
  renderCreateSessionOptions();
  openCreateTab(workspace, ids.tab);
  elements.createSessionForm.hidden = false;
  elements.createSessionButton.setAttribute('aria-expanded', 'true');
  setMobileSidebarOpen(false);
  commitWorkspace();
  requestAnimationFrame(() => {
    elements.createSessionPath.focus();
    if (!existing) elements.createSessionPath.select();
  });
}

function cancelCreateSession(restoreFocus) {
  if (createInFlight) return;
  const found = findCreateTab(workspace);
  elements.createSessionForm.hidden = true;
  elements.createSessionButton.setAttribute('aria-expanded', 'false');
  if (found) {
    closeTab(workspace, found.tab.id, ids.group);
    commitWorkspace(true);
  }
  if (restoreFocus) requestAnimationFrame(() => elements.createSessionButton.focus());
}

async function createSession() {
  if (createInFlight) return;
  const workingDirectory = elements.createSessionPath.value.trim();
  if (!workingDirectory) {
    showToast('Enter a working directory');
    elements.createSessionPath.focus();
    return;
  }
  createInFlight = true;
  elements.createSessionPath.disabled = true;
  elements.createSessionSave.disabled = true;
  elements.createSessionCancel.disabled = true;
  renderCreateSessionOptions();
  renderSessions();
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workingDirectory }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not create session');
    if (!body.session?.id || !body.session?.name || !body.session?.path) throw new Error('Invalid session response');
    pendingCreatedSession = body.session;
    sessions = [...sessions.filter((item) => item.id !== body.session.id), body.session];
    if (!replaceCreateTab(workspace, body.session.id)) openSession(workspace, body.session.id, ids.tab);
    rememberRecentPath(body.session.path);
    elements.sessionSearch.value = '';
    elements.sessionSearchClear.hidden = true;
    elements.createSessionForm.hidden = true;
    elements.createSessionButton.setAttribute('aria-expanded', 'false');
    showToast(`Created ${body.session.name}`);
    commitWorkspace(true);
    loadSessions(false);
  } catch (error) {
    showToast(error.message || 'Could not create session');
    elements.createSessionPath.focus();
    elements.createSessionPath.select();
  } finally {
    createInFlight = false;
    elements.createSessionPath.disabled = false;
    elements.createSessionSave.disabled = false;
    elements.createSessionCancel.disabled = false;
    renderCreateSessionOptions();
    renderSessions();
  }
}

function renderCreateSessionOptions() {
  elements.createSessionName.textContent = nextNumericSessionName(sessions);
  elements.recentSessionPaths.replaceChildren();
  const paths = recentSessionPaths();
  if (paths.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'create-session-recent-empty';
    empty.textContent = 'No recently opened paths yet.';
    elements.recentSessionPaths.append(empty);
    return;
  }
  for (const path of paths) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'create-session-recent-path';
    button.title = path;
    button.disabled = createInFlight;
    const icon = document.createElement('span');
    icon.className = 'create-session-recent-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↺';
    const label = document.createElement('span');
    label.textContent = path;
    button.append(icon, label);
    button.addEventListener('click', () => {
      if (createInFlight) return;
      elements.createSessionPath.value = path;
      elements.createSessionPath.focus();
    });
    elements.recentSessionPaths.append(button);
  }
}

function recentSessionPaths() {
  return sessionPathOptions(recentPaths, [], maximumRecentPaths);
}

function rememberRecentPath(path) {
  const updated = addRecentPath(recentPaths, path, maximumRecentPaths);
  if (updated === recentPaths) return;
  recentPaths = updated;
  try {
    localStorage.setItem(recentPathsSetting, JSON.stringify(recentPaths));
  } catch {
    // The current page retains recent paths when browser storage is unavailable.
  }
  renderCreateSessionOptions();
}

function readRecentPaths() {
  try {
    const stored = JSON.parse(localStorage.getItem(recentPathsSetting));
    if (!Array.isArray(stored)) return [];
    return sessionPathOptions(stored, [], maximumRecentPaths);
  } catch {
    return [];
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

function readSidebarWidth() {
  try {
    const stored = Number.parseFloat(localStorage.getItem(sidebarWidthSetting));
    return Number.isFinite(stored) ? stored : defaultSidebarWidth;
  } catch {
    return defaultSidebarWidth;
  }
}

function sidebarWidthBounds() {
  const minimum = window.innerWidth <= 760 ? compactMinimumSidebarWidth : minimumSidebarWidth;
  const availableWidth = Math.max(minimum, window.innerWidth - minimumWorkspaceWidth);
  return { minimum, maximum: Math.max(minimum, Math.min(maximumSidebarWidth, availableWidth)) };
}

function applySidebarWidth(width, persist = true) {
  const { minimum, maximum } = sidebarWidthBounds();
  sidebarWidth = Math.max(minimum, Math.min(maximumSidebarWidth, Math.round(width)));
  const appliedWidth = Math.min(sidebarWidth, maximum);
  document.documentElement.style.setProperty('--sidebar-width', `${appliedWidth}px`);
  elements.sidebarResizer.setAttribute('aria-valuemin', String(minimum));
  elements.sidebarResizer.setAttribute('aria-valuemax', String(maximum));
  elements.sidebarResizer.setAttribute('aria-valuenow', String(appliedWidth));
  elements.sidebarResizer.title = `Sidebar width: ${appliedWidth}px. Double-click to reset`;
  if (persist) {
    try {
      localStorage.setItem(sidebarWidthSetting, String(sidebarWidth));
    } catch {
      // The current page keeps working when browser storage is unavailable.
    }
  }
}

function startSidebarResize(event) {
  if (event.button !== 0 || mobileLayoutQuery.matches) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = elements.sidebar.getBoundingClientRect().width;
  elements.sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add('sidebar-resizing');
  const move = (moveEvent) => applySidebarWidth(startWidth + moveEvent.clientX - startX, false);
  const stop = (stopEvent) => {
    elements.sidebarResizer.removeEventListener('pointermove', move);
    elements.sidebarResizer.removeEventListener('pointerup', stop);
    elements.sidebarResizer.removeEventListener('pointercancel', stop);
    if (elements.sidebarResizer.hasPointerCapture(stopEvent.pointerId)) elements.sidebarResizer.releasePointerCapture(stopEvent.pointerId);
    document.body.classList.remove('sidebar-resizing');
    applySidebarWidth(elements.sidebar.getBoundingClientRect().width);
  };
  elements.sidebarResizer.addEventListener('pointermove', move);
  elements.sidebarResizer.addEventListener('pointerup', stop);
  elements.sidebarResizer.addEventListener('pointercancel', stop);
}

function resizeSidebarWithKeyboard(event) {
  if (mobileLayoutQuery.matches) return;
  const { minimum, maximum } = sidebarWidthBounds();
  const appliedWidth = elements.sidebar.getBoundingClientRect().width;
  const step = event.shiftKey ? 40 : 16;
  let nextWidth;
  if (event.key === 'ArrowLeft') nextWidth = appliedWidth - step;
  if (event.key === 'ArrowRight') nextWidth = appliedWidth + step;
  if (event.key === 'Home') nextWidth = minimum;
  if (event.key === 'End') nextWidth = maximum;
  if (nextWidth === undefined) return;
  event.preventDefault();
  applySidebarWidth(nextWidth);
}

function setMobileSidebarOpen(open, restoreFocus = false) {
  if (!mobileLayoutQuery.matches) return;
  elements.sidebar.classList.toggle('open', open);
  elements.sidebarBackdrop.hidden = !open;
  elements.mobileSessionToggle.setAttribute('aria-expanded', String(open));
  elements.mobileSessionToggle.setAttribute('aria-label', open ? 'Sessions open' : 'Open sessions');
  elements.sidebar.setAttribute('aria-hidden', String(!open));
  elements.sidebar.inert = !open;
  document.body.classList.toggle('mobile-sidebar-open', open);
  if (open) requestAnimationFrame(() => elements.mobileSidebarClose.focus());
  else if (restoreFocus) elements.mobileSessionToggle.focus();
}

function syncMobileSidebar() {
  if (mobileLayoutQuery.matches) {
    const open = elements.sidebar.classList.contains('open');
    elements.sidebarBackdrop.hidden = !open;
    elements.sidebar.setAttribute('aria-hidden', String(!open));
    elements.sidebar.inert = !open;
    elements.mobileSessionToggle.setAttribute('aria-expanded', String(open));
  } else {
    elements.sidebar.classList.remove('open');
    elements.sidebar.removeAttribute('aria-hidden');
    elements.sidebar.inert = false;
    elements.sidebarBackdrop.hidden = true;
    elements.mobileSessionToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-sidebar-open');
  }
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

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2200);
}
