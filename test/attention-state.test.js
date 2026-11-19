const { sandboxHome } = require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getAttentionDir, getAttentionPath, readAttentionState, writeAttentionState, shouldNotifyTransition } = require('../lib/attention-state');

test('the state dir lives under ~/.claude-shared/session-attention', () => {
  assert.equal(getAttentionDir(), path.join(sandboxHome, '.claude-shared', 'session-attention'));
});

test('writes the spec format whole, readable back', () => {
  const r = writeAttentionState('s-1', { state: 'needs-you', reason: 'stop', detail: 'hi', cwd: '/p', configDir: '/c', claudePid: 9, shellPid: 8, transcriptPath: '/t' }, { now: 1000 });
  assert.equal(r.written, true);
  const s = readAttentionState('s-1');
  assert.deepEqual(s, {
    v: 1, sessionId: 's-1', agent: 'claude', state: 'needs-you', reason: 'stop', detail: 'hi',
    cwd: '/p', configDir: '/c', claudePid: 9, shellPid: 8, transcriptPath: '/t',
    updatedAt: new Date(1000).toISOString()
  });
  assert.deepEqual(fs.readdirSync(getAttentionDir()).filter(n => n.includes('.tmp')), []);
});

test('an event without pids keeps the ones already in the file', () => {
  writeAttentionState('s-2', { state: 'needs-you', reason: 'stop', claudePid: 5, shellPid: 4, cwd: '/p' }, { now: 1000 });
  writeAttentionState('s-2', { state: 'working', reason: 'prompt' }, { now: 2000 });
  const s = readAttentionState('s-2');
  assert.equal(s.state, 'working');
  assert.equal(s.claudePid, 5);
  assert.equal(s.shellPid, 4);
  assert.equal(s.cwd, '/p');
  assert.equal(s.detail, '');
});

test('a write older than the file is dropped (async hook finishing late)', () => {
  writeAttentionState('s-3', { state: 'working', reason: 'prompt' }, { now: 5000 });
  const r = writeAttentionState('s-3', { state: 'needs-you', reason: 'stop' }, { now: 4000 });
  assert.equal(r.written, false);
  assert.equal(readAttentionState('s-3').state, 'working');
});

test('returns the previous state', () => {
  writeAttentionState('s-4', { state: 'working', reason: 'prompt' }, { now: 1 });
  const r = writeAttentionState('s-4', { state: 'done', reason: 'close-phrase' }, { now: 2 });
  assert.equal(r.previous.state, 'working');
});

test('unsafe or empty session ids are refused', () => {
  assert.equal(getAttentionPath('../evil'), null);
  assert.equal(getAttentionPath(''), null);
  assert.equal(writeAttentionState('../evil', { state: 'working' }).written, false);
  assert.equal(readAttentionState('nope-missing'), null);
});

test('notify only on entering needs-you or done', () => {
  const s = (state, reason) => ({ state, reason });
  assert.equal(shouldNotifyTransition(s('working', 'prompt'), s('needs-you', 'stop')), true);
  assert.equal(shouldNotifyTransition(s('working', 'prompt'), s('done', 'close-phrase')), true);
  assert.equal(shouldNotifyTransition(s('working', 'prompt'), s('waiting', 'background')), false);
  assert.equal(shouldNotifyTransition(null, s('needs-you', 'stop')), true);
  assert.equal(shouldNotifyTransition(s('waiting', 'background'), s('needs-you', 'stop')), true);
  assert.equal(shouldNotifyTransition(s('needs-you', 'question'), s('needs-you', 'stop')), true);
});

test('a repeated Stop-derived state (wake-up turns with no prompt between) stays silent', () => {
  const s = (state, reason) => ({ state, reason });
  assert.equal(shouldNotifyTransition(s('needs-you', 'stop'), s('needs-you', 'stop')), false);
  assert.equal(shouldNotifyTransition(s('done', 'close-phrase'), s('done', 'close-phrase')), false);
  assert.equal(shouldNotifyTransition(s('needs-you', 'stop'), s('done', 'close-phrase')), true);
});

test('permission and question repeats are left to stage dedup (back-to-back questions must notify)', () => {
  const s = (state, reason) => ({ state, reason });
  assert.equal(shouldNotifyTransition(s('needs-you', 'question'), s('needs-you', 'question')), true);
  assert.equal(shouldNotifyTransition(s('needs-you', 'permission'), s('needs-you', 'permission')), true);
});
