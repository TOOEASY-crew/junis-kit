// Structural checks on the skill and the packaging. They encode the authoring
// rules of the Agent Skills specification and of the agent clients, so a
// well-meant edit cannot quietly make the kit unloadable somewhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { REPO, SKILL_DIR } from './helpers/harness.mjs';
import { lintInstruction } from '../skills/junis/scripts/lib/lint.mjs';

const skillText = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const frontmatterText = /^---\n([\s\S]*?)\n---\n/.exec(skillText)[1];
const body = skillText.slice(skillText.indexOf('\n---\n', 4) + 5);
const references = fs.readdirSync(path.join(SKILL_DIR, 'references')).filter((name) => name.endsWith('.md'));

// A small reader for the frontmatter this skill uses: scalars, folded scalars
// and one level of mapping.
function readFrontmatter(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, key, rest] = match;
    if (rest === '>-' || rest === '>' || rest === '|' || rest === '') {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[(i += 1)].trim());
      out[key] = rest === '' ? Object.fromEntries(block.map((line) => line.split(/:\s*/).map((part) => part.replace(/^"|"$/g, '')))) : block.join(' ');
    } else {
      out[key] = rest.replace(/^"|"$/g, '');
    }
  }
  return out;
}

const frontmatter = readFrontmatter(frontmatterText);

describe('SKILL.md frontmatter', () => {
  test('uses only fields every client accepts', () => {
    const allowed = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
    for (const key of Object.keys(frontmatter)) assert.ok(allowed.includes(key), `${key} is not a portable field`);
  });

  test('name follows the specification and matches the folder', () => {
    assert.match(frontmatter.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(frontmatter.name.length <= 64);
    assert.equal(frontmatter.name, path.basename(SKILL_DIR));
    assert.doesNotMatch(frontmatter.name, /claude|anthropic/);
  });

  test('description is within limits and says when to use the skill', () => {
    assert.ok(frontmatter.description.length > 100);
    assert.ok(frontmatter.description.length <= 1024, `description has ${frontmatter.description.length} characters`);
    assert.match(frontmatter.description, /Use when/);
    assert.doesNotMatch(frontmatter.description, /<[a-z]/i, 'no markup in the description');
    assert.doesNotMatch(frontmatter.description, /\b(I|you) can\b/i, 'third person');
  });

  test('description names the words users actually say, in both languages', () => {
    for (const word of ['Junis', '주니스', '스쿼드', 'squad', 'agents']) assert.ok(frontmatter.description.includes(word), word);
  });

  test('the key use is in the first 200 characters, which survive truncation', () => {
    assert.match(frontmatter.description.slice(0, 200), /Junis/);
  });

  test('compatibility is within the limit', () => {
    assert.ok(frontmatter.compatibility.length <= 500);
  });
});

describe('SKILL.md body', () => {
  test('stays under 500 lines', () => {
    assert.ok(body.split('\n').length < 500, `${body.split('\n').length} lines`);
  });

  test('links every reference file, and every link resolves', () => {
    const linked = new Set([...body.matchAll(/\]\((references\/[a-z-]+\.md)\)/g)].map((match) => path.basename(match[1])));
    for (const file of references) assert.ok(linked.has(file), `${file} is not reachable from SKILL.md`);
    for (const file of linked) assert.ok(references.includes(file), `SKILL.md links ${file}, which does not exist`);
  });

  test('names only commands and tools that exist', () => {
    const help = execFileSync(process.execPath, [path.join(SKILL_DIR, 'scripts', 'junis.mjs'), '--help'], { encoding: 'utf8' });
    // Every backticked command in the Command column, with its leading plain
    // words ("session wait", "snapshot diff"), must appear in --help.
    const tableStart = body.indexOf('| Job | Tool | Command |');
    assert.ok(tableStart > 0, 'the Job/Tool/Command table exists');
    const table = body.slice(tableStart).split('\n\n')[0];
    const commandCells = table
      .split('\n')
      .slice(2)
      .map((line) => line.split('|')[3] || '')
      .flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()))
      .filter(Boolean);
    assert.ok(commandCells.length >= 8, 'commands were found in the table');
    for (const cell of commandCells) {
      const words = [];
      for (const word of cell.split(/\s+/)) {
        if (!/^[a-z][a-z-]*$/.test(word)) break;
        words.push(word);
      }
      const phrase = words.join(' ');
      assert.ok(phrase, `no command in "${cell}"`);
      assert.match(help, new RegExp(`(^|\\s|\\|)${phrase.replace(/[-]/g, '\\-')}(\\s|$)`, 'm'), `command "${phrase}" is not in --help`);
    }
    const tools = JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'mocks', 'junis', '_tools.json'), 'utf8')).tools.map((tool) => tool.name);
    const lazyOnly = ['junis_find_tools', 'junis_describe_tool', 'junis_read_tool', 'junis_call_tool'];
    for (const match of body.matchAll(/`(junis_[a-z_]+)`/g)) assert.ok(tools.includes(match[1]) || lazyOnly.includes(match[1]), `${match[1]} is not a tool`);
  });
});

