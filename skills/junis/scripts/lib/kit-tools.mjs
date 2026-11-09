// Tools the kit adds on top of the hosted Junis tools. They are served by the
// stdio bridge and are also what the CLI subcommands call, so the two entry
// points cannot drift apart.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  KEY_PATTERN,
  KIT_VERSION,
  customHostWarning,
  isUserLevelKey,
  kitHome,
  loadStore,
  loginUrl,
  maskKey,
  resolveProfile,
  resolveStoredProfile,
  saveProfile,
} from './config.mjs';
import { ExternalApi } from './api.mjs';
import { classifyToolError, explainError } from './errors.mjs';
import { KitError, httpRequest, parseJsonSafe } from './http.mjs';
import { lintInstruction } from './lint.mjs';
import { shellWord } from './args.mjs';
import { RemoteMcp, categorize, firstLine, searchTools, unwrapToolResult } from './mcp-remote.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_CACHE_MS = 5 * 60_000;

let toolCache = { url: '', at: 0, tools: [] };

export function remoteFor(profile) {
  return new RemoteMcp({ url: profile.mcp_url, apiKey: profile.api_key, organizationId: profile.organization_id });
}

export function apiFor(profile) {
  return new ExternalApi({ apiBase: profile.api_base, apiKey: profile.api_key, organizationId: profile.organization_id });
}

// The stored profile, acting in a named organization (a UUID) for this call
// only, so work done in organization B is not run or read in the default A.
// A named profile (for example "partner") is used for this call only.
export function profileForOrganization(organizationId, { profile: profileName } = {}) {
  const profile = profileName ? resolveStoredProfile(String(profileName)) : resolveProfile();
  if (organizationId === undefined || organizationId === null || organizationId === '') return profile;
  if (!UUID.test(String(organizationId))) {
    throw new KitError(`organization_id must be a UUID, got "${organizationId}"`, {
      code: 'bad_organization_id',
      hint: 'Names and slugs are not ids. Resolve the UUID with list_organizations first.',
    });
  }
  return { ...profile, organization_id: String(organizationId) };
}

// The catalogue is public and identical for every key, so it is cached per
// server URL and survives a login or an organization change.
export async function loadRemoteTools(profile, { refresh = false, signal } = {}) {
  const fresh = toolCache.url === profile.mcp_url && Date.now() - toolCache.at < TOOL_CACHE_MS;
  if (!refresh && fresh && toolCache.tools.length) return toolCache.tools;
  const tools = await remoteFor(profile).listTools({ signal });
  toolCache = { url: profile.mcp_url, at: Date.now(), tools };
  return tools;
}

export function resetToolCache() {
  toolCache = { url: '', at: 0, tools: [] };
}

export function setupSteps(profile) {
  return {
    logged_in: false,
    what_to_tell_the_user: [
      `Open ${loginUrl(profile)} and sign in (a Junis account is created on first sign-in). Using Junis from outside the web app needs a Basic or Pro plan (${profile.web_url}/subscription).`,
      'Press "New Key", press "Coding agents (recommended)", give it a name such as "coding agent" and create it, then press the copy button next to the new key. Leave the automatic "junis-magic-auto" key in place: it is a key the platform uses.',
      'Come back and say it is copied. Do not paste the key into the chat.',
    ],
    then: 'Run the connect step (CLI: `login --from-clipboard`, tool: junis_connect). It reads the key from the clipboard, verifies it and stores it locally.',
    preferred: 'Nothing to copy: ask for a key through the browser (tool: junis_connect with method "browser"; CLI: `login --browser`). It returns a link where the signed-in user approves; then call it again to finish. Works without a clipboard.',
    alternatives: [
      'Terminal with a hidden prompt: `login`',
      'Environment variable for CI: JUNIS_API_KEY',
    ],
    login_url: loginUrl(profile),
  };
}

