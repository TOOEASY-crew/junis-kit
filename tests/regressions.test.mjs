// Regression tests: each pins a defect in the kit's behaviour against the platform
// so it stays fixed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { REPO, runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { ORG_A, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';
import { destructiveApiReason, destructiveCommandReason, destructiveReason, isDestructiveTool } from '../skills/junis/scripts/lib/destructive.mjs';
import { explainError } from '../skills/junis/scripts/lib/errors.mjs';
import { httpRequest } from '../skills/junis/scripts/lib/http.mjs';
import { RemoteMcp, MODERN_PROTOCOL_VERSION } from '../skills/junis/scripts/lib/mcp-remote.mjs';
import { expandFileReferences } from '../skills/junis/scripts/lib/args.mjs';
import { diffSnapshots } from '../skills/junis/scripts/lib/snapshot.mjs';

let mock;
before(async () => {
  mock = await startMockJunis();
});
after(() => mock.close());

async function loggedInHome() {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  await runCli(['org', 'use', 'globex'], { env: mock.env(), kitHome });
  return kitHome;
}

describe('every destructive tool is asked about, on every path', () => {
  const HOOK = path.join(REPO, 'hooks', 'confirm-destructive.mjs');
  const hook = (tool_name, tool_input) => execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8' });
  const asks = (out) => out !== '' && JSON.parse(out).hookSpecificOutput.permissionDecision === 'ask';

  test('tools on the shared list always carry a reason', () => {
    for (const name of ['squad_apply', 'rollback_agent', 'set_agent_enabled_tools', 'set_agent_confirmation_tools', 'set_tool_safety', 'set_flag_org_opt_out',
      'actions_agent_set', 'actions_connection_update', 'actions_draft_update', 'actions_import_openapi']) {
      assert.ok(isDestructiveTool(name), name);
      assert.ok(destructiveReason(name, { organization_id: 'o' }), `${name} has no reason`);
    }
  });

  test('Knowledge deletions are destructive too', () => {
    for (const name of ['knowledge_source_delete', 'knowledge_db_check_delete']) {
      assert.ok(isDestructiveTool(name), name);
      assert.ok(destructiveReason(name, { source_id: 's' }), `${name} has no reason`);
    }
    assert.equal(isDestructiveTool('knowledge_db_checks'), false);
    assert.equal(destructiveReason('knowledge_db_checks', {}), '');
  });

  test('Actions: a run, a deletion, a replaced list, connection or draft and a bulk import are asked; new drafts, previews and reads are not', () => {
    // An action run reaches a system outside Junis, so it is asked like a deletion; a dry run sends nothing.
    assert.ok(isDestructiveTool('actions_run'));
    assert.match(destructiveReason('actions_run', { name: 'open_ticket', args: { title: 'x' } }), /outside Junis/);
    assert.match(destructiveReason('actions_run', { name: 'open_ticket', dry_run: false }), /outside Junis/);
    for (const value of [true, 'true', 1]) assert.equal(destructiveReason('actions_run', { name: 'open_ticket', dry_run: value }), '', `dry_run=${value}`);
    for (const name of ['actions_connection_delete', 'actions_draft_delete']) {
      assert.ok(isDestructiveTool(name), name);
      assert.match(destructiveReason(name, { organization_id: 'o' }), /cannot be undone/, name);
    }
    assert.match(destructiveReason('actions_agent_set', { agent_id: 'a', actions: [] }), /whole list/);
    assert.match(destructiveReason('actions_connection_update', { connection_id: 'c', is_active: false }), /switches the connection/);
    assert.match(destructiveReason('actions_import_openapi', { spec: '{}', operations: ['createOrder'] }), /one draft action/);
    // A draft update replaces the whole draft in place (the External PUT is asked by its verb too) — the tool asks the same way (2026-11-09)
    assert.match(destructiveReason('actions_draft_update', { definition_id: 'd1', description: 'x', effect: 'write' }), /replaces the whole draft/);
    for (const name of ['actions_overview', 'actions_connections', 'actions_list', 'actions_get', 'actions_runs', 'actions_run_get', 'actions_agent_get',
      'actions_connection_create', 'actions_connection_test', 'actions_draft_create', 'actions_dry_run', 'actions_import_openapi_preview']) {
      assert.equal(isDestructiveTool(name), false, name);
      assert.equal(destructiveReason(name, { organization_id: 'o', dry_run: false }), '', name);
    }
    // The same calls through the External API: PUT and DELETE are asked by their verb, these two POSTs by their route.
    assert.match(destructiveApiReason('POST', '/actions/run', { body: { name: 'open_ticket', args: {} } }), /outside Junis/);
    assert.match(destructiveApiReason('POST', '/api/external/actions/run/', { body: { name: 'open_ticket' } }), /outside Junis/);
    assert.equal(destructiveApiReason('POST', '/actions/run', { body: { name: 'open_ticket', dry_run: true } }), '');
    assert.match(destructiveApiReason('POST', '/actions/import/openapi', { body: { spec: '{}' } }), /one draft action/);
    assert.equal(destructiveApiReason('POST', '/actions/import/openapi/preview', { body: { spec: '{}' } }), '');
    for (const quiet of ['/actions/connections', '/actions/connections/c1/test', '/actions/definitions', '/actions/definitions/d1/dry-run']) {
      assert.equal(destructiveApiReason('POST', quiet, { body: {} }), '', quiet);
    }
    assert.equal(destructiveApiReason('GET', '/actions/runs'), '');
    assert.ok(destructiveApiReason('PUT', '/actions/agents/a1', { body: { actions: [] } }));
    assert.ok(destructiveApiReason('DELETE', '/actions/definitions/d1'));
    // And on the command line, read the way the CLI will send it.
    const kit = 'node /x/junis-kit/skills/junis/scripts/junis.mjs';
    assert.ok(destructiveCommandReason(`${kit} tools call actions_run name=open_ticket --json '{"args":{"title":"x"}}'`));
    assert.equal(destructiveCommandReason(`${kit} tools call actions_run name=open_ticket dry_run=true`), '');
    assert.equal(destructiveCommandReason(`${kit} tools call actions_run --json '{"name":"open_ticket","dry_run":true}'`), '');
    assert.ok(destructiveCommandReason(`${kit} tools call actions_run --json -`), 'arguments from stdin cannot be read, so it is asked');
    assert.ok(destructiveCommandReason(`${kit} api POST /actions/run --json '{"name":"open_ticket","args":{}}'`));
    assert.equal(destructiveCommandReason(`${kit} api POST /actions/run --json '{"name":"open_ticket","dry_run":true}'`), '');
    assert.ok(destructiveCommandReason(`${kit} tools call actions_draft_delete definition_id=d1`));
    assert.equal(destructiveCommandReason(`${kit} tools call actions_dry_run definition_id=d1`), '');
    assert.equal(destructiveCommandReason(`${kit} tools call actions_draft_create --json '{"name":"open_ticket"}'`), '');
  });

  test('Actions import (junis.actions/v1): asked only when it really writes — the tool previews by default, the route imports by default', () => {
    const doc = { format: 'junis.actions/v1', connections: [], actions: [] };
    assert.ok(isDestructiveTool('actions_import'));
    for (const value of [false, 'false', 0, 'no']) assert.match(destructiveReason('actions_import', { document: doc, dry_run: value }), /action drafts/, `dry_run=${value}`);
    for (const input of [{ document: doc }, { document: doc, dry_run: true }, { document: doc, dry_run: 'true' }]) {
      assert.equal(destructiveReason('actions_import', input), '', JSON.stringify(input));
    }
    assert.equal(isDestructiveTool('actions_export'), false);
    assert.equal(destructiveReason('actions_export', { organization_id: 'o' }), '');
    assert.match(destructiveApiReason('POST', '/actions/import', { body: { document: doc } }), /action drafts/);
    assert.match(destructiveApiReason('POST', '/api/external/actions/import', { body: { document: doc, dry_run: false } }), /action drafts/);
    assert.equal(destructiveApiReason('POST', '/actions/import', { body: { document: doc, dry_run: true } }), '');
    assert.equal(destructiveApiReason('GET', '/actions/export', {}), '');
  });

  test('the designed exceptions stay: a bundle create and a platform rename are not asked', () => {
    assert.equal(destructiveReason('manage_skill_bundle', { action: 'create' }), '');
    assert.equal(destructiveReason('update_mcp_platform', { display_name: 'x' }), '');
  });

  test('the Claude Code hook asks for them', () => {
    assert.ok(asks(hook('mcp__plugin_junis_junis__squad_apply', { organization_id: 'o', plan_id: 'p' })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__rollback_agent', { agent_id: 'a', version: 2 })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__knowledge_source_delete', { source_id: 's' })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__junis_call_tool', { name: 'squad_apply', arguments: { plan_id: 'p' } })));
    assert.ok(asks(hook('Bash', { command: 'node /x/junis-kit/skills/junis/scripts/junis.mjs tools call squad_apply plan_id=p' })));
    assert.ok(asks(hook('Bash', { command: 'node /x/junis-kit/skills/junis/scripts/junis.mjs tools call knowledge_source_delete source_id=s' })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__actions_run', { name: 'open_ticket', args: { title: 'x' } })));
    assert.ok(asks(hook('mcp__junis__actions_agent_set', { agent_id: 'a', actions: ['open_ticket'] })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__junis_call_tool', { name: 'actions_run', arguments: { name: 'open_ticket' } })));
    assert.ok(asks(hook('mcp__plugin_junis_junis__junis_api', { method: 'POST', path: '/actions/run', body: { name: 'open_ticket' } })));
    assert.ok(asks(hook('Bash', { command: 'node /x/junis-kit/skills/junis/scripts/junis.mjs tools call actions_run name=open_ticket' })));
    assert.equal(hook('mcp__plugin_junis_junis__actions_run', { name: 'open_ticket', dry_run: true }), '', 'a dry run sends nothing');
    assert.equal(hook('mcp__plugin_junis_junis__actions_dry_run', { definition_id: 'd1', args: {} }), '');
    assert.equal(hook('mcp__plugin_junis_junis__actions_draft_create', { name: 'open_ticket' }), '');
  });

  test('the lazy bridge returns needs_confirmation first', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome, lazy: true });
    try {
      const result = await bridge.callTool('junis_call_tool', { name: 'squad_apply', arguments: { organization_id: ORG_A, plan_id: 'p' } });
      assert.equal(result.data.status, 'needs_confirmation', JSON.stringify(result.data));
      const run = await bridge.callTool('junis_call_tool', { name: 'actions_run', arguments: { organization_id: ORG_A, name: 'open_ticket', args: {} } });
      assert.equal(run.data.status, 'needs_confirmation', JSON.stringify(run.data));
      const api = await bridge.callTool('junis_api', { method: 'POST', path: '/actions/run', body: { name: 'open_ticket', args: {} } });
      assert.equal(api.data.status, 'needs_confirmation', JSON.stringify(api.data));
    } finally {
      await bridge.close();
    }
  });
});

describe('a validation error never echoes the submitted value', () => {
  test('a 422 from the api command drops `input`, so an @env: secret stays out of the output', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['api', 'PUT', '/management/me/secrets/DB', '--yes', '--json', '{"val":"@env:AUDIT_DB_PASSWORD"}'], {
      env: mock.env({ AUDIT_DB_PASSWORD: 'hunter2-secret-value' }),
      kitHome,
    });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout, /hunter2-secret-value/);
    assert.doesNotMatch(result.stderr, /hunter2-secret-value/);
    assert.match(result.stdout, /Field required/);
    assert.match(result.stdout, /"value"/, 'the field name is still reported');
  });
});

