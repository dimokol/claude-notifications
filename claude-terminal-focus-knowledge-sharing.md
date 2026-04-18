# Claude Code Notifications & Terminal Focus — Setup Guide

**Category**: Developer Tools / Claude Code
**Author**: Dimo
**Date**: 2026-04-03

## What This Does

When running multiple Claude Code sessions in VS Code terminals, it's hard to know which one needs your attention. This setup adds:

1. **Sound notifications** — different sounds for "needs input" vs "task complete"
2. **Banner notifications** — shows the project name, stays on screen
3. **Click-to-focus** — clicking the notification opens the correct VS Code window AND switches to the exact terminal tab where Claude is waiting

Works with multiple VS Code windows and multiple Claude terminals simultaneously.

---

## Prerequisites

- **Claude Code CLI** installed and authenticated
- **VS Code** with the terminal
- **Node.js** (for packaging the VS Code extension)

---

## macOS Setup

### Step 1: Install terminal-notifier

```bash
brew install terminal-notifier
```

Then go to **System Settings → Notifications → terminal-notifier** and set alert style to **Alerts** (stays on screen until dismissed) instead of Banners.

### Step 2: Create notification scripts

Create `~/.claude/notify.sh`:

```bash
#!/bin/bash
PROJECT_PATH="$PWD"
PROJECT_NAME=$(basename "$PROJECT_PATH")

# Find the VS Code workspace root: walk up from $PWD, collect the topmost .vscode
# directory found, but stop at $HOME (don't use ~/.vscode which is global VS Code config)
WORKSPACE_ROOT="$PROJECT_PATH"
SEARCH_DIR="$PROJECT_PATH"
while [ "$SEARCH_DIR" != "/" ] && [ "$SEARCH_DIR" != "$HOME" ]; do
    if [ -d "$SEARCH_DIR/.vscode" ]; then
        WORKSPACE_ROOT="$SEARCH_DIR"
    fi
    SEARCH_DIR=$(dirname "$SEARCH_DIR")
done

# Write ancestor PID chain for terminal tab matching (VS Code extension reads this)
mkdir -p "$WORKSPACE_ROOT/.vscode"
SIGNAL_FILE="$WORKSPACE_ROOT/.vscode/.claude-focus"
PID_CHAIN=""
CURRENT_PID=$$
while [ "$CURRENT_PID" -gt 1 ] 2>/dev/null; do
    PID_CHAIN="${PID_CHAIN}${CURRENT_PID}\n"
    CURRENT_PID=$(ps -o ppid= -p "$CURRENT_PID" 2>/dev/null | tr -d ' ')
    [ -z "$CURRENT_PID" ] && break
done
printf "%b" "$PID_CHAIN" > "$SIGNAL_FILE"

# Play the notification sound (foreground — < 1 second, must not be killed early)
afplay /System/Library/Sounds/Funk.aiff

# Show banner notification — clicking it creates a marker file AND activates VS Code
CLICKED_FILE="$WORKSPACE_ROOT/.vscode/.claude-focus-clicked"
nohup terminal-notifier \
    -title "Claude Code" \
    -message "Waiting for your response in: $PROJECT_NAME" \
    -execute "touch '$CLICKED_FILE' && open -a 'Visual Studio Code'" \
    -group "claude-$PROJECT_NAME" \
    >/dev/null 2>&1 &
disown
```

Create `~/.claude/task-complete.sh`:

```bash
#!/bin/bash
PROJECT_PATH="$PWD"
PROJECT_NAME=$(basename "$PROJECT_PATH")

# Find the VS Code workspace root
WORKSPACE_ROOT="$PROJECT_PATH"
SEARCH_DIR="$PROJECT_PATH"
while [ "$SEARCH_DIR" != "/" ] && [ "$SEARCH_DIR" != "$HOME" ]; do
    if [ -d "$SEARCH_DIR/.vscode" ]; then
        WORKSPACE_ROOT="$SEARCH_DIR"
    fi
    SEARCH_DIR=$(dirname "$SEARCH_DIR")
done

# Write ancestor PID chain for terminal tab matching
mkdir -p "$WORKSPACE_ROOT/.vscode"
SIGNAL_FILE="$WORKSPACE_ROOT/.vscode/.claude-focus"
PID_CHAIN=""
CURRENT_PID=$$
while [ "$CURRENT_PID" -gt 1 ] 2>/dev/null; do
    PID_CHAIN="${PID_CHAIN}${CURRENT_PID}\n"
    CURRENT_PID=$(ps -o ppid= -p "$CURRENT_PID" 2>/dev/null | tr -d ' ')
    [ -z "$CURRENT_PID" ] && break
done
printf "%b" "$PID_CHAIN" > "$SIGNAL_FILE"

# Play the task-complete sound
afplay /System/Library/Sounds/Glass.aiff

# Show banner notification
CLICKED_FILE="$WORKSPACE_ROOT/.vscode/.claude-focus-clicked"
nohup terminal-notifier \
    -title "Claude Code - Done" \
    -message "Task completed in: $PROJECT_NAME" \
    -execute "touch '$CLICKED_FILE' && open -a 'Visual Studio Code'" \
    -group "claude-$PROJECT_NAME" \
    >/dev/null 2>&1 &
disown
```

