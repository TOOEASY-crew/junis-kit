// Minimal HTTP helpers shared by the External API client and the MCP client.
//
// Redirects are never followed: both clients send a credential, and replaying
// it to whatever URL a redirect names would either drop the Authorization
// header (silent 401) or hand the key to another origin or scheme. A redirect
// is reported as a configuration error instead.

export class KitError extends Error {
  constructor(message, { code = 'error', status = 0, hint = '', detail = undefined } = {}) {
    super(message);
    this.name = 'KitError';
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.detail = detail;
  }

  toJSON() {
    const out = { error: this.code, message: this.message };
    if (this.status) out.status = this.status;
    if (this.hint) out.hint = this.hint;
    if (this.detail !== undefined) out.detail = this.detail;
    return out;
  }
}

// 429 from the platform is a rate-limit refusal at the authentication step, before any route runs, so
// sending the same request again cannot run it twice. Honor a short Retry-After (up to 30 s, at most
// two waits); a longer one is returned to the caller unchanged so it can report the wait instead of hanging.
export const MAX_RETRY_AFTER_SECONDS = 30;
const MAX_RATE_LIMIT_RETRIES = 2;

export function retryAfterSeconds(headers) {
  const raw = (headers?.get?.('retry-after') || '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function sleepCancellable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new KitError('Request was cancelled', { code: 'cancelled' }));
    const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new KitError('Request was cancelled', { code: 'cancelled' })); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export async function httpRequest(method, url, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await httpRequestOnce(method, url, options);
    const wait = res.status === 429 ? retryAfterSeconds(res.headers) : undefined;
    if (wait === undefined || wait > MAX_RETRY_AFTER_SECONDS || attempt >= MAX_RATE_LIMIT_RETRIES) return res;
    await sleepCancellable(wait * 1000, options.signal);
  }
}

async function httpRequestOnce(method, url, { headers = {}, body, timeoutMs = 60_000, signal } = {}) {
  // A signal that is already aborted never fires its listener: check it here, or the request is sent anyway.
  if (signal?.aborted) throw new KitError('Request was cancelled', { code: 'cancelled' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      throw new KitError(`${url} answered with a redirect (HTTP ${response.status}) to ${location || 'an unknown location'}`, {
        code: 'redirect_refused',
        status: response.status,
        hint: 'Use the exact endpoint URL without a trailing slash. Redirects are not followed because the request carries a credential.',
      });
    }
    const text = await response.text();
    return { status: response.status, ok: response.ok, headers: response.headers, text };
  } catch (err) {
    if (err instanceof KitError) throw err;
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new KitError('Request was cancelled', { code: 'cancelled' });
      throw new KitError(`No response from ${new URL(url).host} within ${Math.round(timeoutMs / 1000)}s`, {
        code: 'timeout',
        hint: 'The server may still be working. For agent runs, check the session status instead of sending the same request again.',
      });
    }
    const cause = err.cause?.code || err.cause?.message || err.message;
    throw new KitError(`Cannot reach ${new URL(url).host}: ${cause}`, {
      code: 'network',
      hint: 'Check the network connection and the configured URLs (run the status command).',
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export function parseJsonSafe(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Server-sent events body -> list of parsed JSON payloads (one per event).
export function parseSseMessages(text) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    const parsed = parseJsonSafe(data);
    if (parsed !== undefined) messages.push(parsed);
  }
  return messages;
}

// Pull the most useful human-readable message out of the error shapes the
// platform returns (FastAPI detail strings, nested error objects, lists).
export function describeErrorBody(data, fallbackText = '') {
  if (data && typeof data === 'object') {
    const detail = data.detail ?? data.error ?? data.message;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') {
      if (typeof detail.message === 'string') return detail.message;
      if (detail.error && typeof detail.error.message === 'string') return detail.error.message;
      return JSON.stringify(detail).slice(0, 500);
    }
  }
  return String(fallbackText || '').slice(0, 500);
}
