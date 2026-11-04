// Regression tests for the kit's behaviour against the platform. Each test
// pins one fixed behaviour; the comment names what went wrong before.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import { runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { ORG_A, ORG_B, ORG_KEY, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';
import { expandFileReferences } from '../skills/junis/scripts/lib/args.mjs';
import { explainError } from '../skills/junis/scripts/lib/errors.mjs';
import { RemoteMcp } from '../skills/junis/scripts/lib/mcp-remote.mjs';

// Servers and bridges are closed after all tests, so a failing assertion
// reports as a failure instead of leaving a live server that hangs the run.
const open = [];
after(async () => {
  for (const item of open.reverse()) await item.close().catch(() => {});
});
function bridgeFor(options) {
  const bridge = startBridge(options);
  open.push(bridge);
  return bridge;
}

async function loggedIn(options) {
  const mock = await startMockJunis(options);
  open.push({ close: async () => mock.close() });
  const kitHome = tempDir();
  const env = mock.env({ JUNIS_KIT_POLL_MS: '100' });
  const login = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  await runCli(['org', 'use', 'globex'], { env, kitHome });
  return { mock, kitHome, env };
}

const userMessages = (mock) =>
  [...mock.state.sessions.values()].flatMap((session) => session.messages).filter((message) => message.event_type === 'user_message');

describe('following runs', () => {
  test('a recovered turn never returns the previous turn\'s answer', async () => {
    // Before: after a dropped connection the kit walked back past the new
    // user message and reported the previous answer as this turn's.
    const { mock, kitHome, env } = await loggedIn();
    const first = await runCli(['run', 'orchestrator', 'first question'], { env, kitHome });
    assert.equal(first.json.status, 'completed', first.stdout);
    Object.assign(mock.state, { dropAfterMs: 100, runDelayMs: 300, silentAnswer: true });
    const second = await runCli(['run', 'orchestrator', 'second question', '--session', first.json.session_id], { env, kitHome });
    assert.equal(second.json.status, 'finished_without_text', second.stdout);
    assert.doesNotMatch(second.stdout, /first question/);
  });

  test('reading a session from a new process stops at this turn\'s question', async () => {
    // Before: `session wait` in another process walked back past the new user
    // message and reported the previous answer as this turn's.
    const { mock, kitHome, env } = await loggedIn();
    const first = await runCli(['run', 'orchestrator', 'first question'], { env, kitHome });
    assert.equal(first.json.status, 'completed', first.stdout);
    Object.assign(mock.state, { silentAnswer: true });
    const second = await runCli(['run', 'orchestrator', 'second question', '--session', first.json.session_id], { env, kitHome });
    assert.equal(second.json.status, 'finished_without_text', second.stdout);
    const waited = await runCli(['session', 'wait', first.json.session_id, '--wait-seconds', '2'], { env, kitHome });
    assert.equal(waited.json.status, 'finished_without_text', waited.stdout);
    assert.doesNotMatch(waited.stdout, /first question/);
  });

  test('a session that is still running is not sent to again', async () => {
    // Before: a second run in a busy session was sent and billed as well.
    const { mock, kitHome, env } = await loggedIn({ runDelayMs: 1500 });
    const first = await runCli(['run', 'orchestrator', 'long job', '--no-wait'], { env, kitHome });
    assert.equal(first.json.status, 'running', first.stdout);
    const again = await runCli(['run', 'orchestrator', 'long job', '--session', first.json.session_id, '--no-wait'], { env, kitHome });
    assert.equal(again.json.status, 'running', again.stdout);
    assert.equal(again.json.already_running, true);
    assert.equal(userMessages(mock).length, 1, 'only the first run was sent');
  });

  test('runs and API calls act in the organization they name', async () => {
    // Before: junis_run and junis_api always used the stored default, so a
    // squad built in organization B was run (and billed) in A.
    const { mock, kitHome, env } = await loggedIn();
    const bridge = bridgeFor({ env, kitHome });
    const run = await bridge.callTool('junis_run', { message: 'hello B', organization_id: ORG_B });
    assert.equal(run.data.status, 'completed', JSON.stringify(run.data));
    const sent = mock.state.requests.find((entry) => entry.route === 'POST /v1/chat/completions');
    assert.equal(sent.organizationId, ORG_B);
    await bridge.callTool('junis_api', { path: '/brain/sources', organization_id: ORG_B });
    assert.equal(mock.state.requests.at(-1).organizationId, ORG_B);
    const bad = await bridge.callTool('junis_api', { path: '/brain/sources', organization_id: 'globex' });
    assert.equal(bad.isError, true);
    assert.equal(bad.data.error, 'bad_organization_id');
  });
});

