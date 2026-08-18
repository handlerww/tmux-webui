export function createWorkspace(groupId = 'group-1') {
  return {
    root: createGroup(groupId),
    activeGroupId: groupId,
  };
}

export function createGroup(id, tabs = [], activeTabId = null) {
  return {
    type: 'group',
    id,
    tabs,
    activeTabId: activeTabId ?? tabs[0]?.id ?? null,
  };
}

export function groupsInOrder(node) {
  if (!node) return [];
  if (node.type === 'group') return [node];
  return node.children.flatMap(groupsInOrder);
}

export function findGroup(workspace, groupId) {
  return groupsInOrder(workspace.root).find((group) => group.id === groupId) ?? null;
}

export function findTab(workspace, sessionId, preferredGroupId = null) {
  const groups = groupsInOrder(workspace.root);
  const preferred = groups.find((group) => group.id === preferredGroupId);
  const ordered = preferred ? [preferred, ...groups.filter((group) => group !== preferred)] : groups;
  for (const group of ordered) {
    const tab = group.tabs.find((item) => item.sessionId === sessionId);
    if (tab) return { group, tab };
  }
  return null;
}

export function findTabById(workspace, tabId) {
  for (const group of groupsInOrder(workspace.root)) {
    const index = group.tabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) return { group, tab: group.tabs[index], index };
  }
  return null;
}

export function openSession(workspace, sessionId, createTabId) {
  const existing = findTab(workspace, sessionId, workspace.activeGroupId);
  if (existing) {
    existing.group.activeTabId = existing.tab.id;
    workspace.activeGroupId = existing.group.id;
    return { group: existing.group, tab: existing.tab, created: false };
  }

  let group = findGroup(workspace, workspace.activeGroupId);
  if (!group) {
    group = groupsInOrder(workspace.root)[0];
    workspace.activeGroupId = group.id;
  }
  const tab = { id: createTabId(), sessionId };
  group.tabs.push(tab);
  group.activeTabId = tab.id;
  return { group, tab, created: true };
}

export function placeSessionInGroup(workspace, sessionId, targetGroupId, ids) {
  const target = findGroup(workspace, targetGroupId);
  if (!target) return null;
  const existing = findTab(workspace, sessionId, targetGroupId);
  if (existing) {
    if (existing.group.id === targetGroupId) {
      existing.group.activeTabId = existing.tab.id;
      workspace.activeGroupId = targetGroupId;
      return { group: existing.group, tab: existing.tab, created: false, moved: false };
    }
    moveTab(workspace, existing.tab.id, targetGroupId, target.tabs.length, ids.group);
    return { group: target, tab: existing.tab, created: false, moved: true };
  }
  const tab = { id: ids.tab(), sessionId };
  target.tabs.push(tab);
  target.activeTabId = tab.id;
  workspace.activeGroupId = targetGroupId;
  return { group: target, tab, created: true, moved: false };
}

export function activateTab(workspace, groupId, tabId) {
  const group = findGroup(workspace, groupId);
  if (!group || !group.tabs.some((tab) => tab.id === tabId)) return false;
  group.activeTabId = tabId;
  workspace.activeGroupId = groupId;
  return true;
}

export function closeTab(workspace, tabId, createGroupId) {
  const found = findTabById(workspace, tabId);
  if (!found) return null;
  const { group, tab, index } = found;
  group.tabs.splice(index, 1);
  if (group.activeTabId === tabId) {
    group.activeTabId = group.tabs[Math.min(index, group.tabs.length - 1)]?.id ?? null;
  }
  workspace.root = collapseEmpty(workspace.root);
  ensureWorkspaceGroup(workspace, createGroupId);
  return tab;
}

export function closeMissingSessionTabs(workspace, liveSessionIds, createGroupId) {
  const missingTabIds = groupsInOrder(workspace.root)
    .flatMap((group) => group.tabs)
    .filter((tab) => !liveSessionIds.has(tab.sessionId))
    .map((tab) => tab.id);
  const closed = [];
  for (const tabId of missingTabIds) {
    const tab = closeTab(workspace, tabId, createGroupId);
    if (tab) closed.push(tab);
  }
  return closed;
}

export function moveTab(workspace, tabId, targetGroupId, targetIndex, createGroupId) {
  const found = findTabById(workspace, tabId);
  const target = findGroup(workspace, targetGroupId);
  if (!found || !target) return false;

  const sameGroup = found.group === target;
  found.group.tabs.splice(found.index, 1);
  if (sameGroup && found.index < targetIndex) targetIndex -= 1;
  const boundedIndex = Math.max(0, Math.min(target.tabs.length, targetIndex));
  target.tabs.splice(boundedIndex, 0, found.tab);
  if (found.group.activeTabId === tabId && !sameGroup) {
    found.group.activeTabId = found.group.tabs[Math.min(found.index, found.group.tabs.length - 1)]?.id ?? null;
  }
  target.activeTabId = tabId;
  workspace.activeGroupId = target.id;
  workspace.root = collapseEmpty(workspace.root);
  ensureWorkspaceGroup(workspace, createGroupId);
  return true;
}

