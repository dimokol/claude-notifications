#!/usr/bin/env node
// hook.js — Claude Code hook script (runs OUTSIDE VS Code)
// Called by Claude Code on Stop and Notification events.
// Writes a JSON signal file that the VS Code extension watches.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIGNAL_DIR = '.vscode';
const SIGNAL_FILE = '.claude-focus';

// --- 1. Read input ---

// Claude Code provides CLAUDE_PROJECT_DIR as env var
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = path.basename(projectDir);

// Claude Code pipes JSON to stdin with hook_event_name, session_id, etc.
let hookEvent = 'notification';
try {
  const stdinData = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  const input = JSON.parse(stdinData);
  const eventName = (input.hook_event_name || '').toLowerCase();
  if (eventName === 'stop') hookEvent = 'stop';
  else hookEvent = 'notification';
} catch (_) {
  // stdin might not be JSON or might be empty — default to notification
}

// --- 2. Find workspace root ---
// Walk up from projectDir looking for the topmost directory with a .vscode/ folder
// (same logic as the old bash scripts). Stop at $HOME to avoid using ~/.vscode.

const homeDir = process.env.HOME || process.env.USERPROFILE || '';
let workspaceRoot = projectDir;
let searchDir = projectDir;

while (searchDir !== path.dirname(searchDir)) { // stop at filesystem root
  if (searchDir === homeDir) break; // don't go above $HOME
  if (fs.existsSync(path.join(searchDir, SIGNAL_DIR))) {
    workspaceRoot = searchDir;
  }
  searchDir = path.dirname(searchDir);
}

// Ensure .vscode/ exists in the workspace root
const signalDirPath = path.join(workspaceRoot, SIGNAL_DIR);
if (!fs.existsSync(signalDirPath)) {
  fs.mkdirSync(signalDirPath, { recursive: true });
}

// --- 3. Build PID ancestor chain ---

function getPidChain() {
  const pids = [];
  let currentPid = process.pid;

  if (process.platform === 'win32') {
    // Windows: use WMIC or Get-CimInstance
    while (currentPid && currentPid > 0) {
      pids.push(currentPid);
      try {
        const output = execSync(
          `wmic process where ProcessId=${currentPid} get ParentProcessId /value`,
          { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const match = output.match(/ParentProcessId=(\d+)/);
        if (!match) break;
        const parentPid = parseInt(match[1], 10);
        if (parentPid === currentPid || parentPid === 0) break;
        currentPid = parentPid;
      } catch (_) {
        break;
      }
    }
  } else {
    // macOS / Linux: use ps
    while (currentPid && currentPid > 1) {
      pids.push(currentPid);
      try {
        const output = execSync(`ps -o ppid= -p ${currentPid}`, {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const parentPid = parseInt(output.trim(), 10);
        if (isNaN(parentPid) || parentPid <= 0 || parentPid === currentPid) break;
        currentPid = parentPid;
      } catch (_) {
        break;
      }
    }
  }

  return pids;
}

// --- 4. Write signal file ---

const signal = {
  version: 2,
  event: hookEvent,
  project: projectName,
  projectDir: projectDir,
  pids: getPidChain(),
  timestamp: Date.now()
};

const signalPath = path.join(signalDirPath, SIGNAL_FILE);
fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));

// Done — the VS Code extension picks up the signal file and handles
// sound playback + notifications from inside VS Code.
