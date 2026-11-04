// Run an agent or the organization's orchestrator and survive long runs.
//
// Squad runs take from seconds to tens of minutes, while agent clients give a
// single tool call between one and four minutes. So a run is a job with a
// handle: the session id is chosen here before the request is sent, the caller
// waits a bounded time, and anything still working is picked up again by that
// id. A run is never sent twice, because the platform keeps executing (and
// billing) a request even after the connection that started it is gone.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { KitError } from './http.mjs';
import { apiFor, profileForOrganization } from './kit-tools.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_INTERVAL_MS = Number(process.env.JUNIS_KIT_POLL_MS) || 10_000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 60_000; // the platform cancels runs itself after two hours
const MAX_RESPONSE_CHARS = 60_000;
const START_CONFIRM_MS = 20_000;
// How long a request this process sent may show no message of its turn
// before it is taken as never started (a cold orchestrator start loads
// memory and soul first, up to about two minutes).
const START_GRACE_MS = Number(process.env.JUNIS_KIT_START_GRACE_MS) || 5 * 60_000;
// Agent clients kill a shell command after about two minutes; outside a
// terminal the command line must hand back a handle well before that.
const NON_TTY_WAIT_S = 90;

const jobs = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A wait given as text or a bad number must not silently become the default
// (`--wait-seconds 0` is a real request) nor NaN (which fires at once).
export function seconds(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function requireLogin(profile) {
  if (!profile.api_key) throw new KitError('Not logged in', { code: 'not_logged_in' });
}


function elapsedSince(started) {
  return Math.round((Date.now() - started) / 1000);
}

function clip(text) {
  const value = String(text ?? '');
  if (value.length <= MAX_RESPONSE_CHARS) return { response: value };
  return {
    response: value.slice(0, MAX_RESPONSE_CHARS),
    truncated: true,
    full_length: value.length,
    note: 'The response was cut for size. Read the rest from the session messages.',
  };
}

export async function resolveAgent(api, target) {
  if (!target || /^orchestrator$/i.test(target)) return { kind: 'orchestrator', name: 'orchestrator' };
  if (/^orchestrator-/.test(target)) return { kind: 'orchestrator', name: target };
  // Listing agents needs owner or admin; a member can still run an agent by id.
  if (UUID.test(target)) return { kind: 'agent', id: target, name: target };
  const listing = await api.request('GET', '/agents');
  const agents = listing?.agents || [];
  const wanted = target.toLowerCase();
  const exact = agents.filter((agent) => agent.agent_id === target || String(agent.name).toLowerCase() === wanted);
  const matches = exact.length ? exact : agents.filter((agent) => String(agent.name).toLowerCase().includes(wanted));
  if (matches.length === 1) return { kind: 'agent', id: matches[0].agent_id, name: matches[0].name };
  throw new KitError(
    matches.length ? `"${target}" matches ${matches.length} agents` : `No agent named "${target}" in this organization`,
    { code: 'agent_not_resolved', detail: { candidates: (matches.length ? matches : agents).slice(0, 30).map((agent) => agent.name) } },
  );
}

export async function sessionStatus(api, sessionId) {
  return api.request('GET', `/sessions/${sessionId}/status`, { timeoutMs: 30_000 });
}

export async function lastMessages(api, sessionId, pageSize = 50) {
  const first = await api.request('GET', `/sessions/${sessionId}/messages`, {
    query: { page: 1, page_size: pageSize },
    timeoutMs: 60_000,
  });
  const total = first?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage === 1) return first;
  return api.request('GET', `/sessions/${sessionId}/messages`, {
    query: { page: lastPage, page_size: pageSize },
    timeoutMs: 60_000,
  });
}

// The answer of the latest turn only. The platform writes the user message at
// the start of a turn, so walking back past it would return the previous
// turn's answer for a turn that failed or has not answered yet.
function finalAnswer(page) {
  const messages = page?.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const type = String(message.event_type || '').toLowerCase();
    if (type === 'user_message') break;
    if (message.content && !type.includes('user') && !type.includes('tool')) {
      return { response: message.content, agent: message.agent || '' };
    }
  }
  return { response: '', agent: '' };
}

function shapeResponse(agent, data, sessionId, started) {
  const text = agent.kind === 'orchestrator' ? data?.choices?.[0]?.message?.content ?? '' : data?.response ?? '';
  const base = {
    session_id: data?.session_id || sessionId,
    agent: data?.agent_name || agent.name,
    elapsed_s: elapsedSince(started),
  };
  // Once the platform has started its keep-alive body it cannot change the
  // HTTP status any more; a failure is signalled by the id prefix instead.
  if (/^(agentcmpl|chatcmpl)-error-/.test(String(data?.id || ''))) {
    return { status: 'failed', ...base, error: String(text).replace(/^Error:\s*/, '') };
  }
  // `model` only echoes the request and `usage` is a length estimate, not the
  // billed tokens, so neither is reported.
  return {
    status: text ? 'completed' : 'finished_without_text',
    ...base,
    ...clip(text),
  };
}

