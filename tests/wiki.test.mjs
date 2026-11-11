import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runCli, tempDir } from './helpers/harness.mjs';
import { ORG_A, ORG_KEY, startMockJunis } from './helpers/mock-junis.mjs';

let mock;
before(async () => {
  mock = await startMockJunis();
});
after(() => mock.close());
beforeEach(() => {
  mock.state.wikiBehavior = {};
  mock.state.wiki[ORG_A]['policies/returns'] = { content: 'Returns within 30 days.', version: 3, annotation: 'Return policy' };
});

async function loggedInHome() {
  const kitHome = tempDir();
  const login = await runCli(['login', '--key-stdin'], { env: mock.env(), kitHome, input: `${ORG_KEY}\n` });
  assert.equal(login.code, 0, login.stdout);
  return kitHome;
}

function requests(route) {
  return mock.state.requests.filter((entry) => entry.route === route);
}

function fileWith(text) {
  const file = path.join(tempDir(), 'page.md');
  fs.writeFileSync(file, text);
  return file;
}

describe('wiki get', () => {
  test('returns content, version and sha256 of the stripped content', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['wiki', 'get', 'policies/returns'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.version, 3);
    assert.equal(result.json.content, 'Returns within 30 days.');
    assert.match(result.json.sha256, /^[0-9a-f]{64}$/);
  });

  test('--out writes the content to a private file and leaves it out of the output', async () => {
    const kitHome = await loggedInHome();
    const out = path.join(tempDir(), 'returns.md');
    const result = await runCli(['wiki', 'get', 'policies/returns', '--out', out], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(fs.readFileSync(out, 'utf8'), 'Returns within 30 days.');
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.equal(result.json.content, undefined);
  });

  test('a missing page is a not_found error', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['wiki', 'get', 'nope/none'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'not_found');
  });
});

