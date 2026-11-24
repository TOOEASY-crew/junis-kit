import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { runCli, startBridge, tempDir } from './helpers/harness.mjs';
import { USER_KEY, startMockJunis } from './helpers/mock-junis.mjs';

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
  const work = tempDir('junis-kit-files-');
  const file = (name, text) => {
    const full = path.join(work, name);
    fs.writeFileSync(full, text);
    return full;
  };
  return { mock, kitHome, env, work, file };
}

function completions(mock) {
  return mock.state.requests.filter((entry) => /completions$/.test(entry.route));
}

describe('sending files with a run from the command line', () => {
  test('a run without files is the same JSON request as before', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'orchestrator', 'plain request'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    const [sent] = completions(mock);
    assert.deepEqual(Object.keys(sent.body).sort(), ['messages', 'session_id', 'stream']);
    assert.equal(sent.body.__multipart, undefined);
  });

  test('local files travel with the message as multipart parts', async () => {
    const { mock, kitHome, env, file } = await setup();
    const report = file('report.md', '# Q3 report\nrevenue up');
    const table = file('table.csv', 'a,b\n1,2\n');
    const result = await runCli(['run', 'orchestrator', 'read these', '--files', `${report},${table}`], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.status, 'completed');
    const [sent] = completions(mock);
    assert.equal(sent.route, 'POST /v1/chat/completions');
    assert.equal(sent.body.__multipart, true);
    assert.equal(sent.body.messages.at(-1).content, 'read these');
    assert.equal(sent.body.stream, false);
    assert.deepEqual(sent.body.__files, [
      { name: 'report.md', type: 'text/markdown', text: '# Q3 report\nrevenue up' },
      { name: 'table.csv', type: 'text/csv', text: 'a,b\n1,2\n' },
    ]);
  });

  test('a named agent gets the files on its own endpoint', async () => {
    const { mock, kitHome, env, file } = await setup();
    const result = await runCli(['run', 'DigestWriter', 'summarise', '--files', file('notes.txt', 'hello')], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    const [sent] = completions(mock);
    assert.match(sent.route, /^POST \/agents\/[^/]+\/completions$/);
    assert.equal(sent.body.message, 'summarise');
    assert.deepEqual(sent.body.__files.map((entry) => entry.name), ['notes.txt']);
  });

  test('links to files that are already online go into the JSON body', async () => {
    const { mock, kitHome, env } = await setup();
    const result = await runCli(['run', 'orchestrator', 'look', '--file-urls', 'https://files.example/a.png,https://files.example/b.pdf'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    const [sent] = completions(mock);
    assert.equal(sent.body.__multipart, undefined);
    assert.deepEqual(sent.body.files, ['https://files.example/a.png', 'https://files.example/b.pdf']);
  });

  test('a missing file stops the run before anything is sent', async () => {
    const { mock, kitHome, env, work } = await setup();
    const result = await runCli(['run', 'orchestrator', 'read', '--files', path.join(work, 'nope.pdf')], { env, kitHome });
    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /nope\.pdf/);
    assert.equal(completions(mock).length, 0);
  });

  test('more than five attachments, an empty file, a folder and a non-http link are refused', async () => {
    const { mock, kitHome, env, work, file } = await setup();
    const six = Array.from({ length: 6 }, (_, index) => file(`f${index}.txt`, 'x')).join(',');
    for (const args of [
      ['--files', six],
      ['--files', file('empty.txt', '')],
      ['--files', work],
      ['--file-urls', 'ftp://files.example/a.png'],
      ['--files', `${file('a.txt', 'x')},${file('b.txt', 'x')},${file('c.txt', 'x')}`, '--file-urls', 'https://x.example/1.png,https://x.example/2.png,https://x.example/3.png'],
    ]) {
      const result = await runCli(['run', 'orchestrator', 'read', ...args], { env, kitHome });
      assert.notEqual(result.code, 0, JSON.stringify(args));
    }
    assert.equal(completions(mock).length, 0);
  });
});

describe('sending files with junis_run', () => {
  test('the tool takes local paths and links', async () => {
    const { mock, kitHome, env, file } = await setup();
    const bridge = startBridge({ env, kitHome, lazy: true });
    try {
      const listed = await bridge.request('tools/list');
      const tool = listed.result.tools.find((entry) => entry.name === 'junis_run');
      assert.equal(tool.inputSchema.properties.files.type, 'array');
      assert.equal(tool.inputSchema.properties.file_urls.type, 'array');
      assert.deepEqual(tool.inputSchema.required, ['message']);
      const called = await bridge.callTool('junis_run', {
        message: 'read this', files: [file('brief.json', '{"k":1}')], file_urls: ['https://files.example/a.png'],
      });
      assert.equal(called.isError, false, JSON.stringify(called.data));
      assert.equal(called.data.status, 'completed');
      const [sent] = completions(mock);
      assert.deepEqual(sent.body.__files, [{ name: 'brief.json', type: 'application/json', text: '{"k":1}' }]);
      assert.deepEqual(sent.body.files, ['https://files.example/a.png']);
      const refused = await bridge.callTool('junis_run', { message: 'read this', files: ['/no/such/file.pdf'] });
      assert.equal(refused.isError, true);
      assert.equal(completions(mock).length, 1, 'a refused attachment sends nothing');
    } finally {
      await bridge.close();
    }
  });
});

describe('what a model may attach (2026-11-24)', () => {
  test('a file under the kit home is never sent, also through a symbolic link, and nothing leaves the machine', async () => {
    const { mock, kitHome, env, work } = await setup();
    const key = path.join(kitHome, 'credentials.json');
    assert.ok(fs.existsSync(key), 'the login wrote the key store');
    const link = path.join(work, 'notes.txt');
    fs.symlinkSync(key, link);
    const bridge = startBridge({ env, kitHome, lazy: true });
    try {
      for (const target of [key, link]) {
        const refused = await bridge.callTool('junis_run', { message: 'read this', files: [target] });
        assert.equal(refused.isError, true, target);
        assert.match(JSON.stringify(refused.data), /credentials folder/);
      }
    } finally {
      await bridge.close();
    }
    assert.equal(completions(mock).length, 0);
  });

  test('the result says what was attached: names and sizes, not content', async () => {
    const { mock, kitHome, env, file } = await setup();
    const result = await runCli(['run', 'orchestrator', 'read', '--files', file('brief.md', 'hello'), '--file-urls', 'https://files.example/a.png'], { env, kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(result.json.attached, [{ name: 'brief.md', bytes: 5 }, { url: 'https://files.example/a.png' }]);
    const plain = await runCli(['run', 'orchestrator', 'no files'], { env, kitHome });
    assert.equal(plain.json.attached, undefined, 'a run without attachments reports nothing new');
    assert.equal(completions(mock).length, 2);
  });

  test('--files without a value is an error, not a run without the file', async () => {
    const { mock, kitHome, env } = await setup();
    for (const args of [['--files'], ['--files='], ['--file-urls']]) {
      const result = await runCli(['run', 'orchestrator', 'read', ...args], { env, kitHome });
      assert.notEqual(result.code, 0, JSON.stringify(args));
      assert.match(result.stdout + result.stderr, /needs a value/);
    }
    assert.equal(completions(mock).length, 0);
  });
});

describe('personal knowledge is confirmed by the platform, not assumed (2026-11-24)', () => {
  test('a platform that ignores space=me is refused; one that confirms it is used', async () => {
    const old = await setup();
    const read = await runCli(['api', 'GET', '/brain/sources', '--query', 'space=me'], { env: old.env, kitHome: old.kitHome });
    assert.notEqual(read.code, 0, read.stdout);
    assert.match(read.stdout + read.stderr, /personal_knowledge_not_confirmed|did not confirm/);
    assert.doesNotMatch(read.stdout, /Handbook/, 'the organization\'s sources are not handed back as personal');
    const write = await runCli(['api', 'POST', '/brain/sources/text', 'title=t', 'content=c', '--query', 'space=me'], { env: old.env, kitHome: old.kitHome });
    assert.notEqual(write.code, 0);
    assert.match(write.stdout + write.stderr, /This was a write/);
    const org = await runCli(['api', 'GET', '/brain/sources'], { env: old.env, kitHome: old.kitHome });
    assert.equal(org.code, 0, 'the organization\'s Knowledge needs no confirmation');

    const now = await setup({ personalKnowledge: true });
    const mine = await runCli(['api', 'GET', '/brain/sources', '--query', 'space=me'], { env: now.env, kitHome: now.kitHome });
    assert.equal(mine.code, 0, mine.stdout + mine.stderr);
  });
});
