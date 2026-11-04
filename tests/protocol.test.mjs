// MCP 2026-07-28 upstream client (MC2, 2026-11-04): modern stateless requests first, legacy fallback once on an
// unsupported-version answer. The fake servers mirror what the hosted server and a legacy server actually answered in
// a local probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RemoteMcp, MODERN_PROTOCOL_VERSION, PROTOCOL_VERSION } from '../skills/junis/scripts/lib/mcp-remote.mjs';

const META = 'io.modelcontextprotocol/';

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

const modernServer = (headers, body) => {
  const v = headers['mcp-protocol-version'];
  if (v !== MODERN_PROTOCOL_VERSION) return { json: { jsonrpc: '2.0', id: body.id, error: { code: -32022, message: 'Unsupported protocol version' } } };
  if (headers['mcp-method'] !== body.method) return { json: { jsonrpc: '2.0', id: body.id, error: { code: -32020, message: 'mcp-method header does not match' } } };
  if (body.method === 'tools/call' && headers['mcp-name'] !== body.params.name) return { json: { jsonrpc: '2.0', id: body.id, error: { code: -32020, message: 'mcp-name header does not match' } } };
  const meta = body.params?._meta || {};
  if (!meta[`${META}clientCapabilities`] || meta[`${META}protocolVersion`] !== MODERN_PROTOCOL_VERSION) {
    return { json: { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'missing envelope' } } };
  }
  if (body.method === 'tools/list') return { json: { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [{ name: 'add' }] } } };
  if (body.method === 'tools/call') return { json: { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', content: [{ type: 'text', text: '3' }], structuredContent: { result: 3 } } } };
  return { json: { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete' } } };
};

const legacyServer = (headers, body) => {
  const v = headers['mcp-protocol-version'];
  if (v === MODERN_PROTOCOL_VERSION) {
    return { status: 400, json: { jsonrpc: '2.0', id: 'server-error', error: { code: -32600, message: `Bad Request: Unsupported protocol version: ${v}. Supported versions: 2025-06-18` } } };
  }
  if (body.method === 'tools/list') return { json: { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'add' }] } } };
  return { json: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '3' }] } } };
};

test('modern server: headers and envelope are sent, no fallback', async () => {
  const { server, seen, url } = await serve(modernServer);
  try {
    const mcp = new RemoteMcp({ url });
    assert.deepEqual((await mcp.listTools()).map((t) => t.name), ['add']);
    assert.equal((await mcp.callTool('add', { a: 1, b: 2 })).structuredContent.result, 3);
    assert.equal(mcp.protocol, 'modern');
    const call = seen.find((s) => s.body.method === 'tools/call');
    assert.equal(call.headers['mcp-name'], 'add');
    assert.equal(call.body.params._meta[`${META}clientInfo`].name, 'junis-kit');
  } finally { server.close(); }
});

test('legacy server: HTTP 400 unsupported version → falls back once and stays legacy', async () => {
  const { server, seen, url } = await serve(legacyServer);
  try {
    const mcp = new RemoteMcp({ url });
    assert.deepEqual((await mcp.listTools()).map((t) => t.name), ['add']);
    assert.equal(mcp.protocol, 'legacy');
    await mcp.callTool('add', { a: 1, b: 2 });
    const versions = seen.map((s) => s.headers['mcp-protocol-version']);
    assert.deepEqual(versions, [MODERN_PROTOCOL_VERSION, PROTOCOL_VERSION, PROTOCOL_VERSION]);
    assert.equal(seen[1].body.params._meta, undefined, 'legacy requests carry no stateless envelope');
    assert.equal(seen[1].headers['mcp-method'], undefined);
  } finally { server.close(); }
});

test('new server answering -32022 also falls back', async () => {
  const { server, url } = await serve((h, b) => (h['mcp-protocol-version'] === MODERN_PROTOCOL_VERSION
    ? { json: { jsonrpc: '2.0', id: b.id, error: { code: -32022, message: 'Unsupported protocol version' } } }
    : { json: { jsonrpc: '2.0', id: b.id, result: { tools: [] } } }));
  try {
    const mcp = new RemoteMcp({ url });
    assert.deepEqual(await mcp.listTools(), []);
    assert.equal(mcp.protocol, 'legacy');
  } finally { server.close(); }
});

test('incomplete stateless result is a clear error; auth errors do not fall back', async () => {
  const { server, url } = await serve((h, b) => (b.method === 'tools/call'
    ? { json: { jsonrpc: '2.0', id: b.id, result: { resultType: 'incomplete', inputRequests: [] } } }
    : { status: 401, json: { error: { message: 'bad key' } } }));
  try {
    const mcp = new RemoteMcp({ url });
    await assert.rejects(() => mcp.callTool('add', {}), (e) => e.code === 'mcp_incomplete');
    await assert.rejects(() => mcp.listTools(), (e) => e.code === 'unauthorized');
    assert.equal(mcp.protocol, 'modern', 'an auth failure is not a protocol mismatch');
  } finally { server.close(); }
});
