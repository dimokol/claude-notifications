# Claude Notifications — VS Code Extension Context

**Repository**: https://github.com/dimokol/claude-notifications
**Local path**: /Users/dimokol/Documents/WebDev/claude-terminal-focus (directory not yet renamed)
**Publisher**: dimokol
**Current version**: 2.1.0
**Marketplace name**: "Claude Notifications" (dimokol.claude-notifications)

---

## Architecture (v2.1)

Two components communicate via signal files:

```
hook.js (runs OUTSIDE VS Code, spawned by Claude Code)
  ├── Reads CLAUDE_PROJECT_DIR env var + stdin JSON (hook_event_name)
  ├── Finds workspace root (walks up for topmost .vscode/)
  ├── Builds PID ancestor chain (ps on mac/linux, wmic on windows)
  ├── Writes JSON signal file to .vscode/.claude-focus
  ├── Reads mute config from ~/.claude/claude-notifications-config.json
  ├── Plays sound (afplay on macOS, PowerShell on Windows, paplay on Linux)
  └── Shows OS notification (terminal-notifier on macOS, toast on Windows, notify-send on Linux)

extension.js (runs INSIDE VS Code)
  ├── Polls .vscode/.claude-focus every 800ms
  ├── On signal: shows in-window notification with "Focus Terminal" button
  ├── On click: matches PID chain to terminal → focuses correct tab
  ├── Status bar mute toggle (writes config that hook.js reads)
  ├── Commands: setup hooks, remove hooks, gitignore, test notification
  └── First-run: prompts to install hooks if not present
```

### Key Files
- `hook.js` — The hook script Claude Code calls (handles sound + OS notification)
- `extension.js` — VS Code extension (handles terminal focusing + commands)
- `lib/signals.js` — Shared constants, signal file parsing (v1 + v2 format)
- `lib/sounds.js` — Cross-platform sound playback
- `lib/hooks-installer.js` — Read/write ~/.claude/settings.json
- `lib/gitignore-setup.js` — Add signal files to global gitignore
- `sounds/notification.wav` — Funk sound (needs attention)
- `sounds/task-complete.wav` — Glass sound (task done)

### Signal File Format (v2)
```json
{
  "version": 2,
  "event": "stop|notification|permission",
  "project": "project-name",
  "projectDir": "/full/path",
  "workspaceRoot": "/full/path/to/vscode/root",
  "pids": [12345, 12300, 12200],
  "timestamp": 1712678400000
}
```

### Hooks Registered in ~/.claude/settings.json
Three events: `Stop`, `Notification`, `PermissionRequest`
Each points to: `node "/path/to/extension/hook.js"`

### Mute Config
Shared file: `~/.claude/claude-notifications-config.json`
```json
{ "muted": false, "soundEnabled": true, "volume": 0.5 }
```
Written by extension (status bar toggle), read by hook.js (to skip sound/notification when muted).

---

## Competitive Landscape

| Extension | Publisher | Installs | Approach |
|-----------|----------|----------|----------|
| Claude Notifier | Singularity Inc. | 1,757 | Shell scripts, 3 events, per-event levels, status bar, works outside VS Code |
| Claude Code Notifier | Erdem Giray | 1,701 | File watcher on /tmp/claude-notify, open source |
| Claude Notify | krsnasgr | 649 | Hooks → signal files → OS notifications |
| CC Ring | nelzomal | 506 | Sound-only, custom audio support, volume control |
| Claude Focus | evileye | 37 | Local HTTP server, "Go to Terminal" button |
| Claude Code Notify | STS | 25 | Windows-only, three-tier notification logic |

### Our Differentiators
- Cross-platform Node.js hook (single script, no shell/PowerShell dependencies)
- PID-based terminal tab matching (correct terminal, not just "a" terminal)
- Multi-window support (notifications + click-to-open correct VS Code window)
- Auto-install hooks (one-click command)
- Respects OS DND/mute preferences

### Weaknesses to Address
1. No custom sound support (CC Ring has this)
2. No per-event notification levels (Claude Notifier has this)
3. Extension size 3.2 MB (could bundle with esbuild to ~200 KB)
4. No "works outside VS Code" story for standalone terminal users

---

## Known Issues (Current)

