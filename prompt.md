So: the hash fix should fully restore Windows behavior. Sound + banner when unfocused, in-window toast + sound when focused, full Output channel logging, proper   claim race so notifications don't double up.

  What to do now

  1. Reload your VS Code window (Ctrl+Shift+P → "Developer: Reload Window").
  2. Restart any active claude CLI sessions (Claude reads ~/.claude/settings.json once at startup, but in your case the path to dist/hook.js didn't change — only
  the hash logic inside it — so this step actually isn't strictly required this time. But it's safer to do it anyway.)
  3. Trigger a Claude event with VS Code focused. You should now see lines like Signal: event=waiting(Notification), session=…, project=claude-notifications,
  pids=[…] appearing in the Claude Notifications Output channel — that's the proof the polling loop is finally finding signals.
  4. Trigger another Claude event with VS Code alt-tabbed away. Watch your screen — a banner should pop briefly. If it doesn't, expand the Action Center (Win+N)
  afterwards and confirm the toast at least registered.

  If after this banners still seem unreliable when you're alt-tabbed, I'll add a proper Start-Menu-shortcut AppUserModelID registration to make our toasts a
  "first-class app" rather than piggybacking on Windows' generic "Run" identity — that's the real Microsoft-recommended path and would make the toasts more
  reliable through Focus Assist quirks. But I don't think we'll need it.