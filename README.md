# Claude Notifications

**All-in-one Claude Code notification system — sound alerts, OS notifications, and terminal focus. Zero-interaction setup, fully customizable.**

![Demo](images/demo.gif)

When running multiple Claude Code sessions across different VS Code windows and terminals:

1. **Hear a sound** when Claude finishes a task or needs your input
2. **See an OS notification** showing which project needs attention — even when VS Code is not in focus
3. **Click the notification** to jump directly to the correct VS Code window and terminal tab

Works on **macOS**, **Windows**, and **Linux** with multiple VS Code windows and terminals simultaneously.

## Quick Start

1. **Install** from the VS Code Marketplace:
   - Extensions (Ctrl/Cmd+Shift+X) → Search **"Claude Notifications"** → Install

2. **That's it.** Hooks are installed automatically on first activation — no prompts, no clicks. You'll see a confirmation toast and the status bar shows `$(bell) Claude: Notify`.

   If you ever need to re-install: `Ctrl/Cmd+Shift+P` → **"Claude Notifications: Set Up Claude Code Hooks"**

## What's New in v3.0

- **Exactly one notification per event** — smart handshake between hook and extension eliminates duplicate notifications. No more double-bang.
- **Two-type event model** — `waiting` (Claude needs your response) and `completed` (task finished). Simpler settings, clearer copy.
- **Per-event sounds** — choose different sounds for each event type. Pick from bundled sounds, OS system sounds, or your own audio files.
- **Smart three-tier behavior** — sound only when already on the right terminal; in-window toast when on the wrong tab; OS notification when in a different app.
- **macOS terminal-notifier setup** — one-time prompt + re-runnable command + Settings UI button. Recommended for best experience.
- **Zero-interaction setup** — hooks install automatically. Stale paths auto-fix on extension update.
- **Tiny package** — bundled with esbuild, down from 3.2 MB to ~100 KB.

## How It Works

```
Claude needs input / finishes task / needs permission
       │
       ▼
Claude Code fires Stop, Notification, or PermissionRequest hook
       │
       ▼
hook.js writes signal file → waits 1.2s for extension to claim
       │
       ├── Extension claims (VS Code is focused):
       │     ├─ Correct terminal? → sound only (configurable)
       │     └─ Wrong terminal?   → sound + in-window toast
       │
       └── Extension doesn't claim (VS Code not focused / closed):
             └─ hook.js fires OS banner + sound (fallback)
```

**Key design**: Exactly one notification path fires per event — never zero, never two. The extension and hook coordinate via a claim marker file.

## Focus Behavior

The extension **never changes terminal focus without an explicit user action**:
- Clicking **"Focus Terminal"** on an in-window toast
- Clicking an **OS notification** (which focuses the VS Code window; the toast still requires a click)

You will never lose your place in a terminal because of a notification.

## Status Bar

The extension adds a status bar item with three states:

- `$(gear) Claude: Set Up` — hooks not installed (click to install)
- `$(bell) Claude: Notify` — notifications active (click to mute)
- `$(bell-slash) Claude: Muted` — notifications muted (click to unmute)

When muted, signal files are still written (for terminal focus) but no sound or notification is shown.

## Settings

### Events

| Setting | Default | Description |
|---------|---------|-------------|
| `events.waiting` | `Sound + Notification` | When Claude needs your response (Notification + Permission events) |
| `events.completed` | `Sound + Notification` | When Claude finishes a task (Stop event) |

Options: `Sound + Notification` | `Sound only` | `Notification only` | `Nothing`

### Sounds

| Setting | Default | Description |
|---------|---------|-------------|
| `sounds.waiting` | `bundled:notification` | Sound for "waiting" events. Values: `bundled:*`, `system:<name>`, `custom`, `none` |
| `sounds.waitingPath` | | Custom file path (when set to `custom`) |
| `sounds.completed` | `bundled:task-complete` | Sound for "completed" events |
| `sounds.completedPath` | | Custom file path (when set to `custom`) |
| `sounds.volume` | `50` | Sound volume (0–100) |

