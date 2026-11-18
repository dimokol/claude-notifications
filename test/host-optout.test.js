const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipForHost, SKIP_VARS } = require('../lib/host-optout');
const wrapper = require('../bin/hook-wrapper.cjs');

test('an empty environment notifies as usual', () => {
  assert.equal(shouldSkipForHost({}), false);
});

test('each skip variable suppresses on its truthy values', () => {
  for (const name of SKIP_VARS) {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      assert.equal(shouldSkipForHost({ [name]: value }), true, `${name}=${JSON.stringify(value)}`);
    }
  }
});

test('an off value does not suppress, so a host can disable it per session', () => {
  for (const name of SKIP_VARS) {
    for (const value of ['0', 'false', 'no', '', 'off']) {
      assert.equal(shouldSkipForHost({ [name]: value }), false, `${name}=${JSON.stringify(value)}`);
    }
  }
});

test('a non-string value is ignored rather than throwing', () => {
  assert.equal(shouldSkipForHost({ OCTOSHELL_AGENT: 1 }), false);
  assert.equal(shouldSkipForHost({ OCTOSHELL_AGENT: null }), false);
});

test('the wrapper copy agrees with lib/host-optout', () => {
  const cases = [{}, { OCTOSHELL_AGENT: '1' }, { CLAUDE_NOTIFICATIONS_SKIP: 'yes' }, { OCTOSHELL_AGENT: '0' }];
  for (const env of cases) {
    assert.equal(wrapper.shouldSkipForHost(env), shouldSkipForHost(env), JSON.stringify(env));
  }
});
