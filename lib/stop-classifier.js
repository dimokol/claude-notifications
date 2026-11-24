// lib/stop-classifier.js — decide what a finished main-session turn means for
// the user: needs-you, waiting, or done. Pure: Stop payload + the entries of
// the turn (from lib/transcript-turn.js) in, { state, reason, detail } out.
//
// Rules, first match wins (shared spec with Terminal Resume,
// docs/superpowers/specs/2026-11-18-session-attention-design.md in that repo):
//   0. The end of last_assistant_message asks him something -> needs-you/stop.
//      A turn often asks a question AND leaves a watcher running or waits on
//      a peer (replay: ~21% of background stops, ~39% of peer stops). He
//      decided the question wins; otherwise it stays hidden until the wait
//      ends, or forever if a peer never answers.
//   1. background_tasks or session_crons non-empty -> waiting/background.
//      Claude stopped only to wait for its own work; it wakes itself later.
//      Confirmed live on claude 2.1.326: the wake-up turn's Stop has [].
//   2. Since the last human prompt, the LAST direct (to, non-fyi) agent-chat
//      post has no peer wake after it -> waiting/peer. Checking for a wake
//      after the post matters: without it, a session that got its reply and
//      reported back would stay "waiting" until his next prompt.
//   3. last_assistant_message has the close phrase -> done/close-phrase.
//   4. One of the done phrases (self-close, nothing open, safe to close,
//      handed off) in the last 2 lines, and no ask anywhere in the message
//      -> done/done-phrase. A false done costs far more than a missed one,
//      so this rule is stricter than the close phrase: explicit wording only,
//      the whole message is checked for asks, and a sentence carrying a
//      condition or contrast ("once X", "but Y", "not safe to close") is out.
//   5. Otherwise needs-you/stop: a finished turn is his move.

const CLOSE_PHRASE = "Reply ok and I'll close this session";
const MAX_DETAIL = 120;
const AGENT_CHAT_POST = 'mcp__agent-chat__post';
// Only the end of the message counts: his working agreement puts questions
// last, and an early "why did it fail?" is narration, not an ask.
const ASK_TAIL_CHARS = 600;
const QUESTION_LINE = /\?[\s*_)"'`\u201d]*$/;
// His question format (grilling skill) puts a recommendation after the "?":
// "Ship it? I recommend yes." / "(Recommended: A)" / "Rec: A".
const QUESTION_THEN_REC = /\?[\s*_)"'`\u201d]*[(\-:]*\s*[*_]*\s*(i'?d? (recommend|suggest|lean)|recommend(ed|ation)?\b|rec\b|my (pick|vote|rec)\b|\u27a1)/;
const ASK_PHRASE = /\byour (go|call|pick|answer|answers|decision|input|review)\b|\bneeds? your\b|\bwaiting (on|for) you\b|\b(questions?|decisions?) for you\b|\bopen questions?\b|\b(q\d+|questions?)\b[^.]*\bstill open\b/i;
// A header line that is only "Questions" / "Decision(s) needed" etc.
const ASK_HEADER = /^[#*_\s]*(open |pending )?(questions?|decisions?( needed| to make| pending)?)[*_\s:]*$/;
// Grilling-skill markers: "❓ **Q1** - ..." question lines, "**Q2** - ..."
// lines (not "Q2 and Q3 noted"), and "➡️ <recommended answer>" lines when the message has a Q marker.
const GRILL_QUESTION = /^(\u2753|[*_]*q\d+[*_]*\s*[-\u2013\u2014:])/;
const GRILL_ANSWER = /^\u27a1/;
// The communication-tip skill appends "---\n**Tip:** ..." after everything,
// including questions. It never asks him anything, and it can be long enough
// to push the real questions out of the tail window.
const TIP_BLOCK = /\n\s*-{3,}\s*\n\s*[*_]*tip:?[*_]*:?\s[\s\S]*$/i;

// Done phrases, matched per sentence of the last 2 non-empty lines.
const SELF_CLOSE = /\b(this|the) (tab|session) (closes|will close|is closing)\b[^.]*?\b(when|once|as soon as|after|at the end of) this (turn|reply|message)( (ends|finishes|is done))?/;
const DONE_PHRASE = /\bnothing (else )?(is )?(left )?(open|pending)\b|\bno open loops?\b|\bsafe to close\b|\bhanded off to a (fresh|new) tab\b/;
// A condition or contrast in the same sentence means it isn't done yet.
const NOT_YET = /\b(once|when|after|until|as soon as|if|but|except|unless|not|never|no longer)\b|n't safe/;
// Asks his working agreement uses without a "?" or one of ASK_PHRASE's words.
// They block a done phrase only; optional offers ("say the word", "if you
// want, I can") don't.
const DONE_BLOCKER = /\bfor you to decide\b|\bdecide:|\bone ask\b|\bup to you\b|\bwaiting for your\b|\bstill needs? your\b|\bneeds? you\b|\byou('ll| will)? (still )?(need|have) to\b/;
const PATH_LINE = /^[`'"]?(\/|~\/|file:\/\/)\S*[`'"]?$/;

function normalize(s) {
  return s.replace(/[‘’]/g, "'").toLowerCase();
}

function cap(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  return t.length > MAX_DETAIL ? t.slice(0, MAX_DETAIL - 1) + '…' : t;
}

function firstLine(s) {
  if (typeof s !== 'string') return '';
  const line = s.split('\n').find(l => l.trim() !== '');
  return cap(line || '');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => (b && typeof b.text === 'string') ? b.text : '').join(' ');
}

/** The line of the message's tail that asks him something, or ''. Code
 *  blocks, a trailing Tip block and the close phrase (itself a request, but
 *  for "done") are skipped. */
function stripNoise(msg) {
  return msg.replace(/```[\s\S]*?```/g, '').replace(TIP_BLOCK, '');
}

function askLine(msg, whole = false) {
  if (typeof msg !== 'string' || !msg) return '';
  const withoutCode = stripNoise(msg);
  const grilled = /\u2753|^[*_]*q\d+\b/im.test(withoutCode);
  const tail = whole ? withoutCode : withoutCode.slice(-ASK_TAIL_CHARS);
  const lines = tail.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = normalize(lines[i]).replace(normalize(CLOSE_PHRASE), '');
    if (QUESTION_LINE.test(line) || QUESTION_THEN_REC.test(line) || ASK_PHRASE.test(line)
      || ASK_HEADER.test(line) || GRILL_QUESTION.test(line) || (grilled && GRILL_ANSWER.test(line))) {
      return lines[i];
    }
  }
  return '';
}

/** The line of the last 2 that says the session is finished, or ''. */
function doneLine(msg) {
  if (typeof msg !== 'string' || !msg) return '';
  const text = stripNoise(msg);
  if (askLine(text, true) || DONE_BLOCKER.test(normalize(text))) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !PATH_LINE.test(l));
  for (const line of lines.slice(-2)) {
    for (const sentence of normalize(line).split(/(?<=[.!?:;])\s+/)) {
      const self = SELF_CLOSE.test(sentence);
      const rest = sentence.replace(SELF_CLOSE, 'closes');
      if ((self || DONE_PHRASE.test(rest)) && !NOT_YET.test(rest)) return line;
    }
  }
  return '';
}

