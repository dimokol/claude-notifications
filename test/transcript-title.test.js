const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readAiTitle } = require('../lib/transcript-title');

function tmpFile(contents) {
  const p = path.join(os.tmpdir(), `transcript-title-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, contents);
  return p;
}

test('readAiTitle returns null for missing path', () => {
  assert.strictEqual(readAiTitle(''), null);
  assert.strictEqual(readAiTitle(null), null);
  assert.strictEqual(readAiTitle(undefined), null);
});

test('readAiTitle returns null when file does not exist', () => {
  assert.strictEqual(readAiTitle('/no/such/transcript.jsonl'), null);
});

test('readAiTitle returns null for empty file', () => {
  const p = tmpFile('');
  try {
    assert.strictEqual(readAiTitle(p), null);
  } finally {
    fs.unlinkSync(p);
  }
});

test('readAiTitle returns null when no ai-title records present', () => {
  const p = tmpFile(
    '{"type":"user","message":"hi"}\n' +
    '{"type":"assistant","message":"hello"}\n'
  );
  try {
    assert.strictEqual(readAiTitle(p), null);
  } finally {
    fs.unlinkSync(p);
  }
});
