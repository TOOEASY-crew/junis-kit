import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runCli, startBridge as launchBridge, tempDir } from './helpers/harness.mjs';
import { ORG_A, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

const MODERN = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };

let mock;
before(async () => {
  mock = await startMockJunis();
});
// Every bridge is closed after the tests, so a failing assertion reports as a
// failure instead of leaving a child process that keeps the run alive.
const bridges = [];
function startBridge(options) {
  const bridge = launchBridge(options);
  bridges.push(bridge);
  return bridge;
}
after(async () => {
  for (const bridge of bridges) await bridge.close().catch(() => {});
  await mock.close();
});

async function loggedInHome() {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  return kitHome;
}

describe('handshake', () => {
  test('a client that opens with initialize is served the revision it asked for', async () => {
    const bridge = startBridge({ env: mock.env() });
    const init = await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'junis');
    assert.ok(init.result.capabilities.tools);
    assert.equal(init.result.resultType, undefined);
    await bridge.close();
  });

  test('an unknown legacy revision falls back to one the server speaks', async () => {
    const bridge = startBridge({ env: mock.env() });
    const init = await bridge.request('initialize', { protocolVersion: '2019-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    await bridge.close();
  });

  test('a stateless client can discover the server without a handshake', async () => {
    const bridge = startBridge({ env: mock.env() });
    const discover = await bridge.request('server/discover', { _meta: MODERN });
    assert.equal(discover.result.resultType, 'complete');
    assert.ok(discover.result.supportedVersions.includes('2026-07-28'));
    assert.equal(discover.result._meta['io.modelcontextprotocol/serverInfo'].name, 'junis');
    assert.equal(typeof discover.result.ttlMs, 'number');
    await bridge.close();
  });

  test('stateless results carry resultType and cache hints', async () => {
    const bridge = startBridge({ env: mock.env(), lazy: true });
    const list = await bridge.request('tools/list', { _meta: MODERN });
    assert.equal(list.result.resultType, 'complete');
    assert.equal(list.result.cacheScope, 'public');
    assert.ok(list.result.ttlMs > 0);
    const call = await bridge.request('tools/call', { name: 'junis_lint_instruction', arguments: { text: 'ok' }, _meta: MODERN });
    assert.equal(call.result.resultType, 'complete');
    await bridge.close();
  });

  test('an unsupported stateless revision is rejected with the supported list', async () => {
    const bridge = startBridge({ env: mock.env() });
    const response = await bridge.request('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2031-01-01' } });
    assert.equal(response.error.code, -32022);
    assert.ok(response.error.data.supported.includes('2026-07-28'));
    assert.equal(response.error.data.requested, '2031-01-01');
    await bridge.close();
  });

  test('instructions fit the limits agents apply to them', async () => {
    const bridge = startBridge({ env: mock.env() });
    const init = await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.ok(init.result.instructions.length < 2048, 'Claude Code truncates at 2,048 characters');
    assert.match(init.result.instructions.slice(0, 512), /junis_status/, 'the first 512 characters must stand alone');
    await bridge.close();
  });

  test('unknown methods and malformed input get protocol errors, not a crash', async () => {
    const bridge = startBridge({ env: mock.env() });
    const unknown = await bridge.request('resources/list');
    assert.equal(unknown.error.code, -32601);
    bridge.sendRaw('this is not json');
    const stillAlive = await bridge.request('ping');
    assert.deepEqual(stillAlive.result, {});
    assert.ok(bridge.notifications.some((message) => message.error?.code === -32700));
    await bridge.close();
  });

  test('nothing but protocol messages is written to stdout', async () => {
    const bridge = startBridge({ env: mock.env() });
    await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    await bridge.request('tools/list');
    await bridge.callTool('junis_status');
    for (const line of bridge.raw) assert.equal(JSON.parse(line).jsonrpc, '2.0');
    await bridge.close();
  });
});