### CRITICAL: Hooks break on extension update/rename
**Problem**: When the extension updates (new version or rename), the installed path changes (e.g., `dimokol.claude-terminal-focus-2.0.0` → `dimokol.claude-notifications-2.1.0`). The hooks in `~/.claude/settings.json` still point to the OLD path, so they silently fail — no sound, no notification.

**Root cause**: The hook command is `node "/path/to/extension/hook.js"` where the path includes the version number. VS Code installs new versions to a new directory.

**Required fix**: On activation, the extension must:
1. Check if hooks exist but point to a stale path
2. If so, automatically update the hook paths (or prompt the user)
3. This should happen silently — no user action needed for path updates

### No way to re-trigger setup
**Problem**: If a user dismisses the first-run "Set Up Claude Code Hooks?" prompt and clicks "Later", there's no obvious way to trigger it again except via the command palette. The `autoSetupHooks` setting prevents re-prompting.

**Required fix**:
1. Add a "Set Up" button to the status bar when hooks are not installed
2. OR always show the setup prompt on activation if hooks are not detected (regardless of `autoSetupHooks` — that setting should only control the *upgrade* prompt, not the initial setup)

### Fully plug-and-play goal
**Problem**: The extension requires user interaction (clicking "Install" in the setup prompt) to modify `~/.claude/settings.json`. Ideally it would be zero-interaction.

**Analysis**: Modifying `~/.claude/settings.json` without asking is risky (it's user config outside the workspace). However:
- For **fresh installs** (no hooks at all): could auto-install with an info message (no prompt)
- For **updates** (hooks exist but point to old path): should auto-fix silently (path correction, not adding new hooks)
- For **upgrades** (legacy shell hooks): should still prompt (destructive change)

This gives a tiered approach:
1. Path correction → automatic, silent
2. Fresh install → automatic with info toast
3. Legacy upgrade → prompt with Replace/Keep Both/Cancel

---

## Planned Updates (Priority Order)

### P0 — Blocking Issues

#### 1. Auto-fix hook paths on extension update
On activation, compare the hook path in `~/.claude/settings.json` with `context.extensionPath`. If they differ but both contain `hook.js`, silently update the path. Log the change to the output channel. No user prompt needed.

#### 2. Auto-install hooks for fresh installs
If no hooks exist at all (not even legacy), install them automatically with an info toast: "Claude Notifications: Hooks installed. You'll now get notifications when Claude needs attention." No prompt — just do it.

#### 3. Status bar "Set Up" state
When hooks are not installed, show `$(gear) Claude: Set Up` in the status bar instead of the bell icon. Clicking it runs the setup command.

### P1 — Feature Parity with Competitors

#### 4. Sound customization — per-event sounds with OS sound detection

Each event type (Stop, Notification, Permission) should have its own sound setting. Users can pick from three sources:

1. **Bundled sounds** (default) — `notification.wav` and `task-complete.wav` shipped with the extension
2. **OS system sounds** — auto-detected from the OS sound library:
   - macOS: scan `/System/Library/Sounds/*.aiff` (Funk, Glass, Basso, Blow, Bottle, Frog, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink)
   - Windows: scan `C:\Windows\Media\*.wav` (chimes, ding, notify, tada, etc.)
   - Linux: scan `/usr/share/sounds/` common paths
3. **Custom file** — user provides a path to any `.wav` / `.mp3` / `.aiff` file

Settings should feel human, friendly, and intuitive — use clear descriptions with examples, grouped under a "Sounds" section:

```
Claude Notifications > Sounds

  🔔 Task Complete Sound
  Sound to play when Claude finishes a task.
  [Bundled: Glass ▾]  — or —  [Browse for custom file...]

  🔔 Needs Attention Sound  
  Sound to play when Claude needs your input.
  [Bundled: Funk ▾]  — or —  [Browse for custom file...]

  🔔 Permission Request Sound
  Sound to play when Claude needs permission to proceed.
  [Bundled: Funk ▾]  — or —  [Browse for custom file...]

  🔊 Volume
  How loud should notification sounds be? (0 = silent, 100 = max)
  [50 ▾]
```

VS Code settings schema (dropdown with detected sounds + custom option):
- `claudeNotifications.sounds.taskComplete`: enum populated with bundled + OS sounds + "custom"
- `claudeNotifications.sounds.taskCompletePath`: file path (only used when above is "custom")
- `claudeNotifications.sounds.needsAttention`: same pattern
- `claudeNotifications.sounds.needsAttentionPath`: same
- `claudeNotifications.sounds.permissionRequest`: same pattern
- `claudeNotifications.sounds.permissionRequestPath`: same
- `claudeNotifications.sounds.volume`: number 0-100 (friendlier than 0.0-1.0)

The enum values can't be dynamically populated in VS Code settings schema (it's static JSON). So use a string type with a description listing available sounds, plus a command "Claude Notifications: Preview Sound" that plays the selected sound. The extension can also provide a quickpick command "Claude Notifications: Choose Sound" that scans the OS for available sounds and lets the user pick one — writing the result to settings.