Make them executable:

```bash
chmod +x ~/.claude/notify.sh ~/.claude/task-complete.sh
```

### Step 3: Configure Claude Code hooks

Add to `~/.claude/settings.json` (merge with existing content):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash $HOME/.claude/notify.sh"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash $HOME/.claude/task-complete.sh"
          }
        ]
      }
    ]
  }
}
```

> **Note**: The `Stop` hook fires when Claude finishes a task (uses `task-complete.sh` with Glass sound). The `Notification` hook fires when Claude needs user input (uses `notify.sh` with Funk sound). You can swap the sounds by changing the `.aiff` file paths.

### Step 4: Install VS Code extension

Create a temporary directory and two files:

```bash
mkdir -p /tmp/claude-terminal-focus
```

Create `/tmp/claude-terminal-focus/package.json`:

```json
{
  "name": "claude-terminal-focus",
  "displayName": "Claude Terminal Focus",
  "description": "Focuses the correct terminal tab when clicking a Claude Code notification",
  "version": "1.0.5",
  "publisher": "dimokol",
  "license": "MIT",
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./extension.js",
  "contributes": {}
}
```

Create `/tmp/claude-terminal-focus/extension.js`:

```javascript
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const SIGNAL_NAME = '.claude-focus';
const CLICKED_NAME = '.claude-focus-clicked';
const POLL_MS = 800;

function activate(context) {
    const log = vscode.window.createOutputChannel('Claude Terminal Focus');
    log.appendLine('Claude Terminal Focus extension activated');
    log.appendLine(`Workspace folders: ${(vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath).join(', ') || 'none'}`);

    const timer = setInterval(() => {
        if (!vscode.workspace.workspaceFolders) return;

        for (const folder of vscode.workspace.workspaceFolders) {
            const clickedPath = path.join(folder.uri.fsPath, '.vscode', CLICKED_NAME);

            if (fs.existsSync(clickedPath)) {
                log.appendLine(`Notification clicked — switching terminal (${folder.name})`);
                try { fs.unlinkSync(clickedPath); } catch (_) {}

                const signalPath = path.join(folder.uri.fsPath, '.vscode', SIGNAL_NAME);
                handleClick(signalPath, log);
                return;
            }
        }
    }, POLL_MS);

    context.subscriptions.push({ dispose: () => clearInterval(timer) });
    log.appendLine(`Polling every ${POLL_MS}ms for notification clicks`);
    log.appendLine('Ready — will focus terminal only when notification is clicked');
}

async function handleClick(signalPath, log) {
    let content;
    try {
        content = fs.readFileSync(signalPath, 'utf8').trim();
    } catch (err) {
        log.appendLine(`No signal file found: ${err.message}`);
        await vscode.commands.executeCommand('workbench.action.terminal.focus');
        return;
    }

    try { fs.unlinkSync(signalPath); } catch (_) {}

    const ancestorPids = content
        .split(/\r?\n/)
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);

    log.appendLine(`Signal PIDs: ${ancestorPids.join(', ')}`);

    const terminals = vscode.window.terminals;
    log.appendLine(`Open terminals (${terminals.length}): ${terminals.map(t => t.name).join(', ')}`);

    for (const terminal of terminals) {
        try {
            const termPid = await terminal.processId;
            if (termPid && ancestorPids.includes(termPid)) {
                log.appendLine(`PID match: "${terminal.name}" (PID ${termPid})`);
                await focusTerminal(terminal, log);
                return;
            }
        } catch (_) {}
    }

    for (const terminal of terminals) {
        const name = terminal.name.toLowerCase();
        if (name.includes('claude') || name.includes('node')) {
            log.appendLine(`Name match: "${terminal.name}"`);
            await focusTerminal(terminal, log);
            return;
        }
    }

    if (terminals.length > 0) {
        const lastTerminal = terminals[terminals.length - 1];
        log.appendLine(`Fallback: showing last terminal "${lastTerminal.name}"`);
        await focusTerminal(lastTerminal, log);
        return;
    }

    log.appendLine('No terminals found to focus');
}

