import assert from 'node:assert/strict';
import test from 'node:test';

import { addRecentPath, nextNumericSessionName, sessionPathOptions } from './session-create.js';

test('uses the smallest unused canonical numeric session name', () => {
  assert.equal(nextNumericSessionName([]), '0');
  assert.equal(nextNumericSessionName([{ name: '0' }, { name: '2' }, { name: '01' }, { name: 'work' }]), '1');
});

test('keeps recent paths first and adds live session paths without duplicates', () => {
  assert.deepEqual(sessionPathOptions(
    ['/srv/recent', '/srv/shared'],
    [{ path: '/srv/shared' }, { path: '/srv/live' }, { path: 'relative' }],
  ), ['/srv/recent', '/srv/shared', '/srv/live']);
});

test('moves a reused path to the front and enforces the history limit', () => {
  assert.deepEqual(addRecentPath(['/a', '/b', '/c'], '/b', 3), ['/b', '/a', '/c']);
  assert.deepEqual(addRecentPath(['/a', '/b', '/c'], '/d', 3), ['/d', '/a', '/b']);
  assert.deepEqual(addRecentPath(['/a'], 'relative', 3), ['/a']);
});
