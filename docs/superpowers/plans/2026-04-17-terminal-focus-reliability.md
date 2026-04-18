# Terminal Focus Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make click-to-focus reliably land on the correct terminal tab when multiple Claude terminals are open, and make the output log unambiguous when two tabs share a display name.

**Architecture:** Two localised edits inside `extension.js`. A new `describeTerminal(terminal, index)` helper returns `[<index>]"<name>"(pid=<pid>)`, reused wherever a terminal is logged. `showTerminal` drops the redundant panel-focus command that races with `terminal.show()`.

**Tech Stack:** Node.js, VS Code Extension API (`vscode.window.terminals`, `Terminal.processId`, `Terminal.show`, `OutputChannel.appendLine`), esbuild for bundling.

---

## File Structure

- **Modify:** `extension.js` — add helper, update `focusMatchingTerminal` (lines 323-355) and `showTerminal` (lines 357-364).
- **Regenerate (automatic):** `dist/extension.js`, `dist/extension.js.map` — produced by `npm run build`, not edited by hand.

No new files. No changes to `hook.js`, `lib/signals.js`, or any other module.

---

## Testing Approach

The repository has no automated test harness, and these changes interact with VS Code window/terminal state that is impractical to unit-test without an extension test runner. Verification is manual against the output channel, following the steps in the spec.

To pick up code changes without reinstalling the VSIX, use VS Code's **Run Extension** debug launch (F5) from the source workspace — this loads `extension.js` directly from `/Users/dimokol/Documents/WebDev/claude-terminal-focus` in an Extension Development Host window. Alternatively, copy `dist/extension.js` into `~/.vscode/extensions/dimokol.claude-notifications-3.1.2/dist/` and reload.

---

## Task 1: Add `describeTerminal` helper

**Files:**
- Modify: `extension.js` — add the helper immediately above `focusMatchingTerminal` (currently line 323).

- [ ] **Step 1: Add the helper function**

Add this block at `extension.js:322` (immediately before `async function focusMatchingTerminal`):

```js
/**
 * Format a terminal for the output channel. Includes the index in
 * vscode.window.terminals so two tabs with the same display name can be
 * told apart. Resolves the shell PID asynchronously; logs `pid=?` if
 * the API throws (disposed terminal, platform quirk).
 */
async function describeTerminal(terminal, index) {
  let pid = '?';
  try {
    const resolved = await terminal.processId;
    if (resolved) pid = String(resolved);
  } catch (_) {}
  return `[${index}]"${terminal.name}"(pid=${pid})`;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension.js
git commit -m "refactor: add describeTerminal helper for disambiguating terminal log lines"
```

---

## Task 2: Use `describeTerminal` in `focusMatchingTerminal`

**Files:**
- Modify: `extension.js:323-355` — replace name-only log lines with helper calls in all four places (open-list, PID match, name match, fallback).

- [ ] **Step 1: Replace the function body**

Replace the entire current `focusMatchingTerminal` (lines 323-355) with:

```js
async function focusMatchingTerminal(pids, log) {
  const terminals = vscode.window.terminals;
  const descriptions = await Promise.all(terminals.map((t, i) => describeTerminal(t, i)));
  log.appendLine(`Open terminals (${terminals.length}): ${descriptions.join(', ')}`);

  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    try {
      const termPid = await terminal.processId;
      if (termPid && pids.includes(termPid)) {
        log.appendLine(`PID match: ${await describeTerminal(terminal, i)}`);
        await showTerminal(terminal, log);
        return;
      }
    } catch (_) {}
  }

  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    const name = terminal.name.toLowerCase();
    if (name.includes('claude') || name.includes('node')) {
      log.appendLine(`Name match: ${await describeTerminal(terminal, i)}`);
      await showTerminal(terminal, log);
      return;
    }
  }

  if (terminals.length > 0) {
    const lastIndex = terminals.length - 1;
    const lastTerminal = terminals[lastIndex];
    log.appendLine(`Fallback: last terminal ${await describeTerminal(lastTerminal, lastIndex)}`);
    await showTerminal(lastTerminal, log);
    return;
  }

  log.appendLine('No terminals found to focus');
}
```

What changed:
- `forEach`-style `for...of` loops replaced with index-carrying `for (let i; ...)` so we can pass the index to the helper.
- Open-terminals line now parallel-resolves descriptions via `Promise.all`, preserving ordering.
- All four log lines (open-list, PID match, name match, fallback) now use `describeTerminal`.
- Name-match substring logic unchanged — deliberately, per spec.

- [ ] **Step 2: Commit**

```bash
git add extension.js
git commit -m "feat: log terminal index+pid in focus diagnostics for disambiguation"
```

---

## Task 3: Simplify `showTerminal`

**Files:**
- Modify: `extension.js:357-364` — drop `workbench.action.terminal.focus`, upgrade the active-after-switch log.