describe('a second stored key', () => {
  test('logging in under another profile keeps the key in use, and one call can use the other', async () => {
    // Before: `login --profile partner` made the partner organization key the
    // one every call used, so building squads failed until the user logged in again.
    const { mock, kitHome, env } = await loggedIn();
    const partner = await runCli(['login', '--profile', 'partner', '--key-stdin'], { env, kitHome, input: `${ORG_KEY}\n` });
    assert.equal(partner.code, 0, partner.stdout);
    assert.equal(partner.json.profile, 'partner');
    assert.equal(partner.json.in_use, false);
    assert.match(partner.json.next_step, /profile="partner"/);
    const status = await runCli(['status'], { env, kitHome });
    assert.equal(status.json.key_type, 'user', status.stdout);
    assert.equal(status.json.profile, 'default');
    assert.deepEqual(status.json.other_profiles, ['partner']);

    const bridge = bridgeFor({ env, kitHome });
    await bridge.callTool('junis_api', { path: '/brain/sources' });
    assert.equal(mock.state.requests.at(-1).userLevel, true);
    const viaPartner = await bridge.callTool('junis_api', { path: '/agents', profile: 'partner' });
    assert.equal(viaPartner.isError, false, JSON.stringify(viaPartner.data));
    assert.equal(mock.state.requests.at(-1).userLevel, false);
    const missing = await bridge.callTool('junis_api', { path: '/agents', profile: 'nobody' });
    assert.equal(missing.isError, true);
    assert.equal(missing.data.error, 'unknown_profile');

    // The command line reaches the same key with --profile.
    const cli = await runCli(['api', 'GET', '/agents', '--profile', 'partner'], { env, kitHome });
    assert.equal(cli.code, 0, cli.stdout);
    assert.equal(mock.state.requests.at(-1).userLevel, false);
  });

  test('logging out of the key in use does not switch to another stored key', async () => {
    // Before: the first remaining profile, such as the partner key, silently
    // became the key every call used.
    const { kitHome, env } = await loggedIn();
    await runCli(['login', '--profile', 'partner', '--key-stdin'], { env, kitHome, input: `${ORG_KEY}\n` });
    const out = await runCli(['logout'], { env, kitHome });
    assert.equal(out.json.logged_out, true, out.stdout);
    assert.deepEqual(out.json.other_profiles, ['partner']);
    const status = await runCli(['status', '--offline'], { env, kitHome });
    assert.equal(status.json.logged_in, false, status.stdout);
    assert.deepEqual(status.json.other_profiles, ['partner']);
    const again = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(again.json.in_use, true, again.stdout);
    assert.equal(again.json.key_type, 'user');
  });

  test('the first key stored under any name is the one in use', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const login = await runCli(['login', '--profile', 'work', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(login.json.in_use, true, login.stdout);
    const status = await runCli(['status', '--offline'], { env, kitHome });
    assert.equal(status.json.profile, 'work');
  });

  test('a plain login after a partner key was stored first never overwrites that partner key', async () => {
    // Before: on a fresh install the partner key became the profile in use, and a
    // later plain `login` saved the user's own key under "partner", replacing it.
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--profile', 'partner', '--key-stdin'], { env, kitHome, input: `${ORG_KEY}\n` });
    const own = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(own.code, 0, own.stdout);
    assert.equal(own.json.profile, 'default');
    assert.equal(own.json.in_use, true, 'a plain login sets the key in use');
    const status = await runCli(['status'], { env, kitHome });
    assert.equal(status.json.profile, 'default', status.stdout);
    assert.equal(status.json.key_type, 'user');
    assert.deepEqual(status.json.other_profiles, ['partner']);
    const cli = await runCli(['api', 'GET', '/agents', '--profile', 'partner'], { env, kitHome });
    assert.equal(cli.code, 0, cli.stdout);
    assert.equal(mock.state.requests.at(-1).userLevel, false, 'the partner profile still holds the organization key');
  });

  test('login --profile default is the same as a plain login: that key becomes the one in use', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--profile', 'partner', '--key-stdin'], { env, kitHome, input: `${ORG_KEY}\n` });
    const own = await runCli(['login', '--profile', 'default', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(own.json.in_use, true, own.stdout);
    const status = await runCli(['status', '--offline'], { env, kitHome });
    assert.equal(status.json.profile, 'default');
  });
});

describe('destructive calls outside the Claude Code plugin', () => {
  test('reads have their own read-only tool that refuses writes', async () => {
    const { mock, kitHome, env } = await loggedIn();
    const bridge = bridgeFor({ env, kitHome, lazy: true });
    const listed = await bridge.request('tools/list');
    const read = listed.result.tools.find((tool) => tool.name === 'junis_read_tool');
    assert.equal(read.annotations.readOnlyHint, true);
    const ok = await bridge.callTool('junis_read_tool', { name: 'list_agents', arguments: { organization_id: ORG_A } });
    assert.equal(ok.isError, false, JSON.stringify(ok.data));
    const refused = await bridge.callTool('junis_read_tool', { name: 'create_agent', arguments: { name: 'X', organization_id: ORG_A } });
    assert.equal(refused.isError, true);
    assert.equal(refused.data.error, 'not_read_only');
    assert.ok(!mock.state.requests.some((entry) => entry.route === 'TOOL create_agent'));
  });

  test('a deletion is handed back as a question until confirmed', async () => {
    // Before: one "always allow" on junis_call_tool also approved deletions.
    const { mock, kitHome, env } = await loggedIn();
    const bridge = bridgeFor({ env, kitHome, lazy: true });
    const args = { name: 'delete_agent', arguments: { agent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: ORG_A } };
    const asked = await bridge.callTool('junis_call_tool', args);
    assert.equal(asked.data.status, 'needs_confirmation');
    assert.ok(!mock.state.requests.some((entry) => entry.route === 'TOOL delete_agent'), 'nothing was deleted');
    await bridge.callTool('junis_call_tool', { ...args, confirmed: true });
    assert.ok(mock.state.requests.some((entry) => entry.route === 'TOOL delete_agent'));
    const api = await bridge.callTool('junis_api', { method: 'DELETE', path: '/brain/sources/src-1' });
    assert.equal(api.data.status, 'needs_confirmation');
    assert.ok(!mock.state.requests.some((entry) => entry.route.startsWith('DELETE ')));
  });

  test('in full mode a direct secret-revealing read is asked before it runs', async () => {
    // Before: get_mcp_platform is annotated read-only, so clients other than
    // Claude Code (whose hook asked) sent reveal_secrets=true without a question.
    const { mock, kitHome, env } = await loggedIn();
    const bridge = bridgeFor({ env, kitHome });
    const args = { platform_id: 'p-1', reveal_secrets: true, organization_id: ORG_A };
    const asked = await bridge.callTool('get_mcp_platform', args);
    assert.equal(asked.data.status, 'needs_confirmation', JSON.stringify(asked.data));
    assert.ok(!mock.state.requests.some((entry) => entry.route === 'TOOL get_mcp_platform'), 'nothing was read');
    await bridge.callTool('get_mcp_platform', { ...args, confirmed: true });
    const sent = mock.state.requests.find((entry) => entry.route === 'TOOL get_mcp_platform');
    assert.ok(sent, 'read after the confirmation');
    assert.equal(sent.body.confirmed, undefined, 'the kit-only flag is not forwarded');
    await bridge.callTool('get_mcp_platform', { platform_id: 'p-1', organization_id: ORG_A });
    assert.equal(mock.state.requests.filter((entry) => entry.route === 'TOOL get_mcp_platform').length, 2, 'a masked read is never asked');
  });

  test('a raw PUT or PATCH is confirmed like a deletion, the same rule the Claude Code hook uses', async () => {
    // Before: junis_api only asked on DELETE — a PUT to /memory/... replaces the whole
    // text (the same effect as update_memory_content, which is confirmed) went straight through.
    const { mock, kitHome, env } = await loggedIn();
    const bridge = bridgeFor({ env, kitHome, lazy: true });
    for (const method of ['PUT', 'PATCH']) {
      const asked = await bridge.callTool('junis_api', { method, path: '/memory/user/notes', body: { content: 'x' } });
      assert.equal(asked.data.status, 'needs_confirmation', method);
      assert.ok(!mock.state.requests.some((entry) => entry.route.startsWith(`${method} `)), `${method} was not sent`);
    }
    const read = await bridge.callTool('junis_api', { path: '/brain/sources' });
    assert.equal(read.isError, false, 'reads are never asked about');
  });
});

test('forwarded platform tools carry no output schema', async () => {
  // Before: a result cut for size lost its structured content while the tool
  // still promised it, and SDK-based clients threw instead of showing it.
  const { mock, kitHome, env } = await loggedIn();
  const bridge = bridgeFor({ env, kitHome });
  const listed = await bridge.request('tools/list');
  const platform = listed.result.tools.filter((tool) => !tool.name.startsWith('junis_'));
  assert.ok(platform.length > 50);
  assert.equal(platform.filter((tool) => tool.outputSchema).length, 0);
});

describe('error hints', () => {
  test('scope names are read from the hosted server\'s Python-style body too', () => {
    const { code, hint } = explainError("Junis API error 403: {'error': 'insufficient_scopes', 'missing_scopes': ['brain:read']}");
    assert.equal(code, 'insufficient_scopes');
    assert.match(hint, /brain:read/);
  });

  test('credits are bought on the subscription page, and the owner may be the payer', () => {
    const { hint } = explainError('insufficient_credits: Organization credits are insufficient');
    assert.match(hint, /\/subscription/);
    assert.doesNotMatch(hint, /team\/billing/);
    assert.match(hint, /owner/);
  });

  test('a call without an organization gets an actionable hint', () => {
    const { code, hint } = explainError('Junis API error 400: No organization specified');
    assert.equal(code, 'no_organization');
    assert.match(hint, /organization_id/);
  });
});

test('@env:NAME substitutes a secret from the environment, also nested, and never from a missing variable', () => {
  process.env.JUNIS_KIT_TEST_DB_PASSWORD = 's3cr3t';
  try {
    const out = expandFileReferences({ password: '@env:JUNIS_KIT_TEST_DB_PASSWORD', nested: { api_key: '@env:JUNIS_KIT_TEST_DB_PASSWORD' }, note: '@channel' });
    assert.equal(out.password, 's3cr3t');
    assert.equal(out.nested.api_key, 's3cr3t');
    assert.equal(out.note, '@channel');
  } finally {
    delete process.env.JUNIS_KIT_TEST_DB_PASSWORD;
  }
  assert.throws(() => expandFileReferences({ password: '@env:JUNIS_KIT_TEST_DB_PASSWORD' }), /not set/);
  assert.throws(() => expandFileReferences({ password: '@env:bad-name' }), /Invalid environment variable/);
});

test('document uploads can take a file as base64, also inside nested payloads', () => {
  const dir = tempDir();
  const file = path.join(dir, 'manual.pdf');
  fs.writeFileSync(file, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
  const out = expandFileReferences({ files: [{ filename: 'manual.pdf', content: `@base64:${file}` }], note: '@channel' });
  assert.equal(out.files[0].content, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]).toString('base64'));
  assert.equal(out.note, '@channel', 'plain handles stay text');
  assert.throws(() => expandFileReferences({ content: `@base64:${path.join(dir, 'missing.pdf')}` }), /File not found/);
});

test('listing tools retries once after a server error', async () => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls += 1;
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (calls === 1) {
        response.writeHead(503).end('busy');
        return;
      }
      const { id } = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'list_agents', inputSchema: {} }] } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const remote = new RemoteMcp({ url: `http://127.0.0.1:${server.address().port}/mcp` });
  const tools = await remote.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['list_agents']);
  assert.equal(calls, 2);
  server.close();
  server.closeAllConnections?.();
});

