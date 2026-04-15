// extension.js — Claude Notifications v3.0
// hook.js handles OS banner + sound as fallback (runs outside VS Code).
// This extension handles: claim-based dedup, terminal focusing, status bar, settings sync, commands.
//
// FOCUS CONTRACT: This extension never changes terminal focus without an explicit user press —
// either the "Focus Terminal" button on an in-window toast or an OS banner click.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSignalPath, getClickedPath, getClaimedPath, parseSignal, CLAIMED_FILE, SIGNAL_DIR } = require('./lib/signals');
const { checkHookStatus, installHooks, uninstallHooks } = require('./lib/hooks-installer');
const { checkGitignoreStatus, setupGitignore } = require('./lib/gitignore-setup');
const { playSound, playSoundFile, resolveSoundPath, discoverSystemSounds } = require('./lib/sounds');

const POLL_MS = 400;
const CLAIM_STALE_MS = 5000;
const CONFIG_FILE = 'claude-notifications-config.json';

// Module-level shared state (set during activate)
let _statusBarItem = null;
let _extensionPath = null;

function activate(context) {
  const log = vscode.window.createOutputChannel('Claude Notifications');
  log.appendLine('Claude Notifications v3.0 activated');
  log.appendLine(`Workspace folders: ${(vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath).join(', ') || 'none'}`);

  _extensionPath = context.extensionPath;

  // --- Status bar ---
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  _statusBarItem = statusBarItem;
  updateStatusBar(statusBarItem, context.extensionPath);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // --- Register commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotifications.setupHooks', () => cmdSetupHooks(context, log)),
    vscode.commands.registerCommand('claudeNotifications.removeHooks', () => cmdRemoveHooks(log)),
    vscode.commands.registerCommand('claudeNotifications.setupGitignore', () => cmdSetupGitignore(log)),
    vscode.commands.registerCommand('claudeNotifications.testNotification', () => cmdTestNotification(context, log)),
    vscode.commands.registerCommand('claudeNotifications.toggleMute', () => {
      const config = readConfig();
      config.muted = !config.muted;
      writeConfig(config);
      updateStatusBar(statusBarItem, context.extensionPath);
      const state = config.muted ? 'muted' : 'unmuted';
      log.appendLine(`Notifications ${state}`);
      vscode.window.showInformationMessage(`Claude Notifications: ${config.muted ? 'Muted' : 'Unmuted'}`);
    }),
    vscode.commands.registerCommand('claudeNotifications.chooseSound', () => cmdChooseSound(context, log)),
    vscode.commands.registerCommand('claudeNotifications.previewSound', () => cmdPreviewSound(context, log)),
    vscode.commands.registerCommand('claudeNotifications.setupMacNotifier', () => cmdSetupMacNotifier(context, log))
  );

  // --- Signal file watcher (polling at 400ms) ---
  const timer = setInterval(() => {
    if (!vscode.workspace.workspaceFolders) return;

    for (const folder of vscode.workspace.workspaceFolders) {
      // Sweep stale claim markers
      sweepStaleClaims(folder.uri.fsPath);

      // Check for v1-style clicked marker (backwards compat with terminal-notifier)
      const clickedPath = getClickedPath(folder.uri.fsPath);
      if (fs.existsSync(clickedPath)) {
        log.appendLine(`Clicked marker found (v1 compat) — ${folder.name}`);
        try { fs.unlinkSync(clickedPath); } catch (_) {}
        const signalPath = getSignalPath(folder.uri.fsPath);
        handleSignal(signalPath, folder.uri.fsPath, log);
        return;
      }

      // Check for signal file
      const signalPath = getSignalPath(folder.uri.fsPath);
      if (fs.existsSync(signalPath)) {
        log.appendLine(`Signal file found — ${folder.name}`);
        handleSignal(signalPath, folder.uri.fsPath, log);
        return;
      }
    }
  }, POLL_MS);

  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // --- Window focus handler ---
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        checkAllSignalFiles(log);
      }
    })
  );

  // --- Auto-fix stale hook paths, then first-run checks (sequential) ---
  autoFixHookPaths(context, log).then(() => {
    runFirstRunChecks(context, log, statusBarItem);
  });

  // --- Settings sync: VS Code settings → shared config file for hook.js ---
  syncSettingsToConfig(context.extensionPath, log);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeNotifications')) {
        syncSettingsToConfig(context.extensionPath, log);
        updateStatusBar(statusBarItem, context.extensionPath);
      }
    })
  );

  // --- macOS terminal-notifier setup prompt ---
  promptMacNotifierSetup(context, log);

  log.appendLine(`Polling every ${POLL_MS}ms for signals`);
  log.appendLine('Ready');
}

