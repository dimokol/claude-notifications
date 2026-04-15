# Changelog

## [3.0.0] - 2026-04-15

### Added
- **Notification dedup handshake** — exactly one notification per event, never zero, never two. Extension and hook coordinate via claim markers.
- **Two-type event model** — `waiting` (Notification + PermissionRequest) and `completed` (Stop). Simpler settings, clearer copy.
- **Per-event sound customization** — choose different sounds per event type from bundled, OS system, or custom audio files.
- **"Choose Sound" and "Preview Sound" commands** — browse and test all available sounds.
- **macOS terminal-notifier setup** — one-time prompt, re-runnable command, Settings UI button.
- **`soundWhenFocused` setting** — play a sound even when already on the correct terminal, or stay silent.
- **Auto-fix hook paths** when extension updates (no more silent breakage).
- **Auto-install hooks** on fresh install (zero-interaction setup).
- **Status bar "Set Up" state** when hooks are missing.
- **esbuild bundling** (VSIX reduced from 3.2 MB to ~100 KB).
- **Focus behavior contract** — extension never auto-changes terminal focus without a click.
- Gallery banner, expanded keywords, this changelog.

### Changed
- Volume setting now uses 0–100 scale (was 0.0–1.0)
- Poll interval reduced from 800ms to 400ms for faster claim response
- Three-tier notification: sound only when on correct terminal, in-window toast when on wrong tab, OS notification when in different app

### Removed
- `node-notifier` dependency (was unused, ~3 MB savings)
- Three-type event model (replaced by simpler two-type model)

## [2.1.0] - 2026-04-14

### Added
- PermissionRequest event support
- Status bar mute toggle
- Moved sound and OS notifications to hook.js (runs outside VS Code for reliability)

## [2.0.0] - 2026-04-13

### Added
- Complete rewrite as Node.js-based system
- Cross-platform support (macOS, Windows, Linux)
- PID-based terminal tab matching
- Auto-install hooks command
- Bundled sound files (Glass, Funk)
- JSON signal file format (v2)

## [1.0.0] - 2026-04-03

### Added
- Initial release with shell-script hooks
- macOS support via terminal-notifier
- Basic terminal focus on notification click