// Read the state of a run from the platform alone, for runs this process did
// not start or lost the connection to.
//
// The platform marks a run as processing before it writes the turn's user
// message, so "this turn's user message exists and nothing is processing"
// means the turn has ended. The only window in which a run is on its way but
// shows nothing is before that message is written (the orchestrator loads
// memory and soul first). `baseline` is the session's message count before
// this process sent the request, so an earlier turn's answer is never taken
// for this one.
async function readFromPlatform(api, sessionId, started, { baseline = null } = {}) {
  let status;
  try {
    status = await sessionStatus(api, sessionId);
  } catch (err) {
    if (err.status === 404) return { status: 'not_found', session_id: sessionId };
    throw err;
  }
  if (status.timed_out) {
    return { status: 'timed_out', session_id: sessionId, note: 'The run passed the platform\'s two-hour reporting limit. It may still be working: read the session messages later and never send it again.' };
  }
  if (status.is_processing) {
    return {
      status: 'running',
      session_id: sessionId,
      // The platform names the agent at work (a sub-agent after a hand-over); pass it on.
      ...(status.current_agent && status.current_agent !== 'Unknown' ? { current_agent: status.current_agent } : {}),
      elapsed_s: Math.round(status.elapsed_seconds ?? elapsedSince(started)),
    };
  }
  const page = await lastMessages(api, sessionId);
  const all = page?.messages || [];
  const total = page?.total ?? all.length;
  const offset = Math.max(0, total - all.length);
  const turn = baseline === null ? all : all.filter((_, index) => offset + index >= baseline);
  if (!turn.length) {
    if (baseline === null || Date.now() - started < START_GRACE_MS) {
      return {
        status: 'running',
        session_id: sessionId,
        starting: true,
        elapsed_s: elapsedSince(started),
        note: 'The platform has the session but has not begun this turn yet. If nothing changes for five minutes, the request never started and sending it again is safe.',
      };
    }
    return { status: 'finished_without_text', session_id: sessionId, elapsed_s: elapsedSince(started), note: 'The request never produced a message. Read the session before sending it again.' };
  }
  const answer = finalAnswer({ messages: turn });
  const answered = [...turn].reverse().find((message) => message.content && String(message.event_type || '').toLowerCase() === 'assistant_message');
  return {
    status: answer.response ? 'completed' : 'finished_without_text',
    session_id: sessionId,
    agent: answer.agent,
    ...clip(answer.response),
    ...(answered?.created_at ? { answered_at: answered.created_at } : {}),
    elapsed_s: elapsedSince(started),
    recovered: true,
  };
}

// A budget may arrive as a number or, from some clients, as its text ("5"); anything else is ignored, as before.
function wholeNumber(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function launch(api, agent, message, sessionId, { baseline = 0, chosen = false, maxLlmCalls } = {}) {
  const started = Date.now();
  const path = agent.kind === 'orchestrator' ? '/v1/chat/completions' : `/agents/${agent.id}/completions`;
  const body =
    agent.kind === 'orchestrator'
      ? { messages: [{ role: 'user', content: message }], session_id: sessionId, stream: false }
      : { message, session_id: sessionId, stream: false };
  // Run budget: lowers the saved model-call limit for this run only; omitted = the request is unchanged.
  if (Number.isInteger(maxLlmCalls) && maxLlmCalls >= 1) body.max_llm_calls = maxLlmCalls;

  const job = { sessionId, agent: agent.name, started, settled: false, outcome: null };
  job.promise = api
    .request('POST', path, { body, timeoutMs: REQUEST_TIMEOUT_MS })
    .then((data) => shapeResponse(agent, data, sessionId, started))
    .catch(async (err) => {
      const lostConnection = err.code === 'timeout' || err.code === 'network' || (err.status >= 502 && err.status <= 504);
      if (!lostConnection) return { status: 'failed', session_id: sessionId, agent: agent.name, error: err.message, hint: err.hint || undefined, http_status: err.status || undefined };
      // The connection ended, the run did not. Both endpoints create the
      // session with the id chosen here, so follow the run on the platform,
      // for at most as long as the platform itself would let it run.
      let misses = 0;
      let errors = 0;
      let lastError = '';
      const deadline = started + REQUEST_TIMEOUT_MS;
      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        try {
          const state = await readFromPlatform(api, sessionId, started, { baseline });
          errors = 0;
          if (state.status === 'not_found') {
            misses += 1;
            if (misses >= 6) {
              // A session id the caller chose may belong to another user; the platform then runs in a
              // session of its own, which this id never shows. Only an id made here proves "never sent".
              if (chosen) {
                return { status: 'unknown', session_id: sessionId, agent: agent.name, note: 'No session with this id appeared on the platform. If the id belongs to another user, the run went to a new session: check list_sessions before sending the request again.' };
              }
              return { status: 'not_started', session_id: sessionId, note: 'The request never reached the platform. It is safe to send it again.' };
            }
            continue;
          }
          if (state.status !== 'running') return state;
        } catch (pollError) {
          errors += 1;
          lastError = pollError.message;
          if (errors >= 30) {
            return { status: 'unknown', session_id: sessionId, agent: agent.name, error: lastError, note: 'The run could not be followed (the status endpoint kept failing). Check the session later with junis_run_status or list_sessions; do not send the request again.' };
          }
        }
        if (Date.now() > deadline) {
          return { status: 'unknown', session_id: sessionId, agent: agent.name, note: 'The run outlasted the platform limit while the connection was lost. Read the session messages.' };
        }
      }
    })
    .then((outcome) => {
      job.settled = true;
      job.outcome = outcome;
      return outcome;
    });
  jobs.set(sessionId, job);
  return job;
}

