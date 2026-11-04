// Credential and profile storage for the Junis kit.
//
// Secrets live in one file (mode 0600) under the kit home directory, never in
// an agent's MCP config. Every agent is configured with the same secret-free
// command, and the bridge/CLI read the credential from here at run time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KitError } from './http.mjs';

export const KIT_VERSION = '0.1.0';

export const ENVIRONMENTS = {
  prod: {
    api_base: 'https://api.junis.ai/api/external',
    mcp_url: 'https://mcp.junis.ai/mcp',
    web_url: 'https://junis.ai',
  },
};

export const KEY_PATTERN = /^jns_[a-z]+_[A-Za-z0-9_-]{8,}$/;

export function kitHome() {
  return process.env.JUNIS_KIT_HOME || path.join(os.homedir(), '.junis-kit');
}

export function credentialsPath() {
  return path.join(kitHome(), 'credentials.json');
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    // A hand-edited or corrupted file must not take every command down;
    // it is treated as empty, and `logout` can remove it.
    process.stderr.write(`[junis] ${file} is not valid JSON (${err.message}); treating it as empty. Run logout to remove it.\n`);
    return null;
  }
}

// Write through a temp file + rename so a crash never leaves a half-written
// credential file behind, and never a temp file with the key in it either.
function writeJsonPrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // nothing to clean
    }
    throw err;
  }
  fs.chmodSync(file, 0o600);
}

export function loadStore() {
  const store = readJson(credentialsPath());
  if (!store || typeof store !== 'object') return { current: 'default', profiles: {} };
  return { current: store.current || 'default', profiles: store.profiles || {} };
}

export function saveStore(store) {
  writeJsonPrivate(credentialsPath(), store);
}

export function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Every request to these URLs carries the API key, so plain http is refused
// unless it stays on this machine (tests and local development).
export function assertSecureUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new KitError(`${label} is not a valid URL: ${url}`, { code: 'bad_url', hint: 'Unset the override to use the default, or give a full https URL.' });
  }
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))) return url;
  throw new KitError(`${label} must use https, got ${parsed.protocol}//${parsed.host}`, {
    code: 'insecure_url',
    hint: 'The request carries the API key. Use an https URL, or unset the override to use the default.',
  });
}

// The hosts the key may be sent to without being asked: the platform's own
// domain and this machine. Anything else (a staging copy, a proxy) needs
// JUNIS_ALLOW_CUSTOM_HOST=1, and is then named in junis_status, doctor and the
// bridge's log, so a stored or exported override cannot quietly redirect the key.
export const PLATFORM_DOMAIN = 'junis.ai';

export function isPlatformHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === PLATFORM_DOMAIN || host.endsWith(`.${PLATFORM_DOMAIN}`);
}

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase());
}

export function customHostAllowed(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.JUNIS_ALLOW_CUSTOM_HOST || '').trim());
}

// '' for a platform or loopback URL; the host name when it is anything else.
export function customHostOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  return isPlatformHost(parsed.hostname) || isLoopbackHost(parsed.hostname) ? '' : parsed.host;
}

export function assertAllowedHost(url, label) {
  const host = customHostOf(url);
  if (!host || customHostAllowed()) return url;
  throw new KitError(`${label} points at ${host}, which is not ${PLATFORM_DOMAIN} or this machine`, {
    code: 'host_not_allowed',
    hint: `The request would carry the API key. Unset the override (or run logout if the address was saved by an earlier login) to use ${PLATFORM_DOMAIN}, or set JUNIS_ALLOW_CUSTOM_HOST=1 to send the key to ${host} on purpose.`,
  });
}

// One warning naming every custom host in use, or '' when the key stays on the platform.
export function customHostWarning(profile) {
  const hosts = [...new Set([customHostOf(profile.api_base), customHostOf(profile.mcp_url), customHostOf(profile.web_url)].filter(Boolean))];
  if (!hosts.length) return '';
  return `The key is sent to ${hosts.join(', ')} instead of ${PLATFORM_DOMAIN} (JUNIS_ALLOW_CUSTOM_HOST=1).`;
}

function checkedUrl(url, label) {
  return assertAllowedHost(assertSecureUrl(normalizeUrl(url), label), label);
}

