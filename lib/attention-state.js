// lib/attention-state.js — the per-session state file shared with Terminal
// Resume: ~/.claude-shared/session-attention/<sessionId>.json. Terminal Resume
// draws the tab mark from it; we notify from the same transition, so the tab
// and the banner can't disagree. Format (v1) is owned by that repo's spec;
// renaming or removing a field breaks its reader, adding one is safe.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CARRY_OVER = ['cwd', 'configDir', 'claudePid', 'shellPid', 'transcriptPath'];
const NOTIFY_STATES = new Set(['needs-you', 'done']);
// Reasons a Stop produces. A repeat of the same one means a wake-up turn with
// no prompt in between (another background agent finished), not news.
const STOP_REASONS = new Set(['stop', 'close-phrase', 'done-phrase']);

function getAttentionDir() {
  return path.join(os.homedir(), '.claude-shared', 'session-attention');
}

function getAttentionPath(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) return null;
  return path.join(getAttentionDir(), `${sessionId}.json`);
}

function readAttentionState(sessionId) {
  const p = getAttentionPath(sessionId);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

/**
 * Write the whole file (tmp + rename). Drops the write when the file already
 * holds a newer event: Stop/PermissionRequest hooks run async, so one can
 * finish after the next prompt's synchronous write.
 * @returns {{written: boolean, previous: object|null}}
 */
function writeAttentionState(sessionId, fields, { now = Date.now() } = {}) {
  const p = getAttentionPath(sessionId);
  if (!p) return { written: false, previous: null };
  const previous = readAttentionState(sessionId);
  if (previous && Date.parse(previous.updatedAt) > now) return { written: false, previous };

  const f = fields || {};
  const state = {
    v: 1,
    sessionId,
    agent: 'claude',
    state: f.state,
    reason: f.reason || '',
    detail: f.detail || ''
  };
  for (const key of CARRY_OVER) {
    const value = f[key] !== undefined && f[key] !== null && f[key] !== '' && f[key] !== 0
      ? f[key]
      : (previous ? previous[key] : undefined);
    if (value !== undefined) state[key] = value;
  }
  state.updatedAt = new Date(now).toISOString();

  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, p);
    return { written: true, previous };
  } catch (_) {
    return { written: false, previous };
  }
}

/** Notify only when entering needs-you or done. Question/permission repeats
 *  pass through: back-to-back questions are real and stage dedup handles the
 *  platform's duplicate events. */
function shouldNotifyTransition(previous, next) {
  if (!next || !NOTIFY_STATES.has(next.state)) return false;
  if (previous && previous.state === next.state && previous.reason === next.reason && STOP_REASONS.has(next.reason)) {
    return false;
  }
  return true;
}

module.exports = { getAttentionDir, getAttentionPath, readAttentionState, writeAttentionState, shouldNotifyTransition };
