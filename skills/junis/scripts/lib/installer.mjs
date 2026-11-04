// One install pipeline for every agent.
//
//   1. Copy the skill to a stable home owned by the kit.
//   2. Link that copy into each detected agent's skills folder.
//   3. Register the stdio bridge in each agent's MCP configuration.
//
// Nothing here contains a credential: every agent gets the same command, and
// the key stays in the kit's own credential file. Re-running is safe, every
// edited config file is backed up first, and `uninstall` removes only what
// the kit added.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION } from './config.mjs';
import { KitError } from './http.mjs';
import { SERVER_NAME, detectAgents, isKitEntry, mcpEntry, onPath } from './agents.mjs';
import { backupFile, readConfig, sameValue, timestamp, writeConfig } from './jsonc.mjs';

const SKILL_NAME = 'junis';
const OWNER_FILE = '.junis-kit.json';
const TOML_BEGIN = '# >>> junis-kit (managed block, edit with `junis install`) >>>';
const TOML_END = '# <<< junis-kit <<<';
const SKIP_NAMES = new Set(['.DS_Store', 'node_modules', '.git', 'Thumbs.db']);

export function sourceSkillDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function kitHomeFor(home) {
  if (process.env.JUNIS_KIT_HOME && home === os.homedir()) return process.env.JUNIS_KIT_HOME;
  return path.join(home, '.junis-kit');
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

// The Node binary every agent will start. process.execPath can be a
// versioned path (Homebrew Cellar, nvm) that disappears on the next upgrade,
// after which the server silently fails to start. Prefer a stable path to
// the same binary.
export function stableNodePath(execPath = process.execPath) {
  const real = (target) => {
    try {
      return fs.realpathSync(target);
    } catch {
      return '';
    }
  };
  const current = real(execPath) || execPath;
  const onShellPath = onPath('node');
  if (onShellPath && onShellPath !== execPath && real(onShellPath) === current && !/[\\/]\.(nvm|fnm|asdf|volta)[\\/]/.test(onShellPath)) {
    return { path: onShellPath };
  }
  const cellar = /^(.*)[\\/]Cellar[\\/](node(?:@\d+)?)[\\/][^\\/]+[\\/]bin[\\/]node$/.exec(current);
  if (cellar) {
    const opt = path.join(cellar[1], 'opt', cellar[2], 'bin', 'node');
    if (real(opt) === current) return { path: opt };
  }
  if (/[\\/]\.(nvm|fnm|asdf|volta)[\\/]/.test(execPath)) {
    return { path: execPath, warning: 'Node comes from a version manager. Run `junis install` again after switching or removing this Node version, or the agents will not start the Junis server.' };
  }
  return { path: execPath };
}

function kitEnv(home) {
  // A kit home moved with JUNIS_KIT_HOME must reach the server too, or it
  // reads the default credential file and reports "not logged in".
  return process.env.JUNIS_KIT_HOME && home === os.homedir() ? { JUNIS_KIT_HOME: process.env.JUNIS_KIT_HOME } : {};
}

function sameRealPath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

// Step 1. The stable copy every agent points at. Built next to the target and
// swapped in with a rename so an interrupted install never leaves half a skill.
function installCanonical(home, { dryRun }) {
  const source = sourceSkillDir();
  const target = path.join(kitHomeFor(home), 'skills', SKILL_NAME);
  if (sameRealPath(source, target)) return { path: target, status: 'in_place' };
  const previous = readOwner(target);
  const status = !fs.existsSync(target) ? 'installed' : previous?.version === KIT_VERSION ? 'refreshed' : 'upgraded';
  if (dryRun) return { path: target, status: `would_${status.replace(/ed$/, '')}`, from_version: previous?.version };

  const staging = `${target}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  copyTree(source, staging);
  fs.writeFileSync(
    path.join(staging, OWNER_FILE),
    `${JSON.stringify({ name: SKILL_NAME, version: KIT_VERSION, installed_at: new Date().toISOString(), source }, null, 2)}\n`,
  );
  const retired = `${target}.retired-${process.pid}`;
  if (fs.existsSync(target)) fs.renameSync(target, retired);
  fs.renameSync(staging, target);
  fs.rmSync(retired, { recursive: true, force: true });
  return { path: target, status, from_version: previous?.version };
}

// Step 2. A skill folder that the kit did not create is never replaced.
function linkSkill(skillsDir, canonical, { dryRun, force }) {
  const target = path.join(skillsDir, SKILL_NAME);
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch {
    // nothing there yet
  }
  if (stat?.isSymbolicLink() && sameRealPath(target, canonical)) return { path: target, status: 'unchanged' };
  // A folder, or a live link to somewhere else, that the kit did not create
  // belongs to the user. A dangling link is replaced.
  const foreign = stat && (stat.isSymbolicLink() ? fs.existsSync(target) : !readOwner(target));
  if (foreign && !force) {
    return {
      path: target,
      status: 'skipped',
      note: 'Something with this name already exists and was not created by the kit. Re-run with --force to replace it.',
    };
  }
  if (dryRun) return { path: target, status: stat ? 'would_replace' : 'would_link' };

  fs.mkdirSync(skillsDir, { recursive: true });
  if (stat) fs.rmSync(target, { recursive: true, force: true });
  try {
    // A junction needs no privilege on Windows; elsewhere it is an ordinary link.
    fs.symlinkSync(canonical, target, process.platform === 'win32' ? 'junction' : 'dir');
    return { path: target, status: stat ? 'relinked' : 'linked' };
  } catch {
    // Symlinks can be unavailable (Windows without developer mode).
    copyTree(canonical, target);
    return { path: target, status: 'copied', note: 'Symlinks are unavailable here, so this is a copy. Run install again after upgrading the kit.' };
  }
}

function unlinkSkill(skillsDir, canonical, { dryRun }) {
  const target = path.join(skillsDir, SKILL_NAME);
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return { path: target, status: 'absent' };
  }
  const ours = stat.isSymbolicLink() ? sameRealPath(target, canonical) || !fs.existsSync(target) : Boolean(readOwner(target));
  if (!ours) return { path: target, status: 'kept', note: 'Not created by the kit.' };
  if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
  return { path: target, status: dryRun ? 'would_remove' : 'removed' };
}

function run(binary, args) {
  return execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
}

function runQuietly(binary, args) {
  try {
    run(binary, args);
    return true;
  } catch {
    return false;
  }
}

function manualSnippet(agent, entry, argv) {
  if (agent.mcp.kind === 'codex-cli') return tomlBlock(argv, entry.env).split('\n').slice(1, -1).join('\n');
  return JSON.stringify({ [agent.mcp.key]: { [SERVER_NAME]: entry } }, null, 2);
}

function upsertJson(agent, entry, argv, { dryRun, force, stamp }) {
  const { file, key } = agent.mcp;
  const config = readConfig(file);
  if (config.state === 'invalid') {
    return { file, status: 'manual', note: 'The config file could not be parsed, so it was left untouched.', snippet: manualSnippet(agent, entry, argv) };
  }
  const current = config.data[key]?.[SERVER_NAME];
  if (current && sameValue(current, entry)) return { file, status: 'unchanged' };
  if (current && !isKitEntry(current) && !force) return foreignEntry(file, agent, entry, argv);
  if (config.state === 'jsonc' && !force) {
    return {
      file,
      status: 'manual',
      note: 'The config file contains comments. Rewriting it would delete them, so add the entry by hand or re-run with --force.',
      snippet: manualSnippet(agent, entry, argv),
    };
  }
  if (dryRun) return { file, status: current ? 'would_update' : 'would_add' };
  const backup = config.state === 'missing' ? undefined : backupFile(file, stamp);
  const data = { ...config.data, [key]: { ...(config.data[key] || {}), [SERVER_NAME]: entry } };
  writeConfig(file, data, config.indent);
  return { file, status: current ? 'updated' : 'added', backup };
}

function removeJson(agent, { dryRun, stamp }) {
  const { file, key } = agent.mcp;
  const config = readConfig(file);
  if (config.state === 'missing' || !config.data[key]?.[SERVER_NAME]) return { file, status: 'absent' };
  if (!isKitEntry(config.data[key][SERVER_NAME])) return { file, status: 'kept', note: `The "${SERVER_NAME}" entry was not created by the kit.` };
  if (config.state !== 'json') {
    return { file, status: 'manual', note: `Remove the "${SERVER_NAME}" entry under "${key}" by hand; the file is not plain JSON.` };
  }
  if (dryRun) return { file, status: 'would_remove' };
  const backup = backupFile(file, stamp);
  const servers = { ...config.data[key] };
  delete servers[SERVER_NAME];
  writeConfig(file, { ...config.data, [key]: servers }, config.indent);
  return { file, status: 'removed', backup };
}

// Codex gives a tool 60 s by default, while batch builds, imports and runs
// take minutes; a client-side timeout would invite a duplicate retry.
function tomlBlock(argv, env = {}) {
  const lines = [
    TOML_BEGIN,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(argv[0])}`,
    `args = ${JSON.stringify(argv.slice(1))}`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 600',
  ];
  const pairs = Object.entries(env || {});
  if (pairs.length) lines.push(`env = { ${pairs.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`);
  lines.push(TOML_END);
  return lines.join('\n');
}

