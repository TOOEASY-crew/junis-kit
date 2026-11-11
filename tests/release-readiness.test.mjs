// Release-readiness and security checks: the key stays on junis.ai
// unless custom hosts are allowed on purpose, the command line asks (--yes)
// where nothing else can, the Bash hook reads the kit's shape under any script
// name, a narrower key can be requested, and the repository carries CI,
// owners and a changelog.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CLI, REPO, runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { ORG_A, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';
import { customHostWarning, resolveProfile, saveProfile } from '../skills/junis/scripts/lib/config.mjs';
import { destructiveCommandReason } from '../skills/junis/scripts/lib/destructive.mjs';
import { KEY_REQUEST_CORE_SCOPES, KEY_REQUEST_PRESETS, KEY_REQUEST_SCOPES, parseKeyRequestScopes, reducedKeyRequestScopes } from '../skills/junis/scripts/lib/kit-tools.mjs';

let mock;
before(async () => {
  mock = await startMockJunis();
});
after(() => mock.close());

async function loggedInHome(extraEnv = {}) {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(extraEnv), kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  await runCli(['org', 'use', 'globex'], { env: mock.env(extraEnv), kitHome });
  return kitHome;
}

const HOOK = path.join(REPO, 'hooks', 'confirm-destructive.mjs');
const hook = (input) => execFileSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
const asks = (out) => out !== '' && JSON.parse(out).hookSpecificOutput.permissionDecision === 'ask';

