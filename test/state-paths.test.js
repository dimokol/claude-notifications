const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const { getStateDir, getSignalPath, getClickedPath, getClaimedPath, getSessionsPath, hashWorkspace, normalizeWorkspaceRoot } = require('../lib/state-paths');

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

// Every plausible representation of one workspace must hash to the same
// state-directory. On Windows, hook.js receives forward-slash uppercase-drive
// paths via CLAUDE_PROJECT_DIR while VS Code returns backslash lowercase-drive
// paths via folder.uri.fsPath. Pre-fix (v3.3.1) the two diverged silently, so
// the extension polled an empty directory and never saw any signal.
test('hashWorkspace is invariant across slash style and drive case (Windows)', () => {
  if (process.platform !== 'win32') return;
  const variants = [
    'C:/WebDev/claude-notifications',
    'c:/WebDev/claude-notifications',
    'C:\\WebDev\\claude-notifications',
    'c:\\WebDev\\claude-notifications',
    'c:\\WebDev\\claude-notifications\\',
    'C:/WebDev/claude-notifications/',
  ];
  const hashes = new Set(variants.map(hashWorkspace));
  assert.strictEqual(hashes.size, 1, `expected one hash, got ${hashes.size}: ${[...hashes].join(', ')}`);
});

test('hashWorkspace is invariant across trailing slash (POSIX)', () => {
  assert.strictEqual(hashWorkspace('/Users/alice/proj'), hashWorkspace('/Users/alice/proj/'));
});

test('hashWorkspace separates distinct workspaces on Windows even when only case differs in path', () => {
  if (process.platform !== 'win32') return;
  // Drive letter is canonicalized, but path body case is preserved (Windows
  // file systems are case-insensitive but case-preserving — we don't try to
  // canonicalize paths the user actually wrote).
  assert.notStrictEqual(hashWorkspace('c:/WebDev/proj'), hashWorkspace('c:/webdev/proj'));
});

test('normalizeWorkspaceRoot is a no-op on already-canonical POSIX paths', () => {
  if (process.platform === 'win32') return;
  assert.strictEqual(normalizeWorkspaceRoot('/Users/alice/proj'), '/Users/alice/proj');
});

test('normalizeWorkspaceRoot preserves "/" root', () => {
  assert.strictEqual(normalizeWorkspaceRoot('/'), '/');
});
