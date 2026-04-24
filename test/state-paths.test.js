const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const { getStateDir, getSignalPath, getClickedPath, getClaimedPath, getSessionsPath } = require('../lib/state-paths');

test('getStateDir returns stable 12-char hex under ~/.claude/focus-state', () => {
  const dir = getStateDir('/Users/alice/proj');
  const base = path.join(os.homedir(), '.claude', 'focus-state');
  assert.ok(dir.startsWith(base + path.sep), `got ${dir}`);
  const hash = dir.slice((base + path.sep).length);
  assert.match(hash, /^[0-9a-f]{12}$/);
});

test('getStateDir is deterministic for the same workspace root', () => {
  assert.strictEqual(getStateDir('/Users/alice/proj'), getStateDir('/Users/alice/proj'));
});

test('getStateDir differs for different workspace roots', () => {
  assert.notStrictEqual(getStateDir('/Users/alice/proj'), getStateDir('/Users/alice/other'));
});

test('path helpers return files inside the state dir', () => {
  const root = '/Users/alice/proj';
  const dir = getStateDir(root);
  assert.strictEqual(getSignalPath(root), path.join(dir, 'signal'));
  assert.strictEqual(getClickedPath(root), path.join(dir, 'clicked'));
  assert.strictEqual(getClaimedPath(root), path.join(dir, 'claimed'));
  assert.strictEqual(getSessionsPath(root), path.join(dir, 'sessions'));
});

test('getStateDir handles Windows-style paths', () => {
  const dir = getStateDir('C:\\Users\\alice\\proj');
  assert.match(path.basename(dir), /^[0-9a-f]{12}$/);
});
