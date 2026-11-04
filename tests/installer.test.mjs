import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { REPO, runCli, tempDir } from './helpers/harness.mjs';

// Every test installs into a throwaway home directory. `--home` also switches
// the installer to file writers, so no real agent CLI or config is touched.
function fakeHome(agents = ['.claude', '.codex', '.cursor', '.gemini']) {
  const home = tempDir('junis-kit-home-');
  for (const dir of agents) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));
const byAgent = (result, id) => result.json.agents.find((entry) => entry.agent === id);

describe('install', () => {
  test('dry run reports the plan and writes nothing', async () => {
    const home = fakeHome();
    const before = fs.readdirSync(home).sort();
    const result = await runCli(['install', '--home', home, '--dry-run']);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.dry_run, true);
    assert.equal(byAgent(result, 'cursor').mcp.status, 'would_add');
    assert.deepEqual(fs.readdirSync(home).sort(), before);
    assert.equal(fs.existsSync(path.join(home, '.cursor', 'mcp.json')), false);
  });

  test('only agents present on the machine are configured', async () => {
    const home = fakeHome(['.cursor']);
    const result = await runCli(['install', '--home', home]);
    assert.deepEqual(result.json.agents.map((entry) => entry.agent), ['cursor']);
    assert.equal(fs.existsSync(path.join(home, '.claude')), false);
  });

  test('with no agent found it says how to name one', async () => {
    const home = fakeHome([]);
    const result = await runCli(['install', '--home', home]);
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'no_agents');
    assert.match(result.json.hint, /--agents/);
  });

  test('the skill is copied once and linked into each skills folder', async () => {
    const home = fakeHome();
    const result = await runCli(['install', '--home', home]);
    assert.equal(result.code, 0, result.stdout);
    const canonical = path.join(home, '.junis-kit', 'skills', 'junis');
    assert.ok(fs.existsSync(path.join(canonical, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(canonical, 'scripts', 'junis.mjs')));
    for (const dir of ['.claude/skills/junis', '.agents/skills/junis']) {
      const link = path.join(home, dir);
      assert.ok(fs.lstatSync(link).isSymbolicLink(), `${dir} is a link`);
      assert.equal(fs.realpathSync(link), fs.realpathSync(canonical));
    }
  });

  test('each agent gets its own config shape and no credential', async () => {
    const home = fakeHome(['.claude', '.codex', '.cursor', '.gemini', '.config/opencode', '.copilot']);
    await runCli(['install', '--home', home]);
    const script = path.join(home, '.junis-kit', 'skills', 'junis', 'scripts', 'junis.mjs');

    const claude = json(path.join(home, '.claude.json')).mcpServers.junis;
    assert.deepEqual(claude, { type: 'stdio', command: process.execPath, args: [script, 'mcp'] });

    const cursor = json(path.join(home, '.cursor', 'mcp.json')).mcpServers.junis;
    assert.deepEqual(cursor, { command: process.execPath, args: [script, 'mcp', '--lazy'] });

    const gemini = json(path.join(home, '.gemini', 'settings.json')).mcpServers.junis;
    assert.deepEqual(gemini.args, [script, 'mcp', '--lazy']);

    const opencode = json(path.join(home, '.config', 'opencode', 'opencode.json')).mcp.junis;
    assert.deepEqual(opencode, { type: 'local', command: [process.execPath, script, 'mcp', '--lazy'], enabled: true });

    const copilot = json(path.join(home, '.copilot', 'mcp-config.json')).mcpServers.junis;
    assert.equal(copilot.type, 'stdio');

    const codex = read(path.join(home, '.codex', 'config.toml'));
    assert.match(codex, /\[mcp_servers\.junis\]/);
    assert.ok(codex.includes(`command = ${JSON.stringify(process.execPath)}`));

    for (const file of ['.claude.json', '.cursor/mcp.json', '.gemini/settings.json', '.codex/config.toml']) {
      assert.doesNotMatch(read(path.join(home, file)), /jns_|Bearer|api[_-]?key/i, `${file} holds no credential`);
    }
  });

  test('the bridge is started with the absolute path of Node', async () => {
    const home = fakeHome(['.cursor']);
    await runCli(['install', '--home', home]);
    const entry = json(path.join(home, '.cursor', 'mcp.json')).mcpServers.junis;
    assert.ok(path.isAbsolute(entry.command), 'desktop apps do not inherit the shell PATH');
  });

  test('existing config is preserved, backed up, and keeps its indentation', async () => {
    const home = fakeHome(['.cursor', '.codex']);
    const cursorFile = path.join(home, '.cursor', 'mcp.json');
    const original = '{\n    "mcpServers": {\n        "other": {"command": "x", "args": []}\n    },\n    "theme": "dark"\n}\n';
    fs.writeFileSync(cursorFile, original);
    const codexFile = path.join(home, '.codex', 'config.toml');
    fs.writeFileSync(codexFile, 'model = "x"\n\n[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\n');

    const result = await runCli(['install', '--home', home]);
    const cursor = json(cursorFile);
    assert.deepEqual(cursor.mcpServers.other, { command: 'x', args: [] });
    assert.equal(cursor.theme, 'dark');
    assert.match(read(cursorFile), /^ {4}"mcpServers"/m);
    assert.equal(read(byAgent(result, 'cursor').mcp.backup), original);

    const codex = read(codexFile);
    assert.match(codex, /\[mcp_servers\.linear\]/);
    assert.match(codex, /model = "x"/);
  });

  test('running it again changes nothing', async () => {
    const home = fakeHome();
    await runCli(['install', '--home', home]);
    const snapshot = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.gemini/settings.json'].map((file) => read(path.join(home, file)));
    const again = await runCli(['install', '--home', home]);
    for (const entry of again.json.agents) {
      assert.equal(entry.mcp.status, 'unchanged', entry.agent);
      assert.equal(entry.skill.status, 'unchanged', entry.agent);
    }
    const after = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.gemini/settings.json'].map((file) => read(path.join(home, file)));
    assert.deepEqual(after, snapshot);
    const backups = fs.readdirSync(path.join(home, '.cursor')).filter((name) => name.includes('backup'));
    assert.equal(backups.length, 0, 'an unchanged file is not backed up again');
  });

  test('a config file with comments is left untouched and reported as a manual step', async () => {
    const home = fakeHome(['.config/opencode']);
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    const original = '{\n  // keep this comment\n  "mcp": {},\n}\n';
    fs.writeFileSync(file, original);
    const result = await runCli(['install', '--home', home]);
    assert.equal(byAgent(result, 'opencode').mcp.status, 'manual');
    assert.match(byAgent(result, 'opencode').mcp.snippet, /"junis"/);
    assert.equal(read(file), original);
    assert.equal(result.json.manual_steps.length, 1);
  });

  test('a broken config file is left untouched', async () => {
    const home = fakeHome(['.cursor']);
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.writeFileSync(file, '{"mcpServers": {');
    const result = await runCli(['install', '--home', home]);
    assert.equal(byAgent(result, 'cursor').mcp.status, 'manual');
    assert.equal(read(file), '{"mcpServers": {');
  });

  test("a skill folder the kit did not create is not replaced", async () => {
    const home = fakeHome(['.claude']);
    const foreign = path.join(home, '.claude', 'skills', 'junis');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'mine');
    const result = await runCli(['install', '--home', home]);
    assert.equal(byAgent(result, 'claude-code').skill.status, 'skipped');
    assert.equal(read(path.join(foreign, 'SKILL.md')), 'mine');
    const forced = await runCli(['install', '--home', home, '--force']);
    assert.match(byAgent(forced, 'claude-code').skill.status, /linked/);
  });

  test('an unmanaged Codex entry with the same name is not overwritten', async () => {
    const home = fakeHome(['.codex']);
    const file = path.join(home, '.codex', 'config.toml');
    fs.writeFileSync(file, '[mcp_servers.junis]\ncommand = "something-else"\n');
    const result = await runCli(['install', '--home', home]);
    assert.equal(byAgent(result, 'codex').mcp.status, 'manual');
    assert.match(read(file), /something-else/);
  });

  test('tool exposure can be forced for every agent', async () => {
    const home = fakeHome(['.claude', '.cursor']);
    await runCli(['install', '--home', home, '--lazy']);
    assert.ok(json(path.join(home, '.claude.json')).mcpServers.junis.args.includes('--lazy'));
    await runCli(['install', '--home', home, '--full']);
    assert.ok(!json(path.join(home, '.cursor', 'mcp.json')).mcpServers.junis.args.includes('--lazy'));
  });

  test('an unknown agent name is refused with the list of known ones', async () => {
    const home = fakeHome();
    const result = await runCli(['install', '--home', home, '--agents', 'emacs']);
    assert.equal(result.code, 2);
    assert.match(result.json.hint, /claude-code/);
  });

  test('the installed copy runs on its own', async () => {
    const home = fakeHome(['.claude']);
    await runCli(['install', '--home', home]);
    const script = path.join(home, '.junis-kit', 'skills', 'junis', 'scripts', 'junis.mjs');
    const { spawnSync } = await import('node:child_process');
    const version = spawnSync(process.execPath, [script, 'version'], { encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.match(version.stdout, /^\d+\.\d+\.\d+/);
  });
});