// --- Signal handling (focus-gated claim) ---

async function handleSignal(signalPath, workspaceRoot, log) {
  // Read signal content
  let content;
  try {
    content = fs.readFileSync(signalPath, 'utf8').trim();
  } catch (err) {
    log.appendLine(`Could not read signal file: ${err.message}`);
    return;
  }

  const signal = parseSignal(content);
  if (!signal) {
    log.appendLine('Signal file was empty or stale — ignoring');
    try { fs.unlinkSync(signalPath); } catch (_) {}
    return;
  }

  log.appendLine(`Signal: event=${signal.event}, project=${signal.project}, pids=[${signal.pids.join(',')}], version=${signal.version}`);

  // Read config for per-event settings
  const config = readConfig();
  const eventSetting = (config.events && config.events[signal.event]) || 'Sound + Notification';

  // If this window is NOT focused, do NOT claim — let hook.js fire the OS banner.
  // This ensures the correct VS Code window gets the notification.
  if (!vscode.window.state.focused) {
    log.appendLine('Window not focused — not claiming, leaving for hook.js fallback');
    return;
  }

  // Window IS focused — claim the signal (suppresses hook.js OS banner)
  try { fs.writeFileSync(getClaimedPath(workspaceRoot), ''); } catch (_) {}
  try { fs.unlinkSync(signalPath); } catch (err) {
    // Another window already claimed this signal
    log.appendLine('Signal already consumed by another window');
    return;
  }

  // If muted, claim to suppress OS banner but don't notify
  if (config.muted) {
    log.appendLine('Muted — claimed signal, no notification');
    return;
  }

  if (eventSetting === 'Nothing') {
    log.appendLine(`Event "${signal.event}" is disabled — claimed, no notification`);
    return;
  }

  const wantSound = eventSetting === 'Sound + Notification' || eventSetting === 'Sound only';
  const wantToast = eventSetting === 'Sound + Notification' || eventSetting === 'Notification only';

  // Case A: focused + correct terminal → sound only (configurable)
  const activeTerminal = vscode.window.activeTerminal;
  if (activeTerminal) {
    try {
      const activePid = await activeTerminal.processId;
      if (activePid && signal.pids.includes(activePid)) {
        log.appendLine('Already on correct terminal — sound only (if enabled)');
        const soundWhenFocused = vscode.workspace.getConfiguration('claudeNotifications').get('soundWhenFocused', 'sound');
        if (soundWhenFocused === 'sound' && wantSound) {
          playEventSound(signal.event, config);
        }
        return;
      }
    } catch (_) {}
  }

  // Case B: focused + wrong terminal → play sound + show "Focus Terminal" toast
  if (wantSound) {
    playEventSound(signal.event, config);
  }

  if (wantToast) {
    const action = await vscode.window.showInformationMessage(
      signal.event === 'completed'
        ? `Task completed in: ${signal.project}`
        : `Waiting for your response in: ${signal.project}`,
      'Focus Terminal'
    );

    if (action === 'Focus Terminal') {
      log.appendLine('User clicked Focus Terminal');
      await focusMatchingTerminal(signal.pids, log);
    }
  }
}

function playEventSound(event, config) {
  const soundPath = config.sounds && config.sounds[event];
  const volume = (config.sounds && config.sounds.volume != null) ? config.sounds.volume : 50;
  if (soundPath) {
    playSoundFile(soundPath, volume);
  } else {
    // Fallback to bundled sound
    const soundName = event === 'completed' ? 'task-complete' : 'notification';
    playSound(soundName, volume / 100);
  }
}

function sweepStaleClaims(workspaceRoot) {
  const claimPath = getClaimedPath(workspaceRoot);
  try {
    if (fs.existsSync(claimPath)) {
      const stat = fs.statSync(claimPath);
      if (Date.now() - stat.mtimeMs > CLAIM_STALE_MS) {
        fs.unlinkSync(claimPath);
      }
    }
  } catch (_) {}
}

function checkAllSignalFiles(log) {
  if (!vscode.workspace.workspaceFolders) return;

  for (const folder of vscode.workspace.workspaceFolders) {
    const signalPath = getSignalPath(folder.uri.fsPath);
    if (fs.existsSync(signalPath)) {
      log.appendLine(`Signal found on window focus: ${folder.name}`);
      handleSignal(signalPath, folder.uri.fsPath, log);
      return;
    }
  }
}