// Environment variables win over the stored profile so CI and one-off runs
// never have to touch the credential file.
export function resolveProfile(overrides = {}) {
  const store = loadStore();
  const name = overrides.profile || process.env.JUNIS_PROFILE || store.current || 'default';
  const saved = store.profiles[name] || {};
  // One public environment. JUNIS_API_BASE / JUNIS_MCP_URL / JUNIS_WEB_URL
  // (below) point the kit elsewhere; a host outside junis.ai or this machine
  // also needs JUNIS_ALLOW_CUSTOM_HOST=1.
  const envName = 'prod';
  const defaults = ENVIRONMENTS.prod;
  // Stored URLs belong to the environment they were saved for; a profile saved
  // for a former environment falls back to the defaults.
  // A login passes storedUrls: false so only this run's overrides count: a plain
  // login after an override login goes back to the defaults instead of sending
  // the new key to the old host (the bridge keeps what the last login saved).
  const stored = overrides.storedUrls !== false && (!saved.env || saved.env === envName) ? saved : {};
  return {
    name,
    env: envName,
    api_key: overrides.api_key || process.env.JUNIS_API_KEY || saved.api_key || '',
    key_source: overrides.api_key ? 'flag' : process.env.JUNIS_API_KEY ? 'env' : saved.api_key ? 'file' : 'none',
    // Checked in the order the value was chosen: a saved address that is no longer
    // allowed fails with the same message as an override, never a silent default.
    api_base: checkedUrl(overrides.api_base || process.env.JUNIS_API_BASE || stored.api_base || defaults.api_base, 'JUNIS_API_BASE'),
    mcp_url: checkedUrl(overrides.mcp_url || process.env.JUNIS_MCP_URL || stored.mcp_url || defaults.mcp_url, 'JUNIS_MCP_URL'),
    web_url: checkedUrl(overrides.web_url || process.env.JUNIS_WEB_URL || stored.web_url || defaults.web_url, 'JUNIS_WEB_URL'),
    organization_id: overrides.organization_id || process.env.JUNIS_ORG_ID || saved.organization_id || '',
    organization_name: saved.organization_name || '',
    organization_slug: saved.organization_slug || '',
    saved_at: saved.saved_at || '',
  };
}

// A profile named for one call, such as a partner key kept next to the user's
// own key. Its stored key and organization are used as saved: JUNIS_API_KEY
// and JUNIS_ORG_ID describe the profile in use and must not leak into this one.
export function resolveStoredProfile(name) {
  const store = loadStore();
  const saved = Object.hasOwn(store.profiles, name) ? store.profiles[name] : null;
  if (!saved?.api_key) {
    throw new KitError(`No key is stored under the profile "${name}"`, {
      code: 'unknown_profile',
      hint: `The user stores one with \`login --profile ${name} --from-clipboard\` in a terminal. Stored profiles: ${Object.keys(store.profiles).join(', ') || 'none'}.`,
    });
  }
  const profile = resolveProfile({ profile: name, api_key: saved.api_key });
  return { ...profile, key_source: 'file', organization_id: saved.organization_id || '' };
}

// Read-modify-write of the store under a lock file, so two logins finishing at
// the same moment (for different profiles) cannot drop each other's key.
function withStoreLock(fn) {
  const lock = `${credentialsPath()}.lock`;
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  } catch (err) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(err.code)) return fn(); // a read-only folder: nothing to coordinate
    throw err;
  }
  // The lock is held for milliseconds; a long wait means a process died holding it.
  const deadline = Date.now() + 3_000;
  let held = false;
  while (!held) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx', 0o600));
      held = true;
    } catch (err) {
      if (['EACCES', 'EPERM', 'EROFS'].includes(err.code)) return fn();
      if (err.code !== 'EEXIST') throw err;
      try {
        // A lock older than 10 seconds was left by a process that died. It is moved
        // aside under a unique name, so only one waiting process breaks a given lock.
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) {
          const aside = `${lock}.${process.pid}.${Date.now()}.stale`;
          fs.renameSync(lock, aside);
          fs.rmSync(aside, { force: true });
        }
      } catch {
        // gone already, or another process moved it first
      }
      if (Date.now() > deadline) break; // never block a login for good: go ahead without it
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    if (held) fs.rmSync(lock, { force: true });
  }
}

export function saveProfile(name, fields, { makeCurrent = false } = {}) {
  return withStoreLock(() => saveProfileUnlocked(name, fields, { makeCurrent }));
}

function saveProfileUnlocked(name, fields, { makeCurrent }) {
  const store = loadStore();
  const next = { ...(store.profiles[name] || {}), ...fields, saved_at: new Date().toISOString() };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  store.profiles[name] = next;
  // Saving under another name keeps a second key without taking over: the
  // profile in use changes only when it has no key of its own — or when the
  // caller stores the user's own key (a plain login, makeCurrent).
  if (makeCurrent || store.current === name || !store.profiles[store.current]?.api_key) store.current = name;
  saveStore(store);
  return next;
}

export function deleteProfile(name) {
  return withStoreLock(() => deleteProfileUnlocked(name));
}

function deleteProfileUnlocked(name) {
  const store = loadStore();
  // An unreadable file counts as a profile to remove.
  const existed = Boolean(store.profiles[name]) || (Object.keys(store.profiles).length === 0 && fs.existsSync(credentialsPath()));
  delete store.profiles[name];
  // Removing the key in use leaves no key in use: another stored key (such as
  // a partner key) is never picked up without being asked for.
  if (Object.keys(store.profiles).length === 0) {
    try {
      fs.unlinkSync(credentialsPath());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  } else {
    saveStore(store);
  }
  return existed;
}

// Only ever show enough of a key to recognise it.
export function maskKey(key) {
  if (!key) return '';
  const match = /^(jns_[a-z]+_)(.*)$/.exec(key);
  if (!match) return '***';
  return `${match[1]}${match[2].slice(0, 4)}…(${key.length} chars)`;
}

export function isUserLevelKey(key) {
  return /^jns_user_/.test(key || '');
}

export function loginUrl(profile) {
  return `${profile.web_url}/settings/api-keys`;
}