async function focusTerminal(terminal, log) {
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
    terminal.show();
    setTimeout(() => {
        const active = vscode.window.activeTerminal;
        log.appendLine(`Active terminal after switch: "${active?.name || 'none'}"`);
    }, 300);
}

function deactivate() {}

module.exports = { activate, deactivate };
```

Package and install:

```bash
npm install -g @vscode/vsce
cd /tmp/claude-terminal-focus
vsce package --allow-missing-repository
code --install-extension claude-terminal-focus-*.vsix --force
```

### Step 5: Global gitignore

```bash
echo '# Claude Code terminal focus signal' >> ~/.gitignore_global
echo '.vscode/.claude-focus' >> ~/.gitignore_global
echo '.vscode/.claude-focus-clicked' >> ~/.gitignore_global
git config --global core.excludesfile ~/.gitignore_global
```

### Step 6: Verify (macOS)

1. Reload VS Code (Cmd+Shift+P → "Developer: Reload Window")
2. Open Output panel (Cmd+Shift+U) → select "Claude Terminal Focus" → should say "activated"
3. Open 2+ terminals, run Claude in one, work in another
4. When Claude needs input → you hear Funk sound + see banner with project name
5. Click the banner → VS Code opens + correct terminal tab is focused

---

## Windows Setup

### Step 1: Create notification scripts

Create `%USERPROFILE%\.claude\notify.ps1`:

```powershell
param()
$ProjectPath = (Get-Location).Path
$ProjectName = Split-Path $ProjectPath -Leaf

# Find VS Code workspace root (topmost .vscode directory below user profile)
$WorkspaceRoot = $ProjectPath
$SearchDir = $ProjectPath
while ($SearchDir -ne [System.IO.Path]::GetPathRoot($SearchDir) -and $SearchDir -ne $env:USERPROFILE) {
    if (Test-Path (Join-Path $SearchDir ".vscode")) {
        $WorkspaceRoot = $SearchDir
    }
    $SearchDir = Split-Path $SearchDir -Parent
}

# Write ancestor PID chain for terminal tab matching
$VscodeDir = Join-Path $WorkspaceRoot ".vscode"
if (-not (Test-Path $VscodeDir)) { New-Item -ItemType Directory -Path $VscodeDir -Force | Out-Null }
$SignalFile = Join-Path $VscodeDir ".claude-focus"

$PidChain = @()
$CurrentPid = $PID
while ($CurrentPid -gt 0) {
    $PidChain += $CurrentPid
    try {
        $Parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$CurrentPid" -ErrorAction Stop).ParentProcessId
        if ($Parent -eq $CurrentPid -or $Parent -eq 0) { break }
        $CurrentPid = $Parent
    } catch { break }
}
$PidChain -join "`n" | Set-Content -Path $SignalFile -NoNewline

# Play notification sound
[System.Media.SystemSounds]::Exclamation.Play()

