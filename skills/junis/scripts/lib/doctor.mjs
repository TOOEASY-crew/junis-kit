// End-to-end check of the local setup. Every check reports what it found and,
// when something is wrong, the one action that fixes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION, credentialsPath, customHostWarning, isUserLevelKey, kitHome, loginUrl, resolveProfile } from './config.mjs';
import { httpRequest } from './http.mjs';
import { SERVER_NAME, detectAgents } from './agents.mjs';
import { readConfig } from './jsonc.mjs';
import { fetchOrganizations, loadRemoteTools } from './kit-tools.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'junis.mjs');

function check(name, ok, detail, fix) {
  return { check: name, ok, detail, ...(ok || !fix ? {} : { fix }) };
}

// Complete newline-terminated lines only: a pipe hands the answer over in
// chunks (8 KiB on macOS), so the text after the last newline may still be
// half of a message.
export function completeLines(buffer) {
  return buffer.split('\n').slice(0, -1).filter(Boolean);
}

function bridgeSelfTest() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, 'mcp', '--lazy'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, detail: 'no answer within 10s' });
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = completeLines(buffer);
      if (lines.length < 2) return;
      clearTimeout(timer);
      child.stdin.end();
      try {
        const [init, list] = lines.map((line) => JSON.parse(line));
        resolve({ ok: Boolean(init.result?.serverInfo) && list.result?.tools?.length > 0, detail: `protocol ${init.result?.protocolVersion}, ${list.result?.tools?.length} tools` });
      } catch (err) {
        resolve({ ok: false, detail: `unreadable answer: ${err.message}` });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: err.message });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'doctor', version: KIT_VERSION } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  });
}

function registeredIn(agent) {
  const { kind, file, key } = agent.mcp;
  if (!fs.existsSync(file)) return false;
  if (kind === 'codex-cli') return new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}\\]`, 'm').test(fs.readFileSync(file, 'utf8'));
  const config = readConfig(file);
  return Boolean(config.data[key]?.[SERVER_NAME]);
}

export async function commandDoctor({ flags }) {
  const home = typeof flags.home === 'string' ? path.resolve(flags.home) : os.homedir();
  const profile = resolveProfile();
  const checks = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push(check('node', major >= 18, `Node ${process.versions.node}`, 'Install Node 18 or newer.'));

  const bridge = await bridgeSelfTest();
  checks.push(check('bridge', bridge.ok, bridge.detail, 'Re-run `install`; the skill copy may be incomplete.'));

  try {
    const response = await httpRequest('GET', `${new URL(profile.mcp_url).origin}/health`, { timeoutMs: 10_000 });
    checks.push(check('mcp_server', response.ok, `${profile.mcp_url} → HTTP ${response.status}`, 'Check the network, or JUNIS_MCP_URL if it was overridden.'));
  } catch (err) {
    checks.push(check('mcp_server', false, err.message, 'Check the network, or JUNIS_MCP_URL if it was overridden.'));
  }

  try {
    const tools = await loadRemoteTools(profile, { refresh: true });
    checks.push(check('tool_catalogue', tools.length > 0, `${tools.length} platform tools`));
  } catch (err) {
    checks.push(check('tool_catalogue', false, err.message, 'The hosted server did not return its tool list. Try again in a minute.'));
  }

  if (!profile.api_key) {
    checks.push(check('credentials', false, 'no API key stored', `Copy a key at ${loginUrl(profile)} and run \`login --from-clipboard\`.`));
  } else {
    if (profile.key_source === 'file') {
      const mode = fs.statSync(credentialsPath()).mode & 0o777;
      checks.push(check('credential_file', (mode & 0o077) === 0 || process.platform === 'win32', `${credentialsPath()} mode ${mode.toString(8)}`, `Run: chmod 600 ${credentialsPath()}`));
    }
    const userLevel = isUserLevelKey(profile.api_key);
    checks.push(check('key_type', userLevel, userLevel ? 'user-level key' : 'organization-level key', 'Building and managing squads needs a user-level key (jns_user_…). Running agents works with this key.'));
    if (userLevel) {
      try {
        const organizations = await fetchOrganizations(profile);
        checks.push(check('key_valid', true, `reaches ${organizations.length} organization(s)`));
        const chosen = organizations.find((org) => org.id === profile.organization_id);
        checks.push(
          check(
            'default_organization',
            Boolean(chosen) || organizations.length <= 1,
            chosen ? `${chosen.name} (${chosen.role})` : profile.organization_id ? 'the stored organization is no longer reachable' : 'not set',
            'Set one with `org use <name>`.',
          ),
        );
        if (chosen && !/^(owner|admin)$/i.test(String(chosen.role))) {
          checks.push(check('role', false, `role ${chosen.role}`, 'Managing agents needs the OWNER or ADMIN role in the organization.'));
        }
      } catch (err) {
        const fix = /subscription/i.test(err.message)
          ? `The account needs a Basic or Pro plan: ${profile.web_url}/subscription`
          : `Get a current key at ${loginUrl(profile)} and log in again.`;
        checks.push(check('key_valid', false, err.message, fix));
      }
    }
  }

  const installed = fs.existsSync(path.join(kitHome(), 'install.json')) ? JSON.parse(fs.readFileSync(path.join(kitHome(), 'install.json'), 'utf8')) : null;
  if (installed && !fs.existsSync(installed.node)) {
    checks.push(check('node_path', false, `${installed.node} no longer exists`, 'Run `install` again so agents start the bridge with the current Node.'));
  }
  const agents = detectAgents(home, { useBinaries: home === os.homedir() }).filter((agent) => agent.detected);
  for (const agent of agents) {
    const skillOk = !agent.skillsDir || fs.existsSync(path.join(agent.skillsDir, 'junis', 'SKILL.md'));
    const mcpOk = registeredIn(agent);
    checks.push(check(`agent:${agent.id}`, skillOk && mcpOk, `skill ${skillOk ? 'present' : 'missing'}, MCP ${mcpOk ? 'registered' : 'not registered'}`, `Run \`install --agents ${agent.id}\`.`));
  }

  const failed = checks.filter((entry) => !entry.ok);
  const hostWarning = customHostWarning(profile);
  return {
    ok: failed.length === 0,
    kit_version: KIT_VERSION,
    environment: profile.env,
    ...(hostWarning ? { warning: hostWarning } : {}),
    checks,
    summary: failed.length ? `${failed.length} item(s) need attention` : 'Everything is in place',
    exitCode: failed.length ? 1 : 0,
  };
}
