// In-process stand-in for the two Junis endpoints the kit talks to:
// the External API and the hosted MCP server. Tests never touch a real tenant.
//
// The MCP side answers the way the hosted server does (stateless, one SSE
// "message" event per POST) and serves the real tool catalogue captured in
// fixtures/tools-list.prod.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseCatalogue = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'tools-list.prod.json'), 'utf8')).result.tools;

export const USER_KEY = 'jns_user_testkey0123456789abcdefghij';
export const ORG_KEY = 'jns_live_testkey0123456789abcdefghij';
// Scopes the mock platform knows (a request with any other one is refused like the platform's 400).
const KNOWN_SCOPES = new Set(['orchestrator:invoke', 'orchestrator:stream', 'sessions:read', 'sessions:messages', 'agents:list', 'agents:invoke', 'organizations:read', 'organizations:manage', 'agents:manage', 'relationships:manage', 'mcp:manage', 'datastores:manage', 'sessions:manage', 'schedules:manage', 'skills:manage', 'composio:manage', 'content:read', 'content:retry', 'rag:upload', 'rag:read', 'rag:delete', 'brain:read', 'brain:manage', 'wiki:read', 'wiki:manage', 'secrets:manage', 'actions:read', 'actions:run', 'actions:manage']);
export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

function readBody(request) {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
    });
    request.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({ __invalid: true });
      }
    });
  });
}

