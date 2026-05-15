const { test } = require('node:test');
const assert = require('node:assert');
const { parseSignal } = require('../lib/signals');

test('parseSignal v2 returns aiTitle when present', () => {
  const content = JSON.stringify({
    version: 2,
    event: 'completed',
    sessionId: 's1',
    project: 'demo',
    pids: [1234],
    aiTitle: 'Refactor router',
    timestamp: Date.now()
  });
  const parsed = parseSignal(content);
  assert.strictEqual(parsed.aiTitle, 'Refactor router');
});

test('parseSignal v2 returns aiTitle="" when missing', () => {
  const content = JSON.stringify({
    version: 2,
    event: 'completed',
    sessionId: 's1',
    project: 'demo',
    pids: [1234],
    timestamp: Date.now()
  });
  const parsed = parseSignal(content);
  assert.strictEqual(parsed.aiTitle, '');
});

test('parseSignal v2 coerces non-string aiTitle to ""', () => {
  const content = JSON.stringify({
    version: 2,
    event: 'completed',
    sessionId: 's1',
    project: 'demo',
    pids: [1234],
    aiTitle: 42,
    timestamp: Date.now()
  });
  const parsed = parseSignal(content);
  assert.strictEqual(parsed.aiTitle, '');
});
