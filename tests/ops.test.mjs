// `snapshot` and `doctor`: the two commands an operator runs before and after
// changing a squad. Both run against the in-process mock and a throwaway home.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { runCli, tempDir } from './helpers/harness.mjs';
import { ORG_A, ORG_B, ORG_KEY, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

let mock;
before(async () => {
  mock = await startMockJunis();
});
after(() => mock.close());

async function loggedInHome(key = USER_KEY) {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${key}\n` });
  assert.equal(login.code, 0, login.stdout);
  return kitHome;
}

describe('snapshot', () => {
  test('needs a resolved organization and says how to choose one', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['snapshot'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'organization_not_resolved');
    assert.match(result.json.hint, /org use/);
  });

  test('writes a private file with agents, schedules and soul, and reads only configuration', async () => {
    const kitHome = await loggedInHome();
    mock.state.requests.length = 0;
    const result = await runCli(['snapshot', '--org', ORG_A], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.agents, 2);
    assert.equal(result.json.schedules, 1);
    assert.equal(result.json.organization.slug, 'globex');
    assert.ok(result.json.file.startsWith(path.join(kitHome, 'snapshots', 'globex')));
    assert.equal(fs.statSync(result.json.file).mode & 0o777, 0o600);

    const data = JSON.parse(fs.readFileSync(result.json.file, 'utf8'));
    assert.equal(data.kind, 'junis-squad-snapshot');
    assert.deepEqual(data.agents.map((agent) => agent.name).sort(), ['DigestWriter', 'Orchestrator_Globex']);
    assert.equal(data.soul['soul.md'], 'We answer with evidence.');
    assert.deepEqual(data.skipped, []);

    const routes = mock.state.requests.map((entry) => entry.route);
    assert.ok(routes.every((route) => route.startsWith('GET ') || route === 'TOOL list_organizations'), `only reads: ${routes.join(', ')}`);
    assert.ok(!routes.some((route) => /mcp-platforms\/[^/]+$/.test(route)), 'platform details (credentials) are never opened');
    assert.ok(mock.state.requests.every((entry) => entry.organizationId === ORG_A));
  });

  test('a part the key cannot read is recorded as skipped, not fatal', async () => {
    const kitHome = await loggedInHome();
    const original = mock.state.soul;
    mock.state.soul = null; // the route now throws → 500
    try {
      const result = await runCli(['snapshot', '--org', ORG_B], { env: mock.env(), kitHome });
      assert.equal(result.code, 0, result.stdout);
      assert.deepEqual(result.json.skipped.map((entry) => entry.part), ['soul/soul.md', 'soul/identity.md']);
    } finally {
      mock.state.soul = original;
    }
  });

  test('diff names added agents, changed fields and schedule changes', async () => {
    const kitHome = await loggedInHome();
    const before = await runCli(['snapshot', '--org', ORG_A, '--out', path.join(kitHome, 'before.json')], { env: mock.env(), kitHome });
    assert.equal(before.code, 0, before.stdout);

    const agents = mock.state.agents[ORG_A];
    const reviewer = agents.find((agent) => agent.name === 'DigestWriter');
    const savedModel = reviewer.model;
    reviewer.model = 'test/model-b';
    agents.push({ agent_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'ReportWriter', agent_type: 'LLM_AGENT', model: 'test/model-a', description: '' });
    mock.state.schedules[ORG_A].push({ id: 'sch-2', name: 'Daily check', schedule_type: 'daily', enabled: true });
    try {
      const afterFile = path.join(kitHome, 'after.json');
      const later = await runCli(['snapshot', '--org', ORG_A, '--out', afterFile], { env: mock.env(), kitHome });
      assert.equal(later.code, 0, later.stdout);

      const diff = await runCli(['snapshot', 'diff', path.join(kitHome, 'before.json'), afterFile], { env: mock.env(), kitHome });
      assert.equal(diff.code, 0, diff.stdout);
      assert.equal(diff.json.identical, false);
      assert.deepEqual(diff.json.agents_added, ['ReportWriter']);
      assert.deepEqual(diff.json.agents_removed, []);
      assert.deepEqual(diff.json.agents_changed.map((entry) => entry.agent), ['DigestWriter']);
      assert.deepEqual(diff.json.agents_changed[0].changes, [{ field: 'model', before: null, after: 'test/model-b' }]);
      assert.deepEqual(diff.json.schedules, [{ schedule: 'Daily check', change: 'added' }]);

      const same = await runCli(['snapshot', 'diff', afterFile, afterFile], { env: mock.env(), kitHome });
      assert.equal(same.json.identical, true);
    } finally {
      reviewer.model = savedModel;
      agents.pop();
      mock.state.schedules[ORG_A].pop();
    }
  });

  test('list and show find saved snapshots and one agent inside them', async () => {
    const kitHome = await loggedInHome();
    const taken = await runCli(['snapshot', '--org', ORG_A], { env: mock.env(), kitHome });
    const list = await runCli(['snapshot', 'list'], { env: mock.env(), kitHome });
    assert.deepEqual(list.json.snapshots, [{ organization: 'globex', file: taken.json.file }]);

    const shown = await runCli(['snapshot', 'show', taken.json.file, 'digestwriter'], { env: mock.env(), kitHome });
    assert.equal(shown.code, 0, shown.stdout);
    assert.equal(shown.json.agent, 'DigestWriter');
    assert.equal(typeof shown.json.instruction, 'string');

    const missing = await runCli(['snapshot', 'show', taken.json.file, 'Nobody'], { env: mock.env(), kitHome });
    assert.equal(missing.code, 1);
    assert.deepEqual(missing.json.detail.agents.sort(), ['DigestWriter', 'Orchestrator_Globex']);
  });

  test('diff refuses a file that is not a snapshot', async () => {
    const kitHome = await loggedInHome();
    const other = path.join(kitHome, 'other.json');
    fs.writeFileSync(other, '{"kind":"something-else"}');
    const result = await runCli(['snapshot', 'diff', other, other], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'bad_snapshot');
  });
});

describe('doctor', () => {
  const byName = (result, name) => result.json.checks.find((entry) => entry.check === name);

  test('with nothing set up it names each fix, starting with the login link', async () => {
    const home = tempDir('junis-kit-home-');
    fs.mkdirSync(path.join(home, '.cursor'));
    const result = await runCli(['doctor', '--home', home], { env: mock.env() });
    assert.equal(result.code, 1);
    assert.equal(result.json.ok, false);
    assert.equal(byName(result, 'node').ok, true);
    assert.equal(byName(result, 'bridge').ok, true, JSON.stringify(byName(result, 'bridge')));
    assert.equal(byName(result, 'mcp_server').ok, true);
    assert.equal(byName(result, 'tool_catalogue').ok, true);
    assert.equal(byName(result, 'credentials').ok, false);
    assert.match(byName(result, 'credentials').fix, /settings\/api-keys/);
    assert.equal(byName(result, 'agent:cursor').ok, false);
    assert.match(byName(result, 'agent:cursor').fix, /install --agents cursor/);
    assert.match(result.json.summary, /need attention/);
  });

  test('after install and login everything is in place', async () => {
    const home = tempDir('junis-kit-home-');
    fs.mkdirSync(path.join(home, '.cursor'));
    const kitHome = await loggedInHome();
    await runCli(['org', 'use', 'globex'], { env: mock.env(), kitHome });
    const install = await runCli(['install', '--home', home], { env: mock.env(), kitHome });
    assert.equal(install.code, 0, install.stdout);

    const result = await runCli(['doctor', '--home', home], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.ok, true);
    assert.equal(byName(result, 'credential_file').ok, true);
    assert.equal(byName(result, 'key_type').detail, 'user-level key');
    assert.match(byName(result, 'key_valid').detail, /2 organization/);
    assert.match(byName(result, 'default_organization').detail, /Globex \(OWNER\)/);
    assert.equal(byName(result, 'agent:cursor').ok, true);
    assert.equal(result.json.summary, 'Everything is in place');
  });

  test('an organization-level key is reported as limited, and a rejected key as invalid', async () => {
    const orgHome = await loggedInHome(ORG_KEY);
    const limited = await runCli(['doctor', '--home', tempDir('junis-kit-home-')], { env: mock.env(), kitHome: orgHome });
    assert.equal(byName(limited, 'key_type').ok, false);
    assert.match(byName(limited, 'key_type').fix, /user-level key/);
    assert.equal(byName(limited, 'key_valid'), undefined);

    const stale = await runCli(['doctor', '--home', tempDir('junis-kit-home-')], { env: mock.env({ JUNIS_API_KEY: 'jns_user_testkey_stale_000000000000000' }) });
    assert.equal(byName(stale, 'key_valid').ok, false);
    assert.match(byName(stale, 'key_valid').fix, /log in again/);
  });
});
