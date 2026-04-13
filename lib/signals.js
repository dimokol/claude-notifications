// lib/signals.js
const path = require('path');

const SIGNAL_DIR = '.vscode';
const SIGNAL_FILE = '.claude-focus';
const CLICKED_FILE = '.claude-focus-clicked';
const SIGNAL_VERSION = 2;
const STALE_THRESHOLD_MS = 30000; // ignore signals older than 30s

/**
 * Resolve the signal file path for a given workspace root.
 */
function getSignalPath(workspaceRoot) {
  return path.join(workspaceRoot, SIGNAL_DIR, SIGNAL_FILE);
}

function getClickedPath(workspaceRoot) {
  return path.join(workspaceRoot, SIGNAL_DIR, CLICKED_FILE);
}

/**
 * Parse a signal file. Handles both v1 (plain PID list) and v2 (JSON).
 * Returns a normalized object or null if unparseable/stale.
 */
function parseSignal(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Try JSON (v2) first
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      if (data.version === 2) {
        // Check staleness
        if (data.timestamp && Date.now() - data.timestamp > STALE_THRESHOLD_MS) {
          return null;
        }
        return {
          version: 2,
          event: data.event || 'notification',
          project: data.project || 'Unknown',
          projectDir: data.projectDir || '',
          pids: Array.isArray(data.pids) ? data.pids : [],
          timestamp: data.timestamp || Date.now()
        };
      }
    } catch (_) {
      // Not JSON, fall through to v1
    }
  }

  // v1 format: plain PID list, one per line
  const pids = trimmed
    .split(/\r?\n/)
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);

  return {
    version: 1,
    event: 'notification',
    project: 'Claude Code',
    projectDir: '',
    pids,
    timestamp: Date.now()
  };
}

module.exports = {
  SIGNAL_DIR,
  SIGNAL_FILE,
  CLICKED_FILE,
  SIGNAL_VERSION,
  STALE_THRESHOLD_MS,
  getSignalPath,
  getClickedPath,
  parseSignal
};