export async function fetchOrganizations(profile, { signal } = {}) {
  // Discovery must not carry an organization header: an id the key cannot
  // access would turn the discovery call itself into a 403.
  const remote = new RemoteMcp({ url: profile.mcp_url, apiKey: profile.api_key });
  const result = unwrapToolResult(await remote.callTool('list_organizations', {}, { signal }));
  if (!result.ok) {
    throw new KitError(result.error, { code: classifyToolError(result.error), hint: explainError(result.error).hint || undefined });
  }
  const data = result.data;
  const list = Array.isArray(data) ? data : data?.organizations || data?.items || [];
  return list.map((org) => ({
    id: org.id || org.organization_id || '',
    name: org.name || '',
    slug: org.slug || '',
    role: org.role || org.my_role || '',
  }));
}

export { classifyToolError, explainError } from './errors.mjs';

export async function status({ check = true, signal } = {}) {
  const profile = resolveProfile();
  const hostWarning = customHostWarning(profile);
  const base = {
    kit_version: KIT_VERSION,
    environment: profile.env,
    api_base: profile.api_base,
    mcp_url: profile.mcp_url,
    ...(hostWarning ? { warning: hostWarning } : {}),
  };
  const others = Object.keys(loadStore().profiles).filter((name) => name !== profile.name);
  if (!profile.api_key) return { ...base, ...setupSteps(profile), ...(others.length ? { other_profiles: others } : {}) };

  const out = {
    ...base,
    logged_in: true,
    key: maskKey(profile.api_key),
    key_type: isUserLevelKey(profile.api_key) ? 'user' : 'organization',
    key_source: profile.key_source,
    profile: profile.name,
    ...(others.length ? { other_profiles: others } : {}),
    default_organization: profile.organization_id
      ? { id: profile.organization_id, name: profile.organization_name, slug: profile.organization_slug }
      : null,
  };
  if (!check) return out;

  try {
    if (!isUserLevelKey(profile.api_key)) {
      // Organization keys cannot list organizations; listing agents proves the key works.
      await apiFor(profile).request('GET', '/agents', { signal });
      out.verified = true;
      out.organizations = [];
      out.next_step = 'This organization-level key can run agents. Building and managing squads needs a user-level key (jns_user_…).';
      return out;
    }
    const organizations = await fetchOrganizations(profile, { signal });
    out.verified = true;
    out.organizations = organizations;
    if (!profile.organization_id && organizations.length > 1) {
      out.next_step = 'Several organizations are available. Ask which one to work in, then set it with `org use`.';
    }
  } catch (err) {
    out.verified = false;
    out.problem = err.message;
    if (err.code === 'unauthorized') {
      out.next_step = `The stored key was rejected. Get a current key at ${loginUrl(profile)} and connect again.`;
    } else if (!isUserLevelKey(profile.api_key)) {
      out.next_step = 'This is an organization-level key. It can run agents, but building and managing squads needs a user-level key (jns_user_…).';
    }
  }
  return out;
}

function readClipboard() {
  const attempts =
    process.platform === 'darwin'
      ? [['pbpaste', []]]
      : process.platform === 'win32'
        ? [['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard']]]
        : [
            ['wl-paste', ['--no-newline']],
            ['xclip', ['-selection', 'clipboard', '-o']],
            ['xsel', ['--clipboard', '--output']],
          ];
  for (const [command, args] of attempts) {
    try {
      return execFileSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // try the next clipboard tool
    }
  }
  throw new KitError('No clipboard tool is available on this machine', {
    code: 'no_clipboard',
    hint: 'Use the hidden terminal prompt (`login`) or set JUNIS_API_KEY instead.',
  });
}

