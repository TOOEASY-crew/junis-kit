// Spawn the real CLI and the real stdio bridge for tests, each against a
// throwaway kit home so no test can read or write the developer's credentials.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const SKILL_DIR = path.join(REPO, 'skills', 'junis');
export const CLI = path.join(SKILL_DIR, 'scripts', 'junis.mjs');

export function tempDir(prefix = 'junis-kit-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const name of ['JUNIS_API_KEY', 'JUNIS_ORG_ID', 'JUNIS_PROFILE']) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

export function runCli(args, { env = {}, input = '', kitHome } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: cleanEnv({ JUNIS_KIT_HOME: kitHome || tempDir(), ...env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout, stderr, json });
    });
    child.stdin.end(input);
  });
}

export function startBridge({ env = {}, kitHome, lazy = false } = {}) {
  const child = spawn(process.execPath, [CLI, 'mcp', ...(lazy ? ['--lazy'] : [])], {
    env: cleanEnv({ JUNIS_KIT_HOME: kitHome || tempDir(), ...env }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map();
  const notifications = [];
  const raw = [];
  let buffer = '';
  let nextId = 1;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      raw.push(line);
      const message = JSON.parse(line);
      if (message.id !== undefined && message.id !== null && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      } else {
        notifications.push(message);
      }
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    notifications,
    raw,
    send,
    sendRaw: (text) => child.stdin.write(`${text}\n`),
    request(method, params = {}, id = nextId++) {
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method, params = {}) {
      send({ jsonrpc: '2.0', method, params });
    },
    async callTool(name, args = {}, meta) {
      const response = await this.request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
      const text = response.result?.content?.[0]?.text ?? '';
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { response, isError: Boolean(response.result?.isError), data };
    },
    // Safe to call twice (a test's own close, then the file's cleanup): an
    // already closed bridge resolves at once, and a stuck one is killed.
    close() {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}