describe('a request started after cancellation is never sent', () => {
  test('an already aborted signal stops httpRequest before fetch', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        httpRequest('POST', `http://127.0.0.1:${server.address().port}/x`, { body: '{}', signal: controller.signal }),
        (err) => err.code === 'cancelled',
      );
      assert.equal(hits, 0, 'the request was sent although it was already cancelled');
    } finally {
      server.close();
    }
  });
});

describe('long junis_api results are cut with a note, like tool results', () => {
  test('a huge session read is clipped at the bridge limit and says so', async () => {
    const kitHome = await loggedInHome();
    const id = '44444444-4444-4444-8444-444444444444';
    mock.state.sessions.set(id, { id, organizationId: ORG_A, processing: false, messages: [{ event_type: 'assistant_message', content: 'x'.repeat(150_000) }] });
    const bridge = startBridge({ env: mock.env(), kitHome });
    try {
      const response = await bridge.request('tools/call', { name: 'junis_api', arguments: { method: 'GET', path: `/sessions/${id}/messages` } });
      const text = response.result.content[0].text;
      assert.ok(text.length < 120_000, `not clipped: ${text.length} characters`);
      assert.match(text, /truncated \d+ characters/);
    } finally {
      await bridge.close();
    }
  });
});

describe('run status and budget', () => {
  test('a running status names the agent at work, as the platform reports it', async () => {
    const slow = await startMockJunis({ runDelayMs: 1500 });
    try {
      const kitHome = tempDir();
      const env = slow.env({ JUNIS_KIT_POLL_MS: '150' });
      await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
      await runCli(['org', 'use', 'globex'], { env, kitHome });
      const started = await runCli(['run', 'orchestrator', 'slow job', '--no-wait'], { env, kitHome });
      assert.equal(started.json.status, 'running', started.stdout);
      const status = await runCli(['session', 'status', started.json.session_id], { env, kitHome });
      assert.equal(status.json.status, 'running', status.stdout);
      assert.equal(status.json.current_agent, 'Orchestrator_Globex');
    } finally {
      await slow.close();
    }
  });

  test('max_llm_calls given as a numeric string is sent as a number, not dropped', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    try {
      mock.state.requests.length = 0;
      const result = await bridge.callTool('junis_run', { message: 'budget', max_llm_calls: '5', wait_seconds: 5 });
      assert.equal(result.data.status, 'completed', JSON.stringify(result.data));
      const sent = mock.state.requests.find((entry) => entry.route === 'POST /v1/chat/completions');
      assert.equal(sent.body.max_llm_calls, 5);
    } finally {
      await bridge.close();
    }
  });
});

