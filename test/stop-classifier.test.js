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

test('real ending: numbered "? I recommend yes." questions plus a Tip block beat a running viewer server', () => {
  const msg = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'stop-ending-recommend-questions.txt'), 'utf8');
  const r = classifyStop(stop(msg, { background_tasks: [{ description: 'Start the viewer server on 127.0.0.1:3029 again' }] }), []);
  assert.equal(r.state, 'needs-you');
  assert.equal(r.reason, 'stop');
  assert.match(r.detail, /^3\. Once round 1 is through the pipeline/);
});

test('asksUser: a question followed only by a recommendation', () => {
  assert.equal(asksUser('Done.\n1. Can I go ahead? I recommend yes.'), true);
  assert.equal(asksUser('Done.\n1. Can I go ahead? I\'d recommend yes, because it is cheap.'), true);
  assert.equal(asksUser('Done.\n2. Port 3029 or 3030? (Recommended: 3029)'), true);
  assert.equal(asksUser('Done.\n2. Port 3029 or 3030? Recommended: 3029.'), true);
  assert.equal(asksUser('Done.\n2. Port 3029 or 3030? **Rec:** 3029'), true);
  assert.equal(asksUser('Done.\n2. Port 3029 or 3030? My pick: 3029.'), true);
  assert.equal(asksUser('Done.\n2. Port 3029 or 3030? I suggest 3029.'), true);
});

test('asksUser: a trailing Tip block neither hides the questions nor counts as one', () => {
  const qs = 'Built it.\n\n**Questions**\n1. Ship it now? I recommend yes.\n';
  const tip = '\n---\n**Tip:** ' + 'you could paste the exact view next time, which saves a guess. '.repeat(8);
  assert.equal(asksUser(qs + tip), true);
  assert.equal(asksUser('All tests pass and the build is clean.\n\n---\n**Tip:** why not try "rec" next time?'), false);
});

test('asksUser: a bare Questions / Decisions header in the tail', () => {
  assert.equal(asksUser('Built it.\n\n**Questions**\n1. Pick the port. I lean to 3029.'), true);
  assert.equal(asksUser('Built it.\n\n## Questions\n- port number, 3029 by default'), true);
  assert.equal(asksUser('Built it.\n\nDecision needed:\nA or B, I lean A.'), true);
  assert.equal(asksUser('Built it.\n\n**Decisions**\n1. Port: 3029 or 3030.'), true);
});

test('asksUser: grilling-skill markers', () => {
  assert.equal(asksUser('❓ **Q1** - **Port**: which port should the viewer use. Options are 3029 and 3030.\n\n➡️ 3029, it is free.'), true);
  assert.equal(asksUser('Context first.\n\n**Q2** - **Branch**: worktree or same checkout.\n\n➡️ Worktree.'), true);
});

test('asksUser: recommendations and headers outside a question are not asks', () => {
  assert.equal(asksUser('Fixed it. I recommend restarting VS Code so the hook reloads.'), false);
  assert.equal(asksUser('Why did it fail? The cache was stale. Fixed and verified.'), false);
  assert.equal(asksUser('Done.\n\n**Questions answered**\n- port: 3029 (you picked it)'), false);
  assert.equal(asksUser('Next ➡️ deploy runs after CI, nothing needed from you.'), false);
});

test('asksUser: replay false positives stay quiet (Q references, quoted "your turn")', () => {
  assert.equal(asksUser('Q2 and Q3 noted: logs stay off the PC for now.\n\nOnce 032 is back, I will bring the list.'), false);
  assert.equal(asksUser('**Q4, done, and it failed again** with the same error.'), false);
  assert.equal(asksUser('One refusal came from my test prompt ("join, then end your turn"), which Codex misread.'), false);
});

test('asksUser: earlier questions still open', () => {
  assert.equal(asksUser('Built the page.\n\nQ1 to Q11 from my last message are still open.'), true);
  assert.equal(asksUser('Built the page.\n\nThe two questions above are still open.'), true);
  assert.equal(asksUser('Built the page. PR #12 is still open.'), false);
});

// Real closing messages (2026-11-19) that list open loops needing his go. He
// wants these marked needs-you: a merge or install he misses is lost work.
// Done (the close mark) only when the session needs nothing more from him.
test('"needs your go" beats the close phrase, even in an open-loops list', () => {
  const endings = [
    'Everything here is done: the classifier fix is merged and nothing is pushed. The only open item is still installing a new VSIX so your live sessions get the fix, and that needs your go.',
    'Committing that snapshot, marking the PRs ready, merging and removing the worktrees each still need your go.\n\n**Status:** I removed the test folders.',
    '2. Install the VSIX. Each needs your go. You upload to the Marketplace yourself.\n\n**Cleaned up:** the temporary hook.',
    '3. The git guard wouldn\'t let me delete it without your go. Say "delete it" if you want it gone.\n4. Check the lost-drafts session\'s own tab for its result.',
    '**Open loops**, all waiting on the PC:\n- Switching your live Mac files to the published versions. This changes how the pressure row looks, so it needs your go.',
  ];
  for (const e of endings) {
    const r = classifyStop(stop(`${e}\n\n${CLOSE_PHRASE}.`), []);
    assert.equal(r.state, 'needs-you', e);
    assert.equal(r.reason, 'stop');
  }
});