Hook.js reads sound preferences from `~/.claude/claude-notifications-config.json` (written by the extension whenever settings change). The config includes resolved absolute paths to the sound files so hook.js doesn't need to scan the OS itself.

#### 5. Per-event notification settings
Add settings to control behavior per event. Use friendly labels:

```
Claude Notifications > When Claude...

  ✅ ...finishes a task
  What should happen when Claude completes its work?
  [Sound + Notification ▾]

  💬 ...needs your input
  What should happen when Claude has a question for you?
  [Sound + Notification ▾]

  🔐 ...needs permission
  What should happen when Claude needs approval to proceed?
  [Sound + Notification ▾]
```

Options: "Sound + Notification" | "Sound only" | "Notification only" | "Nothing"

Settings:
- `claudeNotifications.events.taskComplete`: enum
- `claudeNotifications.events.needsAttention`: enum
- `claudeNotifications.events.permissionRequest`: enum

Hook.js reads these from the config file to decide what to fire.

#### 6. Three-tier notification logic
- Already on correct terminal → no notification (implemented in v2.1) but still produce sound (maybe also configureable in settings)
- On wrong terminal/tab in same VS Code window → in-window notification + sound
- In different app or VS Code window → full OS notification + sound

### P2 — Polish

#### 7. Bundle with esbuild
Reduce VSIX from 3.2 MB to ~200 KB. Use esbuild to bundle extension.js and its dependencies. Hook.js stays unbundled (needs to run standalone).

#### 8. Add extensionDependencies for Claude Code
In order for users to get this extention as recommended when they are using the default claude code extention (or even using claude code cli) — free discoverability boost

#### 9. Polish keywords and make sure they are rich content full and cover the full spectrum of possibilities
Marketplace search is keyword-driven so this is important for discoverability.

#### 10. GIF/screenshots in README
I will film it after bundling the latest updates, I'll film both inside the vs code and also a notification outside of vs code in windows and mac so make sure we find the best place on the readme to include them (also let's hide the logo from the title for now since the readme appears right under the logo and title already so let's take this into account)
I'll record a GIF showing: Claude running → notification appears → click → correct terminal focused. and also notification appears on desktop → click → correct vs code instance gets focused on the correct terminal tab. Critical for marketplace conversion.

#### 11. Gallery banner in package.json
```json
"galleryBanner": { "color": "#1a1a1a", "theme": "dark" }
```

#### 12. CHANGELOG.md
Add a changelog for marketplace rendering. Include v1.0 → v2.0 → v2.1 history.

---

## Technical Notes

### macOS notification click-to-open
Requires `terminal-notifier` (brew install terminal-notifier). The hook uses:
```
terminal-notifier -title "..." -message "..." -execute "code '$WORKSPACE_ROOT'" -group "claude-$PROJECT"
```
Without terminal-notifier, falls back to `osascript` (no click action).

The `code` CLI path must be absolute (`/usr/local/bin/code` or `/opt/homebrew/bin/code`). The hook tries both, then falls back to `which code`.

### Windows notification click-to-open
Uses `vscode://file/<path>` protocol in the toast XML `launch` attribute. VS Code registers this URI handler on install.

### PID matching
The hook writes its ancestor PID chain. The extension matches terminal PIDs against this chain. On macOS/Linux, `ps -o ppid=` walks the chain. On Windows, `wmic process where ProcessId=X get ParentProcessId`. The terminal's shell PID should appear in the chain since the hook runs as: `node hook.js` → spawned by `claude` → spawned by `node` → spawned by terminal shell.

