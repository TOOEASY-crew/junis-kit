import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runCli, tempDir } from './helpers/harness.mjs';
import { ORG_KEY, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

let mock;
before(async () => {
  mock = await startMockJunis();
});
after(() => mock.close());

async function twoProfiles() {
  const kitHome = tempDir();
  const first = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
  assert.equal(first.code, 0, first.stdout);
  const second = await runCli(['login', '--key-stdin', '--profile', 'dev'], { env: mock.env(), kitHome, input: `${ORG_KEY}\n` });
  assert.equal(second.code, 0, second.stdout);
  return kitHome;
}

describe('profile', () => {
  test('list shows the stored profiles and which one is in use', async () => {
    const kitHome = await twoProfiles();
    const result = await runCli(['profile', 'list'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.in_use, 'default');
    assert.deepEqual(result.json.profiles.map((p) => [p.name, p.in_use, p.has_key]), [['default', true, true], ['dev', false, true]]);
  });

  test('use switches the profile for every following command', async () => {
    const kitHome = await twoProfiles();
    const before = await runCli(['status', '--offline'], { env: mock.env(), kitHome });
    assert.equal(before.json.profile, 'default');
    const switched = await runCli(['profile', 'use', 'dev'], { env: mock.env(), kitHome });
    assert.equal(switched.code, 0, switched.stdout);
    assert.equal(switched.json.profile, 'dev');
    assert.equal(switched.json.previous, 'default');
    const after = await runCli(['status', '--offline'], { env: mock.env(), kitHome });
    assert.equal(after.json.profile, 'dev');
    assert.deepEqual(after.json.other_profiles, ['default']);
    assert.ok(!switched.stdout.includes(ORG_KEY) && !switched.stdout.includes(USER_KEY), 'keys never appear in output');
  });

  test('JUNIS_PROFILE in the environment still wins over the stored choice', async () => {
    const kitHome = await twoProfiles();
    await runCli(['profile', 'use', 'dev'], { env: mock.env(), kitHome });
    const forced = await runCli(['status', '--offline'], { env: { ...mock.env(), JUNIS_PROFILE: 'default' }, kitHome });
    assert.equal(forced.json.profile, 'default');
    const listed = await runCli(['profile', 'list'], { env: { ...mock.env(), JUNIS_PROFILE: 'default' }, kitHome });
    assert.equal(listed.json.in_use, 'default');
    assert.match(listed.json.note, /JUNIS_PROFILE/);
  });

  test('a profile without a stored key cannot be chosen', async () => {
    const kitHome = await twoProfiles();
    const result = await runCli(['profile', 'use', 'staging'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'unknown_profile');
    assert.match(result.json.hint, /default, dev/);
    const status = await runCli(['status', '--offline'], { env: mock.env(), kitHome });
    assert.equal(status.json.profile, 'default');
  });
});
