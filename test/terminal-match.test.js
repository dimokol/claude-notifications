const { test } = require('node:test');
const assert = require('node:assert');
const { matchTerminal, isDefaultShellName, normalizePath } = require('../lib/terminal-match');

const T = (index, name, pid, cwd) => ({ index, name, pid, cwd });

test('returns null on empty terminal list', () => {
  assert.strictEqual(matchTerminal([], { pids: [1] }), null);
});

test('PID tier: signal.shellPid matches terminal.pid', () => {
  const terminals = [T(0, 'bash', 1234, null), T(1, 'powershell', 5678, null)];
  const m = matchTerminal(terminals, { pids: [], shellPid: 1234 });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'pid');
});

test('PID tier: any pid in signal.pids matches', () => {
  const terminals = [T(0, 'bash', 1234, null), T(1, 'powershell', 5678, null)];
  const m = matchTerminal(terminals, { pids: [9999, 5678] });
  assert.strictEqual(m.index, 1);
  assert.strictEqual(m.tier, 'pid');
});

test('PID tier: ambiguous (two terminals match) falls through', () => {
  // Unlikely in practice but defensive.
  const terminals = [T(0, 'bash', 1234, '/p'), T(1, 'bash', 1234, '/p')];
  const m = matchTerminal(terminals, { pids: [1234], workspaceRoot: '/p' });
  // PID tier matched 2, cwd matches 2, marker matches 0, non-default matches 0
  assert.strictEqual(m, null);
});

test('cwd tier: exact workspaceRoot match', () => {
  const terminals = [
    T(0, 'bash', 1, '/home/u/proj'),
    T(1, 'powershell', 2, '/home/u')
  ];
  const m = matchTerminal(terminals, { pids: [], workspaceRoot: '/home/u/proj' });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'cwd');
});

test('cwd tier: subdir of workspaceRoot match', () => {
  const terminals = [
    T(0, 'bash', 1, '/home/u/proj/src'),
    T(1, 'powershell', 2, '/somewhere/else')
  ];
  const m = matchTerminal(terminals, { pids: [], workspaceRoot: '/home/u/proj' });
  assert.strictEqual(m.index, 0);
});

test('cwd tier: Windows path case-insensitive drive letter', () => {
  const terminals = [
    T(0, 'bash', 1, 'd:\\SilvWeb Studio\\silvweb.studio'),
    T(1, 'powershell', 2, 'C:\\Users\\u')
  ];
  const m = matchTerminal(terminals, { pids: [], workspaceRoot: 'D:\\SilvWeb Studio\\silvweb.studio' });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'cwd');
});

test('claude-marker tier: ✳ in name', () => {
  const terminals = [
    T(0, '✳ Debug exported Webflow website on cPanel', 18260, null),
    T(1, 'powershell', 3848, null)
  ];
  const m = matchTerminal(terminals, { pids: [3584, 17332], project: 'silvweb.studio' });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'claude-marker');
});

test('claude-marker tier: project basename in name', () => {
  const terminals = [
    T(0, 'silvweb.studio', 1, null),
    T(1, 'powershell', 2, null)
  ];
  const m = matchTerminal(terminals, { pids: [], project: 'silvweb.studio' });
  assert.strictEqual(m.index, 0);
});

test('claude-marker tier: project basename too short → not used', () => {
  const terminals = [
    T(0, 'app', 1, null),
    T(1, 'powershell', 2, null)
  ];
  const m = matchTerminal(terminals, { pids: [], project: 'app' });
  // 'app' is 3 chars (< PROJECT_NAME_MIN_LEN). Falls through to non-default-name.
  // 'app' is not in default shell names → it's the single non-default → matches.
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'non-default-name');
});

test('non-default-name tier: single non-default terminal wins', () => {
  const terminals = [
    T(0, 'My Custom Terminal', 1, null),
    T(1, 'powershell', 2, null),
    T(2, 'cmd', 3, null)
  ];
  const m = matchTerminal(terminals, { pids: [] });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'non-default-name');
});

test('non-default-name tier: two non-default terminals → null (ambiguous)', () => {
  const terminals = [
    T(0, 'Custom A', 1, null),
    T(1, 'Custom B', 2, null)
  ];
  const m = matchTerminal(terminals, { pids: [] });
  assert.strictEqual(m, null);
});

test('non-default-name tier: VS Code numbered suffix is still "default"', () => {
  const terminals = [
    T(0, 'My Claude Session', 1, null),
    T(1, 'powershell (1)', 2, null),
    T(2, 'powershell (2)', 3, null)
  ];
  const m = matchTerminal(terminals, { pids: [] });
  assert.strictEqual(m.index, 0);
});

test('tier ordering: PID beats cwd', () => {
  const terminals = [
    T(0, 'bash', 1, '/some/other/dir'),
    T(1, 'bash', 9999, '/home/u/proj')
  ];
  const m = matchTerminal(terminals, { pids: [1], workspaceRoot: '/home/u/proj' });
  assert.strictEqual(m.index, 0);
  assert.strictEqual(m.tier, 'pid');
});

test('tier ordering: cwd beats claude-marker', () => {
  const terminals = [
    T(0, '✳ busy task', 1, '/wrong/dir'),
    T(1, 'bash', 2, '/home/u/proj')
  ];
  const m = matchTerminal(terminals, { pids: [], workspaceRoot: '/home/u/proj' });
  assert.strictEqual(m.index, 1);
  assert.strictEqual(m.tier, 'cwd');
});

test('no fallback: nothing matches → returns null (not "last terminal")', () => {
  const terminals = [
    T(0, 'powershell', 1, '/somewhere'),
    T(1, 'cmd', 2, '/elsewhere')
  ];
  const m = matchTerminal(terminals, { pids: [9999], workspaceRoot: '/home/u/proj', project: 'proj' });
  assert.strictEqual(m, null);
});

test('real-world scenario: her bug report log', () => {
  // From the v3.3.2 user report on Windows + Git Bash.
  const terminals = [
    T(0, '✳ Debug exported Webflow website on cPanel', 18260, null),
    T(1, 'powershell', 3848, null)
  ];
  const signal = {
    pids: [3584, 17332, 14576, 18832, 14100],
    workspaceRoot: 'd:\\SilvWeb Studio\\silvweb.studio',
    project: 'silvweb.studio'
  };
  const m = matchTerminal(terminals, signal);
  assert.strictEqual(m.index, 0, 'should pick the Git Bash terminal where Claude is running');
  assert.strictEqual(m.tier, 'claude-marker');
});

test('isDefaultShellName covers common shells', () => {
  for (const n of ['bash', 'Bash', ' powershell ', 'pwsh', 'cmd', 'zsh', 'fish', 'sh']) {
    assert.ok(isDefaultShellName(n), `${n} should be default`);
  }
  assert.ok(!isDefaultShellName('Custom'));
  assert.ok(!isDefaultShellName('✳ task'));
});

test('normalizePath lowercases Windows drive letter and strips trailing slashes', () => {
  assert.strictEqual(normalizePath('D:\\foo\\bar\\'), 'd:/foo/bar');
  assert.strictEqual(normalizePath('/home/u/proj/'), '/home/u/proj');
});
