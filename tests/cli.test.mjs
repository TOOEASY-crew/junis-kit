import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { REPO, runCli, tempDir } from './helpers/harness.mjs';
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

describe('connecting', () => {
  test('status before login explains how to connect and exits cleanly', async () => {
    const result = await runCli(['status'], { env: mock.env() });
    assert.equal(result.code, 0);
    assert.equal(result.json.logged_in, false);
    assert.match(result.json.login_url, /\/settings\/api-keys$/);
    assert.ok(result.json.what_to_tell_the_user.length >= 3);
  });

  test('login verifies the key, stores it privately and never prints it', async () => {
    const kitHome = tempDir();
    const result = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.connected, true);
    assert.equal(result.json.key_type, 'user');
    assert.equal(result.json.organizations.length, 2);
    assert.ok(!result.stdout.includes(USER_KEY), 'the key must not appear in output');
    assert.ok(!result.stderr.includes(USER_KEY), 'the key must not appear in diagnostics');

    const file = path.join(kitHome, 'credentials.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).profiles.default.api_key, USER_KEY);
  });

  test('a key copied as part of a header line is still recognised', async () => {
    const result = await runCli(['login', '--key-stdin'], { env: mock.env(), input: `Authorization: Bearer ${USER_KEY}\n` });
    assert.equal(result.json.connected, true);
  });

  test('a rejected key is not stored and does not replace a working one', async () => {
    const kitHome = await loggedInHome();
    const bad = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: 'jns_user_testkey_wrong_00000000000000\n' });
    assert.equal(bad.code, 1);
    const status = await runCli(['status'], { env: mock.env(), kitHome });
    assert.equal(status.json.verified, true);
  });

  test('text that is not a key is refused before any network call', async () => {
    const before = mock.state.requests.length;
    const result = await runCli(['login', '--key-stdin'], { env: mock.env(), input: 'hello world\n' });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'bad_key');
    assert.equal(mock.state.requests.length, before);
  });

  test('with several organizations none is chosen silently', async () => {
    const kitHome = await loggedInHome();
    const status = await runCli(['status'], { env: mock.env(), kitHome });
    assert.equal(status.json.default_organization, null);
    assert.match(status.json.next_step, /which one/i);
  });

  test('org use resolves a name to the id and stores it', async () => {
    const kitHome = await loggedInHome();
    const chosen = await runCli(['org', 'use', 'globexsales'], { env: mock.env(), kitHome });
    assert.equal(chosen.json.default_organization.id, ORG_B);
    const status = await runCli(['status', '--offline'], { env: mock.env(), kitHome });
    assert.equal(status.json.default_organization.slug, 'globexsales');
  });

  test('org use refuses an ambiguous name and lists the candidates', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['org', 'use', 'globex'], { env: mock.env(), kitHome });
    // "globex" is an exact match for one organization, so it resolves.
    assert.equal(result.json.default_organization.id, ORG_A);
    const vague = await runCli(['org', 'use', 'lobe'], { env: mock.env(), kitHome });
    assert.equal(vague.code, 1);
    assert.equal(vague.json.detail.candidates.length, 2);
  });

  test('an organization key can connect and is reported as such', async () => {
    const kitHome = tempDir();
    const result = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${ORG_KEY}\n` });
    assert.equal(result.json.key_type, 'organization');
    assert.match(result.json.next_step, /user-level key/);
  });

  test('logout removes the stored key', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['logout'], { env: mock.env(), kitHome });
    assert.equal(result.json.logged_out, true);
    assert.equal(fs.existsSync(path.join(kitHome, 'credentials.json')), false);
  });

  test('JUNIS_API_KEY works without any stored file', async () => {
    const result = await runCli(['status'], { env: mock.env({ JUNIS_API_KEY: USER_KEY }) });
    assert.equal(result.json.key_source, 'env');
    assert.equal(result.json.verified, true);
  });
});

describe('tools', () => {
  test('search ranks tools that match every word first', async () => {
    const result = await runCli(['tools', 'sub', 'agent'], { env: mock.env() });
    const names = result.json.tools.map((tool) => tool.name);
    assert.deepEqual(names.slice(0, 4).sort(), ['add_sub_agent', 'list_sub_agents', 'remove_sub_agent', 'reorder_sub_agents']);
  });

  test('the catalogue is readable before login', async () => {
    const result = await runCli(['tools', '--category', 'schedules'], { env: mock.env() });
    const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'tools-list.prod.json'), 'utf8'));
    assert.equal(result.json.total, fixture.result.tools.length);
    assert.equal(result.json.matched, 5);
  });

  test('describe returns the input schema', async () => {
    const result = await runCli(['tools', 'describe', 'create_agent'], { env: mock.env() });
    assert.ok(result.json.input_schema.properties.name);
  });

  test('describe of an unknown tool suggests near names', async () => {
    const result = await runCli(['tools', 'describe', 'make_agent'], { env: mock.env() });
    assert.equal(result.code, 1);
    assert.ok(result.json.detail.did_you_mean.includes('create_agent'));
  });

  test('call passes typed key=value arguments and returns the tool data', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['tools', 'call', 'create_agent', 'name=Summarizer', 'agent_type=LLM_AGENT', 'temperature=0.2', 'tools=["exit_loop"]', `organization_id=${ORG_B}`], {
      env: mock.env(),
      kitHome,
    });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.name, 'Summarizer');
    assert.equal(result.json.temperature, 0.2);
    assert.deepEqual(result.json.tools, ['exit_loop']);
    const seen = mock.state.requests.findLast((entry) => entry.route === 'TOOL create_agent');
    assert.equal(seen.organizationId, ORG_B);
  });

  test('key=@file reads long text from a file', async () => {
    const kitHome = await loggedInHome();
    const file = path.join(tempDir(), 'instruction.md');
    fs.writeFileSync(file, 'You are a "careful" reviewer.\nOutput JSON: {"ok": true}\n');
    const result = await runCli(['tools', 'call', 'create_agent', 'name=FromFile', `instruction=@${file}`, `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    assert.equal(result.json.instruction, fs.readFileSync(file, 'utf8'));
  });

  test('a name in organization_id is refused locally with the fix', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['tools', 'call', 'list_agents', 'organization_id=globex'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'bad_organization_id');
    assert.match(result.json.hint, /list_organizations/);
  });

  test('the default organization is sent when the call names none', async () => {
    const kitHome = await loggedInHome();
    await runCli(['org', 'use', 'globexsales'], { env: mock.env(), kitHome });
    const result = await runCli(['tools', 'call', 'list_agents'], { env: mock.env(), kitHome });
    assert.equal(result.json.items[0].agent_id, 'orchestrator-globexsales');
  });

  test('a platform error comes back with its status class and a hint', async () => {
    const kitHome = await loggedInHome();
    await runCli(['tools', 'call', 'create_agent', 'name=Twice', `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    const again = await runCli(['tools', 'call', 'create_agent', 'name=Twice', `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    assert.equal(again.code, 1);
    assert.match(again.json.message, /409/);
  });

  test('calling without login returns the connection steps', async () => {
    const result = await runCli(['tools', 'call', 'list_agents'], { env: mock.env() });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'not_logged_in');
    assert.ok(result.json.detail.login_url);
  });
});

