// Client for the hosted Junis MCP server (streamable HTTP, stateless).
//
// The tool catalogue is always read from the server, never hard-coded, so a
// tool added on the platform is usable from the kit without a kit release.
import { KIT_VERSION } from './config.mjs';
import { isDestructiveTool } from './destructive.mjs';
import { KitError, httpRequest, parseJsonSafe, parseSseMessages } from './http.mjs';

// MCP 2026-07-28 (stateless): no initialize; every request names its method (Mcp-Method), the tool for tools/call (Mcp-Name) and carries
// the protocol version, client capabilities and client info in params._meta. Servers that predate it answer an unsupported-version error
// (-32022, or HTTP 400 "Unsupported protocol version") — the client then switches to the legacy revision for the rest of its life and retries
// that one request. Tested against the hosted server and a legacy server.
export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const PROTOCOL_VERSION = '2025-06-18'; // legacy revision (fallback)
const META = 'io.modelcontextprotocol/';
const UNSUPPORTED_PROTOCOL = -32022;

// Agent runs can legitimately take minutes; everything else should be quick.
const LONG_RUNNING_TOOLS = new Set(['send_message', 'chat_completion', 'apply_team_changes', 'start_run']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toolTimeoutMs(name) {
  if (LONG_RUNNING_TOOLS.has(name)) return 660_000;
  // The platform holds an action run open while it executes (up to three attempts of up to 120 s each).
  // Giving up earlier would report a timeout for a call that is still acting in the outside system.
  if (name === 'actions_run') return 420_000;
  if (/^(import_|upload_|create_datastore|delete_datastore)/.test(name)) return 300_000;
  return 120_000;
}

// The revision a server answered with is remembered for the process, so a
// legacy server is not asked the modern way again on every call (a client
// object is built per call). The pin goes both ways: a server upgraded while
// the process runs refuses the legacy request once, and the client returns to
// the modern revision and clears the pin.
const protocolByUrl = new Map();

export class RemoteMcp {
  constructor({ url, apiKey = '', organizationId = '' }) {
    this.url = url;
    this.apiKey = apiKey;
    this.organizationId = organizationId;
    this.sessionId = '';
    this.nextId = 1;
    this.protocol = protocolByUrl.get(url) || 'modern';
  }

  get protocolVersion() {
    return this.protocol === 'modern' ? MODERN_PROTOCOL_VERSION : PROTOCOL_VERSION;
  }

  headers(method = '', params = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
      'User-Agent': `junis-kit/${KIT_VERSION}`,
    };
    if (this.protocol === 'modern' && method) {
      headers['Mcp-Method'] = method;
      if (method === 'tools/call' && params?.name) headers['Mcp-Name'] = String(params.name);
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    // The server forwards this header verbatim; a name or slug here produces a
    // 403 on every call, so only a real UUID is ever sent.
    if (UUID.test(this.organizationId)) headers['X-Organization-Id'] = this.organizationId;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  envelope(params = {}) {
    if (this.protocol !== 'modern') return params;
    return {
      ...params,
      _meta: {
        ...(params._meta || {}),
        [`${META}protocolVersion`]: MODERN_PROTOCOL_VERSION,
        [`${META}clientCapabilities`]: {},
        [`${META}clientInfo`]: { name: 'junis-kit', version: KIT_VERSION },
      },
    };
  }

  async rpc(method, params = {}, options = {}) {
    try {
      return await this.rpcOnce(method, params, options);
    } catch (err) {
      if (!err?.unsupportedProtocol || options.signal?.aborted) throw err;
      if (this.protocol === 'modern') {
        this.protocol = 'legacy';
        protocolByUrl.set(this.url, 'legacy');
      } else {
        this.protocol = 'modern';
        protocolByUrl.delete(this.url);
      }
      // One switch per call: a server that refuses both revisions reports the second refusal.
      return this.rpcOnce(method, params, options);
    }
  }

  async rpcOnce(method, params = {}, { timeoutMs = 60_000, signal } = {}) {
    const id = this.nextId++;
    const response = await httpRequest('POST', this.url, {
      headers: this.headers(method, params),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: this.envelope(params) }),
      timeoutMs,
      signal,
    });
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;

    if (!response.ok) {
      const body = parseJsonSafe(response.text);
      const message = body?.error?.message || body?.detail || response.text.slice(0, 300) || `HTTP ${response.status}`;
      const err = new KitError(`Junis MCP server rejected ${method}: ${message}`, {
        code: response.status === 401 || response.status === 403 ? 'unauthorized' : 'mcp_http_error',
        status: response.status,
      });
      err.unsupportedProtocol = body?.error?.code === UNSUPPORTED_PROTOCOL || (response.status === 400 && /unsupported protocol version/i.test(String(message)));
      throw err;
    }

    const contentType = response.headers.get('content-type') || '';
    const messages = contentType.includes('text/event-stream')
      ? parseSseMessages(response.text)
      : [parseJsonSafe(response.text)].filter(Boolean);
    const reply = messages.find((message) => message && message.id === id);
    if (!reply) {
      throw new KitError(`Junis MCP server sent no reply to ${method}`, { code: 'mcp_no_reply' });
    }
    if (reply.error) {
      const err = new KitError(reply.error.message || `MCP error on ${method}`, {
        code: 'mcp_error',
        detail: reply.error,
      });
      err.unsupportedProtocol = reply.error.code === UNSUPPORTED_PROTOCOL;
      throw err;
    }
    // A stateless (2026-07-28) result says what it is; anything but 'complete' asks for input the kit cannot give.
    if (reply.result?.resultType && reply.result.resultType !== 'complete') {
      throw new KitError(`Junis MCP server needs more input for ${method} (${reply.result.resultType}), which the kit does not support`, {
        code: 'mcp_incomplete',
      });
    }
    return reply.result;
  }

  // Legacy handshake only — a 2026-07-28 server has no initialize (use server/discover).
  async initialize() {
    if (this.protocol === 'modern') return this.rpc('server/discover', {});
    return this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'junis-kit', version: KIT_VERSION },
    });
  }

  // Listing must be quick: clients give up on a server whose first
  // tools/list takes a minute. One retry covers a dropped connection or a 5xx.
  async listTools({ signal } = {}) {
    const tools = [];
    const seen = new Set();
    let cursor;
    do {
      const params = cursor ? { cursor } : {};
      let result;
      try {
        result = await this.rpc('tools/list', params, { signal, timeoutMs: 10_000 });
      } catch (err) {
        const transient = err.code === 'timeout' || err.code === 'network' || (err.status >= 500 && err.status <= 504);
        if (!transient || signal?.aborted) throw err;
        result = await this.rpc('tools/list', params, { signal, timeoutMs: 10_000 });
      }
      tools.push(...(result.tools || []));
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) break; // a server repeating a cursor would loop forever
      if (cursor) seen.add(cursor);
    } while (cursor);
    return tools;
  }

  async callTool(name, args = {}, { signal, timeoutMs } = {}) {
    return this.rpc('tools/call', { name, arguments: args }, { timeoutMs: timeoutMs || toolTimeoutMs(name), signal });
  }
}

