// lib/state-paths.js — derive the per-workspace state directory.
// All ephemeral coordination state (signal, clicked, claimed, sessions)
// lives under ~/.claude/focus-state/<hash>/ so it never lands in a
// workspace's .vscode/ directory (and thus never shows up in git changes).
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const STATE_ROOT = path.join(os.homedir(), '.claude', 'focus-state');

function hashWorkspace(workspaceRoot) {
  return crypto.createHash('sha1').update(String(workspaceRoot)).digest('hex').slice(0, 12);
}

function getStateDir(workspaceRoot) {
  return path.join(STATE_ROOT, hashWorkspace(workspaceRoot));
}

function getSignalPath(workspaceRoot)   { return path.join(getStateDir(workspaceRoot), 'signal'); }
function getClickedPath(workspaceRoot)  { return path.join(getStateDir(workspaceRoot), 'clicked'); }
function getClaimedPath(workspaceRoot)  { return path.join(getStateDir(workspaceRoot), 'claimed'); }
function getSessionsPath(workspaceRoot) { return path.join(getStateDir(workspaceRoot), 'sessions'); }

module.exports = {
  STATE_ROOT,
  hashWorkspace,
  getStateDir,
  getSignalPath,
  getClickedPath,
  getClaimedPath,
  getSessionsPath
};