// The [mcp_servers.junis] table outside the managed block, if any.
function unmanagedTomlTable(text) {
  const parts = splitToml(text);
  const outside = parts ? `${parts.before}\n${parts.after}` : text;
  const match = new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(outside);
  return match ? match[0] : '';
}

function splitToml(text) {
  const begin = text.indexOf(TOML_BEGIN);
  const end = text.indexOf(TOML_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return { before: text.slice(0, begin), block: text.slice(begin, end + TOML_END.length), after: text.slice(end + TOML_END.length) };
}

function upsertToml(agent, entry, argv, { dryRun, stamp, force, binaryPath }) {
  const { file } = agent.mcp;
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = tomlBlock(argv, entry.env);
  const table = unmanagedTomlTable(text);
  if (table) {
    // A table the kit added earlier through `codex mcp add` is replaced by the
    // managed block; anybody else's is left alone unless forced.
    const ours = /junis\.mjs/.test(table) && /"mcp"/.test(table);
    if (!ours && !force) {
      return { file, status: 'manual', note: `An [mcp_servers.${SERVER_NAME}] table already exists and was not created by the kit. Re-run with --force to replace it.`, snippet: manualSnippet(agent, entry, argv) };
    }
    if (dryRun) return { file, status: 'would_update' };
    if (!binaryPath || !runQuietly(binaryPath, ['mcp', 'remove', SERVER_NAME])) {
      return { file, status: 'manual', note: `Remove the existing [mcp_servers.${SERVER_NAME}] table, then run install again.`, snippet: manualSnippet(agent, entry, argv) };
    }
    text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
  const parts = splitToml(text);
  if (parts?.block === block) return { file, status: 'unchanged' };
  if (dryRun) return { file, status: parts ? 'would_update' : 'would_add' };
  const backup = text ? backupFile(file, stamp) : undefined;
  const next = parts
    ? `${parts.before}${block}${parts.after}`
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return { file, status: parts ? 'updated' : 'added', backup };
}

function removeToml(agent, { dryRun, stamp }) {
  const { file } = agent.mcp;
  if (!fs.existsSync(file)) return { file, status: 'absent' };
  const text = fs.readFileSync(file, 'utf8');
  const parts = splitToml(text);
  if (!parts) return { file, status: 'absent' };
  if (dryRun) return { file, status: 'would_remove' };
  const backup = backupFile(file, stamp);
  fs.writeFileSync(file, `${parts.before.replace(/\n+$/, '\n')}${parts.after.replace(/^\n+/, '')}`);
  return { file, status: 'removed', backup };
}

// Step 3. Agents with their own CLI are configured through it: the CLI owns
// the file format and may be writing the same file from a running session.
function foreignEntry(file, agent, entry, argv) {
  return {
    file,
    status: 'manual',
    note: `A "${SERVER_NAME}" server entry already exists and was not created by the kit (it may hold a key for the hosted server). It was left as is. Re-run with --force to replace it with the kit's server.`,
    snippet: manualSnippet(agent, entry, argv),
  };
}

function registerMcp(agent, entry, argv, options) {
  const useCli = options.useCli && agent.binaryPath;
  const command = argv;
  if (agent.mcp.kind === 'claude-cli' && useCli) {
    const existing = readConfig(agent.mcp.file);
    const current = existing.state === 'json' || existing.state === 'jsonc' ? existing.data?.mcpServers?.[SERVER_NAME] : undefined;
    if (current && sameValue(current, entry)) return { via: 'claude mcp add', status: 'unchanged' };
    if (current && !isKitEntry(current) && !options.force) return foreignEntry(agent.mcp.file, agent, entry, argv);
    if (options.dryRun) return { via: 'claude mcp add', status: current ? 'would_update' : 'would_add' };
    const backup = existing.state === 'missing' ? undefined : backupFile(agent.mcp.file, options.stamp);
    if (current) runQuietly(agent.binaryPath, ['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
    const envArgs = Object.entries(entry.env || {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    try {
      run(agent.binaryPath, ['mcp', 'add', '--scope', 'user', ...envArgs, SERVER_NAME, '--', ...command]);
      return { via: 'claude mcp add', status: current ? 'updated' : 'added', backup };
    } catch (err) {
      return { via: 'claude mcp add', status: 'manual', note: String(err.stderr || err.message).trim().slice(0, 300), snippet: `claude mcp add --scope user ${SERVER_NAME} -- ${command.join(' ')}`, backup };
    }
  }
  // Codex: the managed block is written directly, with timeouts that
  // `codex mcp add` cannot set.
  if (agent.mcp.kind === 'codex-cli') return upsertToml(agent, entry, argv, { ...options, binaryPath: useCli ? agent.binaryPath : '' });
  return upsertJson(agent, entry, argv, options);
}

function unregisterMcp(agent, options) {
  const useCli = options.useCli && agent.binaryPath;
  if (agent.mcp.kind === 'claude-cli' && useCli) {
    const existing = readConfig(agent.mcp.file);
    const current = existing.data?.mcpServers?.[SERVER_NAME];
    if (!current) return { via: 'claude mcp remove', status: 'absent' };
    if (!isKitEntry(current)) return { via: 'claude mcp remove', status: 'kept', note: `The "${SERVER_NAME}" entry was not created by the kit.` };
    if (options.dryRun) return { via: 'claude mcp remove', status: 'would_remove' };
    const backup = backupFile(agent.mcp.file, options.stamp);
    if (runQuietly(agent.binaryPath, ['mcp', 'remove', '--scope', 'user', SERVER_NAME])) return { via: 'claude mcp remove', status: 'removed', backup };
    // The CLI refused or is broken: fall back to editing the file it writes.
    return removeJson(agent, options);
  }
  if (agent.mcp.kind === 'codex-cli' && useCli) {
    const text = fs.existsSync(agent.mcp.file) ? fs.readFileSync(agent.mcp.file, 'utf8') : '';
    const table = unmanagedTomlTable(text);
    const ours = table && /junis\.mjs/.test(table) && /"mcp"/.test(table);
    if (options.dryRun) return { via: 'codex mcp remove', status: ours || splitToml(text) ? 'would_remove' : 'absent' };
    const removed = ours ? runQuietly(agent.binaryPath, ['mcp', 'remove', SERVER_NAME]) : false;
    const block = removeToml(agent, options);
    return { via: 'codex mcp remove', status: removed || block.status === 'removed' ? 'removed' : table && !ours ? 'kept' : 'absent' };
  }
  if (agent.mcp.kind === 'codex-cli') return removeToml(agent, options);
  return removeJson(agent, options);
}

function buildSkillArchive(canonical, kitHome, { dryRun }) {
  const archive = path.join(kitHome, 'dist', `${SKILL_NAME}-skill.zip`);
  if (dryRun) return { path: archive, status: 'would_build' };
  try {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.rmSync(archive, { force: true });
    // The archive must contain the skill folder itself at its top level.
    execFileSync('zip', ['-r', '-q', '-X', archive, SKILL_NAME, '-x', '*/.DS_Store', '-x', `${SKILL_NAME}/${OWNER_FILE}`, '-x', `${SKILL_NAME}/evals/*`], {
      cwd: path.dirname(canonical),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { path: archive, status: 'built' };
  } catch (err) {
    return { path: archive, status: 'skipped', note: `Could not build the archive (${err.code || err.message}).` };
  }
}

function pluginInstalled(registry) {
  try {
    const plugins = JSON.parse(fs.readFileSync(registry, 'utf8'))?.plugins || {};
    return Object.keys(plugins).some((name) => name.split('@')[0] === SKILL_NAME);
  } catch {
    return false;
  }
}

function selectAgents(home, flags, { forUninstall = false } = {}) {
  const all = detectAgents(home, { useBinaries: home === os.homedir() });
  const requested = typeof flags.agents === 'string' ? flags.agents.split(',').map((id) => id.trim()).filter(Boolean) : null;
  if (requested && !requested.includes('all')) {
    const unknown = requested.filter((id) => !all.some((agent) => agent.id === id));
    if (unknown.length) {
      throw new KitError(`Unknown agent: ${unknown.join(', ')}`, { code: 'usage', hint: `Known agents: ${all.map((agent) => agent.id).join(', ')}` });
    }
    return all.filter((agent) => requested.includes(agent.id));
  }
  if (requested?.includes('all') || forUninstall) return all;
  return all.filter((agent) => agent.detected);
}

function manifestPath(kitHome) {
  return path.join(kitHome, 'install.json');
}

export async function commandInstall({ flags }) {
  const home = typeof flags.home === 'string' ? path.resolve(flags.home) : os.homedir();
  const dryRun = Boolean(flags.dry_run);
  const options = { dryRun, force: Boolean(flags.force), stamp: timestamp(), useCli: home === os.homedir() && !flags.no_cli };
  const kitHome = kitHomeFor(home);
  const agents = selectAgents(home, flags);
  if (!agents.length) {
    throw new KitError('No supported agent was found on this machine', {
      code: 'no_agents',
      hint: 'Name the agents explicitly, for example --agents claude-code,codex, or --agents all.',
    });
  }

  // The kit home holds the credential file later, so it is owner-only from
  // the start (mkdirSync does not change the mode of an existing directory).
  if (!dryRun) fs.mkdirSync(kitHome, { recursive: true, mode: 0o700 });
  const canonical = installCanonical(home, options);
  const script = path.join(canonical.path, 'scripts', 'junis.mjs');
  const forcedMode = flags.full ? 'full' : flags.lazy ? 'lazy' : '';
  const linked = new Map();
  const results = [];

  // An absolute Node path: desktop apps started from the dock do not inherit
  // the shell PATH and would not find `node`.
  const node = stableNodePath();
  const env = kitEnv(home);
  for (const agent of agents) {
    const mode = forcedMode || agent.mode;
    // The Claude Code plugin already brings the skill and the server; a
    // second copy would show every tool twice.
    if (agent.pluginRegistry && pluginInstalled(agent.pluginRegistry) && !flags.force) {
      results.push({ agent: agent.id, label: agent.label, detected: agent.detected, tools: mode, skill: { status: 'skipped', note: 'Provided by the installed Junis plugin.' }, mcp: { status: 'skipped', note: 'The Junis plugin for Claude Code is installed and already runs the server. Uninstall the plugin first to use this install instead.' } });
      continue;
    }
    const argv = [node.path, script, 'mcp', ...(mode === 'lazy' ? ['--lazy'] : [])];
    const entry = mcpEntry(agent.mcp.shape, { command: argv[0], args: argv.slice(1), env });
    let skill;
    if (!agent.skillsDir) {
      skill = { status: 'manual', note: agent.manualSkill, archive: buildSkillArchive(canonical.path, kitHome, options) };
    } else {
      if (!linked.has(agent.skillsDir)) linked.set(agent.skillsDir, linkSkill(agent.skillsDir, canonical.path, options));
      skill = linked.get(agent.skillsDir);
    }
    results.push({ agent: agent.id, label: agent.label, detected: agent.detected, tools: mode, skill, mcp: registerMcp(agent, entry, argv, options) });
  }
  const warnings = node.warning ? [node.warning] : [];

  if (!dryRun) {
    fs.writeFileSync(
      manifestPath(kitHome),
      `${JSON.stringify({ version: KIT_VERSION, installed_at: new Date().toISOString(), node: node.path, skill: canonical.path, agents: results.map((result) => result.agent) }, null, 2)}\n`,
    );
  }

  const manual = results.filter((result) => result.mcp.status === 'manual' || result.skill.status === 'manual' || result.skill.status === 'skipped');
  return {
    dry_run: dryRun,
    kit_version: KIT_VERSION,
    skill: canonical,
    agents: results,
    manual_steps: manual.map((result) => ({ agent: result.label, skill: result.skill.note, mcp: result.mcp.note, snippet: result.mcp.snippet })),
    ...(warnings.length ? { warnings } : {}),
    next_step: dryRun
      ? 'Nothing was changed. Run again without --dry-run to apply.'
      : 'Restart the agents that were open during the install, then ask: "Check my Junis connection" (or ask in your language).',
  };
}

export async function commandUninstall({ flags }) {
  const home = typeof flags.home === 'string' ? path.resolve(flags.home) : os.homedir();
  const dryRun = Boolean(flags.dry_run);
  const options = { dryRun, stamp: timestamp(), useCli: home === os.homedir() && !flags.no_cli };
  const kitHome = kitHomeFor(home);
  const canonical = path.join(kitHome, 'skills', SKILL_NAME);
  const agents = selectAgents(home, flags, { forUninstall: true });
  const unlinked = new Map();
  const results = [];

  for (const agent of agents) {
    let skill = { status: 'absent' };
    if (agent.skillsDir) {
      if (!unlinked.has(agent.skillsDir)) unlinked.set(agent.skillsDir, unlinkSkill(agent.skillsDir, canonical, options));
      skill = unlinked.get(agent.skillsDir);
    }
    const mcp = unregisterMcp(agent, options);
    if (skill.status !== 'absent' || mcp.status !== 'absent') results.push({ agent: agent.id, label: agent.label, skill, mcp });
  }

  const everything = typeof flags.agents !== 'string' || flags.agents.split(',').includes('all');
  let kit = 'kept';
  if (everything && !sameRealPath(sourceSkillDir(), canonical)) {
    kit = dryRun ? 'would_remove' : 'removed';
    if (!dryRun) {
      fs.rmSync(canonical, { recursive: true, force: true });
      fs.rmSync(path.join(kitHome, 'dist'), { recursive: true, force: true });
      fs.rmSync(manifestPath(kitHome), { force: true });
    }
  }
  let credentials = 'kept';
  if (flags.purge && everything) {
    credentials = dryRun ? 'would_remove' : 'removed';
    if (!dryRun) {
      fs.rmSync(path.join(kitHome, 'credentials.json'), { force: true });
      // Browser-login requests of every profile (their verifiers) and received keys not stored yet.
      for (const name of fs.existsSync(kitHome) ? fs.readdirSync(kitHome) : []) {
        if (/^(credentials\.json(\.lock)?|pending-login(\.[A-Za-z0-9_-]+)?\.json)(\.\d+\.tmp)?$/.test(name)) fs.rmSync(path.join(kitHome, name), { force: true });
      }
    }
  }

  // Backups of agent config files are never deleted automatically: they are
  // the user's way back. They are listed so they can be removed by hand.
  const backups = [];
  for (const agent of agents) {
    const file = agent.mcp?.file;
    if (!file) continue;
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.junis-kit-backup-`;
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) if (name.startsWith(prefix)) backups.push(path.join(dir, name));
  }

  return {
    dry_run: dryRun,
    agents: results,
    kit_files: kit,
    credentials,
    backups_kept: backups,
    note: credentials === 'kept' ? 'The stored API key was kept. Add --purge to remove it as well.' : undefined,
  };
}
