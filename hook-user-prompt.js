#!/usr/bin/env node
// hook-user-prompt.js — Claude Code UserPromptSubmit hook.
// Advances the stageId for this session so the next Stop/Notification
// will be treated as a fresh stage and fire a notification even if its
// event type matches the previous one. No OS notification, no sound.
const fs = require('fs');
const path = require('path');
const { getStateDir } = require('./lib/state-paths');
const { advanceOnPrompt } = require('./lib/stage-dedup');
const { shouldSkipForHost } = require('./lib/host-optout');

(() => {
  // A host that opts out of our notifications gets no stage bookkeeping
  // either: nothing reads it, and the writes would churn the state dir.
  if (shouldSkipForHost(process.env)) process.exit(0);

  let sessionId = '';
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  } catch (_) {
    process.exit(0);
  }
  if (!sessionId) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  let workspaceRoot = projectDir;
  let searchDir = projectDir;
  while (searchDir !== path.dirname(searchDir)) {
    if (searchDir === homeDir) break;
    if (fs.existsSync(path.join(searchDir, '.vscode'))) {
      workspaceRoot = searchDir;
    }
    searchDir = path.dirname(searchDir);
  }

  // Ensure state dir exists before any write.
  fs.mkdirSync(getStateDir(workspaceRoot), { recursive: true });
  advanceOnPrompt(workspaceRoot, sessionId);
})();
