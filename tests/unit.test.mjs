import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';
import { parseArgs, resolvePayload } from '../skills/junis/scripts/lib/args.mjs';
import { extractKey } from '../skills/junis/scripts/lib/kit-tools.mjs';
import { explainError } from '../skills/junis/scripts/lib/kit-tools.mjs';
import { maskKey, normalizeUrl } from '../skills/junis/scripts/lib/config.mjs';
import { KitError, httpRequest, parseSseMessages } from '../skills/junis/scripts/lib/http.mjs';
import { readConfig, stripJsonComments } from '../skills/junis/scripts/lib/jsonc.mjs';
import { lintInstruction } from '../skills/junis/scripts/lib/lint.mjs';
import { categorize, deriveAnnotations, unwrapToolResult } from '../skills/junis/scripts/lib/mcp-remote.mjs';

const errors = (text, options) => lintInstruction(text, options).findings.filter((finding) => finding.level === 'error');

describe('instruction linter', () => {
  test('a bare identifier in braces is an error', () => {
    for (const text of ['Route by {task}.', 'Send {payload} on.', 'URL is {BASE_URL}/x', '이름은 {이름} 입니다', 'mail {first}.{last}@x.com']) {
      assert.ok(errors(text).length >= 1, text);
    }
  });

  test('prefixed state references are errors too', () => {
    assert.equal(errors('Use {user:language} and {app:mode}.').length, 2);
  });

  test('the optional form is accepted and noted', () => {
    const result = lintInstruction('Draft: {writer_output?}\nIf empty, write from scratch.');
    assert.equal(result.ok, true);
    assert.equal(result.findings[0].rule, 'optional-key');
  });

  test('quoted JSON examples are safe', () => {
    assert.equal(errors('Return {"task": "x", "payload": {"a": 1}} only.').length, 0);
    assert.equal(errors('```json\n{\n  "ok": true,\n  "items": [{"id": 1}]\n}\n```').length, 0);
  });

  test('platform-provided keys are accepted', () => {
    assert.equal(errors('Now: {current_time}. User: {user_name} ({user_email}). Org: {organization_name}.').length, 0);
  });

  test('keys written by an earlier agent can be declared', () => {
    assert.equal(errors('Combine {web_output} and {db_output}.').length, 2);
    assert.equal(errors('Combine {web_output} and {db_output}.', { allowedKeys: ['web_output', 'db_output'] }).length, 0);
  });

  test('credential references are not state references', () => {
    assert.equal(errors('[CUSTOM_API_CONFIG] {"apis":[{"api_key":"{cred:SLACK_TOKEN}"}]} [/CUSTOM_API_CONFIG]').length, 0);
    assert.equal(errors('header {cred:private:MY_KEY}').length, 0);
  });

  test('angle-bracket placeholders and empty braces are safe', () => {
    assert.equal(errors('Replace <company> with the name. Empty {} and {...} are fine.').length, 0);
  });

  test('artifact references are errors', () => {
    assert.equal(errors('Read {artifact.report}.')[0].rule, 'brace-artifact');
  });

  test('plaintext secrets are errors and are not echoed in full', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const result = lintInstruction(`Use key ${secret} for the API.`);
    assert.equal(result.ok, false);
    const finding = result.findings.find((entry) => entry.rule === 'plaintext-secret');
    assert.ok(finding);
    assert.ok(!JSON.stringify(result).includes(secret));
  });

  test('line numbers point at the problem', () => {
    const result = lintInstruction('line one\nline two\nbad {thing} here');
    assert.equal(result.findings[0].line, 3);
  });

  test('clean text passes', () => {
    const result = lintInstruction('You are a reviewer. Answer in Korean.');
    assert.deepEqual(result, { ok: true, errors: 0, findings: [] });
  });
});

describe('arguments', () => {
  test('flags, pairs and positionals are separated', () => {
    const parsed = parseArgs(['call', 'create_agent', 'name=A B', 'n=3', 'on=true', 'list=[1,2]', '--json', '{"x":1}', '--dry-run', '--limit=5'], { booleans: ['dry_run'] });
    assert.deepEqual(parsed.positionals, ['call', 'create_agent']);
    assert.deepEqual(parsed.pairs, { name: 'A B', n: 3, on: true, list: [1, 2] });
    assert.deepEqual(parsed.flags, { json: '{"x":1}', dry_run: true, limit: '5' });
  });

  test('values that only look numeric stay strings', () => {
    const parsed = parseArgs(['id=007', 'version=1.10', 'phone=+8210']);
    assert.deepEqual(parsed.pairs, { id: '007', version: '1.10', phone: '+8210' });
  });

  test('a boolean flag does not swallow the next argument', () => {
    const parsed = parseArgs(['--dry-run', 'install'], { booleans: ['dry_run'] });
    assert.deepEqual(parsed.positionals, ['install']);
  });

  test('pairs override the JSON payload', () => {
    assert.deepEqual(resolvePayload({ flags: { json: '{"a":1,"b":2}' }, pairs: { b: 3 } }), { a: 1, b: 3 });
  });

  test('invalid JSON is refused with a way out', () => {
    assert.throws(() => resolvePayload({ flags: { json: '{oops' }, pairs: {} }), (err) => err instanceof KitError && /--file/.test(err.hint));
  });
});

