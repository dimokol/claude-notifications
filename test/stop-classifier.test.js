const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyStop, entryOrigin, asksUser, CLOSE_PHRASE } = require('../lib/stop-classifier');

const human = (text = 'do the thing') => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const peerWake = () => ({ type: 'user', isMeta: true, origin: { kind: 'peer', from: 'agent-chat' }, message: { role: 'user', content: 'AGENT CHAT INBOX NOTIFICATION. ...' } });
const taskWake = () => ({ type: 'attachment', attachment: { type: 'queued_command', origin: { kind: 'task-notification' }, prompt: '<task-notification>...' } });
const post = (input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__agent-chat__post', input }] } });
const stop = (msg, extra = {}) => ({ hook_event_name: 'Stop', last_assistant_message: msg, background_tasks: [], session_crons: [], ...extra });

test('pending background task means waiting, with its description', () => {
  const r = classifyStop(stop('started', { background_tasks: [{ type: 'shell', status: 'running', description: 'Run sleep 40' }] }), []);
  assert.deepEqual(r, { state: 'waiting', reason: 'background', detail: 'Run sleep 40' });
});

test('a scheduled cron alone means waiting', () => {
  const r = classifyStop(stop('later', { session_crons: [{ id: 'c1', prompt: 'check CI' }] }), []);
  assert.equal(r.state, 'waiting');
  assert.equal(r.reason, 'background');
});

test('background beats the close phrase', () => {
  const r = classifyStop(stop(`All set, CI still running. ${CLOSE_PHRASE}.`, { background_tasks: [{ description: 'x' }] }), []);
  assert.equal(r.state, 'waiting');
});

test('direct agent-chat post in this turn means waiting on that peer', () => {
  const r = classifyStop(stop('Posted, waiting.'), [human(), post({ room: 'r', from: 'me', to: 'tr-session', message: 'hi' })]);
  assert.deepEqual(r, { state: 'waiting', reason: 'peer', detail: 'reply from tr-session' });
});

test('a broadcast post (no to) does not count as waiting', () => {
  const r = classifyStop(stop('Posted.'), [human(), post({ room: 'r', from: 'me', message: 'fyi all' })]);
  assert.equal(r.state, 'needs-you');
});

test('a fyi direct post does not count as waiting (it wakes nobody)', () => {
  const r = classifyStop(stop('Posted.'), [human(), post({ room: 'r', from: 'me', to: 'x', fyi: true, message: 'fyi' })]);
  assert.equal(r.state, 'needs-you');
});

test('the peer replied after the post: the wait is over', () => {
  const r = classifyStop(stop('Converged, here is the summary.'), [human(), post({ to: 'tr' }), peerWake()]);
  assert.equal(r.state, 'needs-you');
});

test('post, then a background-agent wake, still waiting on the peer', () => {
  const r = classifyStop(stop('Agent done, still waiting on tr.'), [human(), post({ to: 'tr' }), taskWake()]);
  assert.equal(r.state, 'waiting');
  assert.equal(r.reason, 'peer');
});

test('post, peer reply, post again: waiting again', () => {
  const r = classifyStop(stop('Asked again.'), [human(), post({ to: 'tr' }), peerWake(), post({ to: 'tr' })]);
  assert.equal(r.state, 'waiting');
});

test('a post before the last human prompt does not count', () => {
  const r = classifyStop(stop('Done here.'), [human('a'), post({ to: 'tr' }), human('b')]);
  assert.equal(r.state, 'needs-you');
});

test('the close phrase means done, tolerant of curly apostrophe and case', () => {
  assert.equal(classifyStop(stop("All clean. Reply ok and I'll close this session."), []).state, 'done');
  assert.equal(classifyStop(stop('All clean. reply OK and I’ll close this session.'), []).state, 'done');
  assert.equal(classifyStop(stop("All clean. Reply ok and I'll close this session."), []).reason, 'close-phrase');
});

test('a plain finished turn is needs-you, detail is its first non-empty line', () => {
  const r = classifyStop(stop('\n\nHere is the result.\nMore lines.'), []);
  assert.deepEqual(r, { state: 'needs-you', reason: 'stop', detail: 'Here is the result.' });
});

test('missing or malformed fields fall through to needs-you instead of throwing', () => {
  assert.equal(classifyStop({}, undefined).state, 'needs-you');
  assert.equal(classifyStop({ background_tasks: 'nope', session_crons: null, last_assistant_message: 5 }, [null, 7]).state, 'needs-you');
});

test('detail is capped', () => {
  const r = classifyStop(stop('x'.repeat(500)), []);
  assert.ok(r.detail.length <= 120);
});

test('entryOrigin reads origin.kind on user entries and queued commands, ignores tool results', () => {
  assert.equal(entryOrigin(human()), 'human');
  assert.equal(entryOrigin(peerWake()), 'peer');
  assert.equal(entryOrigin(taskWake()), 'task-notification');
  assert.equal(entryOrigin({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null);
  assert.equal(entryOrigin({ type: 'assistant', message: { content: [] } }), null);
});

test('entryOrigin legacy fallback: plain non-meta text is human, tags and meta are not', () => {
  assert.equal(entryOrigin({ type: 'user', message: { content: 'please fix it' } }), 'human');
  assert.equal(entryOrigin({ type: 'user', message: { content: [{ type: 'text', text: 'please fix it' }] } }), 'human');
  assert.equal(entryOrigin({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }), null);
  assert.equal(entryOrigin({ type: 'user', isMeta: true, message: { content: 'Base directory for this skill' } }), null);
  assert.equal(entryOrigin({ type: 'user', isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation' } }), null);
});

test('a question for him beats a running background task (he decided: ask beats wait)', () => {
  const r = classifyStop(stop('Lily requested changes on #183.\nHer major point needs your call.', { background_tasks: [{ description: 'Watch CI' }] }), []);
  assert.deepEqual(r, { state: 'needs-you', reason: 'stop', detail: 'Her major point needs your call.' });
});

test('a question for him beats waiting on a peer', () => {
  const r = classifyStop(stop('Screens are built.\n\n**Your call:** should I go ahead with the browser shots now?'), [human(), post({ to: 'tr' })]);
  assert.equal(r.state, 'needs-you');
  assert.equal(r.detail, '**Your call:** should I go ahead with the browser shots now?');
});

test('a question plus the close phrase is needs-you: he still has to answer', () => {
  const r = classifyStop(stop(`Should I push now, or hold it?\n${CLOSE_PHRASE}.`), []);
  assert.equal(r.state, 'needs-you');
});

test('asksUser: question lines and direct asks near the end', () => {
  assert.equal(asksUser('Done.\nShould I push?'), true);
  assert.equal(asksUser('Done.\n1. **Store builds:** should I write the handoff?**'), true);
  assert.equal(asksUser('Done. I need your go to commit.'), true);
  assert.equal(asksUser('Still waiting on you: the round 1 questions.'), true);
  assert.equal(asksUser('**Decision for you:** A or B'), true);
  assert.equal(asksUser('Open question: which port'), true);
});

test('asksUser: the close phrase, early questions and code are not asks', () => {
  assert.equal(asksUser(`All merged. ${CLOSE_PHRASE}.`), false);
  assert.equal(asksUser('Waiting for the machine load to drop before running the build.'), false);
  assert.equal(asksUser('Why did it fail? The cache was stale.\n' + 'Fixed and verified, tests pass.\n'.repeat(40)), false);
  assert.equal(asksUser('Run this:\n```\nfoo --help?\n```\nThat is all.'), false);
  assert.equal(asksUser(''), false);
  assert.equal(asksUser(undefined), false);
});