// Runs a function with these environment variables set (undefined deletes), restoring them after.
function withEnv(values, fn) {
  const saved = {};
  for (const [name, value] of Object.entries(values)) {
    saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe('the key goes to junis.ai or this machine unless a custom host is allowed on purpose', () => {
  const CLEAR = { JUNIS_API_BASE: undefined, JUNIS_MCP_URL: undefined, JUNIS_WEB_URL: undefined, JUNIS_ALLOW_CUSTOM_HOST: undefined, JUNIS_API_KEY: undefined, JUNIS_PROFILE: undefined };

  test('the platform domain, its subdomains and loopback need no permission', () => {
    withEnv({ ...CLEAR, JUNIS_KIT_HOME: tempDir() }, () => {
      assert.equal(customHostWarning(resolveProfile()), '');
      withEnv({ JUNIS_API_BASE: 'https://example.junis.ai/api/external', JUNIS_MCP_URL: 'http://[::1]:9/mcp', JUNIS_WEB_URL: 'http://localhost:3000' }, () => {
        const profile = resolveProfile();
        assert.equal(profile.api_base, 'https://example.junis.ai/api/external');
        assert.equal(customHostWarning(profile), '');
      });
    });
  });

  test('an override to another host is refused with the fix, and look-alike names do not pass', () => {
    withEnv({ ...CLEAR, JUNIS_KIT_HOME: tempDir() }, () => {
      for (const [name, url] of [
        ['JUNIS_API_BASE', 'https://api.example.test/api/external'],
        ['JUNIS_MCP_URL', 'https://junis.ai.example.test/mcp'],
        ['JUNIS_WEB_URL', 'https://evil-junis.ai'],
      ]) {
        withEnv({ [name]: url }, () => {
          assert.throws(() => resolveProfile(), (err) => err.code === 'host_not_allowed' && err.message.includes(name) && /JUNIS_ALLOW_CUSTOM_HOST=1/.test(err.hint), url);
        });
      }
      // Plain http elsewhere is still the https error, which comes first.
      withEnv({ JUNIS_API_BASE: 'http://api.example.test/api/external' }, () => {
        assert.throws(() => resolveProfile(), (err) => err.code === 'insecure_url');
      });
    });
  });

  test('status fails clearly on an override to another host, and names the host once allowed', async () => {
    const refused = await runCli(['status', '--offline'], { env: { JUNIS_API_BASE: 'https://api.example.test/api/external', JUNIS_API_KEY: USER_KEY } });
    assert.equal(refused.code, 1);
    assert.equal(refused.json.error, 'host_not_allowed');
    assert.match(refused.json.message, /api\.example\.test/);
    const allowed = await runCli(['status', '--offline'], { env: { JUNIS_API_BASE: 'https://api.example.test/api/external', JUNIS_API_KEY: USER_KEY, JUNIS_ALLOW_CUSTOM_HOST: '1' } });
    assert.equal(allowed.code, 0, allowed.stdout);
    assert.match(allowed.json.warning, /api\.example\.test/);
    assert.match(allowed.json.warning, /JUNIS_ALLOW_CUSTOM_HOST/);
    const plain = await runCli(['status', '--offline'], { env: mock.env({ JUNIS_API_KEY: USER_KEY }) });
    assert.equal('warning' in plain.json, false, 'loopback (the test server) is not a custom host');
  });

  test('a stored profile whose host is no longer allowed fails the same way, never falling back silently', () => {
    const kitHome = tempDir();
    withEnv({ ...CLEAR, JUNIS_KIT_HOME: kitHome }, () => {
      saveProfile('default', { env: 'prod', api_key: USER_KEY, api_base: 'https://stale.example/api/external', mcp_url: 'https://stale.example/mcp', web_url: 'https://stale.example' }, { makeCurrent: true });
      assert.throws(() => resolveProfile(), (err) => err.code === 'host_not_allowed' && /stale\.example/.test(err.message) && /logout/.test(err.hint));
      withEnv({ JUNIS_ALLOW_CUSTOM_HOST: '1' }, () => {
        assert.equal(resolveProfile().api_base, 'https://stale.example/api/external');
      });
    });
  });

  test('a login under an allowed override saves that host, which the next run without the permission refuses', async () => {
    const kitHome = tempDir();
    // The test server is loopback; the web address is the override, since nothing is fetched from it at login.
    const env = mock.env({ JUNIS_WEB_URL: 'https://web.example.test', JUNIS_ALLOW_CUSTOM_HOST: '1' });
    const login = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
    assert.equal(login.code, 0, login.stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(kitHome, 'credentials.json'), 'utf8')).profiles.default.web_url, 'https://web.example.test');
    const later = await runCli(['status', '--offline'], { env: mock.env(), kitHome });
    assert.equal(later.code, 1);
    assert.equal(later.json.error, 'host_not_allowed');
    assert.match(later.json.message, /JUNIS_WEB_URL/);
  });

  test('the bridge says once on stderr where the key goes', async () => {
    const run = (env) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, 'mcp', '--lazy'], { env: { ...process.env, JUNIS_KIT_HOME: tempDir(), ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', () => resolve(stderr));
        child.stdin.end();
      });
    const warned = await run({ JUNIS_API_KEY: USER_KEY, ...mock.env({ JUNIS_MCP_URL: 'https://mcp.example.test/mcp', JUNIS_ALLOW_CUSTOM_HOST: '1' }) });
    assert.equal((warned.match(/mcp\.example\.test/g) || []).length, 1, warned);
    const quiet = await run({ JUNIS_API_KEY: USER_KEY, ...mock.env() });
    assert.doesNotMatch(quiet, /JUNIS_ALLOW_CUSTOM_HOST/);
  });

  test('doctor carries the same warning', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['doctor', '--home', tempDir()], { env: mock.env({ JUNIS_WEB_URL: 'https://web.example.test', JUNIS_ALLOW_CUSTOM_HOST: '1' }), kitHome });
    assert.match(result.json.warning, /web\.example\.test/);
    assert.ok(result.json.checks.some((entry) => entry.check === 'mcp_server' && entry.ok), 'the loopback test server is still reached');
  });
});