export function splitTab(workspace, tabId, targetGroupId, position, ids, duplicate = false) {
  const found = findTabById(workspace, tabId);
  const target = findGroup(workspace, targetGroupId);
  if (!found || !target || !['left', 'right', 'top', 'bottom'].includes(position)) return null;

  let tab = found.tab;
  if (duplicate) {
    tab = { id: ids.tab(), sessionId: found.tab.sessionId };
  } else {
    found.group.tabs.splice(found.index, 1);
    if (found.group.activeTabId === tabId) {
      found.group.activeTabId = found.group.tabs[Math.min(found.index, found.group.tabs.length - 1)]?.id ?? null;
    }
  }

  const newGroup = createGroup(ids.group(), [tab], tab.id);
  const direction = position === 'left' || position === 'right' ? 'horizontal' : 'vertical';
  const children = position === 'left' || position === 'top' ? [newGroup, target] : [target, newGroup];
  workspace.root = replaceNode(workspace.root, target.id, {
    type: 'split',
    id: ids.split(),
    direction,
    ratio: 0.5,
    children,
  });
  workspace.root = collapseEmpty(workspace.root) ?? newGroup;
  workspace.activeGroupId = newGroup.id;
  return { group: newGroup, tab };
}

export function cycleTab(workspace, groupId, offset) {
  const group = findGroup(workspace, groupId);
  if (!group || group.tabs.length < 2) return null;
  const current = Math.max(0, group.tabs.findIndex((tab) => tab.id === group.activeTabId));
  const index = (current + offset + group.tabs.length) % group.tabs.length;
  group.activeTabId = group.tabs[index].id;
  workspace.activeGroupId = group.id;
  return group.tabs[index];
}

export function resizeSplit(workspace, splitId, ratio) {
  const split = findNode(workspace.root, splitId);
  if (!split || split.type !== 'split') return false;
  split.ratio = Math.max(0.15, Math.min(0.85, ratio));
  return true;
}

export function editorDropPosition(clientX, clientY, bounds, edgeRatio = 0.25) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 'center';
  const horizontal = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  const vertical = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
  const edges = [
    ['left', horizontal],
    ['right', 1 - horizontal],
    ['top', vertical],
    ['bottom', 1 - vertical],
  ];
  const [position, distance] = edges.reduce((nearest, candidate) => (
    candidate[1] < nearest[1] ? candidate : nearest
  ));
  return distance <= edgeRatio ? position : 'center';
}

export function sanitizeWorkspace(value, knownSessionIds, ids) {
  const seenGroups = new Set();
  const seenTabs = new Set();

  function sanitize(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'group') {
      let groupId = typeof node.id === 'string' && node.id && !seenGroups.has(node.id) ? node.id : ids.group();
      seenGroups.add(groupId);
      const tabs = [];
      for (const candidate of Array.isArray(node.tabs) ? node.tabs : []) {
        if (!candidate || !knownSessionIds.has(candidate.sessionId)) continue;
        const tabId = typeof candidate.id === 'string' && candidate.id && !seenTabs.has(candidate.id) ? candidate.id : ids.tab();
        seenTabs.add(tabId);
        tabs.push({ id: tabId, sessionId: candidate.sessionId });
      }
      if (tabs.length === 0) return null;
      const activeTabId = tabs.some((tab) => tab.id === node.activeTabId) ? node.activeTabId : tabs[0].id;
      return createGroup(groupId, tabs, activeTabId);
    }
    if (node.type !== 'split' || !Array.isArray(node.children)) return null;
    const children = node.children.map(sanitize).filter(Boolean).slice(0, 2);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return {
      type: 'split',
      id: typeof node.id === 'string' && node.id ? node.id : ids.split(),
      direction: node.direction === 'vertical' ? 'vertical' : 'horizontal',
      ratio: Number.isFinite(node.ratio) ? Math.max(0.15, Math.min(0.85, node.ratio)) : 0.5,
      children,
    };
  }

  const root = sanitize(value?.root);
  if (!root) return createWorkspace(ids.group());
  const workspace = { root, activeGroupId: value?.activeGroupId };
  if (!findGroup(workspace, workspace.activeGroupId)) workspace.activeGroupId = groupsInOrder(root)[0].id;
  return workspace;
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.type === 'split') {
    return findNode(node.children[0], id) ?? findNode(node.children[1], id);
  }
  return null;
}

function replaceNode(node, targetGroupId, replacement) {
  if (node.type === 'group') return node.id === targetGroupId ? replacement : node;
  node.children = node.children.map((child) => replaceNode(child, targetGroupId, replacement));
  return node;
}

function collapseEmpty(node) {
  if (!node) return null;
  if (node.type === 'group') return node.tabs.length > 0 ? node : null;
  const children = node.children.map(collapseEmpty).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  node.children = children;
  return node;
}

function ensureWorkspaceGroup(workspace, createGroupId) {
  if (!workspace.root) workspace.root = createGroup(createGroupId());
  const groups = groupsInOrder(workspace.root);
  if (!groups.some((group) => group.id === workspace.activeGroupId)) {
    workspace.activeGroupId = groups[0].id;
  }
}