### Workspace root detection
Walks up from `CLAUDE_PROJECT_DIR`, looking for the topmost directory with `.vscode/` (stops at `$HOME`). This handles monorepos where VS Code is open at the root but Claude runs in a subdirectory.

### extensionDependencies
`package.json` declares `"extensionDependencies": ["anthropic.claude-code"]`. This means VS Code recommends Claude Notifications when Claude Code is installed.

---

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Claude Code hooks configuration |
| `~/.claude/claude-notifications-config.json` | Mute state + sound preferences (shared between hook.js and extension) |
| `~/.vscode/extensions/dimokol.claude-notifications-X.Y.Z/` | Installed extension directory |
| `.vscode/.claude-focus` | Signal file (written by hook, read by extension) |
| `.vscode/.claude-focus-clicked` | v1 click marker (backwards compat) |
| `~/.gitignore_global` | Should contain `.vscode/.claude-focus*` entries |

---

## Competitive Landscape research results — Claude Notification Extensions

  The Competitors

  ┌──────────────────────┬──────────────────┬──────────┬─────────────────┬──────────────┬───────────────────────────────────────────────┐
  │      Extension       │    Publisher     │ Installs │     Rating      │ Last Updated │                   Approach                    │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ Claude Notifier      │ Singularity Inc. │ 1,757    │ 0 stars         │ Apr 3, 2026  │ Shell scripts via hooks, afplay/PowerShell    │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ Claude Code Notifier │ Erdem Giray      │ 1,701    │ 0 stars         │ Jan 9, 2026  │ File watcher on /tmp/claude-notify            │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ Claude Notify        │ krsnasgr         │ 649      │ 3/5 (2 reviews) │ Mar 14, 2026 │ Hooks → signal files → OS notifications       │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ CC Ring              │ nelzomal         │ 506      │ 0 stars         │ Nov 12, 2025 │ Sound-only, hooks, custom audio support       │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ Claude Focus         │ evileye          │ 37       │ 5/5 (1 review)  │ Mar 22, 2026 │ Local HTTP server, "Go to Terminal" button    │
  ├──────────────────────┼──────────────────┼──────────┼─────────────────┼──────────────┼───────────────────────────────────────────────┤
  │ Claude Code Notify   │ STS              │ 25       │ 0 stars         │ Mar 3, 2026  │ Windows-only popups, multi-terminal detection │
  └──────────────────────┴──────────────────┴──────────┴─────────────────┴──────────────┴───────────────────────────────────────────────┘

  What Each Competitor Does Well

  Claude Notifier (Singularity Inc.) — Most installs. Covers 3 events (Stop, PermissionRequest, PreToolUse). Customizable per-event notification levels. Works outside VS
  Code (CLI, vim). Multiple sound presets. Status bar mute toggle.

  Claude Code Notifier (Erdem Giray) — Open source (GitHub). Simple file-watcher approach. Claims "zero configuration." Has a test command.

  CC Ring — Focused and simple. Custom audio file support (WAV, MP3). Volume control. Does one thing well (sound).

  Claude Focus — Unique HTTP server approach. "Go to Terminal" button. Clean UX. First-run hook setup prompt.

  Claude Code Notify (STS) — Best Windows support. Three-tier notification logic (silent when focused on correct terminal, VS Code notification when on wrong tab, Windows
   popup when minimized). Multi-terminal identification.

  ---
  Our Strengths vs. Competitors

  ┌─────────────────────────────────────────────┬─────────────────────────────┬─────────────────────────────────────────────┐
  │                   Feature                   │ Claude Notifications (ours) │               Best Competitor               │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Cross-platform hook (single Node.js script) │ Yes                         │ No — all use shell/PowerShell scripts       │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Auto-install hooks (one-click)              │ Yes                         │ Claude Focus, Claude Notifier also do this  │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ PID-based terminal tab matching             │ Yes                         │ STS has multi-terminal, but no PID matching │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Multi-window support                        │ Yes                         │ No competitor mentions this                 │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ VS Code API + node-notifier fallback        │ Yes                         │ Most use only one mechanism                 │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Respects OS DND/mute                        │ Yes                         │ Not documented by competitors               │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Bundled sounds                              │ Yes                         │ CC Ring has custom audio support            │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ v1 backwards compatibility                  │ Yes                         │ Not applicable                              │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Settings UI                                 │ Yes                         │ Claude Notifier, CC Ring also have this     │
  ├─────────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
  │ Linux support                               │ Yes                         │ Claude Notifier claims this                 │
  └─────────────────────────────────────────────┴─────────────────────────────┴─────────────────────────────────────────────┘

  Our Weaknesses / Gaps

  1. No PermissionRequest hook — Claude Notifier (Singularity) monitors 3 events (Stop, Notification, PermissionRequest). We only monitor Stop and Notification. Adding
  PermissionRequest would catch all cases where Claude needs the user.
  2. No status bar toggle — Claude Notifier has a status bar mute button for quick enable/disable without opening settings. We don't have this — users must go to settings
   or command palette.
  3. No custom sound support — CC Ring lets users use their own audio files (WAV, MP3). We only bundle two fixed sounds. Adding a custom sound path setting would be a
  quick win.
  4. No per-event notification levels — Claude Notifier lets users set different behaviors per event (sound+popup, sound-only, popup-only, off). We treat all events the
  same. This is a nice granularity feature.
  5. Three-tier notification logic — STS's approach is clever: silent when you're already looking at the correct terminal, VS Code notification when on wrong tab, OS
  popup when minimized. We always show notifications even when you're already on the right terminal.
  6. No "works outside VS Code" story — Claude Notifier works with CLI and vim. Our hook.js writes signal files, but the notification part requires VS Code. If someone
  uses Claude Code from a standalone terminal, they get nothing.
  7. Extension size — Our VSIX is 3.66 MB (mostly node-notifier). CC Ring is likely much smaller. Could bundle with esbuild to reduce.

  ---
  Marketplace Discoverability Techniques

  For your question about getting traction:

  1. Keywords — Already improved (added ai-coding, developer-tools, toast, claude-cli). Marketplace search is keyword-driven.
  2. extensionDependencies — You can declare anthropic.claude-code as an extension dependency. VS Code then shows "Claude Notifications" as a recommended extension when
  users have Claude Code installed.
  3. extensionPack — Alternative: create an extension pack that bundles your extension alongside Claude Code.
  4. VS Code recommendations file — Any repo can include .vscode/extensions.json with "recommendations": ["dimokol.claude-notifications"]. If you add this to your own
  project repos, anyone who opens them gets a recommendation.
  5. Gallery banner + README quality — A well-crafted README with screenshots/GIF of the notification flow significantly increases install conversion. Add a
  "galleryBanner" to package.json for marketplace color theming.
  6. GitHub stars + community — Post to r/ClaudeAI, r/vscode, Hacker News, X/Twitter. Stars drive marketplace ranking.

  Recommended Next Steps (Priority Order)

  1. Add PermissionRequest hook support — catches the most common complaint across competitors
  2. Add status bar mute toggle — table stakes, everyone expects this
  3. Add the three-tier notification logic — don't notify when already on the right terminal
  4. Add extensionDependencies for Claude Code — free discoverability boost
  5. Add a GIF/screenshot to README — huge impact on marketplace conversion
  6. Custom sound file path setting — differentiator over most competitors
  7. Bundle with esbuild — reduce VSIX size from 3.66 MB to ~200 KB