describe('the Bash hook reads the kit by name and by shape', () => {
  test('a copy or a link of junis.mjs under another name is read like the kit', () => {
    const dir = tempDir('copy-');
    const copy = path.join(dir, 'k.mjs');
    fs.copyFileSync(CLI, copy);
    const link = path.join(dir, 'tool');
    fs.symlinkSync(CLI, link);
    for (const script of [copy, link]) {
      assert.ok(destructiveCommandReason(`node ${script} api DELETE /brain/sources/1`), `${script} DELETE`);
      assert.ok(destructiveCommandReason(`node ${script} tools call delete_agent agent_id=x`), `${script} delete_agent`);
      assert.ok(destructiveCommandReason(`node --no-warnings ${script} api PATCH /management/agents/1 name=x`), `${script} with a node option`);
      assert.ok(destructiveCommandReason(`cd ${dir} && node ./tool api PUT /management/me/secrets/X --json '{}'`), 'relative name');
      assert.ok(destructiveCommandReason(`bash -c "node ${script} api DELETE /x"`), 'quoted');
      assert.equal(destructiveCommandReason(`node ${script} api GET /agents`), '', 'a read is not asked');
      assert.equal(destructiveCommandReason(`node ${script} tools call list_agents`), '', 'a read tool is not asked');
      assert.ok(asks(hook({ tool_name: 'Bash', tool_input: { command: `node ${script} api DELETE /brain/sources/1` } })), 'through the hook');
    }
    // A line with the shape but a value the shell fills in is asked about rather than guessed.
    assert.ok(destructiveCommandReason(`node ${copy} api DELETE $TARGET`));
  });

  test('other programs that take "api" or "tools" words are left alone', () => {
    for (const line of ['node server.js tools', 'node build.mjs api', 'node x.js tools list', 'npm test', 'node -e "console.log(1)" api']) {
      assert.equal(destructiveCommandReason(line), '', line);
    }
    // A quoted line with the shape may be run by a shell (`bash -c`), so it is read as a line of its own.
    assert.ok(destructiveCommandReason('sh -c "node x api DELETE /y"'));
  });

  test('a hook event that is not JSON but names the kit is asked about; other unreadable input passes', () => {
    assert.ok(asks(hook('not json: node junis.mjs api DELETE /x')));
    assert.ok(asks(hook('{"tool_name": "Bash", "tool_input": {"command": "node junis-kit api DELETE /x"')), 'cut-off JSON');
    assert.equal(hook('not json'), '');
    assert.equal(hook(''), '');
  });

  test('the hook has the timeout the security page documents', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    for (const entry of hooks.hooks.PreToolUse) for (const item of entry.hooks) assert.equal(item.timeout, 10);
    assert.match(fs.readFileSync(path.join(REPO, 'SECURITY.md'), 'utf8'), /10 seconds/);
  });
});

