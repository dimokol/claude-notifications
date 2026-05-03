// lib/hooks-installer.js — Install/uninstall Claude Code hooks in ~/.claude/settings.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Get the command string that Claude Code should run for our hook.
 * Points to dist/hook.js — the esbuild-bundled, self-contained hook
 * script — inside the extension's install directory. v3.0 shipped
 * hook.js at the extension root; autoFixHookPaths in extension.js
 * migrates users by rewriting this path on activation.
 * @param {string} extensionPath - context.extensionPath from VS Code
 */
function getHookCommand(extensionPath) {
  const hookPath = path.join(extensionPath, 'dist', 'hook.js');
  // Use JSON.stringify to handle spaces in paths
  return `node ${JSON.stringify(hookPath)}`;
}

function getUserPromptHookCommand(extensionPath) {
  const hookPath = path.join(extensionPath, 'dist', 'hook-user-prompt.js');
  return `node ${JSON.stringify(hookPath)}`;
}

const HOOK_EVENTS = ['Stop', 'Notification', 'PermissionRequest'];
const USER_PROMPT_EVENT = 'UserPromptSubmit';
const ALL_EVENTS = [...HOOK_EVENTS, USER_PROMPT_EVENT];

/**
 * Extract the full hook.js path from the commands in settings.json.
 * Parses `node "/path/to/extension/dist/hook.js"` and returns that path
 * (or the legacy `/path/to/extension/hook.js` for pre-3.1.1 installs).
 */
function getInstalledHookPath(hooks) {
  for (const event of ALL_EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    for (const entry of hooks[event]) {
      if (!Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) {
        if (!h.command) continue;
        if (!h.command.includes('hook.js') && !h.command.includes('hook-user-prompt.js')) continue;
        const match = h.command.match(/node\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
        const hookPath = match && (match[1] || match[2] || match[3]);
        if (hookPath) return hookPath;
      }
    }
  }
  return null;
}

/** Where v3.1.1+ expects hook.js to live, absolute. */
function getExpectedHookPath(extensionPath) {
  return path.join(extensionPath, 'dist', 'hook.js');
}

/**
 * Check if our hooks are already installed in ~/.claude/settings.json.
 * @returns {{ status: 'installed' | 'not-installed' | 'legacy' | 'no-file' | 'stale-path', installedPath?: string }}
 */
function checkHookStatus(extensionPath, settingsPath = CLAUDE_SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) {
    return { status: 'no-file' };
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooks = settings.hooks;
    if (!hooks) return { status: 'not-installed' };

    const hasAllPrimary = HOOK_EVENTS.every(event => hasOurHook(hooks[event]));
    const hasUserPrompt = hasUserPromptHook(hooks[USER_PROMPT_EVENT]);

    if (hasAllPrimary && hasUserPrompt) {
      const installedPath = getInstalledHookPath(hooks);
      const expectedPath = getExpectedHookPath(extensionPath);
      if (installedPath && path.resolve(installedPath) !== path.resolve(expectedPath)) {
        return { status: 'stale-path', installedPath };
      }
      return { status: 'installed' };
    }

    // Has some of our hooks but not all → partial (e.g. v3.1.x install missing UserPromptSubmit).
    if (hasAllPrimary || HOOK_EVENTS.some(event => hasOurHook(hooks[event]))) {
      const installedPath = getInstalledHookPath(hooks);
      return { status: 'partial', installedPath };
    }

    const hasLegacyStop = hasLegacyHook(hooks.Stop);
    const hasLegacyNotification = hasLegacyHook(hooks.Notification);
    if (hasLegacyStop || hasLegacyNotification) return { status: 'legacy' };

    return { status: 'not-installed' };
  } catch (_) {
    return { status: 'not-installed' };
  }
}

function hasOurHook(hookArray) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(entry =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some(h => h.command && h.command.includes('hook.js'))
  );
}

function hasUserPromptHook(hookArray) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(entry =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some(h => h.command && h.command.includes('hook-user-prompt.js'))
  );
}

function hasLegacyHook(hookArray) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(entry =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some(h =>
      h.command && (
        h.command.includes('task-complete.sh') ||
        h.command.includes('notify.sh') ||
        h.command.includes('task-complete.ps1') ||
        h.command.includes('notify.ps1')
      )
    )
  );
}

/**
 * Install our hooks into ~/.claude/settings.json.
 * Merges with existing hooks — does NOT overwrite other hooks.
 * Creates a backup before modifying.
 *
 * @param {string} extensionPath - context.extensionPath
 * @param {object} options
 * @param {boolean} options.replaceLegacy - if true, remove legacy bash/ps1 hooks
 * @returns {{ success: boolean, message: string, backupPath?: string }}
 */