---

## plan #2:

# Plan: Notification routing, macOS setup, and event model cleanup



## Context



The `claude-notifications` VS Code extension at `/home/user/repo` surfaces Claude Code hook events (`Stop`, `Notification`, `PermissionRequest`) as OS banners, sounds, and in-window toasts. Three problems today:



1. **Noisy duplicate notifications.** `hook.js` runs outside VS Code and always fires an OS banner + sound. `extension.js` independently shows an in-window toast. When VS Code is focused on the wrong terminal the user gets *both*; when focused on the correct terminal they still get an OS banner they don't need.

2. **macOS UX is a cliff.** `osascript` banners aren't clickable, and `terminal-notifier` must be installed manually via Homebrew. The one-time install prompt is easy to miss, and there's no way to re-run it.

3. **Event model lumps three signals.** `Notification` and `PermissionRequest` are both "Claude needs a response" — indistinguishable to users, but they currently live as separate branches in copy and config.



The intended outcome: exactly one of `{OS banner, in-window toast, nothing}` fires per event; macOS gets smart OOTB behavior with a discoverable, re-runnable `terminal-notifier` setup; the two-type model (`waiting` vs `completed`) simplifies copy and per-event settings; the "never auto-change terminal focus" contract is preserved and documented.



## Architecture at a glance