describe('reference files', () => {
  test('each is linked one level deep and does not chain to a missing file', () => {
    for (const file of references) {
      const text = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8');
      for (const match of text.matchAll(/\]\(([a-z-]+\.md)\)/g)) {
        assert.ok(references.includes(match[1]), `${file} links ${match[1]}, which does not exist`);
      }
      assert.doesNotMatch(text, /\]\(references\//, `${file} must link siblings without a folder prefix`);
    }
  });

  test('files longer than 100 lines start with a table of contents', () => {
    for (const file of references) {
      const text = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8');
      if (text.split('\n').length > 100) assert.match(text.slice(0, 1500), /## Contents/, `${file} needs a contents section`);
    }
  });

  test('each opens by saying when to read it', () => {
    for (const file of references) {
      const opening = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8').split('\n').slice(0, 8).join(' ');
      assert.match(opening, /Read this|Find the/, `${file} does not say when to read it`);
    }
  });

  test('platform tools they name exist in the live catalogue', () => {
    const catalogue = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'tools-list.prod.json'), 'utf8')).result.tools.map((tool) => tool.name));
    const kitTools = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'mocks', 'junis', '_tools.json'), 'utf8')).tools.map((tool) => tool.name));
    // Words that look like platform tools but are tools of agents inside Junis,
    // batch action names, or names the text says do not exist.
    const notPlatformTools = new Set([
      'list_custom_apis', 'list_processes', 'list_device_mcp_tools', 'update_orchestrator', 'update_user_memory',
      'update_soul', 'update_identity', 'delete_thread', 'get_products', 'create_pull_request', 'link_mcp', 'link_composio', 'link_device',
      'retry_after', 'add_objective',
    ]);
    const prefix = /^(list|get|create|update|delete|patch|link|unlink|toggle|assign|unassign|import|add|remove|reorder|switch|clone|apply|send|retry|write|manage)_/;
    for (const file of [...references.map((name) => path.join('references', name)), 'SKILL.md']) {
      const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
      for (const match of text.matchAll(/`([a-z]+_[a-z_]+)(?:\([^`]*\))?`/g)) {
        const name = match[1];
        if (!prefix.test(name) || notPlatformTools.has(name)) continue;
        assert.ok(catalogue.has(name) || kitTools.has(name), `${file} names ${name}, which is not a platform tool`);
      }
    }
  });

  test('links to the web app use pages that exist', () => {
    // Pages of the Junis web app.
    const pages = new Set([
      'admin', 'admin/api-keys', 'admin/audit', 'admin/dashboard', 'admin/schedules', 'auth/api-key', 'auth/device', 'chat',
      'connect', 'content', 'embed', 'login', 'memory', 'memory/edit', 'onboarding', 'privacy', 'publish', 'quick-actions',
      'refund', 'settings/api-keys', 'settings/organization', 'shared', 'showcase', 'slack', 'slack/success', 'subscription',
      'team', 'team/agent-proposals', 'team/agent-versions', 'team/audit', 'team/compliance', 'team/content', 'team/devices',
      'team/integrations', 'team/knowledge', 'team/knowledge/graph', 'team/mcp-skills', 'team/members', 'team/orchestration',
      'team/organizations', 'team/public', 'team/rag-knowledge', 'team/security-incidents', 'team/simulations', 'team/skills',
      'team/soul', 'team/task-planning', 'team/tools-guide', 'team/wiki', 'terms', 'usage',
    ]);
    for (const file of [...references.map((name) => path.join('references', name)), 'SKILL.md']) {
      const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
      for (const match of text.matchAll(/https:\/\/junis\.ai\/([a-z][a-z0-9/-]*)/g)) {
        const route = match[1].replace(/\/+$/, '');
        // Dynamic pages (/chat/<id>, /embed/<slug>, /team/public/<slug>) match by their prefix.
        const ok = pages.has(route) || [...pages].some((page) => route.startsWith(`${page}/`) && ['chat', 'embed', 'team/public', 'content', 'shared', 'publish', 'connect'].includes(page));
        assert.ok(ok, `${file} links /${route}, which is not a page of the web app`);
      }
      assert.doesNotMatch(text, /\?org=<slug>/, `${file} relies on ?org=, which no page reads`);
    }
  });

  test('instruction examples pass the brace check they teach', () => {
    for (const file of references) {
      const text = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8');
      for (const block of text.matchAll(/```\n([\s\S]*?)```/g)) {
        const sample = block[1];
        if (!/<identity>|<input>|<rules>|^You are/m.test(sample)) continue;
        const result = lintInstruction(sample, { allowedKeys: [] });
        const errors = result.findings.filter((finding) => finding.level === 'error');
        assert.deepEqual(errors, [], `${file}: an example instruction would break an agent`);
      }
    }
  });
});

describe('repository hygiene', () => {
  const tracked = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'results', 'research'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? tracked(full) : [full];
  });

  test('no credential is present in any file', () => {
    for (const file of tracked(REPO)) {
      if (/\.(png|jpg|zip|ico)$/.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const hit = /jns_(user|live)_[A-Za-z0-9_-]{24,}/.exec(text);
      // Test fixtures use an obviously fake key.
      if (hit && !hit[0].includes('testkey')) assert.fail(`${path.relative(REPO, file)} contains what looks like a real key`);
      assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, path.relative(REPO, file));
    }
  });

  test('the skill folder has no symlinks and no top-level bin folder exists', () => {
    for (const file of tracked(SKILL_DIR)) assert.ok(!fs.lstatSync(file).isSymbolicLink(), file);
    assert.equal(fs.existsSync(path.join(REPO, 'bin')), false, 'a bin folder blocks installation in Claude apps');
  });

  test('the scripts have no dependency outside Node itself', () => {
    for (const file of tracked(path.join(SKILL_DIR, 'scripts'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from '([^']+)'/g)) {
        assert.ok(match[1].startsWith('node:') || match[1].startsWith('./') || match[1].startsWith('../'), `${path.basename(file)} imports ${match[1]}`);
      }
    }
  });

  test('every manifest is generated from kit.json and in sync', () => {
    const output = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'build-manifests.mjs'), '--check'], { encoding: 'utf8' });
    assert.match(output, /in sync/);
  });

  test('the Claude Code plugin carries no version, so each pushed commit is an update', () => {
    // Claude Code skips `plugin update` while the manifest version string is unchanged; without one it
    // uses the commit SHA (code.claude.com/docs/en/plugins/loading, "Versions and updates").
    const claude = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal('version' in claude, false);
    const market = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(market.plugins.some((entry) => 'version' in entry), false);
    const kit = JSON.parse(fs.readFileSync(path.join(REPO, 'kit.json'), 'utf8'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'gemini-extension.json'), 'utf8')).version, kit.version);
  });

  test('--set-version changes every version in one step', () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'junis-kit-version-'));
    try {
      for (const entry of ['kit.json', 'package.json', 'LICENSE', 'NOTICE', 'scripts', 'skills']) fs.cpSync(path.join(REPO, entry), path.join(copy, entry), { recursive: true });
      const build = path.join(copy, 'scripts', 'build-manifests.mjs');
      assert.throws(() => execFileSync(process.execPath, [build, '--set-version', 'v1'], { stdio: 'pipe' }));
      execFileSync(process.execPath, [build, '--set-version', '1.2.3'], { stdio: 'pipe' });
      assert.match(execFileSync(process.execPath, [build, '--check'], { encoding: 'utf8' }), /in sync/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'kit.json'), 'utf8')).version, '1.2.3');
      assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8')).version, '1.2.3');
      assert.match(fs.readFileSync(path.join(copy, 'skills', 'junis', 'SKILL.md'), 'utf8'), /version: "1\.2\.3"/);
      assert.match(fs.readFileSync(path.join(copy, 'skills', 'junis', 'scripts', 'lib', 'config.mjs'), 'utf8'), /KIT_VERSION = '1\.2\.3'/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'gemini-extension.json'), 'utf8')).version, '1.2.3');
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('--set-version changes nothing when it cannot change everything', () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'junis-kit-version-'));
    try {
      for (const entry of ['kit.json', 'package.json', 'LICENSE', 'NOTICE', 'scripts', 'skills']) fs.cpSync(path.join(REPO, entry), path.join(copy, entry), { recursive: true });
      const build = path.join(copy, 'scripts', 'build-manifests.mjs');
      const kitVersion = () => JSON.parse(fs.readFileSync(path.join(copy, 'kit.json'), 'utf8')).version;
      const before = kitVersion();
      for (const bad of [['01.2.3'], ['1.2.3', '--check']]) {
        assert.throws(() => execFileSync(process.execPath, [build, '--set-version', ...bad], { stdio: 'pipe' }), bad.join(' '));
        assert.equal(kitVersion(), before, bad.join(' '));
      }
      const skill = path.join(copy, 'skills', 'junis', 'SKILL.md');
      if (process.getuid?.() !== 0) {
        // a read-only file is found before anything is written (root can write it anyway)
        fs.chmodSync(skill, 0o444);
        assert.throws(() => execFileSync(process.execPath, [build, '--set-version', '2.0.0'], { stdio: 'pipe' }), 'read-only');
        assert.equal(kitVersion(), before, 'read-only');
        fs.chmodSync(skill, 0o644);
      }
      fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/\n  version: "[^"]+"/, ''));
      assert.throws(() => execFileSync(process.execPath, [build, '--set-version', '2.0.0'], { stdio: 'pipe' }));
      assert.equal(kitVersion(), before);
      assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8')).version, before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('plugin hook asks before destructive calls and stays silent otherwise', () => {
    const hook = path.join(REPO, 'hooks', 'confirm-destructive.mjs');
    const run = (name, input) => execFileSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: `mcp__plugin_junis_junis__${name}`, tool_input: input }), encoding: 'utf8' });
    assert.equal(run('list_agents', {}), '');
    assert.equal(run('create_agent', { name: 'x' }), '');
    assert.equal(run('patch_agent_instruction', { old_string: 'a', new_string: 'b' }), '');
    assert.equal(run('update_agent', { agent_id: 'x', model: 'm' }), '');
    for (const [name, input] of [
      ['delete_agent', { agent_id: 'x' }],
      ['delete_datastore', { datastore_id: 'x', force: true }],
      ['remove_sub_agent', {}],
      ['update_agent', { agent_id: 'x', instruction: 'whole new text' }],
      ['update_soul_content', { file_key: 'soul.md', content: 'x' }],
      ['junis_call_tool', { name: 'delete_session', arguments: {} }],
      ['junis_api', { method: 'DELETE', path: '/brain/sources/1' }],
      ['apply_team_changes', { changes: [{ action: 'delete_agent', agent_id: 'x' }] }],
    ]) {
      assert.equal(JSON.parse(run(name, input)).hookSpecificOutput.permissionDecision, 'ask', name);
    }
    assert.equal(execFileSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' }), '', 'fails open');
  });
});
