import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

// Mock servers are closed after all tests, so a failing assertion reports as a
// failure instead of leaving a live server that keeps the run from ending.
const servers = [];
after(async () => {
  for (const mock of servers) await mock.close().catch(() => {});
});

async function setup(options) {
  const mock = await startMockJunis(options);
  servers.push(mock);
  const kitHome = tempDir();
  const env = mock.env({ JUNIS_KIT_POLL_MS: '150' });
  const login = await runCli(['login', '--key-stdin'], { env, kitHome, input: `${USER_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  await runCli(['org', 'use', 'globex'], { env, kitHome });
  return { mock, kitHome, env };
}

function userMessages(mock) {
  return [...mock.state.sessions.values()].flatMap((session) => session.messages).filter((message) => message.event_type === 'user_message');
}

describe('running a squad from the command line', () => {
  test('a quick run returns the answer and the session id', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'orchestrator', '이번 주 트렌드 요약해줘'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.status, 'completed');
    assert.match(result.json.response, /이번 주 트렌드 요약해줘/);
    assert.match(result.json.session_id, /^[0-9a-f-]{36}$/);
    await mock.close();
  });

  test('a named agent is resolved and called directly', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'digestwriter', 'check'], { env, kitHome });
    assert.equal(result.json.agent, 'DigestWriter');
    assert.ok(mock.state.requests.some((entry) => /^POST \/agents\/aaaaaaaa/.test(entry.route)));
    await mock.close();
  });

  test('an unknown agent name lists the agents that exist', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'nobody', 'hi'], { env, kitHome });
    assert.equal(result.code, 1);
    assert.ok(result.json.detail.candidates.includes('DigestWriter'));
    await mock.close();
  });

  test('the session id is chosen before sending, so the platform uses it', async () => {
    const { mock, kitHome, env } = await setup();
    const id = '33333333-3333-4333-8333-333333333333';
    const result = await runCli(['run', 'orchestrator', 'hello', '--session', id], { env, kitHome });
    assert.equal(result.json.session_id, id);
    assert.ok(mock.state.sessions.has(id));
    await mock.close();
  });

  test('a long run handed back as running can be waited for without re-sending', async () => {
    const { mock, kitHome, env } = await setup({ runDelayMs: 1200 });
    const first = await runCli(['run', 'orchestrator', 'long job', '--no-wait'], { env, kitHome });
    assert.equal(first.code, 0);
    assert.equal(first.json.status, 'running');
    assert.match(first.json.next_step, /Do not send the message again/);

    const waited = await runCli(['session', 'wait', first.json.session_id, '--wait-seconds', '10'], { env, kitHome });
    assert.equal(waited.json.status, 'completed', waited.stdout);
    assert.match(waited.json.response, /long job/);
    assert.equal(userMessages(mock).length, 1, 'the request reached the platform exactly once');
    await mock.close();
  });

  test('a dropped connection is followed on the platform instead of failing', async () => {
    const { mock, kitHome, env } = await setup({ runDelayMs: 700, dropAfterMs: 100 });
    const result = await runCli(['run', 'orchestrator', 'survive the drop', '--wait-seconds', '15'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.status, 'completed');
    assert.equal(result.json.recovered, true);
    assert.match(result.json.response, /survive the drop/);
    assert.equal(userMessages(mock).length, 1);
    await mock.close();
  });

  test('a single agent run is followed by the session id the kit chose, also with --no-wait', async () => {
    // Older platform versions: the single-agent endpoint ignored the
    // caller's id, so the kit refused --no-wait and could not follow the run.
    const { mock, kitHome, env } = await setup({ runDelayMs: 600 });
    const started = await runCli(['run', 'digestwriter', 'check', '--no-wait'], { env, kitHome });
    assert.equal(started.code, 0, started.stdout);
    assert.equal(started.json.status, 'running');
    assert.match(started.json.session_id, /^[0-9a-f-]{36}$/);
    const done = await runCli(['session', 'wait', started.json.session_id, '--wait-seconds', '5'], { env, kitHome });
    assert.equal(done.json.status, 'completed', done.stdout);
    assert.match(done.json.response, /check/);
    assert.equal(userMessages(mock).length, 1, 'sent exactly once');
    await mock.close();
  });

  test('outside a terminal a single agent run returns within the wait with a followable id, and is never resent', async () => {
    // An agent's shell kills a command after about two minutes, so the command
    // line must answer within the wait it was given.
    const { mock, kitHome, env } = await setup({ runDelayMs: 1500 });
    const started = Date.now();
    const result = await runCli(['run', 'digestwriter', 'slow', '--wait-seconds', '0.2'], { env, kitHome });
    assert.ok(Date.now() - started < 1400, 'returned before the run finished');
    assert.equal(result.json.status, 'running', result.stdout);
    assert.match(result.json.session_id, /^[0-9a-f-]{36}$/);
    assert.match(result.json.next_step, /Do not send the message again/);
    const again = await runCli(['run', 'digestwriter', 'slow', '--session', result.json.session_id, '--no-wait'], { env, kitHome });
    assert.equal(again.json.already_running, true, again.stdout);
    assert.equal(userMessages(mock).length, 1, 'sent exactly once');
    await mock.close();
  });

  test('a dropped connection on a single agent is followed on the platform to its answer', async () => {
    const { mock, kitHome, env } = await setup({ runDelayMs: 700, dropAfterMs: 100 });
    const result = await runCli(['run', 'digestwriter', 'drop me'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.status, 'completed');
    assert.equal(result.json.recovered, true);
    assert.match(result.json.response, /drop me/);
    assert.doesNotMatch(result.stdout, /not_started|safe to send/);
    assert.equal(userMessages(mock).length, 1, 'the run was sent exactly once');
    await mock.close();
  });

  test('a chosen session id that is never seen on the platform is not reported as safe to resend', async () => {
    // Before: a --session owned by another user runs in a separate session on the
    // platform; after a dropped connection the kit saw no such session and said
    // "safe to send it again", which starts a second billed run.
    const foreign = '11111111-2222-4333-8444-555555555555';
    const { mock, kitHome, env } = await setup({ runDelayMs: 400, dropAfterMs: 100 });
    mock.state.foreignSessions = new Set([foreign]);
    const result = await runCli(['run', 'orchestrator', 'hello', '--session', foreign], { env, kitHome });
    assert.equal(result.json.status, 'unknown', result.stdout);
    assert.doesNotMatch(result.stdout, /not_started|safe to send/);
    assert.match(result.json.note, /list_sessions/);
    assert.equal(userMessages(mock).length, 1, 'sent once');
    await mock.close();
  });

  test('a message containing key=value text is sent as written', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'orchestrator', 'KPI=매출', '이번', '주', '요약해줘'], { env, kitHome });
    assert.equal(result.json.status, 'completed', result.stdout);
    assert.equal(userMessages(mock)[0].content, 'KPI=매출 이번 주 요약해줘');
    await mock.close();
  });

  test('status of a session this key cannot see is a clear not-found', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['session', 'status', '44444444-4444-4444-8444-444444444444'], { env, kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'not_found');
    await mock.close();
  });

  test('the message can come from a file', async () => {
    const { mock, kitHome, env } = await setup();
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(tempDir(), 'brief.md');
    fs.writeFileSync(file, 'Line one\nLine "two" with {braces}\n');
    const result = await runCli(['run', 'orchestrator', `@${file}`], { env, kitHome });
    assert.match(result.json.response, /Line "two" with \{braces\}/);
    await mock.close();
  });
});

describe('running a squad through the bridge', () => {
  test('a run that outlasts the wait returns a handle, and the handle returns the answer', async () => {
    const { mock, kitHome, env } = await setup({ runDelayMs: 1500 });
    const bridge = startBridge({ env, kitHome, lazy: true });
    const started = await bridge.callTool('junis_run', { message: 'weekly report', wait_seconds: 0 });
    assert.equal(started.isError, false);
    assert.equal(started.data.status, 'running');

    const early = await bridge.callTool('junis_run_status', { session_id: started.data.session_id, wait_seconds: 0 });
    assert.equal(early.data.status, 'running');

    const done = await bridge.callTool('junis_run_status', { session_id: started.data.session_id, wait_seconds: 10 });
    assert.equal(done.data.status, 'completed');
    assert.match(done.data.response, /weekly report/);
    assert.equal(userMessages(mock).length, 1);
    await bridge.close();
    await mock.close();
  });

  test('a run budget is sent only when given (lower-only on the platform)', async () => {
    const { mock, kitHome, env } = await setup();
    const bridge = startBridge({ env, kitHome, lazy: true });
    await bridge.callTool('junis_run', { message: 'budgeted', max_llm_calls: 12, wait_seconds: 10 });
    await bridge.callTool('junis_run', { message: 'unbudgeted', wait_seconds: 10 });
    const sent = mock.state.requests.filter((r) => r.route.includes('completions')).map((r) => r.body);
    assert.equal(sent[0].max_llm_calls, 12);
    assert.equal('max_llm_calls' in sent[1], false);
    await bridge.close();
    await mock.close();
  });

  test('a run started elsewhere can be picked up from the platform', async () => {
    const { mock, kitHome, env } = await setup();
    const first = await runCli(['run', 'orchestrator', 'from the terminal'], { env, kitHome });
    const bridge = startBridge({ env, kitHome, lazy: true });
    const picked = await bridge.callTool('junis_run_status', { session_id: first.json.session_id, wait_seconds: 0 });
    assert.equal(picked.data.status, 'completed');
    assert.match(picked.data.response, /from the terminal/);
    await bridge.close();
    await mock.close();
  });

  test('the wait is capped below the shortest client tool timeout', async () => {
    const { mock, kitHome, env } = await setup({ runDelayMs: 300 });
    const bridge = startBridge({ env, kitHome, lazy: true });
    const list = await bridge.request('tools/list');
    const schema = list.result.tools.find((tool) => tool.name === 'junis_run').inputSchema;
    assert.ok(schema.properties.wait_seconds.maximum < 60, 'Codex stops waiting for a tool after 60 seconds by default');
    await bridge.close();
    await mock.close();
  });
});