```

Claude hook fires

    │

    ▼

hook.js writes .vscode/.claude-focus (signal)

    │

    ├── sleeps HANDSHAKE_MS (1200ms)

    │

    ▼

extension.js (polling at 400ms) sees signal:

    ├─ writes .claude-focus-claimed     ◀── claim marker

    ├─ deletes .claude-focus            ◀── atomic via unlinkSync-ENOENT guard

    │

    ├─ focused + on matching terminal?  → silent consume (no sound, no toast)

    └─ else                             → play sound + show "Focus Terminal" toast

    │

    ▼

hook.js wakes up, checks for .claude-focus-claimed

    ├─ exists  → extension took it, unlink marker, exit quietly

    └─ absent  → fire OS banner + play sound (fallback path)

```



Net effect: if the user is looking at the right window + terminal, nothing fires. If they're in VS Code but on the wrong terminal, they see a toast (no double banner). If VS Code is closed or unfocused long enough, they get the OS banner.



## Phase 1 — Hook↔Extension coordination handshake



File-by-file. The full design came from the Plan agent; cited line numbers are against the current files.



### `hook.js`

- Wrap the script body in `(async () => { ... })()`; import `setTimeout` from `node:timers/promises`.

- Move sound playback (lines 122–151) and OS banner (lines 153–225) into a single `fireBanner(signal, sound)` helper.

- After `fs.writeFileSync(signalPath, ...)` at line 117, insert:

  ```js

  await setTimeout(HANDSHAKE_MS);              // default 1200ms

  const claimPath = path.join(signalDirPath, '.claude-focus-claimed');

  if (fs.existsSync(claimPath)) {

    try { fs.unlinkSync(claimPath); } catch {}

    process.exit(0);                            // extension claimed, stay silent

  }

  await fireBanner(signalPayload, soundName);  // fallback: extension didn't claim

  ```

- Read optional `handshakeMs` override from `~/.claude/claude-notifications-config.json` (default 1200).

- Preserve existing `isMuted` early-return at line 120.



### `extension.js`

- Reduce `POLL_MS` (line 13) from 800 → 400, so the average claim happens ~200ms in — well inside the 1200ms budget.

- Rewrite `handleSignal()` (lines 94–138) with atomic claim:

  ```js

  async function handleSignal(signalPath, log) {

    const content = readFile(signalPath);                           // guard ENOENT

    try { fs.writeFileSync(getClaimedPath(workspaceRoot), ''); }    // new helper

    catch {}

    try { fs.unlinkSync(signalPath); } catch { return; }             // someone else won

    const signal = parseSignal(content);

    if (!signal) return;

    const config = readConfig();

    if (config.muted) return;                                        // still claim, suppresses banner

    // Case A: focused + on the matching terminal → silent consume

    const activeTerminal = vscode.window.activeTerminal;

    if (activeTerminal && vscode.window.state.focused) {

      const pid = await activeTerminal.processId.catch(() => null);

      if (pid && signal.pids.includes(pid)) return;

    }

    // Case B: show toast + play sound via extension

    const soundName = signal.event === 'completed' ? 'task-complete' : 'notification';

    if (config.soundEnabled !== false) playSound(soundName, config.volume ?? 0.5);

    const action = await vscode.window.showInformationMessage(

      signal.event === 'completed'

        ? `Task completed in: ${signal.project}`

        : `Waiting for your response in: ${signal.project}`,

      'Focus Terminal'

    );

    if (action === 'Focus Terminal') await focusMatchingTerminal(signal.pids, log);

  }

  ```

- Wire `playSound` from `lib/sounds.js` (already imported, currently unused).

- On activation and on each poll tick, sweep stale claim markers (mtime > 5s).



### `lib/signals.js`

- Export `CLAIMED_FILE = '.claude-focus-claimed'` and `getClaimedPath(workspaceRoot)`.

- No changes to the signal JSON schema — **file existence is the handshake**, no `bannerPending` flag needed.



### New config keys (undocumented overrides in `~/.claude/claude-notifications-config.json`)

- `handshakeMs` (default 1200)

- `claimStaleMs` (default 5000)



### Races handled