export async function startMockJunis({ runDelayMs = 0, dropAfterMs = 0, extraTools = [], silentAnswer = false } = {}) {
  // `extraTools` stands for tools the platform added after the kit was written.
  const catalogue = [...baseCatalogue, ...extraTools];
  const state = {
    organizations: [
      { id: ORG_A, name: 'Globex', slug: 'globex', role: 'OWNER', created_at: '2026-01-01T00:00:00' },
      { id: ORG_B, name: 'GlobexSales', slug: 'globexsales', role: 'ADMIN', created_at: '2026-02-01T00:00:00' },
    ],
    agents: {
      [ORG_A]: [
        { agent_id: 'orchestrator-globex', name: 'Orchestrator_Globex', agent_type: 'LLM_AGENT', description: 'Routes requests' },
        { agent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'DigestWriter', agent_type: 'LLM_AGENT', description: 'Writes digests' },
      ],
      [ORG_B]: [{ agent_id: 'orchestrator-globexsales', name: 'Orchestrator_GlobexSales', agent_type: 'LLM_AGENT', description: '' }],
    },
    schedules: {
      [ORG_A]: [{ id: 'sch-1', name: 'Weekly digest', schedule_type: 'weekly', enabled: true, next_run_at: '2026-10-05T09:00:00+09:00' }],
    },
    soul: { 'soul.md': 'We answer with evidence.', 'identity.md': 'Warm and brief.' },
    wiki: {
      [ORG_A]: { 'policies/returns': { content: 'Returns within 30 days.', version: 3, annotation: 'Return policy' } },
    },
    // Test knobs for the wiki routes: bumpOnGet (someone else edits between read and write → 409),
    // truncateOnPut (the stored page differs from what was sent), forbidGet (403), archiveOnAppend (size rollover key).
    wikiBehavior: {},
    mcpPlatforms: {},
    skills: {},
    datastores: {},
    toolAccess: {},
    sessions: new Map(),
    requests: [],
    runDelayMs,
    dropAfterMs,
    // A turn that ends without writing an answer (a failure after the user message).
    silentAnswer,
  };

  function authenticate(request) {
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')?.[1];
    const key = request.headers['x-api-key'] || bearer || '';
    if (key !== USER_KEY && key !== ORG_KEY) return null;
    const header = request.headers['x-organization-id'];
    return { key, userLevel: key === USER_KEY, organizationId: header || ORG_A };
  }

  function send(response, status, body) {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(text);
  }

  // Like the platform, a known session id continues that session: the
  // turn's user message is appended while the run is marked as processing.
  async function runSession(sessionId, organizationId, agentName, message) {
    let session = state.sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, organizationId, messages: [] };
      state.sessions.set(sessionId, session);
    }
    Object.assign(session, { processing: true, started: Date.now(), agent: agentName });
    session.messages.push({ event_id: crypto.randomUUID(), event_type: 'user_message', content: message, agent: null, created_at: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, state.runDelayMs));
    const answer = state.silentAnswer ? '' : `[${agentName}] done: ${message}`;
    if (answer) session.messages.push({ event_id: crypto.randomUUID(), event_type: 'assistant_message', content: answer, agent: agentName, created_at: new Date().toISOString() });
    session.processing = false;
    return answer;
  }

  async function handleApi(request, response, url) {
    const auth = authenticate(request);
    if (!auth) return send(response, 401, { detail: 'Invalid API key' });
    const route = `${request.method} ${url.pathname.replace(/^\/api\/external/, '')}`;
    const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await readBody(request) : {};
    state.requests.push({ route, organizationId: auth.organizationId, userLevel: auth.userLevel, body, query: Object.fromEntries(url.searchParams) });
    if (!state.organizations.some((org) => org.id === auth.organizationId)) {
      return send(response, 403, { detail: 'Not a member of this organization' });
    }
    const agents = state.agents[auth.organizationId] || [];
    let match;

    if (route === 'GET /management/organizations') {
      if (!auth.userLevel) return send(response, 403, { detail: 'User-level API key required' });
      return send(response, 200, { organizations: state.organizations, total: state.organizations.length });
    }
    if (route === 'GET /agents') return send(response, 200, { agents, total: agents.length, organization_id: auth.organizationId });
    if (route === 'GET /management/agents') return send(response, 200, agents);
    if (route === 'POST /management/agents') {
      if (agents.some((agent) => agent.name === body.name)) return send(response, 409, { detail: `Agent '${body.name}' already exists` });
      const created = { agent_id: crypto.randomUUID(), ...body };
      agents.push(created);
      state.agents[auth.organizationId] = agents;
      return send(response, 201, created);
    }
    if ((match = /^GET \/management\/agents\/([^/]+)$/.exec(route))) {
      const agent = agents.find((entry) => entry.agent_id === match[1]);
      return agent ? send(response, 200, agent) : send(response, 404, { detail: 'Agent not found' });
    }
    if (route === 'GET /management/wiki/content') {
      if (state.wikiBehavior.forbidGet) return send(response, 403, { detail: 'Admin role required' });
      const key = url.searchParams.get('file_key');
      const page = (state.wiki[auth.organizationId] || {})[key];
      if (!page) return send(response, 404, { detail: 'Wiki page not found' });
      const shown = { file_key: key, ...page };
      if (state.wikiBehavior.bumpOnGet) page.version += 1;   // another writer edits right after this read
      return send(response, 200, shown);
    }
    if (route === 'PUT /management/wiki/content') {
      if (!state.wiki[auth.organizationId]) state.wiki[auth.organizationId] = {};
      const pages = state.wiki[auth.organizationId];
      const existing = pages[body.file_key];
      if (existing && body.expected_version !== undefined && body.expected_version !== existing.version) {
        return send(response, 409, { detail: 'The page changed since it was read' });
      }
      const version = existing ? existing.version + 1 : 1;
      const stored = state.wikiBehavior.truncateOnPut ? String(body.content ?? '').slice(0, 5) : String(body.content ?? '');
      pages[body.file_key] = { content: stored, version, annotation: body.annotation || '' };
      return send(response, 200, { file_key: body.file_key, version, chars: stored.length });
    }
    if (route === 'POST /management/wiki/content/append') {
      const existing = (state.wiki[auth.organizationId] || {})[body.file_key];
      if (!existing) return send(response, 404, { detail: 'Wiki page not found' });
      existing.content = `${existing.content}\n\n${body.content}`;
      existing.version += 1;
      const out = { file_key: body.file_key, version: existing.version };
      if (state.wikiBehavior.archiveOnAppend) out.archived_to = state.wikiBehavior.archiveOnAppend;
      return send(response, 200, out);
    }
    if (route === 'POST /management/wiki/verify') {
      if (state.wikiBehavior.noVerifyRoute) return send(response, 404, { detail: 'Not Found' });   // an older platform
      const existing = (state.wiki[auth.organizationId] || {})[body.file_key];
      if (!existing) return send(response, 404, { detail: 'Wiki page not found' });
      existing.verified_at = '2026-11-10T00:00:00+00:00';
      return send(response, 200, { file_key: body.file_key, version: existing.version, content: existing.content, verified_at: existing.verified_at, review_due_at: '2027-02-08T00:00:00+00:00', review_due: false });
    }
    if (route === 'GET /management/wiki/lint') {
      const pages = state.wiki[auth.organizationId] || {};
      const keys = Object.keys(pages);
      return send(response, 200, {
        checked: keys.length, review_after_days: 90, review_due: [], broken_links: [], orphans: [], links_in_use: false,
        empty_pages: keys.filter((key) => !String(pages[key].content || '').trim()),
        missing_annotation: keys.filter((key) => !pages[key].annotation),
        large_pages: [],
      });
    }
    if ((match = /^GET \/management\/agents\/([^/]+)\/sub-agents$/.exec(route))) return send(response, 200, []);
    if (route === 'GET /management/schedules') {
      // Like the platform: limit (default 100) and offset page the list.
      const schedules = state.schedules[auth.organizationId] || [];
      const limit = Number(url.searchParams.get('limit') || 100);
      const offset = Number(url.searchParams.get('offset') || 0);
      return send(response, 200, { schedules: schedules.slice(offset, offset + limit), total: schedules.length });
    }
    if (route === 'GET /management/mcp-platforms') return send(response, 200, state.mcpPlatforms[auth.organizationId] || []);
    if (route === 'GET /management/skills') {
      const skills = state.skills[auth.organizationId] || [];
      return send(response, 200, { skills, total: skills.length });
    }
    if (route === 'GET /management/datastores') return send(response, 200, state.datastores[auth.organizationId] || []);
    if ((match = /^GET \/management\/agents\/([^/]+)\/tool-access$/.exec(route))) {
      const agent = agents.find((entry) => entry.agent_id === match[1]);
      if (!agent) return send(response, 404, { detail: 'Agent not found' });
      return send(response, 200, state.toolAccess[match[1]] || { agent_id: match[1], mcp: [], composio: [] });
    }
    if ((match = /^PUT \/management\/me\/secrets\/([^/]+)$/.exec(route))) {
      // FastAPI's default validation error echoes the submitted body as `input`.
      if (typeof body.value !== 'string') {
        return send(response, 422, { detail: [{ type: 'missing', loc: ['body', 'value'], msg: 'Field required', input: body }] });
      }
      return send(response, 200, { name: match[1], stored: true });
    }
    if ((match = /^GET \/management\/soul\/([^/]+)$/.exec(route))) {
      return send(response, 200, { file_key: match[1], content: state.soul[match[1]] || '' });
    }
    if (route === 'GET /brain/sources') return send(response, 200, { sources: [{ id: 'src-1', title: 'Handbook', status: 'ready' }], total: 1 });
    if (route === 'GET /brain/search') return send(response, 200, { query: url.searchParams.get('q'), results: [] });

    if (route === 'POST /v1/chat/completions' || (match = /^POST \/agents\/([^/]+)\/completions$/.exec(route))) {
      const orchestrator = route === 'POST /v1/chat/completions';
      // Like the platform: both endpoints create the
      // session with the caller-chosen id before the run starts.
      // A session id that belongs to another user is not reused: the platform
      // runs in a session of its own (the ext-… session).
      const sessionId = body.session_id && !state.foreignSessions?.has(body.session_id) ? body.session_id : body.session_id ? `ext-${crypto.randomUUID()}` : crypto.randomUUID();
      const message = orchestrator ? body.messages?.at(-1)?.content : body.message;
      if (!message) return send(response, 422, { detail: [{ loc: ['body', 'message'], msg: 'Field required' }] });
      const agent = orchestrator ? agents[0] : agents.find((entry) => entry.agent_id === match[1]);
      if (!agent) return send(response, 404, { detail: 'Agent not found' });
      if (state.dropAfterMs) {
        // The load balancer cuts the connection; the run keeps going.
        setTimeout(() => request.socket.destroy(), state.dropAfterMs);
        runSession(sessionId, auth.organizationId, agent.name, message);
        return undefined;
      }
      const answer = await runSession(sessionId, auth.organizationId, agent.name, message);
      if (orchestrator) {
        return send(response, 200, {
          id: 'chatcmpl-test',
          model: body.model || 'junis-orchestrator',
          session_id: sessionId,
          choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      return send(response, 200, { id: 'agentcmpl-test', agent_id: agent.agent_id, agent_name: agent.name, session_id: sessionId, response: answer, created: 0, model: 'test/model' });
    }

    if ((match = /^GET \/sessions\/([^/]+)\/status$/.exec(route))) {
      const session = state.sessions.get(match[1]);
      if (!session || session.organizationId !== auth.organizationId) return send(response, 404, { detail: 'Session not found or access denied' });
      if (!session.processing) return send(response, 200, { session_id: session.id, is_processing: false });
      return send(response, 200, {
        session_id: session.id,
        is_processing: true,
        current_agent: session.agent,
        elapsed_seconds: (Date.now() - session.started) / 1000,
      });
    }
    if ((match = /^GET \/sessions\/([^/]+)\/messages$/.exec(route))) {
      const session = state.sessions.get(match[1]);
      if (!session || session.organizationId !== auth.organizationId) return send(response, 404, { detail: 'Session not found or access denied' });
      return send(response, 200, { session_id: session.id, messages: session.messages, total: session.messages.length, page: 1, page_size: 50, has_next: false });
    }
    return send(response, 404, { detail: 'Not Found' });
  }

  // Tools backed by real state; every other catalogue tool echoes its input.
  async function callTool(name, args, request) {
    const auth = authenticate(request);
    if (!auth) throw new Error("No API key found. Send a Bearer token in the Authorization header.");
    const organizationId = args.organization_id || auth.organizationId;
    state.requests.push({ route: `TOOL ${name}`, organizationId, body: args });
    if (name === 'list_organizations') {
      if (!auth.userLevel) throw new Error('Junis API error 403: User-level API key required');
      if (state.failOrganizations > 0) {
        state.failOrganizations -= 1;
        throw new Error('Junis API error 503: temporarily unavailable');
      }
      return { organizations: state.organizations, total: state.organizations.length };
    }
    if (!state.organizations.some((org) => org.id === organizationId)) {
      throw new Error('Junis API error 403: Not a member of this organization');
    }
    const agents = state.agents[organizationId] || [];
    if (name === 'list_agents') return { items: agents, count: agents.length };
    if (name === 'create_agent') {
      if (agents.some((agent) => agent.name === args.name)) throw new Error(`Junis API error 409: Agent '${args.name}' already exists`);
      const { organization_id: _ignored, ...fields } = args;
      const created = { agent_id: crypto.randomUUID(), ...fields };
      agents.push(created);
      state.agents[organizationId] = agents;
      return created;
    }
    if (name === 'get_agent') {
      const agent = agents.find((entry) => entry.agent_id === args.agent_id);
      if (!agent) throw new Error('Junis API error 404: Agent not found');
      return agent;
    }
    if (name === 'list_sub_agents') return { items: [], count: 0 };
    if (name === 'list_llm_models') return { models: [{ model_id: 'test/model-a' }, { model_id: 'test/model-b' }] };
    return { ok: true, tool: name, received: args };
  }

  async function handleMcp(request, response) {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const message = await readBody(request);
    const reply = (payload) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...payload })}\n\n`);
    };
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    if (message.method === 'initialize') {
      return reply({ result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'Mock Junis', version: '0' }, instructions: 'mock' } });
    }
    if (message.method === 'tools/list') return reply({ result: { tools: catalogue } });
    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      if (!catalogue.some((tool) => tool.name === name)) return reply({ error: { code: -32602, message: `Unknown tool: ${name}` } });
      try {
        const data = await callTool(name, args, request);
        return reply({ result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false } });
      } catch (err) {
        return reply({ result: { content: [{ type: 'text', text: `Error calling tool '${name}': ${err.message}` }], isError: true } });
      }
    }
    return reply({ error: { code: -32601, message: `Method not found: ${message.method}` } });
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/health') return send(response, 200, { status: 'ok' });
    const work = url.pathname === '/mcp'
      ? handleMcp(request, response)
      : url.pathname === '/mcp/'
        ? redirect(response)
        : url.pathname.startsWith('/api/user/api-keys/device/')
          ? handleKeyRequest(request, response, url)
          : handleApi(request, response, url);
    Promise.resolve(work).catch((err) => {
      if (!response.headersSent) send(response, 500, { detail: err.message });
    });
  });

  // The platform's key request flow (/api/user/api-keys/device): start, then
  // 202 while pending, the key once after approval (with the verifier), 410 after.
  state.keyRequests = new Map();
  state.keyRequestAttempts = []; // the scopes of every start request, refused ones included
  state.unknownScopes = []; // permissions this platform does not know yet (an older deployment)
  state.hideAvailableScopes = false; // refuse an unknown permission without listing the ones offered
  state.keyResultTtlMs = null; // how long the platform keeps an approved key for collection
  state.keyPollFailures = 0; // answer 503 to this many polls (a rolling deploy)
  async function handleKeyRequest(request, response, url) {
    const route = `${request.method} ${url.pathname.replace('/api/user/api-keys/device', '')}`;
    if (route === 'POST /start') {
      const body = await readBody(request);
      state.keyRequestAttempts.push(body.scopes ?? null);
      // A 400 that is not about an unknown permission (the platform's other refusals carry a plain message).
      if (Array.isArray(body.scopes) && state.rejectScopes) return send(response, 400, { detail: 'Unknown scope' });
      if (Array.isArray(body.scopes)) {
        // The platform's own refusal of a permission it does not know (scope_validator: 400 invalid_scopes).
        const offered = [...KNOWN_SCOPES].filter((scope) => !state.unknownScopes.includes(scope));
        const unknown = body.scopes.filter((scope) => !offered.includes(scope));
        if (unknown.length) {
          return send(response, 400, {
            detail: {
              error: 'invalid_scopes',
              message: "Unknown scope(s). Scopes replace the key's full list, so send every scope the key should keep.",
              unknown_scopes: unknown,
              ...(state.hideAvailableScopes ? {} : { available_scopes: offered.sort() }),
            },
          });
        }
      }
      const code = `CODE${state.keyRequests.size + 1}`;
      state.keyRequests.set(code, { status: 'pending', challenge: body.poll_challenge, scopes: body.scopes ?? null, client: body.client_name });
      return send(response, 200, { device_code: code, verification_uri: `https://junis.test/auth/api-key?code=${code}`, expires_in: 600, interval: 1 });
    }
    if (route === 'GET /poll') {
      if (state.keyPollFailures > 0) {
        state.keyPollFailures -= 1;
        return send(response, 503, { detail: 'Service Unavailable' });
      }
      if (state.keyPollProxyForbidden > 0) {
        // A proxy in front of the platform refusing a request: no platform error body.
        state.keyPollProxyForbidden -= 1;
        return send(response, 403, { message: 'Forbidden' });
      }
      const entry = state.keyRequests.get(url.searchParams.get('code'));
      if (!entry) return send(response, 410, { detail: 'Device code expired or not found' });
      if (entry.status === 'approved' && state.keyResultTtlMs !== null && Date.now() - (entry.approvedAt || 0) > state.keyResultTtlMs) {
        state.keyRequests.delete(url.searchParams.get('code'));
        return send(response, 410, { detail: 'Device code expired or not found' });
      }
      if (entry.status === 'pending') return send(response, 202, null);
      if (entry.status === 'denied') {
        state.keyRequests.delete(url.searchParams.get('code'));
        return send(response, 403, { detail: { error: 'access_denied' } });
      }
      const verifier = request.headers['x-poll-verifier'] || '';
      const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (entry.challenge && digest !== entry.challenge) return send(response, 403, { detail: { error: 'invalid_verifier' } });
      state.keyRequests.delete(url.searchParams.get('code'));
      return send(response, 200, { kind: 'api_key', api_key: USER_KEY, api_key_id: 'k-1', key_prefix: 'jns_user_test', scopes: entry.scopes || [] });
    }
    return send(response, 404, { detail: 'Not Found' });
  }

  function redirect(response) {
    // A misconfigured URL that answers with a redirect must never be followed.
    response.writeHead(307, { Location: 'http://127.0.0.1/mcp' }).end();
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    apiBase: `http://127.0.0.1:${port}/api/external`,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    env(extra = {}) {
      return { JUNIS_API_BASE: `http://127.0.0.1:${port}/api/external`, JUNIS_MCP_URL: `http://127.0.0.1:${port}/mcp`, ...extra };
    },
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}