// Resolves with the outcome, or with null when the wait runs out first. The
// timer is cleared either way: a pending timer would keep the process alive
// long after the answer has been printed.
function waitFor(job, waitSeconds, signal) {
  if (job.settled) return Promise.resolve(job.outcome);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, waitSeconds) * 1000);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    job.promise.then(finish);
    // A cancelled tool call stops waiting; the run itself continues.
    signal?.addEventListener('abort', () => finish(null), { once: true });
  });
}

// Before handing back a handle, make sure the platform has the run. Without
// this, a caller that exits right away could abandon a request that never
// left the machine.
async function confirmStarted(api, job) {
  const deadline = Date.now() + START_CONFIRM_MS;
  while (!job.settled && Date.now() < deadline) {
    try {
      await sessionStatus(api, job.sessionId);
      return true;
    } catch {
      // not visible yet
    }
    await sleep(Math.min(POLL_INTERVAL_MS, 500));
  }
  return job.settled;
}

function stillRunning(sessionId, agent, started, extra = {}) {
  return {
    status: 'running',
    session_id: sessionId,
    agent,
    elapsed_s: elapsedSince(started),
    ...extra,
    next_step: 'The run continues on the platform. Check again with the same session_id in about 30 seconds. Do not send the message again.',
  };
}

export async function startRun({ agent: target = 'orchestrator', message, session_id: sessionId, organization_id: organizationId, wait_seconds: waitSeconds = 45, confirm = false, max_llm_calls: maxLlmCalls, signal }) {
  const profile = profileForOrganization(organizationId);
  requireLogin(profile);
  if (!message || !String(message).trim()) throw new KitError('message is required', { code: 'usage' });
  const api = apiFor(profile);
  const agent = await resolveAgent(api, target);
  // Never start a second run in a session that is still working: the first
  // one is billed to the end, and the second would be billed too.
  let baseline = 0;
  if (sessionId) {
    const local = jobs.get(sessionId);
    if (local && !local.settled) return stillRunning(sessionId, local.agent, local.started, { already_running: true });
    let state = null;
    try {
      state = await sessionStatus(api, sessionId);
    } catch {
      // unknown or new session: nothing is running in it
    }
    if (state?.is_processing) {
      return stillRunning(sessionId, agent.name, Date.now() - (Number(state.elapsed_seconds) || 0) * 1000, { already_running: true });
    }
    if (state) {
      try {
        const first = await api.request('GET', `/sessions/${sessionId}/messages`, { query: { page: 1, page_size: 1 }, timeoutMs: 30_000 });
        baseline = Number(first?.total) || 0;
      } catch {
        baseline = 0;
      }
    }
  }
  const id = sessionId || crypto.randomUUID();
  const job = launch(api, agent, String(message), id, { baseline, chosen: Boolean(sessionId), maxLlmCalls: wholeNumber(maxLlmCalls) });
  const outcome = await waitFor(job, waitSeconds, signal);
  if (outcome) {
    jobs.delete(id);
    return outcome;
  }
  if (confirm && !(await confirmStarted(api, job))) {
    if (job.settled) return job.outcome;
    if (sessionId) {
      return { status: 'unknown', session_id: id, note: 'The platform did not acknowledge the run in this session. If the id belongs to another user, the run went to a new session: check list_sessions before sending it again.' };
    }
    return { status: 'not_started', session_id: id, note: 'The platform did not acknowledge the run. Check the connection, then send it again.' };
  }
  if (job.settled) return job.outcome;
  return stillRunning(id, agent.name, job.started);
}