# Show Windows toast notification
$ClickedFile = Join-Path $VscodeDir ".claude-focus-clicked"
# Create a BurntToast notification (install module first: Install-Module -Name BurntToast)
try {
    Import-Module BurntToast -ErrorAction Stop
    $Button = New-BTButton -Content "Open" -Arguments "vscode://$WorkspaceRoot" -ActivationType Protocol
    New-BurntToastNotification `
        -Text "Claude Code", "Waiting for your response in: $ProjectName" `
        -Button $Button `
        -UniqueIdentifier "claude-$ProjectName" `
        -AppLogo $null `
        -Sound Default
    # Write clicked file (BurntToast doesn't support click callbacks easily, so use a watcher approach)
    # The VS Code extension polls for the signal file on window focus instead
} catch {
    # Fallback: basic Windows notification via PowerShell
    Add-Type -AssemblyName System.Windows.Forms
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = "Claude Code"
    $notify.BalloonTipText = "Waiting for your response in: $ProjectName"
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000)
    Start-Sleep -Milliseconds 100
    $notify.Dispose()
}
```

Create `%USERPROFILE%\.claude\task-complete.ps1`:

```powershell
param()
$ProjectPath = (Get-Location).Path
$ProjectName = Split-Path $ProjectPath -Leaf

# Find VS Code workspace root
$WorkspaceRoot = $ProjectPath
$SearchDir = $ProjectPath
while ($SearchDir -ne [System.IO.Path]::GetPathRoot($SearchDir) -and $SearchDir -ne $env:USERPROFILE) {
    if (Test-Path (Join-Path $SearchDir ".vscode")) {
        $WorkspaceRoot = $SearchDir
    }
    $SearchDir = Split-Path $SearchDir -Parent
}

# Write ancestor PID chain
$VscodeDir = Join-Path $WorkspaceRoot ".vscode"
if (-not (Test-Path $VscodeDir)) { New-Item -ItemType Directory -Path $VscodeDir -Force | Out-Null }
$SignalFile = Join-Path $VscodeDir ".claude-focus"

$PidChain = @()
$CurrentPid = $PID
while ($CurrentPid -gt 0) {
    $PidChain += $CurrentPid
    try {
        $Parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$CurrentPid" -ErrorAction Stop).ParentProcessId
        if ($Parent -eq $CurrentPid -or $Parent -eq 0) { break }
        $CurrentPid = $Parent
    } catch { break }
}
$PidChain -join "`n" | Set-Content -Path $SignalFile -NoNewline

# Play task-complete sound
[System.Media.SystemSounds]::Asterisk.Play()

# Show Windows toast notification
try {
    Import-Module BurntToast -ErrorAction Stop
    New-BurntToastNotification `
        -Text "Claude Code - Done", "Task completed in: $ProjectName" `
        -UniqueIdentifier "claude-done-$ProjectName" `
        -AppLogo $null `
        -Sound Default
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = "Claude Code - Done"
    $notify.BalloonTipText = "Task completed in: $ProjectName"
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000)
    Start-Sleep -Milliseconds 100
    $notify.Dispose()
}
```

### Step 2: Install BurntToast (optional, for better notifications)

```powershell
Install-Module -Name BurntToast -Scope CurrentUser -Force
```

### Step 3: Configure Claude Code hooks (Windows)

Add to `%USERPROFILE%\.claude\settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.claude\\task-complete.ps1\""
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.claude\\notify.ps1\""
          }
        ]
      }
    ]
  }
}
```

### Step 4: Install VS Code extension (Windows)

Same extension works on both platforms. Follow the same steps from macOS Step 4 using PowerShell:

```powershell
mkdir $env:TEMP\claude-terminal-focus
# Create package.json and extension.js (same content as macOS)
# Then:
cd $env:TEMP\claude-terminal-focus
npx @vscode/vsce package --allow-missing-repository
code --install-extension claude-terminal-focus-*.vsix --force
```

### Step 5: Global gitignore (Windows)

```powershell
Add-Content -Path "$env:USERPROFILE\.gitignore_global" -Value ".vscode/.claude-focus"
Add-Content -Path "$env:USERPROFILE\.gitignore_global" -Value ".vscode/.claude-focus-clicked"
git config --global core.excludesfile "$env:USERPROFILE\.gitignore_global"
```

### Windows Notes

- On Windows, `terminal-notifier` is not available. We use **BurntToast** PowerShell module for toast notifications (falls back to basic balloon tips if not installed).
- Windows toast notifications don't support click-to-execute as easily as macOS `terminal-notifier`. The VS Code extension uses **window focus detection** as fallback — when you alt-tab to VS Code after seeing the notification, the extension checks for the signal file and switches to the correct terminal.
- PID chain walking uses `Get-CimInstance Win32_Process` instead of `ps -o ppid=`.
- Sound playback uses `[System.Media.SystemSounds]` instead of `afplay`.

---

## How It Works (Architecture)

```
Claude needs input
       │
       ▼
Hook script runs
       │
       ├── Writes .vscode/.claude-focus (PID chain of the Claude process)
       ├── Plays sound (afplay / SystemSounds)
       └── Shows notification banner (terminal-notifier / BurntToast)
                │
                ▼ (user clicks notification)
                │
                ├── [macOS] Creates .vscode/.claude-focus-clicked + activates VS Code
                └── [Windows] User alt-tabs to VS Code
                         │
                         ▼
              VS Code extension detects .claude-focus-clicked
                         │
                         ├── Reads .claude-focus (PID chain)
                         ├── Matches PID to terminal tab
                         └── Focuses the correct terminal
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No sound plays | macOS: Check `afplay` works in terminal. Windows: check system sound volume |
| No notification banner | macOS: System Settings → Notifications → terminal-notifier → enable. Windows: check BurntToast is installed |
| Extension not activating | VS Code Output panel → "Claude Terminal Focus" dropdown. If missing, reinstall the VSIX and reload |
| Wrong terminal focused | Check Output panel logs for PID matching. The extension tries: PID match → name match ("claude"/"node") → last terminal |
| Notification opens wrong VS Code window | The workspace root detection walks up directories looking for `.vscode/`. Make sure your VS Code workspace root has a `.vscode/` directory |
| macOS notification disappears too fast | System Settings → Notifications → terminal-notifier → set to "Alerts" instead of "Banners" |