// Mirrors the readers: whatever tool could read the key can clear it.
function clearClipboard() {
  const attempts =
    process.platform === 'darwin'
      ? [['pbcopy', [], '']]
      : process.platform === 'win32'
        ? [['powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard -Value $null'], undefined]]
        : [
            ['wl-copy', ['--clear'], undefined],
            ['xclip', ['-selection', 'clipboard'], ''],
            ['xsel', ['--clipboard', '--clear'], undefined],
          ];
  for (const [command, args, input] of attempts) {
    try {
      execFileSync(command, args, { input, timeout: 5000, stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'] });
      return true;
    } catch {
      // try the next clipboard tool
    }
  }
  return false;
}

export function extractKey(text) {
  const candidate = String(text || '').trim();
  if (KEY_PATTERN.test(candidate)) return candidate;
  // Tolerate a copied line such as "Authorization: Bearer jns_user_…".
  const match = /jns_[a-z]+_[A-Za-z0-9_-]{8,}/.exec(candidate);
  return match ? match[0] : '';
}

// Verify first, store second: a rejected key must never replace a working one.
export async function connect({ key, profileName, keepClipboard = false, fromClipboard = false, signal } = {}) {
  let apiKey = key ? extractKey(key) : '';
  if (fromClipboard) {
    apiKey = extractKey(readClipboard());
    if (!apiKey) {
      throw new KitError('The clipboard does not contain a Junis API key', {
        code: 'no_key_in_clipboard',
        hint: 'Ask the user to press the copy button next to the key and try again. Keys start with jns_.',
      });
    }
  }
  if (!apiKey) throw new KitError('That does not look like a Junis API key (keys start with jns_)', { code: 'bad_key' });

  // A plain login stores the user's own key: the "default" profile, made the one
  // in use. Only a named profile (--profile or JUNIS_PROFILE) stores a second key
  // next to it — so a partner key stored first is never overwritten by a later
  // plain login (before: the plain login saved into whichever profile was current).
  const explicitProfile = profileName || process.env.JUNIS_PROFILE || '';
  const current = resolveProfile({ profile: explicitProfile || 'default', storedUrls: false });
  const candidate = { ...current, api_key: apiKey, organization_id: '' };
  const userLevel = isUserLevelKey(apiKey);

  // Once the key has been read from the clipboard it is cleared whatever
  // happens next; a rejected key must not linger there either.
  let cleared = null;
  const clearIfRead = () => {
    if (fromClipboard && !keepClipboard && cleared === null) cleared = clearClipboard();
  };

  let organizations = [];
  try {
    if (userLevel) {
      organizations = await fetchOrganizations(candidate, { signal });
    } else {
      // Organization keys cannot list organizations; listing agents proves the key works.
      await apiFor(candidate).request('GET', '/agents', { signal });
    }
  } catch (err) {
    clearIfRead();
    throw err;
  }

  const keepOrg = organizations.find((org) => org.id === current.organization_id);
  const chosen = keepOrg || (organizations.length === 1 ? organizations[0] : null);
  saveProfile(current.name, {
    env: current.env,
    api_key: apiKey,
    api_base: current.api_base,
    mcp_url: current.mcp_url,
    web_url: current.web_url,
    organization_id: chosen?.id || '',
    organization_name: chosen?.name || '',
    organization_slug: chosen?.slug || '',
  }, { makeCurrent: !explicitProfile || explicitProfile === 'default' });
  clearIfRead();
  const inUse = loadStore().current === current.name;

  return {
    connected: true,
    key: maskKey(apiKey),
    key_type: userLevel ? 'user' : 'organization',
    environment: current.env,
    profile: current.name,
    in_use: inUse,
    organizations,
    default_organization: chosen,
    clipboard_cleared: cleared === true,
    ...(fromClipboard && !keepClipboard && cleared !== true
      ? { warning: 'The clipboard could not be cleared, so the key is still in it. Ask the user to copy something else.' }
      : {}),
    next_step: !inUse
      ? `Stored as the profile "${current.name}"; the kit keeps using "${loadStore().current}". Use this key for one call with profile="${current.name}" on junis_api, or --profile ${shellWord(current.name)} on a command.`
      : chosen
        ? `Ready. Working in "${chosen.name}".`
        : organizations.length
          ? 'Ask the user which organization to work in, then set it with `org use <name>`.'
          : userLevel
            ? 'No organization yet. Offer to create one.'
            : 'Ready to run agents. Managing squads needs a user-level key.',
  };
}

// Browser approval (the platform's key request flow): the kit asks
// for a key, the user approves it in the browser where they are signed in,
// and the kit collects it with a one-time verifier. Nothing is copied or
// pasted, so it also works in remote shells and containers without a
// clipboard. The request asks for every permission the skill uses (the web
// app's "Coding agents" preset minus two unused admin scopes); the user sees
// them before approving.
// The permissions every platform version that has the key request flow knows.
// It is what the kit falls back to when a platform refuses a newer one and
// does not say which permissions it offers.
export const KEY_REQUEST_CORE_SCOPES = [
  'orchestrator:invoke', 'orchestrator:stream', 'sessions:read', 'sessions:messages', 'agents:list', 'agents:invoke',
  'organizations:read', 'organizations:manage', 'agents:manage', 'relationships:manage', 'mcp:manage', 'datastores:manage',
  'sessions:manage', 'schedules:manage', 'skills:manage', 'composio:manage', 'content:read', 'content:retry',
  'rag:upload', 'rag:read', 'rag:delete', 'brain:read', 'brain:manage', 'wiki:read', 'wiki:manage', 'secrets:manage',
];
// Permissions added to the platform after the core list. A platform that does
// not know one yet refuses the whole request; startBrowserLogin then asks again without it.
export const KEY_REQUEST_NEWER_SCOPES = ['actions:read', 'actions:run', 'actions:manage'];
export const KEY_REQUEST_SCOPES = [...KEY_REQUEST_CORE_SCOPES, ...KEY_REQUEST_NEWER_SCOPES];

// The list to ask for after the platform refused the full one for a
// permission it does not know (400 `invalid_scopes`): the permissions it says
// it offers, in the kit's order, or the core list when it names none. null
// when the refusal was about something else, or when nothing narrower is left.
export function reducedKeyRequestScopes(refusal, sent = KEY_REQUEST_SCOPES) {
  const detail = refusal?.detail;
  if (!detail || typeof detail !== 'object' || detail.error !== 'invalid_scopes') return null;
  const offered = Array.isArray(detail.available_scopes) ? detail.available_scopes.filter((scope) => typeof scope === 'string') : [];
  const reduced = offered.length ? sent.filter((scope) => offered.includes(scope)) : sent.filter((scope) => KEY_REQUEST_CORE_SCOPES.includes(scope));
  return reduced.length && reduced.length < sent.length ? reduced : null;
}

// Narrower requests (`login --browser --scopes <preset>`): a key that only
// reads, or one that runs squads and reads results but cannot change them.
export const KEY_REQUEST_PRESETS = {
  'read-only': ['sessions:read', 'sessions:messages', 'agents:list', 'organizations:read', 'content:read', 'rag:read', 'brain:read', 'wiki:read'],
  operator: ['orchestrator:invoke', 'orchestrator:stream', 'agents:invoke', 'sessions:read', 'sessions:messages', 'agents:list', 'organizations:read', 'content:read', 'content:retry', 'rag:read', 'brain:read', 'wiki:read'],
  all: KEY_REQUEST_SCOPES,
};

// A preset name or a comma-separated list of permissions; null means the default (every permission).
export function parseKeyRequestScopes(value) {
  if (value === undefined || value === null || value === true || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (Object.hasOwn(KEY_REQUEST_PRESETS, text)) return text === 'all' ? null : [...KEY_REQUEST_PRESETS[text]];
  const scopes = [...new Set(text.split(',').map((scope) => scope.trim()).filter(Boolean))];
  const unknown = scopes.filter((scope) => !KEY_REQUEST_SCOPES.includes(scope));
  if (!scopes.length || unknown.length) {
    throw new KitError(unknown.length ? `Unknown permission(s): ${unknown.join(', ')}` : 'No permission named', {
      code: 'bad_scopes',
      hint: `Use a preset (${Object.keys(KEY_REQUEST_PRESETS).join(', ')}) or a comma-separated list of: ${KEY_REQUEST_SCOPES.join(', ')}.`,
    });
  }
  return scopes;
}

const sameScopes = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// One waiting request per profile, so a partner login never replaces the
// user's own (or the other way round). '' and 'default' are the same profile.
function profileKey(name) {
  const value = String(name || '').trim();
  return !value || value === 'default' ? 'default' : value;
}

// A hash of the name, so names that differ only in punctuation, letters outside
// ASCII or case (on a case-insensitive disk) never share a file.
function pendingLoginPath(profile) {
  const key = profileKey(profile);
  if (key === 'default') return path.join(kitHome(), 'pending-login.json');
  return path.join(kitHome(), `pending-login.${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}.json`);
}

// The platform keeps an approved key this long for collection (requests that
// carry a poll verifier), so the request is kept locally that long past its
// approval window.
const COLLECT_MS = 300_000;

function readPendingFile(profile) {
  try {
    const data = JSON.parse(fs.readFileSync(pendingLoginPath(profile), 'utf8'));
    if (!data || typeof data !== 'object') return null;
    // A file for another profile (an older kit kept every request in one file) is not this profile's.
    if (profileKey(data.profile) !== profileKey(profile)) return null;
    // A hand-edited or damaged file must not make the wait loop spin.
    return { ...data, interval: Math.max(2, Number(data.interval) || 3), expires_at: Number(data.expires_at) || 0 };
  } catch {
    return null;
  }
}

// The request waiting for approval (or for collection), or a key that arrived
// but is not stored yet. A request past its collection window is removed (it
// holds the poll verifier); a received key is kept until it is stored,
// whatever its age. The marker left after a stored key is not a request.
function readPendingLogin(profile) {
  const data = readPendingFile(profile);
  if (!data) return null;
  if (data.api_key) return data;
  if (Date.now() >= data.expires_at + COLLECT_MS) {
    fs.rmSync(pendingLoginPath(profile), { force: true });
    return null;
  }
  return data.stored ? null : data;
}

function writePendingLogin(data) {
  fs.mkdirSync(kitHome(), { recursive: true, mode: 0o700 });
  const file = pendingLoginPath(data.profile);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// Removes the request this process worked on, never a newer one another
// process started meanwhile, and never a received key that is not stored yet
// (only its storing, --restart and logout remove that).
function clearPendingLogin(profile, deviceCode) {
  const current = readPendingFile(profile);
  if (!current) return;
  if (deviceCode && current.device_code !== deviceCode) return;
  if (current.api_key) return;
  fs.rmSync(pendingLoginPath(profile), { force: true });
}

// After the key is stored: a marker without secrets, so another session still
// waiting on the same request (whose poll now answers 410) learns it succeeded.
function markStored(pending) {
  const current = readPendingFile(pending.profile);
  if (current && current.device_code !== pending.device_code) return;
  writePendingLogin({ device_code: pending.device_code, stored: true, profile: pending.profile || '', base: pending.base, expires_at: pending.expires_at });
}

// A request another session finished: report the connection instead of a new link.
function connectedFromMarker(marker) {
  if (!marker?.stored) return null;
  const profile = resolveProfile({ profile: profileKey(marker.profile), storedUrls: false });
  if (!profile.api_key) return null;
  return { connected: true, method: 'browser', key: maskKey(profile.api_key), profile: profile.name, note: 'Another session collected the approved key and stored it here.' };
}

// logout (for its profile) and uninstall --purge (all of them): a waiting
// request and a received key go too.
export function forgetBrowserLogin(profileName) {
  const file = pendingLoginPath(profileName);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Leave a request an older kit wrote there for another profile.
    if (data && typeof data === 'object' && profileKey(data.profile) !== profileKey(profileName)) return;
  } catch {
    // missing or unreadable: remove whatever is there
  }
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    // a read-only kit folder: there is nothing this process could have stored there either
    if (!['EACCES', 'EPERM', 'EROFS'].includes(err.code)) throw err;
  }
}

// The request currently waiting for this profile, to show its link.
export function currentBrowserLogin(profileName) {
  return readPendingLogin(profileName || process.env.JUNIS_PROFILE || '');
}

// https://api.junis.ai/api/external → https://api.junis.ai/api/user/api-keys/device
function keyRequestBase(profile) {
  const base = new URL(profile.api_base);
  base.pathname = base.pathname.replace(/\/external\/?$/, '/user/api-keys/device');
  return base.toString().replace(/\/+$/, '');
}

async function requestJson(method, url, { body, headers = {}, signal } = {}) {
  const response = await httpRequest(method, url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 30_000,
    signal,
  });
  return { status: response.status, data: parseJsonSafe(response.text) };
}

function sleepFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('cancelled'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal.reason || new Error('cancelled'));
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

// Starts a request, or returns the one still waiting for approval when it was
// made for the same profile and server.
export async function startBrowserLogin({ profileName, restart = false, scopes = null, signal } = {}) {
  const wanted = profileName || process.env.JUNIS_PROFILE || '';
  const profile = resolveProfile({ profile: profileKey(wanted), storedUrls: false });
  const base = keyRequestBase(profile);
  // A request still waiting is continued only when it asks for the same permissions.
  const requested = scopes ?? null;
  if (!restart) {
    // Another session connected this profile moments ago: report that, not a new link.
    const marker = readPendingFile(wanted);
    if (marker?.stored && marker.base === base && Date.now() < marker.expires_at + COLLECT_MS && connectedFromMarker(marker)) {
      return { ...marker, reused: true };
    }
  }
  const pending = restart ? null : readPendingLogin(wanted);
  if (pending?.api_key) return { ...pending, reused: true };
  if (pending && pending.base === base && sameScopes(pending.scopes, requested)) {
    if (Date.now() < pending.expires_at) return { ...pending, reused: true };
    // The approval window is over; a key approved in time may still wait to be collected.
    const polled = await pollOnce(pending, signal);
    if (polled.status === 200 && polled.data?.api_key) {
      const received = { ...pending, api_key: polled.data.api_key };
      writePendingLogin(received);
      return { ...received, reused: true };
    }
    if (RETRY_STATUS(polled.status)) return { ...pending, reused: true };
  }
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const ask = (list) => requestJson('POST', `${base}/start`, { body: { client_name: 'Junis kit', ...(list ? { scopes: list } : {}), poll_challenge: challenge }, signal });
  let started = await ask(requested || KEY_REQUEST_SCOPES);
  if (started.status === 400 && requested) {
    // The user asked for these permissions by name: a wider key is never requested in their place.
    throw new KitError(`The platform did not accept the requested permissions (HTTP 400)`, {
      code: 'bad_scopes',
      hint: `Use a preset (${Object.keys(KEY_REQUEST_PRESETS).join(', ')}) or leave --scopes out for the default permissions.`,
    });
  }
  // A platform that does not know one of the permissions yet refuses the whole list (400 invalid_scopes):
  // ask once more for the ones it offers, so the key is as wide as that platform allows.
  const reduced = started.status === 400 ? reducedKeyRequestScopes(started.data) : null;
  if (reduced) started = await ask(reduced);
  // Any other 400, or a second refusal: ask for the platform's defaults instead.
  if (started.status === 400) started = await ask(null);
  if (started.status !== 200 || !started.data?.device_code) {
    throw new KitError(`The key request could not be started (HTTP ${started.status})`, {
      code: 'browser_login_unavailable',
      hint: 'Use the clipboard instead: the user copies a key from the API keys page, then run login --from-clipboard (tool: junis_connect).',
    });
  }
  // Another session may have started a request for this profile meanwhile: show that one (ours just expires).
  const raced = readPendingLogin(wanted);
  if (raced && !raced.api_key && raced.base === base && sameScopes(raced.scopes, requested)) return { ...raced, reused: true };
  const pendingLogin = {
    device_code: started.data.device_code,
    verifier,
    verification_uri: started.data.verification_uri,
    interval: Math.max(2, Number(started.data.interval) || 3),
    expires_at: Date.now() + Math.max(60, Number(started.data.expires_in) || 600) * 1000,
    profile: wanted,
    base,
    ...(requested ? { scopes: requested } : {}),
  };
  writePendingLogin(pendingLogin);
  return { ...pendingLogin, reused: false };
}