describe('on the command line a destructive call needs --yes when nothing can ask', () => {
  test('api DELETE, PUT and PATCH stop with exit code 2 and the reason, and send nothing', async () => {
    const kitHome = await loggedInHome();
    for (const [method, route] of [['DELETE', '/brain/sources/1'], ['PUT', '/management/me/secrets/X'], ['PATCH', '/management/agents/1']]) {
      const before = mock.state.requests.length;
      const result = await runCli(['api', method, route, 'name=x'], { env: mock.env(), kitHome });
      assert.equal(result.code, 2, result.stdout);
      assert.equal(result.json.error, 'needs_confirmation');
      assert.match(result.json.message, new RegExp(`${method} ${route}`));
      assert.match(result.json.hint, /--yes/);
      assert.equal(mock.state.requests.length, before, `${method} was not sent`);
    }
  });

  test('with --yes the call is sent; reads never need it', async () => {
    const kitHome = await loggedInHome();
    await runCli(['api', 'DELETE', '/brain/sources/1', '--yes'], { env: mock.env(), kitHome });
    assert.ok(mock.state.requests.some((entry) => entry.route === 'DELETE /brain/sources/1'));
    const read = await runCli(['api', 'GET', '/brain/sources'], { env: mock.env(), kitHome });
    assert.equal(read.code, 0, read.stdout);
    const create = await runCli(['api', 'POST', '/management/agents', 'name=NoYesNeeded'], { env: mock.env(), kitHome });
    assert.equal(create.code, 0, create.stdout);
  });

  test('tools call follows the shared destructive list', async () => {
    const kitHome = await loggedInHome();
    const before = mock.state.requests.length;
    const refused = await runCli(['tools', 'call', 'delete_agent', 'agent_id=x', `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    assert.equal(refused.code, 2);
    assert.equal(refused.json.error, 'needs_confirmation');
    assert.match(refused.json.message, /delete_agent/);
    assert.equal(mock.state.requests.length, before);
    const done = await runCli(['tools', 'call', 'delete_agent', 'agent_id=x', `organization_id=${ORG_A}`, '--yes'], { env: mock.env(), kitHome });
    assert.equal(done.code, 0, done.stdout);
    assert.equal(mock.state.requests.at(-1).route, 'TOOL delete_agent');
    const safe = await runCli(['tools', 'call', 'update_agent', 'agent_id=x', 'model=m', `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    assert.equal(safe.code, 0, safe.stdout);
  });

  test('the bridge keeps its own confirmation and never needs --yes', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome, lazy: true });
    try {
      await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      const asked = await bridge.callTool('junis_api', { method: 'DELETE', path: '/brain/sources/2' });
      assert.equal(asked.data.status, 'needs_confirmation');
      await bridge.callTool('junis_api', { method: 'DELETE', path: '/brain/sources/2', confirmed: true });
      assert.ok(mock.state.requests.some((entry) => entry.route === 'DELETE /brain/sources/2'));
      const tool = await bridge.callTool('junis_call_tool', { name: 'delete_agent', arguments: { agent_id: 'y', organization_id: ORG_A }, confirmed: true });
      assert.equal(tool.isError, false, JSON.stringify(tool.data));
      assert.equal(mock.state.requests.at(-1).route, 'TOOL delete_agent');
    } finally {
      await bridge.close();
    }
  });

  test('--help names the flag', async () => {
    const result = await runCli(['--help']);
    assert.match(result.stdout, /--yes/);
  });
});

