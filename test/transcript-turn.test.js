const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTurnEntries } = require('../lib/transcript-turn');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-turn-'));
const line = (o) => JSON.stringify(o) + '\n';
const human = (t) => ({ type: 'user', origin: { kind: 'human' }, message: { content: t } });
const asst = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });

test('returns entries from the last human prompt to the end', () => {
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, line(human('one')) + line(asst('r1')) + line(human('two')) + line(asst('r2')));
  const entries = readTurnEntries(f);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message.content, 'two');
});

test('finds the human prompt across small chunks, skipping a torn first line', () => {
  const f = path.join(dir, 'b.jsonl');
  let body = line(human('start'));
  for (let i = 0; i < 200; i++) body += line(asst('filler ' + 'x'.repeat(100)));
  fs.writeFileSync(f, body);
  const entries = readTurnEntries(f, { chunkBytes: 1024 });
  assert.equal(entries.length, 201);
  assert.equal(entries[0].message.content, 'start');
});

test('with no human prompt inside the cap, returns what it read', () => {
  const f = path.join(dir, 'c.jsonl');
  let body = line(human('old'));
  for (let i = 0; i < 100; i++) body += line(asst('y'.repeat(100)));
  fs.writeFileSync(f, body);
  const entries = readTurnEntries(f, { chunkBytes: 512, maxBytes: 2048 });
  assert.ok(entries.length > 0 && entries.length < 101);
  assert.ok(entries.every(e => e.type === 'assistant'));
});

test('missing file or junk lines never throw', () => {
  assert.deepEqual(readTurnEntries(path.join(dir, 'nope.jsonl')), []);
  const f = path.join(dir, 'd.jsonl');
  fs.writeFileSync(f, 'not json\n' + line(human('h')) + '{broken\n' + line(asst('a')));
  assert.equal(readTurnEntries(f).length, 2);
});