describe('uninstall', () => {
  test('removes what the kit added and nothing else', async () => {
    const home = fakeHome(['.claude', '.cursor', '.codex']);
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{\n  "mcpServers": {\n    "other": {"command": "x"}\n  }\n}\n');
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "x"\n');
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'mine'), { recursive: true });
    await runCli(['install', '--home', home]);

    const result = await runCli(['uninstall', '--home', home]);
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(json(path.join(home, '.cursor', 'mcp.json')).mcpServers, { other: { command: 'x' } });
    assert.equal(read(path.join(home, '.codex', 'config.toml')), 'model = "x"\n');
    assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', 'junis')), false);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'mine')));
    assert.equal(fs.existsSync(path.join(home, '.junis-kit', 'skills', 'junis')), false);
  });

  test('keeps the stored key unless asked to remove it', async () => {
    const home = fakeHome(['.claude']);
    await runCli(['install', '--home', home]);
    const credentials = path.join(home, '.junis-kit', 'credentials.json');
    fs.writeFileSync(credentials, '{}');
    const kept = await runCli(['uninstall', '--home', home]);
    assert.equal(kept.json.credentials, 'kept');
    assert.ok(fs.existsSync(credentials));
    await runCli(['install', '--home', home]);
    const purged = await runCli(['uninstall', '--home', home, '--purge']);
    assert.equal(purged.json.credentials, 'removed');
    assert.equal(fs.existsSync(credentials), false);
  });

  test('on a machine where nothing was installed it reports nothing to do', async () => {
    const home = fakeHome();
    const result = await runCli(['uninstall', '--home', home]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.agents, []);
  });
});

