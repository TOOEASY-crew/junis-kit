// The kit must keep working when Junis gains tools it has never heard of:
// nothing about the platform catalogue is hard-coded. The mock serves one
// extra tool that is not in the captured fixture, and every path (full
// bridge, lazy bridge, command line) must find, describe and call it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { ORG_A, USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

const NEW_TOOL = {
  name: 'archive_conversation',
  description: 'Archive a conversation so it no longer appears in lists. Added to the platform after this kit was written.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'The conversation to archive' },
      organization_id: { type: 'string' },
    },
    required: ['session_id'],
  },
};

let mock;
before(async () => {
  mock = await startMockJunis({ extraTools: [NEW_TOOL] });
});
after(() => mock.close());

async function loggedInHome() {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  return kitHome;
}

const initialize = (bridge) => bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

describe('a platform tool that did not exist when the kit was written', () => {
  test('is listed by the full bridge with its schema and derived annotations', async () => {
    const bridge = startBridge({ env: mock.env(), kitHome: await loggedInHome() });
    await initialize(bridge);
    const list = await bridge.request('tools/list');
    const tool = list.result.tools.find((entry) => entry.name === NEW_TOOL.name);
    assert.ok(tool, 'new tool is exposed');
    assert.deepEqual(tool.inputSchema.required, ['session_id']);
    assert.equal(typeof tool.annotations, 'object');
    assert.equal(tool.annotations.readOnlyHint, false, 'an unknown verb is not assumed to be read-only');

    const called = await bridge.callTool(NEW_TOOL.name, { session_id: 's-1', organization_id: ORG_A });
    assert.equal(called.isError, false, JSON.stringify(called.response));
    assert.equal(called.data.tool, NEW_TOOL.name);
    assert.equal(called.data.received.session_id, 's-1');
    await bridge.close();
  });

  test('is found, described and called through the lazy bridge', async () => {
    const bridge = startBridge({ env: mock.env(), kitHome: await loggedInHome(), lazy: true });
    await initialize(bridge);
    const list = await bridge.request('tools/list');
    assert.ok(!list.result.tools.some((entry) => entry.name === NEW_TOOL.name), 'lazy mode lists only kit tools');

    const found = await bridge.callTool('junis_find_tools', { query: 'archive conversation' });
    assert.equal(found.isError, false);
    assert.equal(found.data.tools[0].name, NEW_TOOL.name);

    const described = await bridge.callTool('junis_describe_tool', { name: NEW_TOOL.name });
    assert.deepEqual(described.data.input_schema.required, ['session_id']);

    const called = await bridge.callTool('junis_call_tool', { name: NEW_TOOL.name, arguments: { session_id: 's-2', organization_id: ORG_A } });
    assert.equal(called.isError, false, JSON.stringify(called.response));
    assert.equal(called.data.received.session_id, 's-2');
    await bridge.close();
  });

  test('is reachable from the command line the same way', async () => {
    const kitHome = await loggedInHome();
    const search = await runCli(['tools', 'archive', 'conversation'], { env: mock.env(), kitHome });
    assert.equal(search.code, 0, search.stdout);
    assert.equal(search.json.tools[0].name, NEW_TOOL.name);

    const describe = await runCli(['tools', 'describe', NEW_TOOL.name], { env: mock.env(), kitHome });
    assert.equal(describe.json.input_schema.properties.session_id.type, 'string');

    const call = await runCli(['tools', 'call', NEW_TOOL.name, 'session_id=s-3', `organization_id=${ORG_A}`], { env: mock.env(), kitHome });
    assert.equal(call.code, 0, call.stdout);
    assert.equal(call.json.received.session_id, 's-3');
    assert.equal(mock.state.requests.at(-1).organizationId, ORG_A);
  });

  test('a misspelt new tool name gets the nearest real names, not a silent failure', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['tools', 'describe', 'archive_conversations'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'unknown_tool');
    assert.ok(result.json.detail.did_you_mean.includes(NEW_TOOL.name));
  });
});