// --- Terminal focusing ---

async function focusMatchingTerminal(pids, log) {
  const terminals = vscode.window.terminals;
  log.appendLine(`Open terminals (${terminals.length}): ${terminals.map(t => t.name).join(', ')}`);

  for (const terminal of terminals) {
    try {
      const termPid = await terminal.processId;
      if (termPid && pids.includes(termPid)) {
        log.appendLine(`PID match: "${terminal.name}" (PID ${termPid})`);
        await showTerminal(terminal, log);
        return;
      }
    } catch (_) {}
  }

  for (const terminal of terminals) {
    const name = terminal.name.toLowerCase();
    if (name.includes('claude') || name.includes('node')) {
      log.appendLine(`Name match: "${terminal.name}"`);
      await showTerminal(terminal, log);
      return;
    }
  }

  if (terminals.length > 0) {
    const lastTerminal = terminals[terminals.length - 1];
    log.appendLine(`Fallback: last terminal "${lastTerminal.name}"`);
    await showTerminal(lastTerminal, log);
    return;
  }

  log.appendLine('No terminals found to focus');
}

async function showTerminal(terminal, log) {
  await vscode.commands.executeCommand('workbench.action.terminal.focus');
  terminal.show();
  setTimeout(() => {
    const active = vscode.window.activeTerminal;
    log.appendLine(`Active terminal after switch: "${active?.name || 'none'}"`);
  }, 300);
}

// --- Config file (shared with hook.js) ---

function getConfigPath() {
  return path.join(os.homedir(), '.claude', CONFIG_FILE);
}

function readConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {}
  return { muted: false, soundEnabled: true, volume: 0.5 };
}