function browserSteps(pending) {
  return {
    logged_in: false,
    status: 'waiting_for_approval',
    verification_uri: pending.verification_uri,
    what_to_tell_the_user: [
      `Open ${pending.verification_uri} (sign in to Junis if asked; using Junis from outside the web app needs a Basic or Pro plan).`,
      'Check the permissions the kit asks for, press Approve, and come back. Nothing needs to be copied.',
    ],
    expires_in: Math.max(0, Math.round((pending.expires_at - Date.now()) / 1000)),
  };
}

// Stores a key that arrived, exactly like a pasted one (verified first). No
// cancellation signal: a call cancelled halfway must not lose the only copy.
async function storeReceivedKey(pending) {
  try {
    // The profile the request was made for, whatever JUNIS_PROFILE this run has.
    const out = await connect({ key: pending.api_key, profileName: pending.profile || 'default' });
    markStored(pending);
    return { ...out, method: 'browser' };
  } catch (err) {
    // Another session may have stored the same key meanwhile.
    const current = readPendingFile(pending.profile);
    if (current?.stored && current.device_code === pending.device_code) {
      const done = connectedFromMarker(current);
      if (done) return done;
    }
    throw new KitError(`The approved key arrived but could not be checked: ${err.message}`, {
      code: 'key_not_checked',
      hint: 'The key is kept on this machine (owner-only). Run login --browser again (tool: junis_connect with method "browser") to store it. If it keeps failing, start over with login --browser --restart and revoke the unused "Junis kit-…" key on the API keys page.',
    });
  }
}