export async function runStatus({ session_id: sessionId, organization_id: organizationId, wait_seconds: waitSeconds = 30, signal }) {
  const profile = profileForOrganization(organizationId);
  requireLogin(profile);
  if (!sessionId) throw new KitError('session_id is required', { code: 'usage' });
  const job = jobs.get(sessionId);
  if (job) {
    const outcome = await waitFor(job, waitSeconds, signal);
    if (outcome) {
      jobs.delete(sessionId);
      return outcome;
    }
    // A run started here is followed by its job; the platform's current_agent is read only for runs started elsewhere.
    return stillRunning(sessionId, job.agent, job.started);
  }

  // Not started by this process (a new terminal, a restarted agent).
  const api = apiFor(profile);
  const started = Date.now();
  const deadline = started + Math.max(0, waitSeconds) * 1000;
  for (;;) {
    const state = await readFromPlatform(api, sessionId, started);
    if (state.status === 'not_found') {
      throw new KitError(`No session ${sessionId} for this key in this organization`, {
        code: 'not_found',
        hint: 'Sessions are visible only to their own user and only in their organization: pass the organization_id the run was started in.',
      });
    }
    if (state.status !== 'running') return state;
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return stillRunning(sessionId, '', started, {
        elapsed_s: state.elapsed_s,
        ...(state.current_agent ? { current_agent: state.current_agent } : {}),
        ...(state.starting ? { starting: true, note: state.note } : {}),
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function readMessage(positionals) {
  const raw = positionals.join(' ').trim();
  if (!raw) throw new KitError('Usage: run <agent|orchestrator> <message|@file>', { code: 'usage' });
  if (raw.startsWith('@')) {
    const file = raw.slice(1);
    if (!fs.existsSync(file)) throw new KitError(`Message file not found: ${file}`, { code: 'file_not_found' });
    return fs.readFileSync(file, 'utf8');
  }
  return raw;
}

function withExitCode(outcome) {
  return { ...outcome, exitCode: ['completed', 'running', 'finished_without_text'].includes(outcome.status) ? 0 : 1 };
}

export async function commandRun({ positionals, flags }) {
  const [target, ...rest] = positionals;
  const message = readMessage(rest);
  const interactive = Boolean(process.stdout.isTTY);
  const waitSeconds = flags.no_wait ? 0 : seconds(flags.wait_seconds, interactive ? 1800 : NON_TTY_WAIT_S);
  const outcome = await startRun({
    agent: target,
    message,
    session_id: typeof flags.session === 'string' ? flags.session : undefined,
    organization_id: typeof flags.org === 'string' ? flags.org : undefined,
    wait_seconds: waitSeconds,
    // The command exits after printing, so the run must be on the platform.
    confirm: true,
  });
  if (outcome.status === 'running' && outcome.session_id) process.stderr.write(`still running — follow with: session wait ${outcome.session_id}\n`);
  return withExitCode(outcome);
}

export async function commandSession({ positionals, flags }) {
  const [action, sessionId] = positionals;
  if (!sessionId || !['status', 'messages', 'wait'].includes(action)) {
    throw new KitError('Usage: session status|messages|wait <session-id>', { code: 'usage' });
  }
  const organizationId = typeof flags.org === 'string' ? flags.org : undefined;
  if (action === 'status') return withExitCode(await runStatus({ session_id: sessionId, organization_id: organizationId, wait_seconds: 0 }));
  if (action === 'wait') {
    const fallback = process.stdout.isTTY ? 1800 : NON_TTY_WAIT_S;
    return withExitCode(await runStatus({ session_id: sessionId, organization_id: organizationId, wait_seconds: seconds(flags.wait_seconds, fallback) }));
  }
  const profile = profileForOrganization(organizationId);
  requireLogin(profile);
  const api = apiFor(profile);
  const pageSize = seconds(flags.page_size, 50) || 50;
  const page = await lastMessages(api, sessionId, pageSize);
  if (flags.all) return page;
  const tail = seconds(flags.tail, 10) || 10;
  let messages = page?.messages || [];
  // The last page can be short; take the rest of the tail from the page before it.
  const total = page?.total ?? messages.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (messages.length < tail && lastPage > 1) {
    const previous = await api.request('GET', `/sessions/${sessionId}/messages`, { query: { page: lastPage - 1, page_size: pageSize }, timeoutMs: 60_000 });
    messages = [...(previous?.messages || []), ...messages];
  }
  return { session_id: sessionId, total, messages: messages.slice(-tail) };
}