- **Two windows claim at once:** atomic `readFile → writeFile(claim) → unlinkSync(signal)`; second window's `unlinkSync` throws ENOENT and aborts before showing a toast.

- **Extension cold-starting when hook fires:** 1200ms budget usually enough; if not, OS banner fires (safe fallback). `onStartupFinished` + `onDidChangeWindowState` already surfaces just-missed signals when the user focuses the window.

- **Extension crashes mid-claim:** no marker written → hook falls through to banner. Stale claim markers are swept after 5s.



## Phase 2 — Two-type event model (`waiting` | `completed`)



### `hook.js`

- Map incoming `HOOK_EVENT_NAME`:

  - `Stop` → `event: 'completed'`

  - `Notification` → `event: 'waiting'`

  - `PermissionRequest` → `event: 'waiting'`

- Consolidate `eventMessages` to two entries (`waiting`, `completed`) with message + sound.

- Keep writing the canonical value to the signal JSON's `event` field.



### `extension.js`

- Replace the `signal.event === 'stop'` ternary with `signal.event === 'completed'` (see Phase 1 snippet). Keep a compat branch that treats legacy `'stop'` as `'completed'` for one release so stale signals from older hooks don't break.



### `lib/signals.js`

- Update `parseSignal` to accept `event ∈ {'waiting','completed','stop'}`; map `'stop'` → `'completed'` for forward-compat in memory.



### `package.json` — new per-event configuration

Add under `contributes.configuration`:

```json

"claudeNotifications.events.waiting.enabled":   { "type": "boolean", "default": true },

"claudeNotifications.events.waiting.sound":     { "type": "string", "enum": ["notification","task-complete","none"], "default": "notification" },

"claudeNotifications.events.completed.enabled": { "type": "boolean", "default": true },

"claudeNotifications.events.completed.sound":   { "type": "string", "enum": ["notification","task-complete","none"], "default": "task-complete" }

```

Both `hook.js` (via the shared config file) and `extension.js` consult `events.<type>.enabled` and `events.<type>.sound`. If `enabled === false`, hook skips the banner/sound AND extension skips the toast (but still claims, so neither fires).



## Phase 3 — macOS `terminal-notifier` opt-in + re-runnable setup



### One-time prompt on first macOS activation

In `extension.js` activation (macOS only), check `which terminal-notifier`. If missing and `globalState.get('macNotifierPromptAnswered') !== true`:



> **Claude Notifications — Recommended:** Install `terminal-notifier` for click-to-open banners (best experience on macOS). Using `osascript` fallback otherwise.

>