describe('tool exposure', () => {
  test('full mode lists every platform tool with safety annotations', async () => {
    const bridge = startBridge({ env: mock.env() });
    const list = await bridge.request('tools/list');
    const tools = list.result.tools;
    const names = tools.map((tool) => tool.name);
    assert.ok(tools.length >= 81 + 5);
    assert.equal(new Set(names).size, names.length, 'tool names must be unique');
    assert.equal(tools.find((tool) => tool.name === 'list_agents').annotations.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'delete_agent').annotations.destructiveHint, true);
    assert.equal(tools.find((tool) => tool.name === 'create_agent').annotations.readOnlyHint, false);
    assert.ok(!names.includes('junis_call_tool'), 'the indirection tool is only needed in lazy mode');
    await bridge.close();
  });

  test('lazy mode lists a handful of tools and stays small', async () => {
    const bridge = startBridge({ env: mock.env(), lazy: true });
    const list = await bridge.request('tools/list');
    assert.ok(list.result.tools.length <= 12);
    // Budget for the kit's own tools in lazy mode. Raised from 8,000 when junis_wiki joined (one tool, three actions);
    // the platform catalogue stays behind junis_find_tools / junis_call_tool.
    assert.ok(JSON.stringify(list.result.tools).length < 9600, 'lazy mode exists to keep tool schemas out of context');
    for (const name of ['junis_status', 'junis_find_tools', 'junis_describe_tool', 'junis_call_tool', 'junis_run', 'junis_run_status']) {
      assert.ok(list.result.tools.some((tool) => tool.name === name), `${name} is listed`);
    }
    await bridge.close();
  });

  test('every tool has a description and an object input schema', async () => {
    const bridge = startBridge({ env: mock.env() });
    const list = await bridge.request('tools/list');
    for (const tool of list.result.tools) {
      assert.ok(tool.description?.length > 10, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} has an object schema`);
      assert.ok(tool.name.length <= 64, `${tool.name} fits the 64 character limit`);
    }
    await bridge.close();
  });
});

describe('before login', () => {
  test('the server still starts and status explains how to connect', async () => {
    const bridge = startBridge({ env: mock.env() });
    const status = await bridge.callTool('junis_status');
    assert.equal(status.isError, false);
    assert.equal(status.data.logged_in, false);
    assert.match(status.data.login_url, /api-keys/);
    await bridge.close();
  });

  test('a platform call returns the connection steps as a readable error', async () => {
    const bridge = startBridge({ env: mock.env() });
    const result = await bridge.callTool('list_agents');
    assert.equal(result.isError, true);
    assert.equal(result.data.error, 'not_logged_in');
    assert.ok(result.data.detail.what_to_tell_the_user.length);
    await bridge.close();
  });

  test('discovery works without a key', async () => {
    const bridge = startBridge({ env: mock.env(), lazy: true });
    const found = await bridge.callTool('junis_find_tools', { query: 'schedule' });
    assert.equal(found.data.matched, 5);
    const described = await bridge.callTool('junis_describe_tool', { name: 'create_schedule' });
    assert.ok(described.data.input_schema.properties.schedule_type);
    await bridge.close();
  });
});

describe('after login', () => {
  test('a platform tool call passes through with structured content', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const response = await bridge.request('tools/call', { name: 'list_agents', arguments: { organization_id: ORG_A } });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.count, 2);
    await bridge.close();
  });

  test('lazy mode reaches the same tool through junis_call_tool', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome, lazy: true });
    const result = await bridge.callTool('junis_call_tool', { name: 'list_agents', arguments: { organization_id: ORG_A } });
    assert.equal(result.isError, false);
    assert.equal(result.data.count, 2);
    const direct = await bridge.callTool('list_agents', { organization_id: ORG_A });
    assert.equal(direct.isError, true);
    assert.match(direct.data.message, /junis_call_tool/);
    await bridge.close();
  });

  test('a platform error comes back with the next action attached', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const response = await bridge.request('tools/call', { name: 'get_agent', arguments: { agent_id: 'missing', organization_id: ORG_A } });
    assert.equal(response.result.isError, true);
    const text = response.result.content.map((block) => block.text).join('\n');
    assert.match(text, /404/);
    assert.match(text, /What to do:/);
    await bridge.close();
  });

  test('an organization name instead of a UUID is stopped before it reaches the platform', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const count = mock.state.requests.length;
    const result = await bridge.callTool('list_agents', { organization_id: 'globex' });
    assert.equal(result.isError, true);
    assert.equal(result.data.error, 'bad_organization_id');
    assert.equal(mock.state.requests.length, count);
    await bridge.close();
  });

  test('the default organization can be set by name and is then used', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const chosen = await bridge.callTool('junis_use_organization', { organization: 'GlobexSales' });
    assert.equal(chosen.data.default_organization.slug, 'globexsales');
    const agents = await bridge.callTool('list_agents');
    assert.equal(agents.data.items[0].agent_id, 'orchestrator-globexsales');
    await bridge.close();
  });

  test('the external api tool reaches endpoints that have no dedicated tool', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const result = await bridge.callTool('junis_api', { path: '/brain/sources' });
    assert.equal(result.isError, false);
    assert.equal(result.data.total, 1);
    await bridge.close();
  });

  test('wiki tools read, replace with confirmation and append a page', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const page = await bridge.callTool('junis_wiki', { action: 'get', file_key: 'policies/returns' });
    assert.equal(page.isError, false);
    assert.equal(page.data.version, 3);
    assert.equal(page.data.content, 'Returns within 30 days.');

    const empty = await bridge.callTool('junis_wiki', { action: 'put', file_key: 'policies/returns', content: '  ', confirmed: true });
    assert.equal(empty.isError, true);
    assert.equal(empty.data.error, 'empty_body');

    const asks = await bridge.callTool('junis_wiki', { action: 'put', file_key: 'policies/returns', content: 'Returns within 14 days.' });
    assert.equal(asks.isError, false);
    assert.equal(asks.data.status, 'needs_confirmation');
    assert.equal(mock.state.wiki[ORG_A]['policies/returns'].content, 'Returns within 30 days.');

    const replaced = await bridge.callTool('junis_wiki', { action: 'put', file_key: 'policies/returns', content: 'Returns within 14 days.', summary: 'shorter window', confirmed: true });
    assert.equal(replaced.isError, false, JSON.stringify(replaced.data));
    assert.equal(replaced.data.created, false);
    assert.equal(replaced.data.version, 4);
    assert.ok(replaced.data.backup.startsWith(kitHome));

    const created = await bridge.callTool('junis_wiki', { action: 'put', file_key: 'guides/onboarding', content: '# Onboarding\n\nStart here.\n' });
    assert.equal(created.isError, false, JSON.stringify(created.data));
    assert.equal(created.data.created, true);
    assert.equal(created.data.backup, null);

    const appended = await bridge.callTool('junis_wiki', { action: 'append', file_key: 'guides/onboarding', content: 'Then read the policies.' });
    assert.equal(appended.isError, false, JSON.stringify(appended.data));
    assert.equal(appended.data.version, 2);
    assert.equal(mock.state.wiki[ORG_A]['guides/onboarding'].content, '# Onboarding\n\nStart here.\n\n\nThen read the policies.');

    const badAction = await bridge.callTool('junis_wiki', { action: 'delete', file_key: 'guides/onboarding' });
    assert.equal(badAction.isError, true);
    assert.equal(badAction.data.error, 'usage');
    await bridge.close();
  });

  test('concurrent calls are answered independently', async () => {
    const kitHome = await loggedInHome();
    const bridge = startBridge({ env: mock.env(), kitHome });
    const [a, b, c] = await Promise.all([
      bridge.callTool('list_agents', { organization_id: ORG_A }),
      bridge.callTool('list_llm_models', { organization_id: ORG_A }),
      bridge.callTool('junis_lint_instruction', { text: 'fine' }),
    ]);
    assert.equal(a.data.count, 2);
    assert.equal(b.data.models.length, 2);
    assert.equal(c.data.ok, true);
    await bridge.close();
  });
});
