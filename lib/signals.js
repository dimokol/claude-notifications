// lib/signals.js — signal-file parsing + atomic claim marker.
// Path derivation moved to lib/state-paths.js.
const fs = require('fs');

const SIGNAL_VERSION = 2;
const STALE_THRESHOLD_MS = 30000; // ignore signals older than 30s
const CLAIM_STALE_MS = 5000;      // handled-marker lifespan

// Event priority: higher = more important. Used to pick which event wins
// when multiple hook.js invocations fire close together (e.g., Stop +
// Notification at end of a plan phase).
const EVENT_PRIORITY = { completed: 1, waiting: 2 };

function eventPriority(event) {
  return EVENT_PRIORITY[event] || 0;
}

/**
 * Normalize event types to two-type model: 'waiting' | 'completed'.
 * Legacy: 'stop' → 'completed', 'notification'/'permission' → 'waiting'.
 */
function normalizeEvent(event) {
  if (event === 'completed') return 'completed';
  if (event === 'stop') return 'completed';
  return 'waiting';
}

/**
 * Try to atomically claim the "handled" marker file. Returns true if this
 * process now owns the right to fire a notification; false if another party
 * (extension or sibling hook.js) already claimed it.
 */
function claimHandled(handledPath, staleMs = CLAIM_STALE_MS) {
  try {
    fs.writeFileSync(handledPath, String(Date.now()), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') return false;
  }
  try {
    const stat = fs.statSync(handledPath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      fs.unlinkSync(handledPath);
      fs.writeFileSync(handledPath, String(Date.now()), { flag: 'wx' });
      return true;
    }
  } catch (_) {}
  return false;
}

function parseSignal(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      if (data.version === 2) {
        if (data.timestamp && Date.now() - data.timestamp > STALE_THRESHOLD_MS) {
          return null;
        }
        return {
          version: 2,
          event: normalizeEvent(data.event || 'notification'),
          hookEventName: typeof data.hookEventName === 'string' ? data.hookEventName : '',
          hookMessage: typeof data.hookMessage === 'string' ? data.hookMessage : '',
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
          project: data.project || 'Unknown',
          projectDir: data.projectDir || '',
          pids: Array.isArray(data.pids) ? data.pids : [],
          state: data.state === 'fired' ? 'fired' : 'pending',
          aiTitle: typeof data.aiTitle === 'string' ? data.aiTitle : '',
          timestamp: data.timestamp || Date.now()
        };
      }
    } catch (_) {}
  }

  const pids = trimmed
    .split(/\r?\n/)
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);

  return {
    version: 1,
    event: 'waiting',
    hookEventName: '',
    hookMessage: '',
    sessionId: '',
    project: 'Claude Code',
    projectDir: '',
    pids,
    state: 'pending',
    aiTitle: '',
    timestamp: Date.now()
  };
}

module.exports = {
  SIGNAL_VERSION,
  STALE_THRESHOLD_MS,
  CLAIM_STALE_MS,
  claimHandled,
  eventPriority,
  normalizeEvent,
  parseSignal
};