describe('a narrower key can be requested through the browser', () => {
  test('presets and lists are checked locally', () => {
    assert.equal(parseKeyRequestScopes(undefined), null);
    assert.equal(parseKeyRequestScopes('all'), null);
    assert.deepEqual(parseKeyRequestScopes('read-only'), KEY_REQUEST_PRESETS['read-only']);
    assert.deepEqual(parseKeyRequestScopes('brain:read, agents:list'), ['brain:read', 'agents:list']);
    for (const preset of Object.values(KEY_REQUEST_PRESETS)) for (const scope of preset) assert.ok(KEY_REQUEST_SCOPES.includes(scope), scope);
    for (const preset of ['read-only', 'operator']) assert.ok(!KEY_REQUEST_PRESETS[preset].some((scope) => /:manage$|:delete$|:upload$/.test(scope)), `${preset} cannot change anything`);
    assert.throws(() => parseKeyRequestScopes('brain:write'), (err) => err.code === 'bad_scopes' && /brain:write/.test(err.message));
  });

  test('login --browser --scopes sends exactly those permissions', async () => {
    const kitHome = tempDir();
    const result = await runCli(['login', '--browser', '--scopes', 'read-only'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.status, 'waiting_for_approval');
    const request = [...mock.state.keyRequests.values()].at(-1);
    assert.deepEqual(request.scopes, KEY_REQUEST_PRESETS['read-only']);
    // The same request is continued, not replaced, as long as the permissions match; a different list starts a new one.
    const count = mock.state.keyRequests.size;
    await runCli(['login', '--browser', '--scopes', 'read-only'], { env: mock.env(), kitHome });
    assert.equal(mock.state.keyRequests.size, count);
    await runCli(['login', '--browser'], { env: mock.env(), kitHome });
    assert.equal(mock.state.keyRequests.size, count + 1);
    assert.deepEqual([...mock.state.keyRequests.values()].at(-1).scopes, KEY_REQUEST_SCOPES);
  });

  test('a permission the platform refuses is not replaced by a wider request', async () => {
    const kitHome = tempDir();
    const before = mock.state.keyRequests.size;
    const bad = await runCli(['login', '--browser', '--scopes', 'nothing:here'], { env: mock.env(), kitHome });
    assert.equal(bad.code, 1);
    assert.equal(bad.json.error, 'bad_scopes');
    mock.state.rejectScopes = true;
    try {
      const refused = await runCli(['login', '--browser', '--scopes', 'operator'], { env: mock.env(), kitHome });
      assert.equal(refused.code, 1);
      assert.equal(refused.json.error, 'bad_scopes');
    } finally {
      mock.state.rejectScopes = false;
    }
    assert.equal(mock.state.keyRequests.size, before, 'no request was started');
    const pasted = await runCli(['login', '--key-stdin', '--scopes', 'read-only'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
    assert.equal(pasted.code, 2, '--scopes is a browser option');
  });
});

describe('browser login asks for the Actions permissions and degrades to what the platform offers', () => {
  const ACTIONS = ['actions:read', 'actions:run', 'actions:manage'];
  // A platform of its own per case, so the order of start requests can be read exactly.
  async function platform(settings = {}) {
    const own = await startMockJunis();
    Object.assign(own.state, settings);
    return own;
  }
  const login = (own, args = []) => runCli(['login', '--browser', '--wait-seconds', '0', ...args], { env: own.env(), kitHome: tempDir() });

  test('the default request is the core list plus the three Actions permissions', () => {
    assert.equal(KEY_REQUEST_CORE_SCOPES.length, 26);
    assert.equal(KEY_REQUEST_SCOPES.length, 29);
    assert.deepEqual(KEY_REQUEST_SCOPES, [...KEY_REQUEST_CORE_SCOPES, ...ACTIONS]);
    assert.equal(new Set(KEY_REQUEST_SCOPES).size, 29, 'no permission twice');
  });

  test('a platform that knows them is asked once, for all 29', async () => {
    const own = await platform();
    try {
      const result = await login(own);
      assert.equal(result.json.status, 'waiting_for_approval', result.stdout);
      assert.deepEqual(own.state.keyRequestAttempts, [KEY_REQUEST_SCOPES], 'one request, nothing retried');
      const granted = [...own.state.keyRequests.values()].at(-1).scopes;
      for (const scope of ACTIONS) assert.ok(granted.includes(scope), scope);
      assert.equal(granted.length, 29);
    } finally {
      await own.close();
    }
  });

  test('a platform that does not know them yet gets one retry with the permissions it offers: the key is what it was before', async () => {
    // Before: adding a permission to the request made an older platform refuse the whole list, and the kit fell
    // back to the platform's default set, a key without Knowledge, wiki or vault permissions.
    const own = await platform({ unknownScopes: ACTIONS });
    try {
      const result = await login(own);
      assert.equal(result.code, 0, result.stdout);
      assert.equal(result.json.status, 'waiting_for_approval', result.stdout);
      assert.match(result.json.verification_uri, /auth\/api-key\?code=/);
      assert.deepEqual(own.state.keyRequestAttempts, [KEY_REQUEST_SCOPES, KEY_REQUEST_CORE_SCOPES], 'the full list, then the reduced one, and no third request');
      assert.equal(own.state.keyRequests.size, 1, 'one request is waiting');
      const granted = [...own.state.keyRequests.values()][0].scopes;
      assert.deepEqual(granted, KEY_REQUEST_CORE_SCOPES);
      for (const scope of ['brain:manage', 'wiki:manage', 'secrets:manage']) assert.ok(granted.includes(scope), `${scope} is not lost`);
    } finally {
      await own.close();
    }
  });

  test('the retry follows the list the platform names, so any other permission it lacks is dropped the same way', async () => {
    const own = await platform({ unknownScopes: [...ACTIONS, 'wiki:manage'] });
    try {
      const result = await login(own);
      assert.equal(result.json.status, 'waiting_for_approval', result.stdout);
      const expected = KEY_REQUEST_CORE_SCOPES.filter((scope) => scope !== 'wiki:manage');
      assert.deepEqual(own.state.keyRequestAttempts, [KEY_REQUEST_SCOPES, expected]);
      assert.deepEqual([...own.state.keyRequests.values()][0].scopes, expected);
    } finally {
      await own.close();
    }
  });

  test('a refusal that names no offered permissions falls back to the core list, then to the platform defaults', async () => {
    const quiet = await platform({ unknownScopes: ACTIONS, hideAvailableScopes: true });
    const older = await platform({ unknownScopes: [...ACTIONS, 'wiki:manage'], hideAvailableScopes: true });
    try {
      assert.equal((await login(quiet)).json.status, 'waiting_for_approval');
      assert.deepEqual(quiet.state.keyRequestAttempts, [KEY_REQUEST_SCOPES, KEY_REQUEST_CORE_SCOPES]);
      // The core list is refused as well: only then the platform's own defaults, as before.
      assert.equal((await login(older)).json.status, 'waiting_for_approval');
      assert.deepEqual(older.state.keyRequestAttempts, [KEY_REQUEST_SCOPES, KEY_REQUEST_CORE_SCOPES, null]);
      assert.equal([...older.state.keyRequests.values()][0].scopes, null);
    } finally {
      await quiet.close();
      await older.close();
    }
  });

  test('a 400 that is not about an unknown permission is not retried with a reduced list', async () => {
    const own = await platform({ rejectScopes: true });
    try {
      const result = await login(own);
      assert.equal(result.json.status, 'waiting_for_approval', result.stdout);
      assert.deepEqual(own.state.keyRequestAttempts, [KEY_REQUEST_SCOPES, null], 'straight to the platform defaults, as before');
    } finally {
      await own.close();
    }
  });

  test('permissions asked for by name are never narrowed: an older platform refuses them and nothing is retried', async () => {
    const own = await platform({ unknownScopes: ACTIONS });
    try {
      const refused = await login(own, ['--scopes', 'agents:list,actions:read']);
      assert.equal(refused.code, 1);
      assert.equal(refused.json.error, 'bad_scopes');
      assert.deepEqual(own.state.keyRequestAttempts, [['agents:list', 'actions:read']]);
      assert.equal(own.state.keyRequests.size, 0, 'no request was started');
    } finally {
      await own.close();
    }
  });

  test('only the unknown-permission refusal yields a reduced list', () => {
    const refusal = (detail) => ({ detail });
    assert.deepEqual(reducedKeyRequestScopes(refusal({ error: 'invalid_scopes', unknown_scopes: ACTIONS, available_scopes: [...KEY_REQUEST_CORE_SCOPES, 'users:provision'] })), KEY_REQUEST_CORE_SCOPES, 'the intersection, in the kit\'s order, never a permission the kit did not ask for');
    assert.deepEqual(reducedKeyRequestScopes(refusal({ error: 'invalid_scopes', unknown_scopes: ACTIONS })), KEY_REQUEST_CORE_SCOPES);
    assert.deepEqual(reducedKeyRequestScopes(refusal({ error: 'invalid_scopes', available_scopes: 'everything' })), KEY_REQUEST_CORE_SCOPES, 'a malformed list is ignored');
    assert.equal(reducedKeyRequestScopes(refusal({ error: 'invalid_scopes', available_scopes: KEY_REQUEST_SCOPES })), null, 'nothing narrower to ask for');
    assert.equal(reducedKeyRequestScopes(refusal({ error: 'invalid_scopes', available_scopes: ['users:provision'] })), null, 'an empty intersection is not sent');
    for (const other of [refusal('Unknown scope'), refusal({ error: 'org_level_only_scopes', available_scopes: KEY_REQUEST_CORE_SCOPES }), refusal({ error: 'empty_scopes' }), {}, null, undefined, 'Bad Request']) {
      assert.equal(reducedKeyRequestScopes(other), null, JSON.stringify(other));
    }
  });
});

describe('shipped text', () => {
  const tracked = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'results', 'research', 'fixtures'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? tracked(full) : [full];
  });

  test('names no internal repository, path, flag or hosted server pin', () => {
    // Case matters: `ff_off` is a value the platform returns and `/users/<id>` is an API route.
    const forbidden = /app\/nextjs-web|JunisAI|\/Users\/|staff-only|[Ff]ast[Mm][Cc][Pp] [0-9]|\bFF_[A-Z_]+/;
    const self = fileURLToPath(import.meta.url);
    for (const file of tracked(REPO)) {
      if (file === self || /\.(png|jpg|zip|ico|DS_Store)$/.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const hit = forbidden.exec(text);
      assert.equal(hit, null, `${path.relative(REPO, file)}: "${hit?.[0]}"`);
    }
  });

  test('the repository carries CI, owners, an issue template and a changelog for the current version', () => {
    const ci = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(ci, /npm run check/);
    assert.match(ci, /18/);
    assert.match(ci, /20/);
    assert.match(fs.readFileSync(path.join(REPO, '.github', 'CODEOWNERS'), 'utf8'), /^\* @2easyjunmin @raytona$/m);
    assert.ok(fs.existsSync(path.join(REPO, '.github', 'ISSUE_TEMPLATE', 'bug_report.md')));
    const version = JSON.parse(fs.readFileSync(path.join(REPO, 'kit.json'), 'utf8')).version;
    assert.match(fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8'), new RegExp(`## \\[${version.replace(/\./g, '\\.')}\\]`));
    assert.match(fs.readFileSync(path.join(REPO, 'SECURITY.md'), 'utf8'), /## Supported versions/);
    for (const readme of ['README.md', 'README.ko.md']) assert.match(fs.readFileSync(path.join(REPO, readme), 'utf8'), new RegExp(`JUNIS_KIT_REF=v${version.replace(/\./g, '\\.')}`), readme);
  });
});

describe('the live dashboard example is safe to copy', () => {
  const html = fs.readFileSync(path.join(REPO, 'examples', 'live-dashboard', 'index.html'), 'utf8');

  test('names from Knowledge are written as text, never as markup', () => {
    // Entity names come from ingested documents and imports; the page holds a token that reads the
    // organization's Knowledge, so interpolating them into innerHTML would run whatever a document contains.
    assert.doesNotMatch(html, /innerHTML\s*=\s*`[^`]*\$\{/, 'no template string with values goes into innerHTML');
    assert.doesNotMatch(html, /insertAdjacentHTML|document\.write\(/);
    assert.match(html, /textContent\s*=\s*e\.name/);
  });

  test('the browser token stays in memory and in the Authorization header', () => {
    assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/);
    assert.doesNotMatch(html, /[?&](access_)?token=/, 'the token never goes in a URL');
    assert.match(html, /Authorization: 'Bearer ' \+ token/);
  });

  test('every call carries the route hint, and no API key header appears', () => {
    // The platform balances browser-token requests by X-Junis-Route; a page without it puts all its viewers on one server.
    const calls = html.match(/fetch\((?:API \+ path|`\$\{API\})[^\n]*/g) || [];
    assert.equal(calls.length, 2, 'the entity read and the change stream');
    assert.equal((html.match(/'X-Junis-Route': ROUTE/g) || []).length, 2, 'both calls send the hint');
    assert.doesNotMatch(html, /X-API-Key/i, 'the hint is refused together with an API key');
  });
});