describe('the protocol fallback is remembered per server, not per client object', () => {
  function serve(handler) {
    const seen = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        seen.push({ headers: req.headers, body });
        const out = handler(req.headers, body);
        res.writeHead(out.status || 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json));
      });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
  }
  const legacyServer = (headers, body) => {
    if (headers['mcp-protocol-version'] === MODERN_PROTOCOL_VERSION) {
      return { status: 400, json: { jsonrpc: '2.0', id: 'server-error', error: { code: -32600, message: 'Bad Request: Unsupported protocol version: x. Supported versions: 2025-06-18' } } };
    }
    return { json: { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'add' }] } } };
  };

  test('a server upgraded during the process is spoken to the modern way again', async () => {
    let modern = false;
    const flipping = (headers, body) => {
      const isModern = headers['mcp-protocol-version'] === MODERN_PROTOCOL_VERSION;
      if (!modern) {
        if (isModern) return { status: 400, json: { jsonrpc: '2.0', id: 'server-error', error: { code: -32600, message: 'Bad Request: Unsupported protocol version: x. Supported versions: 2025-06-18' } } };
        return { json: { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'add' }] } } };
      }
      if (!isModern) return { json: { jsonrpc: '2.0', id: body.id, error: { code: -32022, message: 'Unsupported protocol version' } } };
      return { json: { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [{ name: 'add' }] } } };
    };
    const { server, seen, url } = await serve(flipping);
    try {
      await new RemoteMcp({ url, apiKey: 'jns_user_testkey' }).rpc('tools/list');
      assert.equal(seen.length, 2, 'pinned to legacy');
      modern = true; // the server was upgraded
      const client = new RemoteMcp({ url, apiKey: 'jns_user_testkey' });
      const result = await client.rpc('tools/list');
      assert.equal(result.tools[0].name, 'add');
      assert.equal(seen.length, 4, 'legacy refused once, then modern');
      assert.equal(client.protocol, 'modern');
      await new RemoteMcp({ url, apiKey: 'jns_user_testkey' }).rpc('tools/list');
      assert.equal(seen.length, 5, 'the pin was cleared: modern straight away');
    } finally {
      server.close();
    }
  });

  test('a second client to a legacy server speaks legacy at once', async () => {
    const { server, seen, url } = await serve(legacyServer);
    try {
      await new RemoteMcp({ url, apiKey: 'jns_user_testkey' }).rpc('tools/list');
      assert.equal(seen.length, 2, 'first client: modern then legacy');
      await new RemoteMcp({ url, apiKey: 'jns_user_testkey' }).rpc('tools/list');
      assert.equal(seen.length, 3, 'second client sent the modern request again');
    } finally {
      server.close();
    }
  });
});