describe('external api', () => {
  test('GET with key=value becomes a query string', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['api', 'GET', '/brain/search', 'q=pricing', 'limit=5'], { env: mock.env(), kitHome });
    assert.equal(result.json.query, 'pricing');
    const seen = mock.state.requests.findLast((entry) => entry.route === 'GET /brain/search');
    assert.deepEqual(seen.query, { q: 'pricing', limit: '5' });
  });

  test('the full /api/external prefix is accepted as well', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['api', 'GET', '/api/external/brain/sources'], { env: mock.env(), kitHome });
    assert.equal(result.json.total, 1);
  });

  test('a full URL is refused so the key cannot be sent elsewhere', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['api', 'GET', 'https://example.com/steal'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'bad_path');
  });

  test('an unknown route reports the status and a hint', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['api', 'GET', '/nope'], { env: mock.env(), kitHome });
    assert.equal(result.json.status, 404);
    assert.ok(result.json.hint);
  });
});

describe('general', () => {
  test('an unknown command exits with the usage code', async () => {
    const result = await runCli(['frobnicate'], { env: mock.env() });
    assert.equal(result.code, 2);
  });

  test('help lists every command group', async () => {
    const result = await runCli(['--help'], { env: mock.env() });
    for (const word of ['login', 'install', 'tools', 'run', 'lint', 'mcp', 'doctor', 'snapshot']) assert.match(result.stdout, new RegExp(`\\b${word}\\b`));
  });
});