function installHooks(extensionPath, { replaceLegacy = false, settingsPath = CLAUDE_SETTINGS_PATH } = {}) {
  try {
    const claudeDir = path.dirname(settingsPath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(content);

      const backupPath = settingsPath + '.backup';
      fs.writeFileSync(backupPath, content);
    }

    if (!settings.hooks) settings.hooks = {};

    const hookCommand = getHookCommand(extensionPath);
    const ourHookEntry = {
      matcher: '',
      hooks: [{ type: 'command', command: hookCommand }]
    };

    // Remove legacy hooks if requested
    if (replaceLegacy) {
      if (Array.isArray(settings.hooks.Stop)) {
        settings.hooks.Stop = settings.hooks.Stop.filter(entry =>
          !Array.isArray(entry.hooks) || !entry.hooks.some(h =>
            h.command && (h.command.includes('task-complete.sh') || h.command.includes('task-complete.ps1'))
          )
        );
      }
      if (Array.isArray(settings.hooks.Notification)) {
        settings.hooks.Notification = settings.hooks.Notification.filter(entry =>
          !Array.isArray(entry.hooks) || !entry.hooks.some(h =>
            h.command && (h.command.includes('notify.sh') || h.command.includes('notify.ps1'))
          )
        );
      }
    }

    // Remove any existing v2 hooks (prevent duplicates)
    for (const event of ALL_EVENTS) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter(entry =>
          !Array.isArray(entry.hooks) || !entry.hooks.some(h =>
            h.command && (h.command.includes('hook.js') || h.command.includes('hook-user-prompt.js'))
          )
        );
      }
    }

    // Add the primary hook (Stop/Notification/PermissionRequest)
    for (const event of HOOK_EVENTS) {
      if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
      settings.hooks[event].push(ourHookEntry);
    }

    // Add the UserPromptSubmit hook (separate command)
    const userPromptEntry = {
      matcher: '',
      hooks: [{ type: 'command', command: getUserPromptHookCommand(extensionPath) }]
    };
    if (!Array.isArray(settings.hooks[USER_PROMPT_EVENT])) settings.hooks[USER_PROMPT_EVENT] = [];
    settings.hooks[USER_PROMPT_EVENT].push(userPromptEntry);

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    return {
      success: true,
      message: 'Claude Code hooks installed successfully.',
      backupPath: settingsPath + '.backup'
    };
  } catch (err) {
    return { success: false, message: `Failed to install hooks: ${err.message}` };
  }
}

/**
 * Remove our hooks from ~/.claude/settings.json.
 * Only removes hooks that point to our hook.js — leaves everything else intact.
 */
function uninstallHooks(settingsPath = CLAUDE_SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) {
    return { success: true, message: 'No settings file found — nothing to remove.' };
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(content);

    if (!settings.hooks) {
      return { success: true, message: 'No hooks configured — nothing to remove.' };
    }

    fs.writeFileSync(settingsPath + '.backup', content);

    let removed = false;
    for (const event of ALL_EVENTS) {
      if (Array.isArray(settings.hooks[event])) {
        const before = settings.hooks[event].length;
        settings.hooks[event] = settings.hooks[event].filter(entry =>
          !Array.isArray(entry.hooks) || !entry.hooks.some(h =>
            h.command && (h.command.includes('hook.js') || h.command.includes('hook-user-prompt.js'))
          )
        );
        if (settings.hooks[event].length < before) removed = true;
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
    }

    // Clean up empty hooks object
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    return {
      success: true,
      message: removed
        ? 'Claude Terminal Focus hooks removed.'
        : 'No Claude Terminal Focus hooks found to remove.'
    };
  } catch (err) {
    return { success: false, message: `Failed to remove hooks: ${err.message}` };
  }
}

/**
 * Find every Claude Code config-profile settings file on the machine: the
 * default ~/.claude/settings.json and every ~/.claude-<name>/settings.json
 * (a profile selectable via the CLAUDE_CONFIG_DIR env var). Profiles whose
 * directory name starts with `claude-backup` (case-insensitive) are skipped —
 * those are user-owned backups, not active profiles.
 */
function discoverProfiles(homeDir = os.homedir()) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch (_) {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name !== '.claude' && !name.startsWith('.claude-')) continue;
    if (name.toLowerCase().startsWith('.claude-backup')) continue;
    const settingsPath = path.join(homeDir, name, 'settings.json');
    if (fs.existsSync(settingsPath)) result.push(settingsPath);
  }
  return result;
}

/**
 * Run checkHookStatus across every discovered profile. Returns one entry per
 * profile so the caller can decide which need fixing.
 */
function checkAllProfiles(extensionPath, homeDir) {
  return discoverProfiles(homeDir).map(p => ({
    path: p,
    ...checkHookStatus(extensionPath, p)
  }));
}

module.exports = { checkHookStatus, checkAllProfiles, getInstalledHookPath, installHooks, uninstallHooks, discoverProfiles, CLAUDE_SETTINGS_PATH };