// install.sh is the public one-liner (`curl … | sh`). A fake remote and fake kits
// keep it hermetic: each junis.mjs only prints where it came from.
describe('install.sh bootstrap', () => {
  const INSTALL_SH = path.join(REPO, 'install.sh');
  // The developer's git setup must not reach these tests: no GIT_* variables (a
  // pre-commit hook exports GIT_INDEX_FILE, which would rewrite their index), no
  // global or system config (signing, hooks).
  const baseEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: baseEnv, stdio: 'pipe' });
  const fakeKit = (dir, marker) => {
    fs.mkdirSync(path.join(dir, 'skills', 'junis', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'junis', 'scripts', 'junis.mjs'), `console.log(${JSON.stringify(marker)});\n`);
  };
  const setup = () => {
    const root = tempDir('junis-kit-bootstrap-');
    const remote = path.join(root, 'remote');
    fakeKit(remote, 'FROM-CLONE-1');
    git(remote, 'init', '-q', '-b', 'main');
    git(remote, 'add', '.');
    git(remote, 'commit', '-q', '-m', 'one');
    const cwdKit = path.join(root, 'cwd-kit');
    fakeKit(cwdKit, 'FROM-CWD');
    // Pin every install.sh override, so an exported JUNIS_KIT_HOME never points the test at a real kit.
    const home = path.join(root, 'home');
    const env = { ...baseEnv, HOME: home, JUNIS_KIT_HOME: path.join(home, '.junis-kit'), JUNIS_KIT_REF: 'main', JUNIS_KIT_REPO: `file://${remote}` };
    fs.mkdirSync(home);
    const piped = () => execFileSync('sh', ['-s', '--', '--dry-run'], { input: fs.readFileSync(INSTALL_SH), cwd: cwdKit, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { root, remote, cwdKit, env, piped };
  };

  test('piped, it downloads the kit even when the current directory looks like one', () => {
    const { piped } = setup();
    assert.match(piped(), /FROM-CLONE-1/);
  });

  test('piped again, it picks up the new commit', () => {
    const { remote, piped } = setup();
    piped();
    fakeKit(remote, 'FROM-CLONE-2');
    git(remote, 'commit', '-q', '-am', 'two');
    assert.match(piped(), /FROM-CLONE-2/);
  });

  test('a download cut off anywhere runs nothing', () => {
    const { env, cwdKit } = setup();
    const script = fs.readFileSync(INSTALL_SH, 'utf8');
    // Coarse steps through the script, then every byte of the tail, where a finished
    // download block followed by a missing last line would matter most.
    const cuts = new Set();
    for (let cut = 1; cut < script.length - 1; cut += 53) cuts.add(cut);
    for (let cut = Math.max(1, script.length - 200); cut < script.length - 1; cut += 1) cuts.add(cut);
    for (const cut of [...cuts].sort((a, b) => a - b)) {
      let out = '';
      try {
        out = execFileSync('sh', ['-s', '--', '--dry-run'], { input: script.slice(0, cut), cwd: cwdKit, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        out = String(err.stdout || '');
      }
      assert.doesNotMatch(out, /FROM-/, `cut at ${cut}`);
      assert.equal(fs.existsSync(env.JUNIS_KIT_HOME), false, `cut at ${cut} touched ${env.JUNIS_KIT_HOME}`);
    }
  });

  // zsh sets $0 to the function name inside a function (FUNCTION_ARGZERO), so the
  // script must read its own path before main runs.
  const shells = ['sh', 'bash', 'dash', 'zsh'].filter((shell) => spawnSync(shell, ['-c', 'true']).status === 0);

  test('every shell installs the checkout when run as a file, and downloads when piped', () => {
    const { root, cwdKit, env, remote } = setup();
    const checkout = path.join(root, 'checkout');
    fakeKit(checkout, 'FROM-CHECKOUT');
    fs.copyFileSync(INSTALL_SH, path.join(checkout, 'install.sh'));
    assert.ok(shells.includes('sh'));
    for (const shell of shells) {
      const asFile = execFileSync(shell, [path.join(checkout, 'install.sh'), '--dry-run'], { cwd: cwdKit, env, encoding: 'utf8' });
      assert.match(asFile, /FROM-CHECKOUT/, `${shell} as a file`);
      const piped = execFileSync(shell, ['-s', '--', '--dry-run'], { input: fs.readFileSync(INSTALL_SH), cwd: cwdKit, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      assert.match(piped, /FROM-CLONE-1/, `${shell} piped`);
    }
    assert.ok(remote);
  });

  test('run as a file from a checkout, it installs that checkout', () => {
    const { root, cwdKit, env } = setup();
    const checkout = path.join(root, 'checkout');
    fakeKit(checkout, 'FROM-CHECKOUT');
    fs.copyFileSync(INSTALL_SH, path.join(checkout, 'install.sh'));
    const out = execFileSync('sh', [path.join(checkout, 'install.sh'), '--dry-run'], { cwd: cwdKit, env, encoding: 'utf8' });
    assert.match(out, /FROM-CHECKOUT/);
  });

  // JUNIS_KIT_REF and JUNIS_KIT_REPO reach git as data, never as options (an empty value is the default).
  test('a ref or repository that is an option or several words is refused before git runs', () => {
    const { cwdKit, env } = setup();
    const script = fs.readFileSync(INSTALL_SH);
    for (const [name, value] of [
      ['JUNIS_KIT_REF', '--upload-pack=touch /tmp/pwned'],
      ['JUNIS_KIT_REF', '-q'],
      ['JUNIS_KIT_REF', 'main extra'],
      ['JUNIS_KIT_REPO', '--upload-pack=touch /tmp/pwned'],
    ]) {
      const result = spawnSync('sh', ['-s', '--', '--dry-run'], { input: script, cwd: cwdKit, env: { ...env, [name]: value }, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${name}=${JSON.stringify(value)} was accepted`);
      assert.match(result.stderr, new RegExp(name), `${name}=${JSON.stringify(value)} is named in the error`);
      assert.doesNotMatch(result.stdout, /FROM-/);
      assert.equal(fs.existsSync(env.JUNIS_KIT_HOME), false, `${name}=${JSON.stringify(value)} touched ${env.JUNIS_KIT_HOME}`);
    }
  });

  test('an existing clone follows a changed JUNIS_KIT_REPO and says so', () => {
    const { root, cwdKit, env, piped } = setup();
    assert.match(piped(), /FROM-CLONE-1/);
    const other = path.join(root, 'other-remote');
    fakeKit(other, 'FROM-OTHER-REPO');
    git(other, 'init', '-q', '-b', 'main');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'one');
    const moved = { ...env, JUNIS_KIT_REPO: `file://${other}` };
    const result = spawnSync('sh', ['-s', '--', '--dry-run'], { input: fs.readFileSync(INSTALL_SH), cwd: cwdKit, env: moved, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FROM-OTHER-REPO/);
    assert.match(result.stderr, /switching it to file:\/\//);
    assert.equal(execFileSync('git', ['-C', path.join(env.JUNIS_KIT_HOME, 'src'), 'remote', 'get-url', 'origin'], { env: baseEnv, encoding: 'utf8' }).trim(), `file://${other}`);
    // The same repository again: no switch, no message.
    const again = spawnSync('sh', ['-s', '--', '--dry-run'], { input: fs.readFileSync(INSTALL_SH), cwd: cwdKit, env: moved, encoding: 'utf8' });
    assert.doesNotMatch(again.stderr, /switching/);
  });
});