// Tool results arrive as MCP content blocks. Prefer the structured form, fall
// back to parsing the text block, and keep the raw text when it is not JSON.
export function unwrapToolResult(result) {
  const text = (result?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (result?.isError) return { ok: false, error: text || 'Tool call failed', data: undefined };
  if (result?.structuredContent !== undefined) {
    const structured = result.structuredContent;
    // FastMCP wraps non-object returns as {"result": ...}.
    const keys = structured && typeof structured === 'object' ? Object.keys(structured) : [];
    const data = keys.length === 1 && keys[0] === 'result' ? structured.result : structured;
    return { ok: true, data };
  }
  const parsed = parseJsonSafe(text);
  return { ok: true, data: parsed !== undefined ? parsed : text };
}

export const READ_PREFIX = /^(list_|get_)/;
const OPEN_WORLD = /^(send_message|chat_completion|import_skill_|retry_content|actions_run$)/;

// The bridge serves the hosted server's own annotations when a tool has them
// (it marks every tool that changes or deletes data destructive). For a tool
// without them, deriving them from the naming convention lets clients
// auto-approve reads and warn before deletes; the destructive set is the one
// the confirmation hook uses.
export function deriveAnnotations(name) {
  if (READ_PREFIX.test(name)) return { readOnlyHint: true, openWorldHint: false };
  const destructive = isDestructiveTool(name);
  return {
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: !destructive && /^(update_|patch_|toggle_|link_|reorder_)/.test(name),
    openWorldHint: OPEN_WORLD.test(name),
  };
}

const CATEGORY_RULES = [
  ['organizations', /organization/],
  ['agents', /(_agent$|^list_agents$|agent_instruction|^list_tools$|^list_llm_models$)/],
  ['relationships', /sub_agent/],
  ['mcp', /mcp/],
  ['composio', /composio/],
  ['devices', /device/],
  ['rag', /(datastore|rag_|upload_status)/],
  ['sessions', /session/],
  ['chat', /^(send_message|chat_completion|start_run|get_run)$/],
  ['schedules', /schedule/],
  ['skills', /(skill|e2b_templates)/],
  ['soul', /soul/],
  ['memory', /memory/],
  ['content', /content$/],
  ['team', /^apply_team_changes$/],
];

export function categorize(name) {
  // Order matters: "link_agent_mcp" is an MCP tool, not an agent tool.
  for (const [category, pattern] of CATEGORY_RULES.slice(2)) if (pattern.test(name)) return category;
  for (const [category, pattern] of CATEGORY_RULES.slice(0, 2)) if (pattern.test(name)) return category;
  return 'other';
}

export function firstLine(text) {
  return String(text || '').split('\n').find((line) => line.trim())?.trim() || '';
}

// Names close to a misspelt or guessed tool name. Ranked by how many name words they share
// (`make_agent` → every `*_agent*` tool), then alphabetically, so the answer does not depend on
// which descriptions happen to contain the words. searchTools() is for finding tools by what
// they do; for a wrong *name* it preferred tools whose description mentioned every word
// (`actions_agent_set` for "make agent") and dropped `create_agent` once the catalogue grew.
export function nearToolNames(tools, name, limit = 5) {
  const words = new Set(String(name || '').toLowerCase().split(/[\s_-]+/).filter(Boolean));
  const scored = tools
    .map((tool) => {
      const parts = new Set(tool.name.toLowerCase().split(/[_-]+/));
      let shared = 0;
      for (const word of words) if (parts.has(word)) shared += 1;
      return { name: tool.name, shared };
    })
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
  if (scored.length) return scored.slice(0, limit).map((entry) => entry.name);
  return searchTools(tools, { query: [...words].join(' ') }).slice(0, limit).map((entry) => entry.tool.name);
}

export function searchTools(tools, { query = '', category = '' } = {}) {
  const words = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  const scored = tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const summary = firstLine(tool.description).toLowerCase();
      const body = String(tool.description || '').toLowerCase();
      let score = 0;
      let hits = 0;
      for (const word of words) {
        if (name.includes(word)) score += 5;
        else if (summary.includes(word)) score += 2;
        else if (body.includes(word)) score += 1;
        else continue;
        hits += 1;
      }
      return { tool, score, hits, category: categorize(tool.name) };
    })
    .filter((entry) => !category || entry.category === category);
  if (words.length === 0) return scored.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  // Tools matching every word win outright; partial matches are only a
  // fallback, otherwise a common word such as "agent" floods the result.
  const complete = scored.filter((entry) => entry.hits === words.length);
  const pool = complete.length ? complete : scored.filter((entry) => entry.hits > 0);
  return pool.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}