describe('keys and urls', () => {
  test('a key is found inside surrounding text', () => {
    assert.equal(extractKey('  jns_user_abcdefgh12345678  \n'), 'jns_user_abcdefgh12345678');
    assert.equal(extractKey('Authorization: Bearer jns_live_abcdefgh12345678'), 'jns_live_abcdefgh12345678');
    assert.equal(extractKey('nothing here'), '');
  });

  test('masking never reveals more than a recognisable prefix', () => {
    const masked = maskKey('jns_user_abcdtestkeyghijklmnopqrstuvwxyz');
    assert.ok(masked.startsWith('jns_user_abcd'));
    assert.ok(!masked.includes('efgh'));
  });

  test('trailing slashes are removed from endpoints', () => {
    assert.equal(normalizeUrl('https://mcp.junis.ai/mcp/'), 'https://mcp.junis.ai/mcp');
  });
});

describe('http', () => {
  test('a redirect is refused instead of followed with the credential', async () => {
    let followed = false;
    const server = http.createServer((request, response) => {
      if (request.url === '/next') followed = true;
      response.writeHead(307, { Location: '/next' }).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/mcp/`;
    await assert.rejects(httpRequest('POST', url, { headers: { Authorization: 'Bearer secret' }, body: '{}' }), (err) => err.code === 'redirect_refused');
    assert.equal(followed, false);
    server.close();
  });

  test('a silent server ends in a timeout error that warns against re-sending', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await assert.rejects(httpRequest('GET', `http://127.0.0.1:${server.address().port}/`, { timeoutMs: 200 }), (err) => err.code === 'timeout' && /again/.test(err.hint));
    server.closeAllConnections();
    server.close();
  });

  test('a short Retry-After on 429 is waited and the request sent again', async () => {
    let hits = 0;
    const server = http.createServer((request, response) => {
      hits += 1;
      if (hits === 1) response.writeHead(429, { 'Retry-After': '0', 'Content-Type': 'application/json' }).end('{"detail":"slow"}');
      else response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const res = await httpRequest('POST', `http://127.0.0.1:${server.address().port}/`, { body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(hits, 2);
    server.close();
  });

  test('a long Retry-After on 429 is returned at once, not waited', async () => {
    let hits = 0;
    const server = http.createServer((request, response) => {
      hits += 1;
      response.writeHead(429, { 'Retry-After': '120' }).end('{"detail":"limit"}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const res = await httpRequest('GET', `http://127.0.0.1:${server.address().port}/`);
    assert.equal(res.status, 429);
    assert.equal(hits, 1);
    server.close();
  });

  test('an unreachable host is a network error', async () => {
    await assert.rejects(httpRequest('GET', 'http://127.0.0.1:1/', { timeoutMs: 2000 }), (err) => err.code === 'network');
  });

  test('server-sent events are parsed, including multi-line data and comments', () => {
    const body = ': keepalive\n\nevent: message\ndata: {"id":1,\ndata: "result":{}}\n\nevent: message\ndata: {"id":2}\n\n';
    assert.deepEqual(parseSseMessages(body), [{ id: 1, result: {} }, { id: 2 }]);
  });
});

describe('config files', () => {
  test('comments and trailing commas are read, strings are left alone', () => {
    const text = '{\n  // comment\n  "url": "https://x.y/a//b", /* block */\n  "list": [1, 2,],\n  "text": "a, }",\n}';
    assert.deepEqual(JSON.parse(stripJsonComments(text).text), { url: 'https://x.y/a//b', list: [1, 2], text: 'a, }' });
  });

  test('a missing file reads as empty', () => {
    assert.equal(readConfig('/nonexistent/path.json').state, 'missing');
  });
});

describe('tool metadata', () => {
  test('annotations follow the naming convention', () => {
    assert.equal(deriveAnnotations('list_agents').readOnlyHint, true);
    assert.equal(deriveAnnotations('get_skill').readOnlyHint, true);
    assert.equal(deriveAnnotations('delete_datastore').destructiveHint, true);
    assert.equal(deriveAnnotations('unlink_agent_mcp').destructiveHint, true);
    assert.equal(deriveAnnotations('apply_team_changes').destructiveHint, true);
    assert.equal(deriveAnnotations('patch_agent_instruction').idempotentHint, true);
    assert.equal(deriveAnnotations('send_message').openWorldHint, true);
  });

  test('categories group related tools', () => {
    assert.equal(categorize('link_agent_mcp'), 'mcp');
    assert.equal(categorize('link_agent_composio'), 'composio');
    assert.equal(categorize('link_agent_device'), 'devices');
    assert.equal(categorize('add_sub_agent'), 'relationships');
    assert.equal(categorize('patch_agent_instruction'), 'agents');
    assert.equal(categorize('upload_rag_document'), 'rag');
    assert.equal(categorize('list_llm_models'), 'agents');
  });

  test('tool results are unwrapped from every shape the server uses', () => {
    assert.deepEqual(unwrapToolResult({ structuredContent: { a: 1 }, content: [] }), { ok: true, data: { a: 1 } });
    assert.deepEqual(unwrapToolResult({ structuredContent: { result: [1, 2] }, content: [] }), { ok: true, data: [1, 2] });
    assert.deepEqual(unwrapToolResult({ content: [{ type: 'text', text: '{"b":2}' }] }), { ok: true, data: { b: 2 } });
    assert.deepEqual(unwrapToolResult({ content: [{ type: 'text', text: 'plain' }] }), { ok: true, data: 'plain' });
    assert.equal(unwrapToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] }).ok, false);
  });
});

describe('error explanations', () => {
  const profile = { web_url: 'https://junis.ai' };

  test('a missing scope names the scope and where to get a new key', () => {
    const body = '403 {"detail":{"error":"insufficient_scopes","missing_scopes":["brain:read"]}}';
    const explained = explainError(body, profile);
    assert.equal(explained.code, 'insufficient_scopes');
    assert.match(explained.hint, /brain:read/);
    assert.match(explained.hint, /settings\/api-keys/);
  });

  test('a missing subscription points at the subscription page', () => {
    const explained = explainError('Junis API error 403: {"error":{"type":"subscription_required"}}', profile);
    assert.equal(explained.code, 'subscription_required');
    assert.match(explained.hint, /junis\.ai\/subscription/);
  });

  test('status classes are recognised from tool error text', () => {
    assert.equal(explainError('Junis API error 404: Agent not found', profile).code, 'not_found');
    assert.equal(explainError('Junis API error 409: exists', profile).code, 'conflict');
    assert.equal(explainError('Junis API error 429: slow down', profile).code, 'rate_limited');
    assert.equal(explainError('Junis API error 402: insufficient_credits', profile).code, 'payment_required');
    assert.equal(explainError('something odd', profile).hint, '');
  });
});


test('the secret check also knows Stripe, Google, Slack app, JWT and private-key shapes', async () => {
  const { lintInstruction } = await import('../skills/junis/scripts/lib/lint.mjs');
  const samples = [
    'sk_live_' + 'a'.repeat(24),
    'AIza' + 'B'.repeat(35),
    'xapp-1-' + 'C'.repeat(24),
    'eyJ' + 'h'.repeat(12) + '.eyJ' + 'p'.repeat(12) + '.' + 's'.repeat(12),
    // assembled so the file itself holds no key marker
    `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(3)}`,
  ];
  for (const secret of samples) {
    const result = lintInstruction(`Use this to call the service: ${secret}`, { allowedKeys: [] });
    assert.ok(result.findings.some((entry) => entry.rule === 'plaintext-secret'), secret.slice(0, 12));
  }
  const clean = lintInstruction('Call the API with {cred:STRIPE_KEY} in the header. Keys look like sk_live_… in Stripe docs.', { allowedKeys: [] });
  assert.equal(clean.findings.filter((entry) => entry.rule === 'plaintext-secret').length, 0);
  // A publishable key and a sentence naming the PEM header are not secrets.
  for (const harmless of ['The checkout page uses pk_live_' + 'a'.repeat(24) + ' (publishable).', `Never paste a file that starts with ${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')} here.`]) {
    const result = lintInstruction(harmless, { allowedKeys: [] });
    assert.equal(result.findings.filter((entry) => entry.rule === 'plaintext-secret').length, 0, harmless.slice(0, 30));
  }
});

test('many findings are numbered quickly, and an old-style encrypted key is still found', async () => {
  const { lintInstruction } = await import('../skills/junis/scripts/lib/lint.mjs');
  const text = Array.from({ length: 8000 }, (_, i) => `line ${i} {name${i}}`).join('\n');
  const started = Date.now();
  const result = lintInstruction(text, { allowedKeys: [] });
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.equal(result.findings.at(-1).line, 8000);
  const pem = [['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '), 'Proc-Type: 4,ENCRYPTED', 'DEK-Info: AES-128-CBC,0123456789ABCDEF', '', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(3)].join('\n');
  assert.ok(lintInstruction(`key: ${pem}`, { allowedKeys: [] }).findings.some((entry) => entry.rule === 'plaintext-secret'));
});

test('the brace check stays fast on long runs of braces and reads them like the runtime', async () => {
  const { lintInstruction } = await import('../skills/junis/scripts/lib/lint.mjs');
  const started = Date.now();
  lintInstruction('{'.repeat(20000) + ' text', { allowedKeys: [] });
  lintInstruction('{a'.repeat(10000), { allowedKeys: [] });
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
  const found = (text) => lintInstruction(text, { allowedKeys: [] }).findings.filter((entry) => entry.rule === 'brace-state-key').map((entry) => entry.text);
  assert.deepEqual(found('Hello {{name}} and {a{b} and {c}'), ['{{name}}', '{b}', '{c}']);
  assert.deepEqual(found('{{{x}}}'), ['{{{x}}}']);
});