test('a grilling question plus the close phrase is still needs-you', () => {
  const r = classifyStop(stop(`Done.\n\n❓ **Q1** - Merge now\n➡️ yes\n\n${CLOSE_PHRASE}.`), []);
  assert.equal(r.state, 'needs-you');
});

test('without the close phrase, "needs your go" is still an ask', () => {
  assert.equal(classifyStop(stop('Built. Pushing it needs your go.'), []).state, 'needs-you');
});

// Done endings beyond the close phrase (2026-11-24). Explicit phrases only,
// in the last 2 non-empty lines, and no ask anywhere in the message.
const done = (msg) => classifyStop(stop(msg), []);

test('done endings: self-close, nothing open, safe to close, handoff', () => {
  for (const msg of [
    'Cleaned up the worktree.\n\nThis tab closes when this reply ends.',
    'Release is live.\n\nNothing else is open: 2.1.323 is verified. This tab closes when this turn ends.',
    'Removed the mocks.\nThis session closes when this turn ends.',
    'This tab closes when this reply finishes.',
    'Done. This tab closes as soon as this message ends.',
    'All committed.\n\nNo open loops left in this session.',
    'Docs updated.\n\nNothing is left open here.',
    'The sleep finished with exit code 0. Nothing else is pending.',
    'Safe to close. Nothing is open from this session.',
    'Everything is saved in docs/, so this session is safe to close.',
    'Handed off to a fresh tab.\n/Users/dimokol/.claude-shared/state/handoffs/2026-11-24-1200-abc.md',
    'I handed off to a new tab, and this session closes when this turn ends.',
  ]) {
    assert.deepEqual(done(msg).state, 'done', msg);
    assert.equal(done(msg).reason, 'done-phrase', msg);
  }
});

test('done endings: a trailing path or Tip block does not push the phrase out', () => {
  assert.equal(done('Work saved.\n\nNothing is left open here.\n\n---\n**Tip:** say what you want first.').state, 'done');
  assert.equal(done('Nothing is open on my side.\n/Users/dimokol/x/report.md').state, 'done');
});

test('done endings: detail is the line with the phrase', () => {
  assert.equal(done('Long report first.\n\nThis tab closes when this reply ends.').detail, 'This tab closes when this reply ends.');
});

test('done endings: the phrase must be in the last 2 lines', () => {
  assert.equal(done('This tab is safe to close once the new session posts.\n1. Storage\n2. Full Disk Access\n3. spawn-session').state, 'needs-you');
  assert.equal(done('```\nprompt: tell him the old tab is safe to close\n```\nThis prompt covers only my session.').state, 'needs-you');
});

test('done endings: any ask anywhere in the message blocks done', () => {
  for (const msg of [
    '**For you to decide:** I can add one line to your CLAUDE.md.\n\nThis session closes when this turn ends.',
    'All saved, safe to close.\n\n**One ask:** paste what you sent to Ada.',
    'Should I also delete the branch?\n\nA lot more text here.\n'.padEnd(900, 'x') + '\nNothing else is open.',
    'Whether to ship is your call.\nNothing else is open.',
    'The merge is up to you.\nNo open loops.',
    'The PRs still need your go. This session is safe to close.',
    'Still waiting for your review of #12.\nNothing is left open here.',
    'Decide: A or B.\nNothing else is open.',
    // Replay 2026-11-24: a sibling session still waited on him.
    'The design session still needs you to paste the resume command from my last message. Nothing else is open from this session, so you can close it.',
    'You still need to run the migration.\nNothing else is open.',
    'You\'ll have to approve the PR.\nNo open loops.',
  ]) assert.equal(done(msg).state, 'needs-you', msg);
});

test('done endings: an optional offer does not block done', () => {
  assert.equal(done('Cleanup finished. If you want more room, say the word and I\'ll ask that session.\nThe session is safe to close.').state, 'done');
  assert.equal(done('If you want, I can delete the remote branch later.\nNothing else is open.').state, 'done');
});

test('done endings: negations and plans are not done', () => {
  for (const msg of [
    'Not safe to close yet: the build is still running.',
    'It is not safe to close this tab.',
    'Once the PR merges, nothing is left open.\nI will report back.',
    'There are open loops left.',
    'Nothing is left open on the server side, but the client still fails.\nI need to look at the client next.',
  ]) assert.equal(done(msg).state, 'needs-you', msg);
});

test('done endings: background work and a pending peer still win', () => {
  assert.equal(classifyStop(stop('Nothing else is open.', { background_tasks: [{ description: 'x' }] }), []).state, 'waiting');
  assert.equal(classifyStop(stop('Nothing else is open.'), [human(), post({ room: 'r', from: 'me', to: 'p', message: 'hi' })]).state, 'waiting');
});