// Still waiting (202), or a busy or restarting server (429, 5xx, no answer): poll again.
function RETRY_STATUS(status) {
  return status === 0 || status === 202 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function pollOnce(pending, signal) {
  try {
    return await requestJson('GET', `${pending.base}/poll?code=${encodeURIComponent(pending.device_code)}`, {
      headers: { 'X-Poll-Verifier': pending.verifier },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: 0 };
  }
}

// The platform hands a key over once. When this session's poll finds the
// request gone, another session waiting on it (a second agent window, the
// command line) may have collected it: look before calling it expired.
async function settledElsewhere(pending, signal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = readPendingFile(pending.profile);
    if (current?.device_code === pending.device_code) {
      if (current.api_key) return storeReceivedKey(current);
      const done = connectedFromMarker(current);
      if (done) return done;
    }
    if (attempt === 0) await sleepFor(1500, signal);
  }
  return null;
}

// Waits up to waitSeconds for the approval, then stores the key. Returns the
// steps again while still waiting.
export async function finishBrowserLogin({ waitSeconds = 60, signal, profileName } = {}) {
  const wanted = profileName || process.env.JUNIS_PROFILE || '';
  const done = connectedFromMarker(readPendingFile(wanted));
  if (done) return done;
  const pending = readPendingLogin(wanted);
  if (!pending) {
    throw new KitError('No key request is waiting', { code: 'no_pending_login', hint: 'Start one first: login --browser (tool: junis_connect with method "browser").' });
  }
  // The key is checked against the server it was made on.
  if (keyRequestBase(resolveProfile({ profile: profileKey(pending.profile), storedUrls: false })) !== pending.base) {
    throw new KitError('The key request was started for another Junis server', {
      code: 'login_host_changed',
      hint: 'Run it with the same JUNIS_ENV / JUNIS_API_BASE as when it started, or start a new one: login --browser --restart.',
    });
  }
  if (pending.api_key) return storeReceivedKey(pending);
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let delay = pending.interval * 1000;
  for (;;) {
    const polled = await pollOnce(pending, signal);
    if (polled.status === 200 && polled.data?.api_key) {
      // Kept on disk before anything else can fail: the platform hands it over once.
      const received = { ...pending, api_key: polled.data.api_key };
      writePendingLogin(received);
      return storeReceivedKey(received);
    }
    const refusal = polled.status === 403 ? polled.data?.detail?.error : undefined;
    if (refusal === 'access_denied') {
      clearPendingLogin(pending.profile, pending.device_code);
      throw new KitError('The user declined the key request', { code: 'access_denied', hint: 'Start again only if the user wants to connect: login --browser.' });
    }
    if (refusal === 'invalid_verifier') {
      clearPendingLogin(pending.profile, pending.device_code);
      throw new KitError('The platform did not accept this machine\'s proof for the key request', {
        code: 'login_invalid',
        hint: 'Start a new request: login --browser --restart.',
      });
    }
    // Any other 403 comes from something in between (a proxy), not from the platform: try again.
    if (polled.status !== 403 && !RETRY_STATUS(polled.status)) {
      const elsewhere = await settledElsewhere(pending, signal);
      if (elsewhere) return elsewhere;
      clearPendingLogin(pending.profile, pending.device_code);
      const connected = Boolean(resolveProfile({ profile: profileKey(pending.profile), storedUrls: false }).api_key);
      throw new KitError(`The key request is no longer valid (HTTP ${polled.status})`, {
        code: 'login_expired',
        hint: connected
          ? 'This machine is already connected (see junis_status); nothing more is needed for this request.'
          : 'Start a new one: login --browser --restart. If the user had approved it, they can revoke the unused "Junis kit-…" key on the API keys page.',
      });
    }
    // Too many polls (429) slows down; anything else keeps the platform's interval.
    delay = polled.status === 429 ? Math.min(delay * 2, 15_000) : pending.interval * 1000;
    if (!Number.isFinite(delay) || delay < 1000) delay = 3000;
    if (Date.now() + delay > deadline) return browserSteps(pending);
    await sleepFor(delay, signal);
  }
}

export function pendingBrowserSteps(pending) {
  return browserSteps(pending);
}


export async function useOrganization(selector, { signal } = {}) {
  const profile = resolveProfile();
  if (!profile.api_key) throw new KitError('Not logged in', { code: 'not_logged_in' });
  if (!isUserLevelKey(profile.api_key)) {
    throw new KitError('An organization key is bound to its organization', {
      code: 'organization_key',
      hint: 'Working in another organization needs a user-level key (jns_user_…).',
    });
  }
  const organizations = await fetchOrganizations(profile, { signal });
  const wanted = String(selector || '').trim().toLowerCase();
  const exact = organizations.filter(
    (org) => org.id.toLowerCase() === wanted || org.slug.toLowerCase() === wanted || org.name.toLowerCase() === wanted,
  );
  const matches = exact.length ? exact : organizations.filter((org) => `${org.name} ${org.slug}`.toLowerCase().includes(wanted));
  if (matches.length !== 1) {
    throw new KitError(
      matches.length ? `"${selector}" matches ${matches.length} organizations` : `No organization matches "${selector}"`,
      { code: 'organization_not_resolved', detail: { candidates: (matches.length ? matches : organizations).map((org) => ({ name: org.name, slug: org.slug })) } },
    );
  }
  const [org] = matches;
  saveProfile(profile.name, { organization_id: org.id, organization_name: org.name, organization_slug: org.slug });
  return { default_organization: org };
}

export async function findTools({ query = '', category = '', limit = 25, signal } = {}) {
  const profile = resolveProfile();
  const tools = await loadRemoteTools(profile, { signal });
  const matches = searchTools(tools, { query, category });
  const categories = {};
  for (const tool of tools) categories[categorize(tool.name)] = (categories[categorize(tool.name)] || 0) + 1;
  return {
    total: tools.length,
    shown: Math.min(matches.length, limit),
    matched: matches.length,
    categories,
    tools: matches.slice(0, limit).map((entry) => ({
      name: entry.tool.name,
      category: entry.category,
      summary: firstLine(entry.tool.description),
    })),
  };
}

export async function describeTool(name, { signal } = {}) {
  const profile = resolveProfile();
  const tools = await loadRemoteTools(profile, { signal });
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    const near = searchTools(tools, { query: name.replace(/_/g, ' ') }).slice(0, 5).map((entry) => entry.tool.name);
    throw new KitError(`There is no tool named "${name}"`, { code: 'unknown_tool', detail: { did_you_mean: near } });
  }
  return { name: tool.name, category: categorize(tool.name), description: tool.description, input_schema: tool.inputSchema };
}

// Returns the raw MCP result so the bridge can pass it through untouched.
export async function callRemoteTool(name, args = {}, { signal, timeoutMs } = {}) {
  const profile = resolveProfile();
  if (!profile.api_key) {
    throw new KitError('Not connected to Junis yet', { code: 'not_logged_in', detail: setupSteps(profile) });
  }
  if (args && typeof args.organization_id === 'string' && args.organization_id && !UUID.test(args.organization_id)) {
    throw new KitError(`organization_id must be a UUID, got "${args.organization_id}"`, {
      code: 'bad_organization_id',
      hint: 'Names and slugs are not ids. Resolve the UUID with list_organizations first.',
    });
  }
  return remoteFor(profile).callTool(name, args, { signal, timeoutMs });
}

export async function callApi({ method = 'GET', path, query = {}, body, organization_id: organizationId, profile: profileName, signal, timeoutMs } = {}) {
  const profile = profileForOrganization(organizationId, { profile: profileName });
  if (!path) throw new KitError('path is required, for example /brain/sources', { code: 'bad_path' });
  return apiFor(profile).request(method, path, { query, body, signal, timeoutMs });
}

export function lint(text, options = {}) {
  return lintInstruction(String(text ?? ''), options);
}