describe('a snapshot is enough to notice an undo gap', () => {
  test('platform, skill and datastore lists and per-agent tool access are diffed', async () => {
    const kitHome = await loggedInHome();
    const before = path.join(kitHome, 'before.json');
    const afterFile = path.join(kitHome, 'after.json');
    mock.state.mcpPlatforms[ORG_A] = [{ platform_id: 'p1', name: 'Slack' }];
    mock.state.skills[ORG_A] = [{ id: 'sk1', name: 'Tone' }];
    // Datastores come back with display_name (no name), like the platform.
    mock.state.datastores[ORG_A] = [{ datastore_id: 'd1', display_name: 'Docs' }];
    mock.state.toolAccess['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = {
      agent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      mcp: [{ platform_id: 'p1', name: 'Slack', enabled_tools: ['channels_list'] }],
      composio: [{ auth_config_id: 'ac1', toolkit_slug: 'gmail', enabled_tools: null, toolkit_logo_url: `data:image/png;base64,${'A'.repeat(5000)}` }],
    };
    try {
      const first = await runCli(['snapshot', '--org', ORG_A, '--out', before], { env: mock.env(), kitHome });
      assert.equal(first.code, 0, first.stdout);
      const saved = JSON.parse(fs.readFileSync(before, 'utf8'));
      assert.equal(saved.tool_access['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'].mcp[0].enabled_tools[0], 'channels_list');
      assert.equal(saved.tool_access['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'].composio[0].toolkit_slug, 'gmail');
      assert.doesNotMatch(fs.readFileSync(before, 'utf8'), /toolkit_logo_url/, 'logos are not configuration');

      mock.state.mcpPlatforms[ORG_A] = [];
      mock.state.skills[ORG_A] = [{ id: 'sk1', name: 'Tone', description: 'changed' }];
      mock.state.datastores[ORG_A] = [{ datastore_id: 'd1', display_name: 'Docs' }, { datastore_id: 'd2', display_name: 'More' }];
      mock.state.toolAccess['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'].mcp[0].enabled_tools = null;
      const second = await runCli(['snapshot', '--org', ORG_A, '--out', afterFile], { env: mock.env(), kitHome });
      assert.equal(second.code, 0, second.stdout);

      const diff = diffSnapshots(before, afterFile);
      assert.equal(diff.identical, false);
      assert.deepEqual(diff.mcp_platforms, [{ platform: 'Slack', change: 'removed' }]);
      assert.deepEqual(diff.skills, [{ skill: 'Tone', change: 'changed', fields: ['description'] }]);
      assert.deepEqual(diff.datastores, [{ datastore: 'More', change: 'added' }]);
      const digest = diff.agents_changed.find((entry) => entry.agent === 'DigestWriter');
      assert.ok(digest && digest.changes.some((change) => change.field === 'tool_access'), JSON.stringify(diff.agents_changed));
    } finally {
      mock.state.mcpPlatforms[ORG_A] = [];
      mock.state.skills[ORG_A] = [];
      mock.state.datastores[ORG_A] = [];
      delete mock.state.toolAccess['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    }
  });

  test('a snapshot taken before tool access was recorded does not make every agent look changed', async () => {
    const kitHome = await loggedInHome();
    const file = path.join(kitHome, 'now.json');
    const result = await runCli(['snapshot', '--org', ORG_A, '--out', file], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete data.tool_access; // an older kit wrote no tool_access
    const older = path.join(kitHome, 'older.json');
    fs.writeFileSync(older, JSON.stringify(data));
    const diff = diffSnapshots(older, file);
    assert.equal(diff.identical, true, JSON.stringify(diff));
  });

  test('more than 200 schedules are all saved', async () => {
    const kitHome = await loggedInHome();
    const original = mock.state.schedules[ORG_A];
    mock.state.schedules[ORG_A] = Array.from({ length: 230 }, (_, i) => ({ id: `s${i}`, name: `job ${i}`, schedule_type: 'daily', enabled: true }));
    try {
      const out = path.join(kitHome, 'many.json');
      const result = await runCli(['snapshot', '--org', ORG_A, '--out', out], { env: mock.env(), kitHome });
      assert.equal(result.code, 0, result.stdout);
      assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).schedules.length, 230);
    } finally {
      mock.state.schedules[ORG_A] = original;
    }
  });
});

describe('error hints lead with the cheapest fix', () => {
  test('a missing scope is added to the existing key or re-requested by browser login, before any new key', () => {
    const { hint } = explainError('403 {"detail":{"error":"insufficient_scopes","missing_scopes":["secrets:manage"]}}');
    assert.match(hint, /Add permissions/);
    assert.match(hint, /browser/i);
    assert.ok(hint.indexOf('Add permissions') < hint.indexOf('new key'), hint);
  });

  test('a missing Actions permission gets the same two fixes, without promising what an older platform cannot give', () => {
    // Browser login asks for the Actions permissions only where the platform offers them (it retries without
    // them otherwise), so the hint must not say that logging in again always grants every permission.
    const { hint } = explainError("Junis API error 403: {'error': 'insufficient_scopes', 'missing_scopes': ['actions:manage']}");
    assert.match(hint, /actions:manage/);
    assert.match(hint, /Add permissions/);
    assert.match(hint, /browser login again/);
    assert.match(hint, /that this platform offers/);
    assert.doesNotMatch(hint, /every permission the kit needs/);
    assert.ok(hint.indexOf('Add permissions') < hint.indexOf('new key'), hint);
  });
});

describe('a file reference is refused early when it cannot be uploaded anyway', () => {
  test('@base64: over the upload limit fails fast instead of reading the whole file', () => {
    const dir = tempDir();
    const big = path.join(dir, 'big.bin');
    const fd = fs.openSync(big, 'w');
    fs.ftruncateSync(fd, 51 * 1024 * 1024); // sparse: no bytes written
    fs.closeSync(fd);
    assert.throws(() => expandFileReferences({ content: `@base64:${big}` }), (err) => err.code === 'file_too_large');
    assert.throws(() => expandFileReferences({ files: [{ content: `@base64:${big}` }] }), (err) => err.code === 'file_too_large');
  });
});