### Behavior

| Setting | Default | Description |
|---------|---------|-------------|
| `soundWhenFocused` | `sound` | What to do when already on the correct terminal: `sound` or `nothing` |
| `autoSetupHooks` | `true` | Prompt to upgrade legacy shell-script hooks |

### macOS

| Setting | Description |
|---------|-------------|
| `macOS.setup` | Click to install `terminal-notifier` for click-to-open banners. Recommended for best experience. |

All settings are prefixed with `claudeNotifications.` — e.g., `claudeNotifications.sounds.volume`.

## Commands

Open the command palette (`Ctrl/Cmd+Shift+P`) and search for:

| Command | Description |
|---------|-------------|
| **Set Up Claude Code Hooks** | Install hooks in `~/.claude/settings.json` |
| **Remove Claude Code Hooks** | Remove hooks (keeps other settings intact) |
| **Add Signal Files to Global Gitignore** | Prevent signal files from showing in git |
| **Test Notification** | Send a test notification to verify your setup |
| **Toggle Mute** | Mute/unmute notifications (also via status bar) |
| **Choose Sound** | Browse bundled, system, and custom sounds per event |
| **Preview Sound** | Listen to any available sound without changing settings |
| **Set Up macOS terminal-notifier** | Install terminal-notifier via Homebrew (macOS only) |

## Monitored Events

The extension monitors three Claude Code hook events, grouped into two types:

| Type | Hook Events | Notification |
|------|------------|-------------|
| **Waiting** | Notification, PermissionRequest | "Waiting for your response in: {project}" + Funk sound |
| **Completed** | Stop | "Task completed in: {project}" + Glass sound |

## macOS Setup

For the best click-to-open experience on macOS, install `terminal-notifier`. The extension will prompt you on first activation, or you can run it anytime:

`Ctrl/Cmd+Shift+P` → **"Claude Notifications: Set Up macOS terminal-notifier (Recommended)"**

You can also find the setup link in Settings under **Claude Notifications > macOS: Setup**.

After installing: **System Settings → Notifications → terminal-notifier** → set to **Alerts**.

Without terminal-notifier, the extension falls back to `osascript` notifications (which work but don't support click-to-open).

## Upgrading from v1.x

If you previously used the shell-script based setup:

1. The extension will detect your legacy hooks and offer to upgrade automatically
2. Choosing **"Replace"** removes the old shell hooks and installs the new Node.js hook
3. You can safely delete the old scripts (`~/.claude/notify.sh`, `~/.claude/task-complete.sh`, etc.)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No notifications | Run **"Test Notification"** from the command palette |
| No sound | Check `claudeNotifications.events.*` settings and status bar mute state |
| Double notifications | Update to v3.0 — the handshake dedup eliminates this |
| Notification doesn't open VS Code | macOS: run **"Set Up macOS terminal-notifier"** command. Windows: automatic via `vscode://` URI. |
| Extension not activating | Output panel → "Claude Notifications" dropdown |
| Wrong terminal focused | Check Output panel PID matching logs |
| Hooks not firing | Run **"Set Up Claude Code Hooks"** command. Restart Claude Code after setup. |

## How the Hook Works

The extension ships a `hook.js` file that Claude Code runs when it needs your attention. This script:

1. Reads the project directory from `CLAUDE_PROJECT_DIR` environment variable
2. Finds the VS Code workspace root (walks up looking for `.vscode/`)
3. Builds a PID ancestor chain (for terminal tab matching)
4. Writes a JSON signal file to `.vscode/.claude-focus`
5. Waits 1.2 seconds for the extension to claim the signal
6. If claimed: exits silently (extension handled it)
7. If not claimed: plays sound + shows OS notification (fallback)

The script is pure Node.js with no npm dependencies — it works identically on macOS, Windows, and Linux.

## License

MIT