describe('installer ownership', () => {
  const home = (dirs = ['.cursor', '.gemini', '.codex']) => {
    const dir = tempDir('junis-kit-home-');
    for (const name of dirs) fs.mkdirSync(path.join(dir, name), { recursive: true });
    return dir;
  };
  const hosted = { url: 'https://mcp.junis.ai/mcp', headers: { Authorization: 'Bearer jns_user_ownkey0123456789' } };

  test('a "junis" server the user added is neither replaced nor removed', async () => {
    // Before: install overwrote, and uninstall deleted, the entry the web app
    // tells users to create for the hosted server (with their key in it).
    const dir = home();
    const cursor = path.join(dir, '.cursor', 'mcp.json');
    fs.writeFileSync(cursor, JSON.stringify({ mcpServers: { junis: hosted } }, null, 2));
    const installed = await runCli(['install', '--home', dir, '--agents', 'cursor']);
    assert.equal(installed.json.agents[0].mcp.status, 'manual', installed.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(cursor, 'utf8')).mcpServers.junis, hosted);
    const removed = await runCli(['uninstall', '--home', dir]);
    assert.equal(removed.code, 0, removed.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(cursor, 'utf8')).mcpServers.junis, hosted, 'still there after uninstall');
  });

  test('--force replaces it, and the kit\'s own entry is removed again', async () => {
    const dir = home();
    const gemini = path.join(dir, '.gemini', 'settings.json');
    fs.writeFileSync(gemini, JSON.stringify({ mcpServers: { junis: hosted } }, null, 2));
    const forced = await runCli(['install', '--home', dir, '--agents', 'gemini-cli', '--force']);
    assert.equal(forced.json.agents[0].mcp.status, 'updated', forced.stdout);
    assert.match(JSON.stringify(JSON.parse(fs.readFileSync(gemini, 'utf8')).mcpServers.junis), /junis\.mjs/);
    await runCli(['uninstall', '--home', dir]);
    assert.equal(JSON.parse(fs.readFileSync(gemini, 'utf8')).mcpServers.junis, undefined);
  });

  test('Codex gets tool and startup timeouts long enough for builds', async () => {
    // Before: Codex's 60 s default cut batch builds off while they kept running.
    const dir = home(['.codex']);
    await runCli(['install', '--home', dir, '--agents', 'codex']);
    const toml = fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8');
    assert.match(toml, /tool_timeout_sec = 600/);
    assert.match(toml, /startup_timeout_sec = 20/);
  });

  test('Claude Code is skipped when the Junis plugin is already installed', async () => {
    // Before: plugin plus install gave two servers and every tool twice.
    const dir = home(['.claude/plugins']);
    fs.writeFileSync(path.join(dir, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'junis@junis-kit': [{}] } }));
    const result = await runCli(['install', '--home', dir, '--agents', 'claude-code', '--no-cli']);
    assert.equal(result.json.agents[0].mcp.status, 'skipped', result.stdout);
    assert.equal(fs.existsSync(path.join(dir, '.claude.json')), false);
  });

  test('--home never reads the real configuration through environment overrides', async () => {
    // Before: XDG_CONFIG_HOME / APPDATA pointed a test install at the real files.
    const dir = home([]);
    const real = tempDir('junis-kit-real-');
    const result = await runCli(['install', '--home', dir, '--agents', 'vscode', '--dry-run'], { env: { XDG_CONFIG_HOME: real, APPDATA: real } });
    assert.equal(result.code, 0, result.stdout);
    assert.ok(result.json.agents[0].mcp.file.startsWith(dir), result.json.agents[0].mcp.file);
  });
});


