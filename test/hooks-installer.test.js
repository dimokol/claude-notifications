const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverProfiles } = require('../lib/hooks-installer');

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