function asksUser(msg) {
  return askLine(msg) !== '';
}

/**
 * Who started this entry: 'human' | 'peer' | 'task-notification' | other kind
 * string, or null when the entry isn't a turn trigger (assistant output, tool
 * results, skill bodies, compaction summaries). Current Claude Code tags user
 * entries and queued commands with origin.kind; untagged entries fall back to
 * "plain, non-meta text is a human prompt".
 */
function entryOrigin(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type === 'attachment') {
    const a = entry.attachment;
    if (!a || a.type !== 'queued_command') return null;
    return (a.origin && typeof a.origin.kind === 'string') ? a.origin.kind : null;
  }
  if (entry.type !== 'user' || entry.isSidechain) return null;
  const content = entry.message && entry.message.content;
  if (Array.isArray(content) && content.some(b => b && b.type === 'tool_result')) return null;
  if (entry.origin && typeof entry.origin.kind === 'string') return entry.origin.kind;
  if (entry.isMeta || entry.isCompactSummary) return null;
  const text = textOf(content).trim();
  if (!text || text.startsWith('<')) return null;
  return 'human';
}

function directPostTarget(entry) {
  if (!entry || entry.type !== 'assistant' || entry.isSidechain) return '';
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return '';
  let target = '';
  for (const b of content) {
    if (!b || b.type !== 'tool_use' || b.name !== AGENT_CHAT_POST) continue;
    const input = b.input || {};
    // fyi mail wakes nobody, so nobody is expected to answer it.
    if (typeof input.to === 'string' && input.to && input.fyi !== true) target = input.to;
  }
  return target;
}

function pendingPeer(entries) {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entryOrigin(entries[i]) === 'human') { start = i; break; }
  }
  let waitingOn = '';
  for (let i = start; i < entries.length; i++) {
    const to = directPostTarget(entries[i]);
    if (to) { waitingOn = to; continue; }
    if (waitingOn && entryOrigin(entries[i]) === 'peer') waitingOn = '';
  }
  return waitingOn;
}

/**
 * @param {object} payload Stop hook stdin
 * @param {object[]} entries transcript entries of the turn (may be empty)
 */
function classifyStop(payload, entries) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const msg = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : '';
  const ask = askLine(msg);
  if (ask) return { state: 'needs-you', reason: 'stop', detail: cap(ask) };

  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  const crons = Array.isArray(p.session_crons) ? p.session_crons : [];
  if (tasks.length > 0 || crons.length > 0) {
    const first = tasks.find(t => t && t.description) || crons.find(c => c && (c.prompt || c.description));
    const detail = first ? cap(first.description || first.prompt) : '';
    return { state: 'waiting', reason: 'background', detail };
  }

  const peer = pendingPeer(Array.isArray(entries) ? entries.filter(e => e && typeof e === 'object') : []);
  if (peer) return { state: 'waiting', reason: 'peer', detail: cap(`reply from ${peer}`) };

  if (normalize(msg).includes(normalize(CLOSE_PHRASE))) {
    return { state: 'done', reason: 'close-phrase', detail: firstLine(msg) };
  }
  const finished = doneLine(msg);
  if (finished) return { state: 'done', reason: 'done-phrase', detail: cap(finished) };
  return { state: 'needs-you', reason: 'stop', detail: firstLine(msg) };
}

module.exports = { classifyStop, entryOrigin, asksUser, CLOSE_PHRASE, MAX_DETAIL };
