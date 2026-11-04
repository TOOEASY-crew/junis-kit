// Where each coding agent keeps skills and MCP configuration.
//
// Skills use one open format, so every agent gets the same folder. MCP
// configuration is not standardised: file location, top-level key and entry
// shape all differ per agent, so each agent has its own small writer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SERVER_NAME = 'junis';

// Environment overrides describe the real home only; an install into another
// home (--home, tests) must never read or write the real configuration.
const realHome = (home) => home === os.homedir();

function appData(home) {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (process.platform === 'win32') return (realHome(home) && process.env.APPDATA) || path.join(home, 'AppData', 'Roaming');
  return (realHome(home) && process.env.XDG_CONFIG_HOME) || path.join(home, '.config');
}

function claudeDir(home) {
  return (realHome(home) && process.env.CLAUDE_CONFIG_DIR) || path.join(home, '.claude');
}

function codexDir(home) {
  return (realHome(home) && process.env.CODEX_HOME) || path.join(home, '.codex');
}

function xdgConfig(home) {
  if (process.platform === 'win32') return (realHome(home) && process.env.APPDATA) || path.join(home, 'AppData', 'Roaming');
  return (realHome(home) && process.env.XDG_CONFIG_HOME) || path.join(home, '.config');
}

export function onPath(binary) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(probe, [binary], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
  } catch {
    return '';
  }
}

const exists = (target) => fs.existsSync(target);

// `mode` is the default tool exposure. "full" lists every platform tool and is
// right for agents that defer tool schemas until needed; "lazy" lists a few
// discovery tools and is right for agents that load every schema up front.
export function agentCatalog(home = os.homedir()) {
  const devinNew = path.join(xdgConfig(home), 'devin', 'mcp_config.json');
  const devinLegacy = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      binary: 'claude',
      markers: [claudeDir(home)],
      skillsDir: path.join(claudeDir(home), 'skills'),
      mode: 'full',
      mcp: { kind: 'claude-cli', file: realHome(home) && process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json'), key: 'mcpServers', shape: 'stdio-typed' },
      pluginRegistry: path.join(claudeDir(home), 'plugins', 'installed_plugins.json'),
    },
    {
      id: 'codex',
      label: 'Codex',
      binary: 'codex',
      markers: [codexDir(home)],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      mcp: { kind: 'codex-cli', file: path.join(codexDir(home), 'config.toml') },
    },
    {
      id: 'cursor',
      label: 'Cursor',
      binary: 'cursor',
      markers: [path.join(home, '.cursor')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      mcp: { kind: 'json', file: path.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', shape: 'stdio' },
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      binary: 'gemini',
      markers: [path.join(home, '.gemini')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      mcp: { kind: 'json', file: path.join(home, '.gemini', 'settings.json'), key: 'mcpServers', shape: 'stdio' },
    },
    {
      id: 'vscode',
      label: 'VS Code (Copilot)',
      binary: 'code',
      markers: [path.join(appData(home), 'Code', 'User')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      mcp: { kind: 'json', file: path.join(appData(home), 'Code', 'User', 'mcp.json'), key: 'servers', shape: 'stdio-typed' },
    },
    {
      id: 'copilot-cli',
      label: 'GitHub Copilot CLI',
      binary: 'copilot',
      markers: [path.join(home, '.copilot')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      mcp: { kind: 'json', file: path.join(home, '.copilot', 'mcp-config.json'), key: 'mcpServers', shape: 'copilot' },
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      binary: 'opencode',
      markers: [path.join(xdgConfig(home), 'opencode')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      // OpenCode's documented default is opencode.jsonc; a plain .json is
      // also read. Whichever exists is the one to edit.
      mcp: { kind: 'json', file: [path.join(xdgConfig(home), 'opencode', 'opencode.jsonc'), path.join(xdgConfig(home), 'opencode', 'opencode.json')].find((file) => fs.existsSync(file)) || path.join(xdgConfig(home), 'opencode', 'opencode.json'), key: 'mcp', shape: 'opencode' },
    },
    {
      id: 'devin-desktop',
      label: 'Devin Desktop (Windsurf)',
      binary: 'windsurf',
      markers: [path.join(xdgConfig(home), 'devin'), path.join(home, '.codeium', 'windsurf')],
      skillsDir: path.join(home, '.agents', 'skills'),
      mode: 'lazy',
      // Machines upgraded from Windsurf may still use the old file; write to
      // whichever already exists and prefer the new location on a clean one.
      mcp: { kind: 'json', file: !exists(devinNew) && exists(devinLegacy) ? devinLegacy : devinNew, key: 'mcpServers', shape: 'stdio' },
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      binary: '',
      markers: [path.join(appData(home), 'Claude')],
      skillsDir: '',
      mode: 'lazy',
      mcp: { kind: 'json', file: path.join(appData(home), 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', shape: 'stdio' },
      manualSkill: 'Claude Desktop has no skills folder. Upload the skill archive once under Customize > Skills.',
    },
  ];
}

export function detectAgents(home = os.homedir(), { useBinaries = true } = {}) {
  return agentCatalog(home).map((agent) => {
    const byMarker = agent.markers.some(exists);
    const binaryPath = useBinaries && agent.binary ? onPath(agent.binary) : '';
    return { ...agent, detected: byMarker || Boolean(binaryPath), binaryPath };
  });
}

export function mcpEntry(shape, { command, args, env }) {
  const withEnv = env && Object.keys(env).length ? env : null;
  if (shape === 'opencode') return { type: 'local', command: [command, ...args], enabled: true, ...(withEnv ? { environment: withEnv } : {}) };
  if (shape === 'stdio-typed') return { type: 'stdio', command, args, ...(withEnv ? { env: withEnv } : {}) };
  // Copilot CLI only exposes the tools listed in `tools`.
  if (shape === 'copilot') return { type: 'stdio', command, args, tools: ['*'], ...(withEnv ? { env: withEnv } : {}) };
  return { command, args, ...(withEnv ? { env: withEnv } : {}) };
}

// An MCP entry the kit wrote runs the kit's own script in server mode. A
// "junis" entry pointing anywhere else (the web app's hosted-server snippet
// with a Bearer key, for example) belongs to the user.
export function isKitEntry(entry) {
  const text = JSON.stringify(entry ?? '');
  return /junis\.mjs/.test(text) && /"mcp"/.test(text);
}
