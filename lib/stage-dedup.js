// lib/stage-dedup.js — acknowledgment-based notification dedup.
// Each (sessionId) has a stageId that advances on: user prompt, or
// previous stage resolved. shouldNotify returns {notify:false} when
// the current event is a re-fire of an already-notified-and-unresolved
// stage. Event type is *not* a stage boundary: Claude Code commonly
// emits Stop("completed") and Notification("waiting") seconds apart for
// the same logical attention point, and treating them as separate
// stages causes a duplicate banner.
const fs = require('fs');
const path = require('path');
const { getStateDir, getSessionsPath } = require('./state-paths');

const SESSIONS_PRUNE_MS = 60 * 60 * 1000; // 1h

// Escape valve for same-stage suppression. Claude Code emits Stop+Notification
// pairs ~100ms apart for the same attention point — we want those to collapse.
// But AskUserQuestion (and other delayed Notifications) currently land inside
// the same unresolved stage with no upstream ack hook (anthropics/claude-code
// #15872), so they get silently swallowed. If more than STAGE_ESCAPE_VALVE_MS
// has elapsed since the last notification for this stage, treat the event as
// the start of a new stage and notify. 3s is comfortably larger than every
// duplicate burst observed historically (≤200ms typical, ~1–2s worst case in
// the dafb73f-era notes) while still well under the time Claude needs to do
// any real work before the next genuine wait.
//
// **Revert path:** when issue #15872 ships and PostToolUse fires for
// AskUserQuestion, drop this constant and the escape branch in shouldNotify;
// instead install a PostToolUse hook that calls advanceOnPrompt on tool
// completion. See CLAUDE.md "Known limitations" for the full revert plan.
const STAGE_ESCAPE_VALVE_MS = 3000;

function ensureDir(workspaceRoot) {
  const dir = getStateDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSessions(workspaceRoot) {
  const p = getSessionsPath(workspaceRoot);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (data && typeof data === 'object') ? data : {};
  } catch (_) {
    return {};
  }
}

function writeSessions(workspaceRoot, map) {
  ensureDir(workspaceRoot);
  const now = Date.now();
  for (const key of Object.keys(map)) {
    const u = map[key] && map[key].updatedAt;
    if (typeof u === 'number' && now - u > SESSIONS_PRUNE_MS) delete map[key];
  }
  try {
    fs.writeFileSync(getSessionsPath(workspaceRoot), JSON.stringify(map));
  } catch (_) {}
}

function shouldNotify(workspaceRoot, sessionId, currentEvent) {
  // No session id → can't dedup safely; always notify.
  if (!sessionId) return { notify: true, stageId: null };

  const map = readSessions(workspaceRoot);
  const now = Date.now();
  let entry = map[sessionId];

  if (!entry) {
    entry = { stageId: 1, lastEvent: currentEvent, resolved: false, lastNotifiedAt: now, updatedAt: now };
    map[sessionId] = entry;
    writeSessions(workspaceRoot, map);
    return { notify: true, stageId: 1 };
  }

  // Fresh stage from a UserPromptSubmit: lastEvent===null means no notification has been fired yet for this stage.
  if (entry.lastEvent === null) {
    entry.lastEvent = currentEvent;
    entry.resolved = false;
    entry.lastNotifiedAt = now;
    entry.updatedAt = now;
    writeSessions(workspaceRoot, map);
    return { notify: true, stageId: entry.stageId };
  }

  if (entry.resolved === true) {
    entry.stageId = (entry.stageId || 0) + 1;
    entry.lastEvent = currentEvent;
    entry.resolved = false;
    entry.lastNotifiedAt = now;
    entry.updatedAt = now;
    writeSessions(workspaceRoot, map);
    return { notify: true, stageId: entry.stageId };
  }

  // Escape valve: if the last notification for this stage was long enough
  // ago, this event can't be part of the original Stop/Notification burst —
  // it's a genuinely new wait (typically AskUserQuestion arriving after
  // Claude finished a tool call). Treat as a new stage.
  const lastAt = entry.lastNotifiedAt || 0;
  if (now - lastAt > STAGE_ESCAPE_VALVE_MS) {
    entry.stageId = (entry.stageId || 0) + 1;
    entry.lastEvent = currentEvent;
    entry.resolved = false;
    entry.lastNotifiedAt = now;
    entry.updatedAt = now;
    writeSessions(workspaceRoot, map);
    return { notify: true, stageId: entry.stageId };
  }

  // Unresolved stage, fresh burst → re-fire of an already-notified stage.
  // Track the latest event type so the signal file/UI reflects current
  // state, but suppress the notification.
  entry.lastEvent = currentEvent;
  entry.updatedAt = now;
  writeSessions(workspaceRoot, map);
  return { notify: false, stageId: entry.stageId };
}

function advanceOnPrompt(workspaceRoot, sessionId) {
  if (!sessionId) return;
  const map = readSessions(workspaceRoot);
  const now = Date.now();
  const entry = map[sessionId] || { stageId: 0, lastEvent: null, resolved: false, lastNotifiedAt: 0, updatedAt: now };
  entry.stageId = (entry.stageId || 0) + 1;
  entry.lastEvent = null;
  entry.resolved = false;
  entry.updatedAt = now;
  map[sessionId] = entry;
  writeSessions(workspaceRoot, map);
}

function markResolved(workspaceRoot, sessionId) {
  if (!sessionId) return;
  const map = readSessions(workspaceRoot);
  const entry = map[sessionId];
  if (!entry) return;
  entry.resolved = true;
  entry.updatedAt = Date.now();
  writeSessions(workspaceRoot, map);
}

module.exports = {
  SESSIONS_PRUNE_MS,
  STAGE_ESCAPE_VALVE_MS,
  shouldNotify,
  advanceOnPrompt,
  markResolved,
  _readSessions: readSessions
};