function writeConfig(config) {
  try {
    const configPath = getConfigPath();
    const claudeDir = path.dirname(configPath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (_) {}
}

function updateStatusBar(item, extensionPath) {
  const { status } = checkHookStatus(extensionPath);

  if (status === 'not-installed' || status === 'no-file') {
    item.text = '$(gear) Claude: Set Up';
    item.tooltip = 'Claude Notifications: Click to install hooks';
    item.command = 'claudeNotifications.setupHooks';
    return;
  }

  item.command = 'claudeNotifications.toggleMute';
  const config = readConfig();
  if (config.muted) {
    item.text = '$(bell-slash) Claude: Muted';
    item.tooltip = 'Claude Notifications: Muted (click to unmute)';
  } else {
    item.text = '$(bell) Claude: Notify';
    item.tooltip = 'Claude Notifications: Active (click to mute)';
  }
}

// --- Commands ---

async function cmdSetupHooks(context, log) {
  const { status } = checkHookStatus(context.extensionPath);

  if (status === 'installed') {
    vscode.window.showInformationMessage('Claude Notifications hooks are already installed.');
    return;
  }

  let replaceLegacy = false;
  if (status === 'legacy') {
    const choice = await vscode.window.showInformationMessage(
      'Legacy Claude Notifications hooks detected (shell scripts). Replace with the new Node.js hooks?',
      'Replace', 'Keep Both', 'Cancel'
    );
    if (choice === 'Cancel' || !choice) return;
    replaceLegacy = choice === 'Replace';
  } else {
    const choice = await vscode.window.showInformationMessage(
      'Install Claude Code hooks for notifications and terminal focus? This will modify ~/.claude/settings.json (a backup will be created).',
      'Install', 'Cancel'
    );
    if (choice !== 'Install') return;
  }

  const result = installHooks(context.extensionPath, { replaceLegacy });

  if (result.success) {
    log.appendLine(`Hooks installed. Backup: ${result.backupPath}`);
    vscode.window.showInformationMessage(result.message);
    updateStatusBar(_statusBarItem, context.extensionPath);
    syncSettingsToConfig(context.extensionPath, log);

    const gitStatus = checkGitignoreStatus();
    if (!gitStatus.configured) {
      const gitChoice = await vscode.window.showInformationMessage(
        'Add signal files to global gitignore?',
        'Yes', 'No'
      );
      if (gitChoice === 'Yes') {
        const gitResult = setupGitignore();
        vscode.window.showInformationMessage(gitResult.message);
      }
    }
  } else {
    vscode.window.showErrorMessage(result.message);
  }
}

async function cmdRemoveHooks(log) {
  const choice = await vscode.window.showWarningMessage(
    'Remove Claude Notifications hooks from ~/.claude/settings.json?',
    'Remove', 'Cancel'
  );
  if (choice !== 'Remove') return;

  const result = uninstallHooks();
  if (result.success) {
    log.appendLine(result.message);
    vscode.window.showInformationMessage(result.message);
  } else {
    vscode.window.showErrorMessage(result.message);
  }
}

async function cmdSetupGitignore(log) {
  const result = setupGitignore();
  if (result.success) {
    log.appendLine(result.message);
    vscode.window.showInformationMessage(result.message);
  } else {
    vscode.window.showErrorMessage(result.message);
  }
}

async function cmdTestNotification(context, log) {
  const hookPath = path.join(context.extensionPath, 'hook.js');
  const { spawn } = require('child_process');
  const child = spawn('node', [hookPath], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir() },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.end('{"hook_event_name":"Notification"}');
  child.on('close', (code) => {
    if (code !== 0) log.appendLine(`Test notification exited with code ${code}`);
    else log.appendLine('Test notification sent via hook.js');
  });
}

// --- macOS terminal-notifier setup ---

async function promptMacNotifierSetup(context, log) {
  if (process.platform !== 'darwin') return;

  const prompted = context.globalState.get('macNotifierPromptAnswered', false);
  if (prompted) return;

  // Check if terminal-notifier is already installed
  try {
    require('child_process').execSync('command -v terminal-notifier', { stdio: 'ignore' });
    return; // already installed
  } catch (_) {}

  const choice = await vscode.window.showInformationMessage(
    'Claude Notifications: Install terminal-notifier for click-to-open OS banners? Recommended for best experience. Using osascript fallback otherwise.',
    'Install (Recommended)', 'Keep osascript', "Don't Ask Again"
  );

  if (choice === 'Install (Recommended)') {
    await installTerminalNotifier(context, log);
  } else if (choice === "Don't Ask Again") {
    await context.globalState.update('macNotifierPromptAnswered', true);
  } else {
    // "Keep osascript" — mark as answered but reset on next major version
    await context.globalState.update('macNotifierPromptAnswered', true);
  }
}

async function cmdSetupMacNotifier(context, log) {
  if (process.platform !== 'darwin') {
    vscode.window.showInformationMessage('terminal-notifier setup is only needed on macOS.');
    return;
  }

  // Check if already installed
  try {
    require('child_process').execSync('command -v terminal-notifier', { stdio: 'ignore' });
    const choice = await vscode.window.showInformationMessage(
      'terminal-notifier is already installed.',
      'Reinstall', 'OK'
    );
    if (choice !== 'Reinstall') return;
  } catch (_) {}

  await installTerminalNotifier(context, log);
}

async function installTerminalNotifier(context, log) {
  // Check for Homebrew
  try {
    require('child_process').execSync('command -v brew', { stdio: 'ignore' });
  } catch (_) {
    vscode.window.showInformationMessage(
      'Homebrew not found. Install terminal-notifier manually: https://github.com/julienXX/terminal-notifier#installation'
    );
    return;
  }

  // Run brew install in a terminal
  const terminal = vscode.window.createTerminal('Claude Notifications Setup');
  terminal.show();
  terminal.sendText('brew install terminal-notifier && echo "\\n✅ terminal-notifier installed! You can close this terminal."');
  await context.globalState.update('macNotifierPromptAnswered', true);
  log.appendLine('terminal-notifier install started via Homebrew');
}

// --- Auto-fix stale hook paths ---

async function autoFixHookPaths(context, log) {
  const { status, installedPath } = checkHookStatus(context.extensionPath);
  if (status !== 'stale-path') return;

  log.appendLine(`Hook path stale: ${installedPath} -> ${context.extensionPath}`);
  const result = installHooks(context.extensionPath, {});
  if (result.success) {
    log.appendLine('Hook paths updated automatically');
    updateStatusBar(_statusBarItem, context.extensionPath);
  } else {
    log.appendLine(`Failed to update hook paths: ${result.message}`);
  }
}

// --- First-run checks ---

async function runFirstRunChecks(context, log, statusBarItem) {
  const { status } = checkHookStatus(context.extensionPath);
  log.appendLine(`Hook status: ${status}`);

  if (status === 'installed' || status === 'stale-path') return;

  if (status === 'not-installed' || status === 'no-file') {
    const result = installHooks(context.extensionPath, {});
    if (result.success) {
      log.appendLine('Hooks auto-installed on first run');
      vscode.window.showInformationMessage(
        'Claude Notifications: Hooks installed. You\'ll now get notified when Claude needs attention.'
      );
      const gitStatus = checkGitignoreStatus();
      if (!gitStatus.configured) setupGitignore();
      updateStatusBar(statusBarItem, context.extensionPath);
      syncSettingsToConfig(context.extensionPath, log);
    } else {
      log.appendLine(`Auto-install failed: ${result.message}`);
    }
    return;
  }

  if (status === 'legacy') {
    const config = vscode.workspace.getConfiguration('claudeNotifications');
    if (!config.get('autoSetupHooks', true)) return;

    const choice = await vscode.window.showInformationMessage(
      'Claude Notifications: Legacy shell-script hooks detected. Upgrade to Node.js hooks?',
      'Upgrade', 'Later', "Don't Ask Again"
    );
    if (choice === 'Upgrade') {
      await cmdSetupHooks(context, log);
    } else if (choice === "Don't Ask Again") {
      await config.update('autoSetupHooks', false, vscode.ConfigurationTarget.Global);
    }
  }
}

// --- Settings sync: VS Code settings → shared config file ---

function syncSettingsToConfig(extensionPath, log) {
  const cfg = vscode.workspace.getConfiguration('claudeNotifications');
  const config = readConfig();

  config.sounds = {
    waiting: resolveSoundPath(
      cfg.get('sounds.waiting', 'bundled:notification'),
      cfg.get('sounds.waitingPath', ''),
      extensionPath
    ),
    completed: resolveSoundPath(
      cfg.get('sounds.completed', 'bundled:task-complete'),
      cfg.get('sounds.completedPath', ''),
      extensionPath
    ),
    volume: cfg.get('sounds.volume', 50)
  };

  config.events = {
    waiting: cfg.get('events.waiting', 'Sound + Notification'),
    completed: cfg.get('events.completed', 'Sound + Notification')
  };

  writeConfig(config);
  log.appendLine('Settings synced to shared config');
}

// --- Choose Sound / Preview Sound commands ---

async function cmdChooseSound(context, log) {
  const events = [
    { label: 'Waiting (needs your response)', setting: 'sounds.waiting', pathSetting: 'sounds.waitingPath' },
    { label: 'Completed (task finished)', setting: 'sounds.completed', pathSetting: 'sounds.completedPath' }
  ];

  const eventPick = await vscode.window.showQuickPick(
    events.map(e => e.label),
    { placeHolder: 'Choose which event to configure' }
  );
  if (!eventPick) return;
  const event = events.find(e => e.label === eventPick);

  const items = [
    { label: '$(package) Bundled: Glass (task-complete)', value: 'bundled:task-complete' },
    { label: '$(package) Bundled: Funk (notification)', value: 'bundled:notification' }
  ];

  const systemSounds = discoverSystemSounds();
  for (const s of systemSounds) {
    items.push({ label: `$(device-desktop) System: ${s.label}`, value: `system:${s.label}` });
  }

  items.push(
    { label: '$(file) Custom file...', value: 'custom' },
    { label: '$(mute) None', value: 'none' }
  );

  const soundPick = await vscode.window.showQuickPick(items, {
    placeHolder: `Sound for "${eventPick}"`
  });
  if (!soundPick) return;

  const cfg = vscode.workspace.getConfiguration('claudeNotifications');

  if (soundPick.value === 'custom') {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      filters: { 'Audio': ['wav', 'mp3', 'aiff', 'ogg'] }
    });
    if (!files || files.length === 0) return;
    await cfg.update(event.pathSetting, files[0].fsPath, vscode.ConfigurationTarget.Global);
  }

  await cfg.update(event.setting, soundPick.value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Sound for "${eventPick}" set to: ${soundPick.value}`);
}

async function cmdPreviewSound(context, log) {
  const items = [
    { label: 'Bundled: Glass (task-complete)', value: 'bundled:task-complete' },
    { label: 'Bundled: Funk (notification)', value: 'bundled:notification' }
  ];

  const systemSounds = discoverSystemSounds();
  for (const s of systemSounds) {
    items.push({ label: `System: ${s.label}`, value: `system:${s.label}` });
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a sound to preview'
  });
  if (!pick) return;

  const filePath = resolveSoundPath(pick.value, '', context.extensionPath);
  if (filePath) {
    const vol = vscode.workspace.getConfiguration('claudeNotifications').get('sounds.volume', 50);
    playSoundFile(filePath, vol);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