describe('wiki put', () => {
  test('refuses an empty body before any request', async () => {
    const kitHome = await loggedInHome();
    const before = requests('PUT /management/wiki/content').length;
    const fromFile = await runCli(['wiki', 'put', 'policies/returns', '--file', fileWith('  \n'), '--yes'], { env: mock.env(), kitHome });
    assert.equal(fromFile.code, 1);
    assert.equal(fromFile.json.error, 'empty_body');
    const fromText = await runCli(['wiki', 'put', 'policies/returns', '--text=', '--yes'], { env: mock.env(), kitHome });
    assert.equal(fromText.json.error, 'empty_body');
    assert.equal(requests('PUT /management/wiki/content').length, before);
  });

  test('asks before replacing an existing page when stdin is not a terminal', async () => {
    const kitHome = await loggedInHome();
    const before = requests('PUT /management/wiki/content').length;
    const result = await runCli(['wiki', 'put', 'policies/returns', '--file', fileWith('Returns within 14 days.\n')], { env: mock.env(), kitHome });
    assert.equal(result.code, 2);
    assert.equal(result.json.error, 'needs_confirmation');
    assert.equal(requests('PUT /management/wiki/content').length, before);
  });

  test('replaces with a local backup, the version it read, and a read-back check', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(
      ['wiki', 'put', 'policies/returns', '--file', fileWith('Returns within 14 days.\n'), '--annotation', 'Return policy v2', '--summary', 'shorter window', '--yes'],
      { env: mock.env(), kitHome },
    );
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.created, false);
    assert.equal(result.json.version, 4);
    assert.equal(result.json.chars, 'Returns within 14 days.\n'.length);
    const put = requests('PUT /management/wiki/content').at(-1);
    assert.equal(put.body.expected_version, 3);
    assert.equal(put.body.content, 'Returns within 14 days.\n');
    assert.equal(put.body.annotation, 'Return policy v2');
    assert.equal(put.body.summary, 'shorter window');
    assert.ok(result.json.backup.startsWith(kitHome), 'backup lives under the kit home');
    assert.equal(fs.statSync(path.dirname(result.json.backup)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(result.json.backup).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(result.json.backup, 'utf8')).content, 'Returns within 30 days.');
  });

  test('two writes in the same second keep both backups', async () => {
    const kitHome = await loggedInHome();
    const first = await runCli(['wiki', 'put', 'policies/returns', '--text=first', '--yes'], { env: mock.env(), kitHome });
    const second = await runCli(['wiki', 'put', 'policies/returns', '--text=second', '--yes'], { env: mock.env(), kitHome });
    assert.equal(first.code, 0, first.stdout);
    assert.equal(second.code, 0, second.stdout);
    assert.notEqual(first.json.backup, second.json.backup);
    assert.equal(JSON.parse(fs.readFileSync(first.json.backup, 'utf8')).content, 'Returns within 30 days.');
    assert.equal(JSON.parse(fs.readFileSync(second.json.backup, 'utf8')).content, 'first');
  });

  test('creates a new page without asking and without a backup', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['wiki', 'put', 'guides/onboarding', '--file', fileWith('# Onboarding\n\nStart here.\n')], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.created, true);
    assert.equal(result.json.version, 1);
    assert.equal(result.json.backup, null);
  });

  test('--file - reads the body from stdin', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['wiki', 'put', 'notes/stdin', '--file', '-'], { env: mock.env(), kitHome, input: 'from stdin\n' });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(requests('PUT /management/wiki/content').at(-1).body.content, 'from stdin\n');
  });

  test('--text and --file together, or a non-integer --min-chars, are usage errors', async () => {
    const kitHome = await loggedInHome();
    const both = await runCli(['wiki', 'put', 'notes/x', '--text=a', '--file', fileWith('b')], { env: mock.env(), kitHome });
    assert.equal(both.code, 2);
    assert.equal(both.json.error, 'usage');
    const minChars = await runCli(['wiki', 'put', 'notes/x', '--text=long enough', '--min-chars', 'abc'], { env: mock.env(), kitHome });
    assert.equal(minChars.code, 2);
    assert.equal(minChars.json.error, 'usage');
    assert.equal(requests('PUT /management/wiki/content').filter((r) => r.body.file_key === 'notes/x').length, 0);
  });

  test('--min-chars guards short bodies', async () => {
    const kitHome = await loggedInHome();
    const short = await runCli(['wiki', 'put', 'notes/short', '--text=tiny', '--min-chars', '10'], { env: mock.env(), kitHome });
    assert.equal(short.code, 1);
    assert.equal(short.json.error, 'body_too_short');
    const ok = await runCli(['wiki', 'put', 'notes/short', '--text=long enough body', '--min-chars', '10'], { env: mock.env(), kitHome });
    assert.equal(ok.code, 0, ok.stdout);
  });

  test('a page edited between read and write is a conflict that names the backup', async () => {
    const kitHome = await loggedInHome();
    mock.state.wikiBehavior = { bumpOnGet: true };
    const result = await runCli(['wiki', 'put', 'policies/returns', '--text=Returns within 7 days.', '--yes'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'conflict');
    assert.equal(result.json.status, 409);
    assert.equal(result.json.detail.read_version, 3);
    assert.ok(fs.existsSync(result.json.detail.backup));
    assert.equal(mock.state.wiki[ORG_A]['policies/returns'].content, 'Returns within 30 days.');
  });

  test('a page that reads back differently is verify_failed with the backup path', async () => {
    const kitHome = await loggedInHome();
    mock.state.wikiBehavior = { truncateOnPut: true };
    const result = await runCli(['wiki', 'put', 'policies/returns', '--text=Returns within 14 days.', '--yes'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'verify_failed');
    assert.equal(result.json.detail.read_back, 'different');
    assert.notEqual(result.json.detail.expected_sha256, result.json.detail.actual_sha256);
    assert.ok(fs.existsSync(result.json.detail.backup));
  });

  test('a read error other than 404 is reported as is and nothing is written', async () => {
    const kitHome = await loggedInHome();
    mock.state.wikiBehavior = { forbidGet: true };
    const before = requests('PUT /management/wiki/content').length;
    const result = await runCli(['wiki', 'put', 'policies/returns', '--text=whatever', '--yes'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.status, 403);
    assert.equal(requests('PUT /management/wiki/content').length, before);
  });
});

describe('wiki append', () => {
  test('refuses an empty body and appends otherwise', async () => {
    const kitHome = await loggedInHome();
    const empty = await runCli(['wiki', 'append', 'policies/returns', '--text=   '], { env: mock.env(), kitHome });
    assert.equal(empty.json.error, 'empty_body');
    const result = await runCli(['wiki', 'append', 'policies/returns', '--text={"kind":"seal"}'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    const post = requests('POST /management/wiki/content/append').at(-1);
    assert.equal(post.body.content, '{"kind":"seal"}');
    assert.equal(result.json.appended_chars, 15);
    assert.equal(result.json.archived_to, undefined);
  });

  test('passes archived_to through when the platform rolled the page over', async () => {
    const kitHome = await loggedInHome();
    mock.state.wikiBehavior = { archiveOnAppend: 'policies/returns/archive/20261109T000000Z' };
    const result = await runCli(['wiki', 'append', 'policies/returns', '--text=more'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.archived_to, 'policies/returns/archive/20261109T000000Z');
  });
});

describe('wiki verify and lint', () => {
  test('verify posts the file key and reports the new review window; a missing page is not_found', async () => {
    const kitHome = await loggedInHome();
    const result = await runCli(['wiki', 'verify', 'policies/returns'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(requests('POST /management/wiki/verify').at(-1).body.file_key, 'policies/returns');
    assert.equal(result.json.version, 3);
    assert.equal(result.json.verified_at, '2026-11-10T00:00:00+00:00');
    assert.equal(result.json.review_due, false);
    assert.equal(result.json.content, undefined, 'verify does not echo the page body');
    const missing = await runCli(['wiki', 'verify', 'nope/none'], { env: mock.env(), kitHome });
    assert.equal(missing.code, 1);
    assert.equal(missing.json.error, 'not_found');
  });

  test('a platform without the verify route is reported as unsupported, not as a missing page', async () => {
    const kitHome = await loggedInHome();
    mock.state.wikiBehavior.noVerifyRoute = true;
    try {
      const result = await runCli(['wiki', 'verify', 'policies/returns'], { env: mock.env(), kitHome });
      assert.equal(result.code, 1);
      assert.equal(result.json.error, 'unsupported', result.stdout);
      assert.match(result.json.message, /does not have wiki verify/);
    } finally {
      delete mock.state.wikiBehavior.noVerifyRoute;
    }
  });

  test('lint needs no file key and adds a findings count to the platform answer', async () => {
    const kitHome = await loggedInHome();
    mock.state.wiki[ORG_A]['guides/empty'] = { content: '   ', version: 1, annotation: '' };
    const result = await runCli(['wiki', 'lint'], { env: mock.env(), kitHome });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(requests('GET /management/wiki/lint').length, 1);
    assert.equal(result.json.checked, Object.keys(mock.state.wiki[ORG_A]).length);
    assert.ok(result.json.empty_pages.includes('guides/empty'));
    assert.ok(result.json.missing_annotation.includes('guides/empty'));
    assert.equal(result.json.findings, result.json.empty_pages.length + result.json.missing_annotation.length);
    const noKey = await runCli(['wiki', 'verify'], { env: mock.env(), kitHome });
    assert.equal(noKey.json.error, 'usage');
  });
});

describe('empty text guards on every write path', () => {
  test('api PUT with an empty instruction is refused before sending', async () => {
    const kitHome = await loggedInHome();
    const file = path.join(tempDir(), 'agent.json');
    fs.writeFileSync(file, JSON.stringify({ instruction: '   ' }));
    const result = await runCli(['api', 'PUT', '/management/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '--file', file, '--yes'], { env: mock.env(), kitHome });
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'empty_instruction');
    assert.equal(requests('PUT /management/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').length, 0);
  });

  test('api PUT with instruction=@<empty file> and tools call with the same shape are refused', async () => {
    const kitHome = await loggedInHome();
    const empty = fileWith('');
    const viaApi = await runCli(['api', 'PUT', '/management/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', `instruction=@${empty}`, '--yes'], { env: mock.env(), kitHome });
    assert.equal(viaApi.json.error, 'empty_instruction');
    const viaTools = await runCli(['tools', 'call', 'update_agent', 'agent_id=x', `instruction=@${empty}`, '--yes'], { env: mock.env(), kitHome });
    assert.equal(viaTools.json.error, 'empty_instruction');
    const wikiContent = await runCli(['api', 'PUT', '/management/wiki/content', 'file_key=policies/returns', `content=@${empty}`, '--yes'], { env: mock.env(), kitHome });
    assert.equal(wikiContent.json.error, 'empty_content');
    assert.equal(requests('PUT /management/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').length, 0);
  });

  test('api --file that does not exist or is empty is a clear error', async () => {
    const kitHome = await loggedInHome();
    const missing = await runCli(['api', 'PUT', '/management/wiki/content', '--file', '/nonexistent/body.json', '--yes'], { env: mock.env(), kitHome });
    assert.equal(missing.json.error, 'file_not_found');
    const empty = await runCli(['api', 'PUT', '/management/wiki/content', '--file', fileWith(''), '--yes'], { env: mock.env(), kitHome });
    assert.equal(empty.json.error, 'empty_payload');
  });
});
