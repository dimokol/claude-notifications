#!/usr/bin/env node
// hook.js — Claude Code hook script (runs OUTSIDE VS Code)
// Called by Claude Code on Stop, Notification, and PermissionRequest events.
//
// Flow:
// 1. Write JSON signal file (.vscode/.claude-focus)
// 2. Sleep HANDSHAKE_MS (1200ms) — give extension time to claim
// 3. Check for claim marker (.vscode/.claude-focus-claimed)
//    - If claimed: extension handled it → exit silently
//    - If not claimed: fire OS banner + play sound (fallback)

const fs = require('fs');
const path = require('path');
const { execSync, execFile, spawn } = require('child_process');
const os = require('os');
const { setTimeout: sleep } = require('node:timers/promises');

const SIGNAL_DIR = '.vscode';
const SIGNAL_FILE = '.claude-focus';
const CLAIMED_FILE = '.claude-focus-claimed';
const CONFIG_FILE = 'claude-notifications-config.json';
const DEFAULT_HANDSHAKE_MS = 1200;

(async () => {
  // --- 1. Read input ---

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectName = path.basename(projectDir);

  let hookEvent = 'waiting';
  try {
    const stdinData = fs.readFileSync(0, 'utf8');
    const input = JSON.parse(stdinData);
    const eventName = (input.hook_event_name || '').toLowerCase();
    if (eventName === 'stop') hookEvent = 'completed';
    else hookEvent = 'waiting'; // notification, permissionrequest, etc.
  } catch (_) {}

  // --- 2. Read config (mute state, sound/event preferences) ---

  const configPath = path.join(os.homedir(), '.claude', CONFIG_FILE);
  let config = { muted: false, soundEnabled: true, volume: 0.5 };
  try {
    if (fs.existsSync(configPath)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch (_) {}

  // Backwards compat: old flat config → new nested config
  if (config.soundEnabled !== undefined && !config.sounds) {
    config.sounds = { volume: Math.round((config.volume || 0.5) * 100) };
    config.events = {};
  }

  const isMuted = config.muted === true;

  // --- 3. Find workspace root ---

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  let workspaceRoot = projectDir;
  let searchDir = projectDir;

  while (searchDir !== path.dirname(searchDir)) {
    if (searchDir === homeDir) break;
    if (fs.existsSync(path.join(searchDir, SIGNAL_DIR))) {
      workspaceRoot = searchDir;
    }
    searchDir = path.dirname(searchDir);
  }

  const signalDirPath = path.join(workspaceRoot, SIGNAL_DIR);
  if (!fs.existsSync(signalDirPath)) {
    fs.mkdirSync(signalDirPath, { recursive: true });
  }

  // --- 4. Build PID ancestor chain ---

  function getPidChain() {
    const pids = [];
    let currentPid = process.pid;

    if (process.platform === 'win32') {
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
        } catch (_) { break; }
      }
    } else {
      while (currentPid && currentPid > 1) {
        pids.push(currentPid);
        try {
          const output = execSync(`ps -o ppid= -p ${currentPid}`, {
            encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe']
          });
          const parentPid = parseInt(output.trim(), 10);
          if (isNaN(parentPid) || parentPid <= 0 || parentPid === currentPid) break;
          currentPid = parentPid;
        } catch (_) { break; }
      }
    }
    return pids;
  }

  // --- 5. Write signal file ---

  const signalPayload = {
    version: 2,
    event: hookEvent,
    project: projectName,
    projectDir: projectDir,
    workspaceRoot: workspaceRoot,
    pids: getPidChain(),
    timestamp: Date.now()
  };

  const signalPath = path.join(signalDirPath, SIGNAL_FILE);
  fs.writeFileSync(signalPath, JSON.stringify(signalPayload, null, 2));

  // If muted, signal file written (for terminal focus) but skip everything else
  if (isMuted) process.exit(0);

  // --- 6. Per-event settings ---

  const eventConfig = (config.events && config.events[hookEvent]) || 'Sound + Notification';
  if (eventConfig === 'Nothing') process.exit(0);

  const shouldPlaySound = eventConfig === 'Sound + Notification' || eventConfig === 'Sound only';
  const shouldNotify = eventConfig === 'Sound + Notification' || eventConfig === 'Notification only';

  const eventMessages = {
    completed: { title: 'Claude Code — Done', message: `Task completed in: ${projectName}`, sound: 'task-complete' },
    waiting: { title: 'Claude Code', message: `Waiting for your response in: ${projectName}`, sound: 'notification' }
  };
  const eventInfo = eventMessages[hookEvent] || eventMessages.waiting;

  // --- 7. Handshake: wait for extension to claim ---

  const handshakeMs = config.handshakeMs || DEFAULT_HANDSHAKE_MS;
  await sleep(handshakeMs);

  const claimPath = path.join(signalDirPath, CLAIMED_FILE);
  if (fs.existsSync(claimPath)) {
    // Extension claimed the signal — it handled toast + sound
    try { fs.unlinkSync(claimPath); } catch (_) {}
    process.exit(0);
  }

  // --- 8. Fallback: extension didn't claim → fire OS banner + sound ---

  // Play sound
  if (shouldPlaySound) {
    const soundPath = config.sounds && config.sounds[hookEvent];
    const volume = (config.sounds && config.sounds.volume != null) ? config.sounds.volume : 50;
    const fileToPlay = soundPath || path.join(path.dirname(__filename), 'sounds', `${eventInfo.sound}.wav`);

    if (fs.existsSync(fileToPlay)) {
      try {
        if (process.platform === 'darwin') {
          const vol = Math.round((volume / 100) * 255).toString();
          execFile('afplay', ['-v', vol, fileToPlay], () => {});
        } else if (process.platform === 'win32') {
          const psCmd = `(New-Object System.Media.SoundPlayer '${fileToPlay.replace(/'/g, "''")}').PlaySync()`;
          execFile('powershell', ['-NoProfile', '-Command', psCmd], () => {});
        } else {
          execFile('paplay', [fileToPlay], (err) => {
            if (err) execFile('aplay', [fileToPlay], () => {});
          });
        }
      } catch (_) {}
    }
  }

  // Show OS notification
  if (!shouldNotify) process.exit(0);

  function findCodeCli() {
    const candidates = ['/usr/local/bin/code', '/opt/homebrew/bin/code'];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    try {
      return execSync('which code', { encoding: 'utf8', timeout: 2000 }).trim();
    } catch (_) {
      return 'code';
    }
  }

  if (process.platform === 'darwin') {
    const codeCli = findCodeCli();
    try {
      execSync('command -v terminal-notifier', { stdio: 'ignore' });
      const child = spawn('terminal-notifier', [
        '-title', eventInfo.title,
        '-message', eventInfo.message,
        '-execute', `${codeCli} '${workspaceRoot}'`,
        '-group', `claude-${projectName}`,
      ], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (_) {
      try {
        execSync(`osascript -e 'display notification "${eventInfo.message}" with title "${eventInfo.title}" sound name "default"'`, {
          timeout: 3000, stdio: 'ignore'
        });
      } catch (_) {}
    }
  } else if (process.platform === 'win32') {
    const vscodePath = workspaceRoot.replace(/\\/g, '/');
    const vscodeUri = `vscode://file/${vscodePath}`;
    const psScript = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $template = @"
      <toast activationType="protocol" launch="${vscodeUri}" duration="long">
        <visual><binding template="ToastGeneric">
          <text>${eventInfo.title}</text>
          <text>${eventInfo.message}</text>
        </binding></visual>
        <audio src="ms-winsoundevent:Notification.Default" silent="true" />
      </toast>
"@
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.Windows.Shell.RunDialog").Show($toast)
    `;
    const child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
      detached: true, stdio: 'ignore'
    });
    child.unref();
  } else {
    try {
      const child = spawn('notify-send', [
        eventInfo.title, eventInfo.message,
        '--app-name=Claude Code',
        '--expire-time=15000'
      ], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (_) {}
  }
})();