> **[Install (Recommended)]  [Keep osascript]  [Don't Ask Again]**



- **Install**: detect Homebrew with `execSync('command -v brew')`.

  - If found: open a new integrated terminal and run `brew install terminal-notifier`; set `globalState.macNotifierPromptAnswered = true` on completion.

  - If not: open an info toast linking to `https://github.com/julienXX/terminal-notifier#installation`.

- **Keep osascript** / **Don't Ask Again**: set `globalState.macNotifierPromptAnswered = true`. "Keep osascript" resets on next major version; "Don't Ask Again" persists forever.



### Re-runnable setup command

Add to `package.json` `contributes.commands`:

```json

{ "command": "claudeNotifications.setupMacNotifier",

  "title": "Claude Notifications: Set Up macOS terminal-notifier (Recommended)" }

```

The handler (registered in `extension.js`) runs the same flow as the "Install" branch above, but always — even if `terminal-notifier` is already present (shows "Already installed — reinstall?" in that case). No OS gating on the command itself; on non-macOS it shows a message that setup isn't needed.



### Button in the Settings UI

Use VS Code's `markdownDescription` with a `command:` URI on a synthetic configuration key. Add to `package.json`:

```json

"claudeNotifications.macOS.setup": {

  "type": "null",

  "markdownDescription": "macOS banners need `terminal-notifier` for click-to-open. [Run setup (Recommended)](command:claudeNotifications.setupMacNotifier)"

}

```

This renders as a link/button directly in the Settings page under `Claude Notifications › macOS: Setup`. (The user asked for "a button similarly to how they have the option to run the update setup" — `markdownDescription` + `command:` URI is the standard VS Code pattern for this.)



## Phase 4 — Never-auto-focus contract (document + audit)



**Contract:** the extension never changes terminal focus without an explicit user press — either the **"Focus Terminal"** button on an in-window toast or an **OS banner click** (which only focuses the window; the resulting in-window toast still requires a click to focus the terminal).



- Audit all new code paths from Phase 1 to confirm no `activeTerminal.show()` / `focusMatchingTerminal()` call runs without a button press. Silent-consume branch must NOT call focus.

- Add a comment block at the top of `handleSignal()` stating the contract.

- Add a short section to `README.md` titled **"Focus behavior"** explaining the contract so users aren't surprised.



## Phase 5 — Settings & copy polish



- In `README.md`, add an "Installation (macOS)" section that recommends running `Claude Notifications: Set Up macOS terminal-notifier (Recommended)` from the Command Palette.

- In every user-visible `terminal-notifier` reference, use the phrase **"Recommended for best experience."**

- Group existing configuration under `Claude Notifications` with subsections: `Events`, `Sounds`, `macOS`.



## Critical files to modify



- `/home/user/repo/hook.js` — async wrapper, handshake sleep, two-type event mapping, gated `fireBanner`.

- `/home/user/repo/extension.js` — rewritten `handleSignal`, faster poll, claim markers, macOS setup prompt & command registration, stale-marker sweep.

- `/home/user/repo/lib/signals.js` — `getClaimedPath` export, legacy-`stop` compat in `parseSignal`.

- `/home/user/repo/lib/sounds.js` — confirm sound keys match hook.js; no code change expected.

- `/home/user/repo/package.json` — new command, new configuration keys (per-event + macOS setup link), activation events include `onStartupFinished` (likely already present).

- `/home/user/repo/README.md` — macOS install section, focus-behavior section, two-type event copy.



## Reused utilities (do not reinvent)



- `lib/signals.js` `parseSignal` / `SIGNAL_FILE` / 30s staleness — keep as-is, only extend.

- `lib/sounds.js` `playSound` — wire into `extension.js` (already imported, unused today).

- `extension.js` `readConfig()` — already reads `~/.claude/claude-notifications-config.json`; extend to read `events.*` overrides.

- Existing `focusMatchingTerminal` helper — unchanged; still the only function that focuses terminals.



## Verification



End-to-end checks, all manual (no unit test scaffolding today):



1. **Dedup — focused + correct terminal.** Open a workspace in VS Code, run Claude in its integrated terminal, trigger a `Notification` event. Expect: no sound, no OS banner, no toast. Confirm via hook.js log at `~/.claude/claude-notifications-hook.log`: line "Extension claimed signal".

2. **Dedup — focused + wrong terminal.** Same setup, but switch the active terminal to a different one before triggering. Expect: in-window toast + sound (from extension). No OS banner.

3. **Dedup — VS Code unfocused.** Alt-tab away, trigger. Expect: OS banner + sound (from hook.js). Bring VS Code forward → pending toast surfaces via `onDidChangeWindowState`.

4. **No auto-focus.** In scenarios 2 and 3, confirm the active terminal never changes without clicking "Focus Terminal".

5. **macOS setup — first run.** Fresh VS Code profile on macOS without `terminal-notifier`. Activate extension → the recommendation prompt appears once. Choose "Keep osascript" → prompt does not reappear on reload. Run `Claude Notifications: Set Up macOS terminal-notifier (Recommended)` from the Command Palette → installer flow runs. Re-run the command → it says "Already installed".

6. **Settings button.** Open Settings → search "claude notifications" → confirm the `macOS: Setup` entry shows a clickable link that triggers the setup command.

7. **Two-type events.** Trigger a `PermissionRequest` and a `Notification` back-to-back. Both surface with copy **"Waiting for your response in: …"**. Trigger `Stop` → copy is **"Task completed in: …"**.

8. **Per-event disable.** Set `claudeNotifications.events.waiting.enabled = false`. Trigger `Notification` → nothing fires anywhere. Set `claudeNotifications.events.completed.sound = "none"`. Trigger `Stop` → toast appears silently.

9. **Races — two windows.** Open the same workspace in two VS Code windows. Trigger an event. Only one window shows a toast; no OS banner fires; no errors in either window's "Claude Notifications" output channel.

10. **Legacy signal.** Manually drop a signal file with `event: "stop"` into `.vscode/.claude-focus`. Extension handles it as `completed` (compat branch).