describe('connecting through the browser', () => {
  // Before: the only way in was copying a key to the clipboard, which fails in
  // remote shells and containers. The platform's key request flow needs no copy.
  const approve = (mock, status = 'approved') => {
    for (const entry of mock.state.keyRequests.values()) Object.assign(entry, { status, approvedAt: Date.now() });
  };
  const pendingPath = (kitHome) => path.join(kitHome, 'pending-login.json');
  // A named profile's request lives in pending-login.<hash of the name>.json.
  const profilePendingPath = (kitHome, name) => path.join(kitHome, `pending-login.${crypto.createHash('sha256').update(name).digest('hex').slice(0, 16)}.json`);
  // After success the file is gone or holds only a no-secret marker for other sessions.
  const noWaitingRequest = (file) => {
    if (!fs.existsSync(file)) return true;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.stored === true && !data.verifier && !data.api_key;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('the command line waits, resumes, and stores the approved key', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const first = await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    assert.equal(first.json.status, 'waiting_for_approval', first.stdout);
    assert.match(first.json.verification_uri, /auth\/api-key\?code=/);
    const pendingFile = path.join(kitHome, 'pending-login.json');
    assert.equal(fs.statSync(pendingFile).mode & 0o777, 0o600);
    const request = [...mock.state.keyRequests.values()][0];
    assert.equal(request.client, 'Junis kit');
    assert.ok(request.scopes.includes('brain:manage') && request.scopes.includes('secrets:manage'), 'the coding-agent permissions are requested');
    approve(mock);
    const done = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
    assert.equal(done.json.method, 'browser');
    assert.equal(done.json.key_type, 'user');
    assert.equal(mock.state.keyRequests.size, 0, 'the same request was continued, not a new one');
    assert.equal(noWaitingRequest(pendingFile), true);
    const status = await runCli(['status', '--offline'], { env, kitHome });
    assert.equal(status.json.logged_in, true);
  });

  test('the bridge returns the link first and connects on the next call', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const bridge = bridgeFor({ env: mock.env(), kitHome });
    const first = await bridge.callTool('junis_connect', { method: 'browser' });
    assert.equal(first.data.status, 'waiting_for_approval', JSON.stringify(first.data));
    assert.match(first.data.next_step, /again/);
    approve(mock);
    const second = await bridge.callTool('junis_connect', { method: 'browser' });
    assert.equal(second.data.connected, true, JSON.stringify(second.data));
    const status = await bridge.callTool('junis_status', {});
    assert.equal(status.data.logged_in, true);
  });

  test('a declined request is reported and cleared', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    approve(mock, 'denied');
    const declined = await runCli(['login', '--browser', '--wait-seconds', '3'], { env, kitHome });
    assert.equal(declined.json.error, 'access_denied', declined.stdout);
    assert.equal(fs.existsSync(path.join(kitHome, 'pending-login.json')), false);
  });

  // Previously the bridge polled only when the model called again, which
  // is after the user replies. The platform keeps an approved key for a short
  // time, so a slow reply lost a key that had already been made.
  test('the bridge keeps waiting after returning the link and collects the key at once', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    mock.state.keyResultTtlMs = 1500;
    const kitHome = tempDir();
    const bridge = bridgeFor({ env: mock.env(), kitHome });
    const first = await bridge.callTool('junis_connect', { method: 'browser' });
    assert.equal(first.data.status, 'waiting_for_approval', JSON.stringify(first.data));
    approve(mock);
    await sleep(3000);
    assert.equal(mock.state.keyRequests.size, 0, 'collected while the model was still waiting for the user');
    const second = await bridge.callTool('junis_connect', { method: 'browser' });
    assert.equal(second.data.connected, true, JSON.stringify(second.data));
    const status = await bridge.callTool('junis_status', {});
    assert.equal(status.data.logged_in, true);
  });

  test('a temporary server error while waiting does not throw the request away', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    approve(mock);
    mock.state.keyPollFailures = 2;
    const done = await runCli(['login', '--browser', '--wait-seconds', '8'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
    assert.equal(noWaitingRequest(pendingPath(kitHome)), true);
  });

  test('a key that arrived but could not be checked is kept and stored on the next try', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    approve(mock);
    mock.state.failOrganizations = 1;
    const failed = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.notEqual(failed.json?.connected, true, failed.stdout);
    assert.equal(mock.state.keyRequests.size, 0, 'the platform handed the key over');
    assert.equal(fs.statSync(pendingPath(kitHome)).mode & 0o777, 0o600, 'kept owner-only until stored');
    const done = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
    assert.equal(noWaitingRequest(pendingPath(kitHome)), true);
  });

  test('a request started for one profile is not continued under another', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    const partner = await runCli(['login', '--browser', '--profile', 'partner', '--wait-seconds', '1'], { env, kitHome });
    assert.equal(partner.json.status, 'waiting_for_approval', partner.stdout);
    assert.equal(mock.state.keyRequests.size, 2, 'a new request for the partner profile');
    assert.equal(JSON.parse(fs.readFileSync(profilePendingPath(kitHome, 'partner'), 'utf8')).profile, 'partner');
    approve(mock);
    const done = await runCli(['login', '--browser', '--profile', 'partner', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
    assert.equal(done.json.profile, 'partner');
  });

  test('a verifier the platform does not accept is not reported as a refusal', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '1'], { env, kitHome });
    const pending = JSON.parse(fs.readFileSync(pendingPath(kitHome), 'utf8'));
    fs.writeFileSync(pendingPath(kitHome), JSON.stringify({ ...pending, verifier: 'x'.repeat(64) }), { mode: 0o600 });
    approve(mock);
    const out = await runCli(['login', '--browser', '--wait-seconds', '3'], { env, kitHome });
    assert.equal(out.json.error, 'login_invalid', out.stdout);
  });

  test('--wait-seconds 0 returns at once, and logout removes a waiting request', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const started = Date.now();
    const first = await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    assert.equal(first.json.status, 'waiting_for_approval', first.stdout);
    assert.ok(Date.now() - started < 5000, `returned after ${Date.now() - started} ms`);
    assert.equal(fs.existsSync(pendingPath(kitHome)), true);
    await runCli(['logout'], { env, kitHome });
    assert.equal(fs.existsSync(pendingPath(kitHome)), false);
  });

  test('a missing browser opener does not crash the login', async () => {
    const script = [
      "import { openInBrowser } from './skills/junis/scripts/lib/browser.mjs';",
      "const opened = openInBrowser('https://junis.ai/auth/api-key?code=X', { allowedOrigin: 'https://junis.ai', isTTY: true, platform: 'linux', env: { DISPLAY: ':0', PATH: '/nonexistent' } });",
      "const headless = openInBrowser('https://junis.ai/auth/api-key?code=X', { allowedOrigin: 'https://junis.ai', isTTY: true, platform: 'linux', env: { PATH: '/nonexistent' } });",
      "const foreign = openInBrowser('https://evil.example/auth', { allowedOrigin: 'https://junis.ai', isTTY: true, platform: 'linux', env: { DISPLAY: ':0', PATH: '/nonexistent' } });",
      "setTimeout(() => { console.log(JSON.stringify({ opened, headless, foreign })); }, 300);",
    ].join('\n');
    const { spawnSync } = await import('node:child_process');
    const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(JSON.parse(ran.stdout), { opened: true, headless: false, foreign: false });
  });

  // Two sessions waiting on one request. The platform hands
  // the key to one; the other got 410 and told the user to revoke the key that
  // was now in use, or deleted a received key that was still being checked.
  test('the session that loses the race reports the connection instead of an expired request', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    approve(mock);
    const [a, b] = await Promise.all([
      runCli(['login', '--browser', '--wait-seconds', '8'], { env, kitHome }),
      runCli(['login', '--browser', '--wait-seconds', '8'], { env, kitHome }),
    ]);
    for (const out of [a, b]) {
      assert.equal(out.json.connected, true, out.stdout);
      assert.doesNotMatch(out.stdout, /revoke/);
    }
    const status = await runCli(['status', '--offline'], { env, kitHome });
    assert.equal(status.json.logged_in, true);
  });

  test('a key approved just before the request ran out is still collected', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    const pending = JSON.parse(fs.readFileSync(pendingPath(kitHome), 'utf8'));
    fs.writeFileSync(pendingPath(kitHome), JSON.stringify({ ...pending, expires_at: Date.now() - 1000 }), { mode: 0o600 });
    approve(mock);
    const done = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
    assert.equal(mock.state.keyRequests.size, 0, 'the old request was collected, no new one started');
  });

  test('uninstall --purge removes a waiting request and a received key too', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    // With --home, the kit's own folder is <home>/.junis-kit.
    const home = tempDir();
    const kitHome = path.join(home, '.junis-kit');
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    assert.equal(fs.existsSync(pendingPath(kitHome)), true);
    const out = await runCli(['uninstall', '--purge', '--home', home], { env, kitHome });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.equal(fs.existsSync(pendingPath(kitHome)), false);
  });

  test('outside a terminal a new request returns the link at once and says how to continue', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const started = Date.now();
    const first = await runCli(['login', '--browser', '--profile', 'partner'], { env, kitHome });
    assert.ok(Date.now() - started < 5000, `returned after ${Date.now() - started} ms`);
    assert.equal(first.json.status, 'waiting_for_approval', first.stdout);
    assert.match(first.json.then, /login --browser --profile partner/);
  });

  test('a received key is stored under the profile its request was made for', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    approve(mock);
    mock.state.failOrganizations = 1;
    await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    const other = await runCli(['login', '--browser', '--wait-seconds', '0'], { env: { ...env, JUNIS_PROFILE: 'other' }, kitHome });
    assert.equal(other.json.status, 'waiting_for_approval', 'another profile gets its own request and leaves this key alone');
    const done = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.profile, 'default', done.stdout);
  });

  test('the bridge answers at once for a request of another profile and serves a way to confirm a secret read', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    await runCli(['login', '--browser', '--profile', 'partner', '--wait-seconds', '0'], { env: mock.env(), kitHome });
    const bridge = bridgeFor({ env: mock.env(), kitHome });
    const started = Date.now();
    const first = await bridge.callTool('junis_connect', { method: 'browser' });
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
    assert.equal(first.data.status, 'waiting_for_approval', JSON.stringify(first.data));
    const { mock: live, kitHome: home, env } = await loggedIn();
    const full = bridgeFor({ env, kitHome: home });
    const listed = await full.request('tools/list', {});
    const tool = listed.result.tools.find((entry) => entry.name === 'get_mcp_platform');
    assert.equal(tool.inputSchema.properties.confirmed?.type, 'boolean');
    assert.ok(live);
  });

  test('each profile keeps its own request, and logout removes only its own', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    await runCli(['login', '--browser', '--profile', 'partner', '--wait-seconds', '0'], { env, kitHome });
    const partnerFile = profilePendingPath(kitHome, 'partner');
    assert.equal(JSON.parse(fs.readFileSync(pendingPath(kitHome), 'utf8')).profile, '', 'the default request is still there');
    assert.equal(JSON.parse(fs.readFileSync(partnerFile, 'utf8')).profile, 'partner');
    await runCli(['logout', '--profile', 'partner'], { env, kitHome });
    assert.equal(fs.existsSync(partnerFile), false);
    assert.equal(fs.existsSync(pendingPath(kitHome)), true, "logout of partner leaves the default's request");
    approve(mock);
    const done = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
  });

  test('a hand-edited interval cannot make the wait loop forever, and a proxy refusal is retried', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    const pending = JSON.parse(fs.readFileSync(pendingPath(kitHome), 'utf8'));
    fs.writeFileSync(pendingPath(kitHome), JSON.stringify({ ...pending, interval: 'x' }), { mode: 0o600 });
    const started = Date.now();
    const waited = await runCli(['login', '--browser', '--wait-seconds', '3'], { env, kitHome });
    assert.equal(waited.json.status, 'waiting_for_approval', waited.stdout);
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
    approve(mock);
    mock.state.keyPollProxyForbidden = 1;
    const done = await runCli(['login', '--browser', '--wait-seconds', '8'], { env, kitHome });
    assert.equal(done.json.connected, true, done.stdout);
  });

  test('a second session right after the first connected reports it instead of a new link', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome });
    approve(mock);
    const first = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(first.json.connected, true, first.stdout);
    const second = await runCli(['login', '--browser', '--wait-seconds', '5'], { env, kitHome });
    assert.equal(second.json.connected, true, second.stdout);
    assert.equal(mock.state.keyRequests.size, 0, 'no new request was started');
  });

  test('profile names that look alike keep separate requests, and an older single file is not read as another profile', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    for (const name of ['a.b', 'a_b']) await runCli(['login', '--browser', '--profile', name, '--wait-seconds', '0'], { env, kitHome });
    assert.equal(mock.state.keyRequests.size, 2, 'two requests, not one continued under the other name');
    assert.notEqual(profilePendingPath(kitHome, 'a.b'), profilePendingPath(kitHome, 'a_b'));
    // An older kit kept every request in pending-login.json; one made for "partner" is not the default profile's.
    const other = tempDir();
    fs.writeFileSync(path.join(other, 'pending-login.json'), JSON.stringify({ device_code: 'LEGACY', verifier: 'v', verification_uri: 'https://junis.test/x', interval: 2, expires_at: Date.now() + 60_000, profile: 'partner', base: `${mock.apiBase.replace(/\/external$/, '')}/user/api-keys/device` }), { mode: 0o600 });
    const fresh = await runCli(['login', '--browser', '--wait-seconds', '0'], { env, kitHome: other });
    assert.equal(fresh.json.status, 'waiting_for_approval', fresh.stdout);
    assert.notEqual(fresh.json.verification_uri, 'https://junis.test/x', 'a new request for the default profile');
  });

  test('logins for two profiles at the same time keep both keys', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const names = ['', 'partner', 'ops'];
    for (const name of names) await runCli(['login', '--browser', ...(name ? ['--profile', name] : []), '--wait-seconds', '0'], { env, kitHome });
    approve(mock);
    const results = await Promise.all(names.map((name) => runCli(['login', '--browser', ...(name ? ['--profile', name] : []), '--wait-seconds', '8'], { env, kitHome })));
    for (const out of results) assert.equal(out.json.connected, true, out.stdout);
    const store = JSON.parse(fs.readFileSync(path.join(kitHome, 'credentials.json'), 'utf8'));
    assert.deepEqual(Object.keys(store.profiles).sort(), ['default', 'ops', 'partner']);
    for (const profile of Object.values(store.profiles)) assert.ok(profile.api_key, 'every key was kept');
  });

  test('a lock left by a crashed process is broken quickly, and a read-only kit folder does not crash logout', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const env = mock.env();
    const lock = path.join(kitHome, 'credentials.json.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    const started = Date.now();
    const login = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(login.code, 0, login.stdout);
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
    assert.equal(fs.existsSync(lock), false);
    const readOnly = tempDir();
    fs.chmodSync(readOnly, 0o500);
    try {
      const out = await runCli(['logout'], { env, kitHome: readOnly });
      assert.notEqual(out.json?.error, 'internal', out.stdout);
    } finally {
      fs.chmodSync(readOnly, 0o700);
    }
  });

  test('a profile name with a space is quoted in every follow-up command the kit suggests', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    const kitHome = tempDir();
    const out = await runCli(['login', '--browser', '--profile', 'my partner', '--wait-seconds', '0'], { env: mock.env(), kitHome });
    assert.match(out.json.then, /login --browser --profile 'my partner'/);
    const clip = await runCli(['login', '--profile', 'my partner'], { env: mock.env(), kitHome });
    assert.match(clip.json.reason, /--profile 'my partner'/);
  });

  test('a platform that refuses the requested permissions is asked for its defaults', async () => {
    const mock = await startMockJunis();
    open.push({ close: async () => mock.close() });
    mock.state.rejectScopes = true;
    const kitHome = tempDir();
    const first = await runCli(['login', '--browser', '--wait-seconds', '1'], { env: mock.env(), kitHome });
    assert.equal(first.json.status, 'waiting_for_approval', first.stdout);
    assert.equal([...mock.state.keyRequests.values()][0].scopes, null);
  });
});
