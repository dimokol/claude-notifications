const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverProfiles, checkAllProfiles } = require('../lib/hooks-installer');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-profiles-'));
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{}');
}

test('discoverProfiles finds default ~/.claude/settings.json', () => {
  const home = makeTempHome();
  touch(path.join(home, '.claude/settings.json'));
  const profiles = discoverProfiles(home);
  assert.deepStrictEqual(profiles, [path.join(home, '.claude/settings.json')]);
});

test('discoverProfiles finds ~/.claude-<name>/settings.json profiles', () => {
  const home = makeTempHome();
  touch(path.join(home, '.claude/settings.json'));
  touch(path.join(home, '.claude-andreas/settings.json'));
  touch(path.join(home, '.claude-dimo/settings.json'));
  const profiles = discoverProfiles(home).sort();
  assert.deepStrictEqual(profiles, [
    path.join(home, '.claude-andreas/settings.json'),
    path.join(home, '.claude-dimo/settings.json'),
    path.join(home, '.claude/settings.json')
  ]);
});

test('discoverProfiles skips .claude-backup-* directories', () => {
  const home = makeTempHome();
  touch(path.join(home, '.claude/settings.json'));
  touch(path.join(home, '.claude-backup-20260428-123811/settings.json'));
  touch(path.join(home, '.claude-Backup-other/settings.json'));
  const profiles = discoverProfiles(home);
  assert.deepStrictEqual(profiles, [path.join(home, '.claude/settings.json')]);
});

test('discoverProfiles skips dirs without settings.json', () => {
  const home = makeTempHome();
  fs.mkdirSync(path.join(home, '.claude-empty'), { recursive: true });
  touch(path.join(home, '.claude/settings.json'));
  const profiles = discoverProfiles(home);
  assert.deepStrictEqual(profiles, [path.join(home, '.claude/settings.json')]);
});

test('discoverProfiles returns empty array when no profiles exist', () => {
  const home = makeTempHome();
  assert.deepStrictEqual(discoverProfiles(home), []);
});

function writeSettings(filePath, settings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

function buildSettings({ hookPath, includeUserPrompt = true }) {
  const userPromptCmd = `node "${hookPath.replace('hook.js', 'hook-user-prompt.js')}"`;
  const cmd = `node "${hookPath}"`;
  const entry = (c) => ({ matcher: '', hooks: [{ type: 'command', command: c }] });
  const hooks = {
    Stop: [entry(cmd)],
    Notification: [entry(cmd)],
    PermissionRequest: [entry(cmd)]
  };
  if (includeUserPrompt) hooks.UserPromptSubmit = [entry(userPromptCmd)];
  return { hooks };
}

test('checkAllProfiles returns one entry per discovered profile', () => {
  const home = makeTempHome();
  const extPath = '/ext/3.2.1';
  const goodPath = path.join(extPath, 'dist/hook.js');
  writeSettings(path.join(home, '.claude/settings.json'), buildSettings({ hookPath: goodPath }));
  writeSettings(path.join(home, '.claude-other/settings.json'), buildSettings({ hookPath: '/ext/3.1.4/dist/hook.js' }));

  const results = checkAllProfiles(extPath, home);
  assert.strictEqual(results.length, 2);

  const def = results.find(r => r.path.endsWith('/.claude/settings.json'));
  const other = results.find(r => r.path.endsWith('/.claude-other/settings.json'));
  assert.strictEqual(def.status, 'installed');
  assert.strictEqual(other.status, 'stale-path');
  assert.strictEqual(other.installedPath, '/ext/3.1.4/dist/hook.js');
});

test('checkAllProfiles flags profile missing UserPromptSubmit as partial', () => {
  const home = makeTempHome();
  const extPath = '/ext/3.2.1';
  const stalePath = '/ext/3.1.4/dist/hook.js';
  writeSettings(
    path.join(home, '.claude-andreas/settings.json'),
    buildSettings({ hookPath: stalePath, includeUserPrompt: false })
  );

  const results = checkAllProfiles(extPath, home);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'partial');
  assert.strictEqual(results[0].installedPath, stalePath);
});

test('checkAllProfiles ignores profiles without our hooks', () => {
  const home = makeTempHome();
  writeSettings(path.join(home, '.claude/settings.json'), {
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo unrelated' }] }] }
  });
  const results = checkAllProfiles('/ext/3.2.1', home);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'not-installed');
});
