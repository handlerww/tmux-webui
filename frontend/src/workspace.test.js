import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeMissingSessionTabs,
  closeTab,
  createWorkspace,
  editorDropPosition,
  findCreateTab,
  findGroup,
  findTab,
  groupsInOrder,
  moveTab,
  openCreateTab,
  openSession,
  placeSessionInGroup,
  replaceCreateTab,
  sanitizeWorkspace,
  splitTab,
  workspaceForStorage,
} from './workspace.js';

function sequence(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function ids() {
  return { group: sequence('group'), tab: sequence('tab'), split: sequence('split') };
}

test('opening a session focuses its existing tab instead of duplicating it', () => {
  const workspace = createWorkspace('main');
  const createTabId = sequence('tab');
  const first = openSession(workspace, '$1', createTabId);
  const second = openSession(workspace, '$2', createTabId);
  const reopened = openSession(workspace, '$1', createTabId);

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal(reopened.created, false);
  assert.equal(findGroup(workspace, 'main').tabs.length, 2);
  assert.equal(findGroup(workspace, 'main').activeTabId, first.tab.id);
});

test('new session uses one transient tab and replaces it in place after creation', () => {
  const workspace = createWorkspace('main');
  const createTabId = sequence('tab');
  const first = openCreateTab(workspace, createTabId);
  const reopened = openCreateTab(workspace, createTabId);

  assert.equal(first.created, true);
  assert.equal(reopened.created, false);
  assert.equal(findGroup(workspace, 'main').tabs.length, 1);
  assert.equal(findCreateTab(workspace).tab.id, first.tab.id);

  const replaced = replaceCreateTab(workspace, '$4');
  assert.equal(replaced.tab.id, first.tab.id);
  assert.equal(replaced.tab.sessionId, '$4');
  assert.equal(findCreateTab(workspace), null);
});

test('new session tabs are omitted from persisted workspace state', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const session = openSession(workspace, '$1', generated.tab);
  const right = splitTab(workspace, session.tab.id, 'main', 'right', generated, true).group;
  openCreateTab(workspace, generated.tab);
  closeTab(workspace, right.tabs[0].id, generated.group);

  const stored = workspaceForStorage(workspace);

  assert.equal(groupsInOrder(stored.root).length, 1);
  assert.equal(stored.root.id, 'main');
  assert.deepEqual(stored.root.tabs, [{ id: session.tab.id, sessionId: '$1' }]);
  assert.equal(stored.activeGroupId, 'main');
  assert.equal(right.tabs.some((tab) => tab.kind === 'create'), true);

  const empty = createWorkspace('empty');
  openCreateTab(empty, generated.tab);
  assert.equal(workspaceForStorage(empty), null);
});

test('split duplicates only for an explicit split action', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const opened = openSession(workspace, '$1', generated.tab);
  const split = splitTab(workspace, opened.tab.id, 'main', 'right', generated, true);

  assert.equal(groupsInOrder(workspace.root).length, 2);
  assert.notEqual(split.tab.id, opened.tab.id);
  assert.equal(split.tab.sessionId, opened.tab.sessionId);
  assert.equal(findTab(workspace, '$1', split.group.id).group.id, split.group.id);
});

test('dragging a tab moves it across groups and collapses an empty source', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const first = openSession(workspace, '$1', generated.tab);
  splitTab(workspace, first.tab.id, 'main', 'right', generated, true);
  const original = findGroup(workspace, 'main');
  workspace.activeGroupId = original.id;
  const second = openSession(workspace, '$2', generated.tab);
  const target = groupsInOrder(workspace.root).find((group) => group.id !== original.id);

  assert.equal(moveTab(workspace, second.tab.id, target.id, 0, generated.group), true);
  assert.equal(findTab(workspace, '$2').group.id, target.id);
  closeTab(workspace, first.tab.id, generated.group);
  assert.equal(groupsInOrder(workspace.root).length, 1);
  assert.deepEqual(groupsInOrder(workspace.root)[0].tabs.map((tab) => tab.sessionId), ['$2', '$1']);
});

test('sanitizing persisted state removes tabs for sessions that ended', () => {
  const generated = ids();
  const restored = sanitizeWorkspace({
    activeGroupId: 'left',
    root: {
      type: 'split',
      id: 'saved-split',
      direction: 'horizontal',
      ratio: 0.7,
      children: [
        { type: 'group', id: 'left', activeTabId: 'one', tabs: [{ id: 'one', sessionId: '$1' }] },
        { type: 'group', id: 'right', activeTabId: 'gone', tabs: [{ id: 'gone', sessionId: '$9' }] },
      ],
    },
  }, new Set(['$1']), generated);

  assert.equal(restored.root.type, 'group');
  assert.equal(restored.root.id, 'left');
  assert.equal(restored.activeGroupId, 'left');
});

test('session refresh closes every tab for sessions that ended', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const ended = openSession(workspace, '$1', generated.tab);
  splitTab(workspace, ended.tab.id, 'main', 'right', generated, true);
  workspace.activeGroupId = 'main';
  const live = openSession(workspace, '$2', generated.tab);

  const closed = closeMissingSessionTabs(workspace, new Set(['$2']), generated.group);

  assert.equal(closed.length, 2);
  assert.deepEqual(closed.map((tab) => tab.sessionId), ['$1', '$1']);
  assert.equal(groupsInOrder(workspace.root).length, 1);
  assert.deepEqual(groupsInOrder(workspace.root)[0].tabs, [live.tab]);
  assert.equal(groupsInOrder(workspace.root)[0].activeTabId, live.tab.id);
});

test('closing the final ended session leaves a valid empty workspace', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  openSession(workspace, '$1', generated.tab);

  assert.equal(closeMissingSessionTabs(workspace, new Set(), generated.group).length, 1);
  assert.equal(workspace.root.type, 'group');
  assert.equal(workspace.root.tabs.length, 0);
  assert.equal(workspace.activeGroupId, workspace.root.id);
});

test('session refresh leaves the transient new session tab open', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const create = openCreateTab(workspace, generated.tab);

  assert.deepEqual(closeMissingSessionTabs(workspace, new Set(), generated.group), []);
  assert.equal(findCreateTab(workspace).tab.id, create.tab.id);
});

test('editor drop target uses edge halves and a single center target', () => {
  const bounds = { left: 100, top: 50, width: 800, height: 600 };
  assert.equal(editorDropPosition(110, 350, bounds), 'left');
  assert.equal(editorDropPosition(890, 350, bounds), 'right');
  assert.equal(editorDropPosition(500, 60, bounds), 'top');
  assert.equal(editorDropPosition(500, 640, bounds), 'bottom');
  assert.equal(editorDropPosition(500, 350, bounds), 'center');
  assert.equal(editorDropPosition(270, 170, bounds), 'top', 'the nearest edge wins in a corner');
});

test('placing a sidebar session moves an existing tab instead of duplicating it', () => {
  const workspace = createWorkspace('main');
  const generated = ids();
  const first = openSession(workspace, '$1', generated.tab);
  const right = splitTab(workspace, first.tab.id, 'main', 'right', generated, true).group;
  workspace.activeGroupId = 'main';
  const second = openSession(workspace, '$2', generated.tab);

  const placed = placeSessionInGroup(workspace, '$2', right.id, generated);
  assert.equal(placed.created, false);
  assert.equal(placed.moved, true);
  assert.equal(findTab(workspace, '$2').group.id, right.id);
  assert.equal(groupsInOrder(workspace.root).flatMap((group) => group.tabs).filter((tab) => tab.sessionId === '$2').length, 1);
  assert.equal(second.tab.id, placed.tab.id);
});