- [ ] **Step 1: Replace the function body**

Replace the entire current `showTerminal` (lines 357-364) with:

```js
function showTerminal(terminal, log) {
  terminal.show();
  setTimeout(async () => {
    const active = vscode.window.activeTerminal;
    if (!active) {
      log.appendLine('Active terminal after switch: none');
      return;
    }
    const index = vscode.window.terminals.indexOf(active);
    log.appendLine(`Active terminal after switch: ${await describeTerminal(active, index)}`);
  }, 300);
}
```

What changed:
- Dropped `await vscode.commands.executeCommand('workbench.action.terminal.focus')`. `terminal.show()` already reveals the panel and focuses the specified terminal (its default `preserveFocus` is `false`).
- Function is no longer `async` — it has no awaits on its own axis; the `setTimeout` callback handles its own async work. Callers already `await` it; awaiting a non-promise is a no-op, so this is backwards-compatible.
- Active-after-switch log now uses `describeTerminal`, so an index mismatch between the `PID match` line and the `Active terminal after switch` line becomes visible evidence that `show()` did not take effect.
- `indexOf` returns `-1` if the terminal is no longer in the list (e.g., disposed between `show()` and the 300ms callback). The helper renders that as `[-1]` which is still a useful diagnostic.

- [ ] **Step 2: Commit**

```bash
git add extension.js
git commit -m "fix: drop redundant panel-focus before terminal.show() to stop race on same-name tabs"
```

---

## Task 4: Build and manually verify

**Files:**
- Run build to regenerate `dist/extension.js`.
- No source edits in this task.

- [ ] **Step 1: Build**

Run:

```bash
cd /Users/dimokol/Documents/WebDev/claude-terminal-focus
npm run build
```

Expected output: `Build complete: dist/extension.js, dist/hook.js`

- [ ] **Step 2: Launch Extension Development Host**

In VS Code, open the source folder `/Users/dimokol/Documents/WebDev/claude-terminal-focus` and press **F5** (Run Extension). A new VS Code window opens with the extension loaded from source. Open the **Output → Claude Notifications** channel in the dev host window.

- [ ] **Step 3: Verify disambiguating logs — in-window toast path**

In the Extension Development Host:
1. Open two terminals, both running native Claude (tabs should display as `2.1.112` or similar version).
2. Focus terminal B, then trigger a notification from terminal A (e.g., ask Claude for input).
3. When the in-window toast appears, click **Focus Terminal**.

Verify in the output channel:
- `Open terminals (2): [0]"<name>"(pid=<N>), [1]"<name>"(pid=<M>)` — each entry has an index and pid.
- `PID match: [<i>]"<name>"(pid=<P>)` — index `<i>` corresponds to terminal A.
- `Active terminal after switch: [<i>]"<name>"(pid=<P>)` — same `<i>` and `<P>` as the match line.
- The VS Code UI shows terminal A as the active tab.

Expected: match index == active-after-switch index, and the visual tab matches.

- [ ] **Step 4: Verify OS-banner path**

With the same two terminals:
1. Focus terminal B.
2. Trigger a notification from terminal A.
3. Switch to another application (e.g., a browser) so VS Code loses focus.
4. Click the OS banner when it appears.

Verify in the output channel:
- `Clicked marker found — <project>`
- `Click-to-focus — project=<project>, pids=[...]`
- `Open terminals (...)`, `PID match: ...`, `Active terminal after switch: ...` as in Step 3.
- The VS Code UI ends up with terminal A as the active tab.

Expected: VS Code returns to focus and terminal A is visibly active. Match index == active-after-switch index.

- [ ] **Step 5: Verify cross-build — one Homebrew, one native**

If a Homebrew/node claude build is available:
1. Uninstall and reinstall one Claude session so it runs under the Homebrew wrapper (terminal shows as `node`), keep the other running native (terminal shows as `2.1.112`).
2. Repeat steps 3 and 4 with notifications coming from each side in turn.

Expected: PID match succeeds in both directions regardless of which build fired the notification. Log indices continue to agree.

If no Homebrew build is available on this machine, skip this step and note it in the PR description.

- [ ] **Step 6: Commit the rebuilt dist**

```bash
git add dist/extension.js dist/extension.js.map dist/hook.js
git commit -m "build: rebuild dist after terminal focus reliability changes"
```

---

## Self-Review Checklist (post-implementation)

- `Active terminal after switch` line appears for every `PID match` / `Name match` / `Fallback` focus event.
- When two tabs share a name, `[<index>]` values in the log cleanly distinguish them.
- No `workbench.action.terminal.focus` call remains in `showTerminal` (`grep workbench.action.terminal.focus extension.js` returns nothing).
- No changes to `hook.js`, `lib/signals.js`, or any other module.
- `npm run build` completes without errors; `dist/extension.js` timestamp is updated.
