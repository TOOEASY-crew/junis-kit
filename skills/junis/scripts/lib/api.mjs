// Client for the Junis External API (everything the MCP server does not
// cover: Knowledge/Second Brain, direct agent calls, raw session reads).
import { KIT_VERSION } from './config.mjs';
import { KitError, describeErrorBody, httpRequest, parseJsonSafe, retryAfterSeconds } from './http.mjs';
import { explainError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A validation error (FastAPI's 422) repeats the submitted body as `input`,
// which may hold a password or key the kit filled in from @env:. Only the
// field, the message and the kind of error are kept.
export function withoutSubmittedInput(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.detail)) return data;
  const detail = data.detail.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const kept = {};
    for (const key of ['loc', 'msg', 'type']) if (entry[key] !== undefined) kept[key] = entry[key];
    return kept;
  });
  return { ...data, detail };
}

export class ExternalApi {
  constructor({ apiBase, apiKey, organizationId = '' }) {
    this.apiBase = apiBase;
    this.apiKey = apiKey;
    this.organizationId = organizationId;
  }

  buildUrl(path, query = {}) {
    if (/^https?:\/\//i.test(path)) {
      throw new KitError('Pass a path such as /brain/sources, not a full URL', { code: 'bad_path' });
    }
    // Accept both "/brain/sources" and "/api/external/brain/sources".
    const trimmed = `/${String(path).replace(/^\/+/, '')}`.replace(/^\/api\/external(?=\/|$)/, '');
    const url = new URL(`${this.apiBase}${trimmed}`);
    // The key must never reach another host or another part of this host:
    // after URL normalisation (which resolves ".." and "%2e%2e") the path has
    // to be under the External API root.
    const base = new URL(this.apiBase);
    const root = base.pathname.replace(/\/+$/, '');
    if (url.origin !== base.origin || !(url.pathname === root || url.pathname.startsWith(`${root}/`))) {
      throw new KitError('The path must stay under the External API', { code: 'bad_path', hint: 'Use a path such as /brain/sources.' });
    }
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request(method, path, { query = {}, body, timeoutMs = 120_000, signal } = {}) {
    if (!this.apiKey) {
      throw new KitError('Not logged in', { code: 'not_logged_in', hint: 'Run the login command first.' });
    }
    const headers = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': `junis-kit/${KIT_VERSION}`,
    };
    if (UUID.test(this.organizationId)) headers['X-Organization-Id'] = this.organizationId;
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await httpRequest(method.toUpperCase(), this.buildUrl(path, query), {
      headers,
      body: payload,
      timeoutMs,
      signal,
    });
    const data = withoutSubmittedInput(parseJsonSafe(response.text));
    if (!response.ok) {
      const explained = explainError(`${response.status} ${response.text}`);
      const retryAfter = response.status === 429 ? retryAfterSeconds(response.headers) : undefined;
      throw new KitError(describeErrorBody(data, response.status === 422 ? '' : response.text) || `HTTP ${response.status}`, {
        code: explained.code === 'tool_error' ? 'api_error' : explained.code,
        status: response.status,
        hint: retryAfter !== undefined ? `Wait ${retryAfter}s (Retry-After) before calling again. ${explained.hint || ''}`.trim() : explained.hint,
        detail: data,
      });
    }
    return data !== undefined ? data : response.text;
  }
}
