// Save the current state of an organization's squad to a local file.
//
// Taken before any change to an organization that is already in use, a
// snapshot is what makes an edit reversible: instructions and settings can be
// compared afterwards and put back. Only configuration is read. Platform
// credentials are never requested (MCP platforms are listed, not opened), and
// the file is written with owner-only permissions because instructions can
// describe private business logic.
import fs from 'node:fs';
import path from 'node:path';
import { kitHome, resolveProfile } from './config.mjs';
import { KitError } from './http.mjs';
import { apiFor, fetchOrganizations } from './kit-tools.mjs';
import { timestamp } from './jsonc.mjs';

const PAGE = 100;
const TOOL_ACCESS_CONCURRENCY = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function inBatches(items, size, work) {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work));
  }
}

// A link entry carries the app's logo, which can be a large embedded image;
// it is not configuration and would bloat the file and every diff.
function withoutLogos(value) {
  if (Array.isArray(value)) return value.map(withoutLogos);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'toolkit_logo_url').map(([key, item]) => [key, withoutLogos(item)]));
  }
  return value;
}

async function allAgents(api) {
  const agents = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await api.request('GET', '/management/agents', { query: { skip, limit: PAGE } });
    const items = Array.isArray(page) ? page : page?.items || page?.agents || [];
    agents.push(...items);
    if (items.length < PAGE) return agents;
  }
}

// The platform pages schedules with limit (100 by default) and offset.
async function allSchedules(api) {
  const schedules = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await api.request('GET', '/management/schedules', { query: { limit: PAGE, offset } });
    const items = Array.isArray(page) ? page : page?.schedules || page?.items || [];
    schedules.push(...items);
    if (items.length < PAGE) return schedules;
  }
}

// A part that cannot be read (missing scope, feature off) is recorded as
// skipped instead of failing the whole snapshot.
async function optional(label, skipped, work) {
  try {
    return await work();
  } catch (err) {
    skipped.push({ part: label, reason: err.message, status: err.status || undefined });
    return null;
  }
}

function summarize(agents) {
  const byType = {};
  const byModel = {};
  for (const agent of agents) {
    byType[agent.agent_type || 'unknown'] = (byType[agent.agent_type || 'unknown'] || 0) + 1;
    if (agent.model) byModel[agent.model] = (byModel[agent.model] || 0) + 1;
  }
  return { agents: agents.length, by_type: byType, by_model: byModel };
}

export async function takeSnapshot({ organizationId, out } = {}) {
  const profile = resolveProfile(organizationId ? { organization_id: organizationId } : {});
  if (!profile.api_key) throw new KitError('Not logged in', { code: 'not_logged_in' });
  if (!UUID.test(profile.organization_id)) {
    throw new KitError('Choose the organization first', {
      code: 'organization_not_resolved',
      hint: 'Pass --org <uuid>, or set a default with `org use <name>`.',
    });
  }
  const api = apiFor(profile);
  const skipped = [];

  const agents = await allAgents(api);
  const organizations = await optional('organization', skipped, () => fetchOrganizations(profile));
  const organization = organizations?.find((org) => org.id === profile.organization_id) || { id: profile.organization_id };

  const relationships = {};
  for (const agent of agents) {
    if (Array.isArray(agent.relationships)) {
      if (agent.relationships.length) relationships[agent.agent_id] = agent.relationships;
    }
  }

  // Which tools of each connection the agent may use and which need a
  // confirmation: not in the agent list, and lost by a plain update. One
  // read per agent, a few at a time (the key's rate limit is per minute).
  const toolAccess = {};
  await inBatches(agents, TOOL_ACCESS_CONCURRENCY, async (agent) => {
    const access = await optional(`tool_access/${agent.name}`, skipped, () => api.request('GET', `/management/agents/${agent.agent_id}/tool-access`));
    if (access && typeof access === 'object') toolAccess[agent.agent_id] = withoutLogos(access);
  });

  const schedules = await optional('schedules', skipped, () => allSchedules(api));
  const platforms = await optional('mcp_platforms', skipped, () => api.request('GET', '/management/mcp-platforms'));
  const skills = await optional('skills', skipped, () => api.request('GET', '/management/skills'));
  const datastores = await optional('datastores', skipped, () => api.request('GET', '/management/datastores'));
  const soul = {};
  for (const fileKey of ['soul.md', 'identity.md']) {
    const file = await optional(`soul/${fileKey}`, skipped, () => api.request('GET', `/management/soul/${fileKey}`));
    if (file?.content) soul[fileKey] = file.content;
  }

  const snapshot = {
    kind: 'junis-squad-snapshot',
    version: 1,
    taken_at: new Date().toISOString(),
    environment: profile.env,
    organization,
    summary: summarize(agents),
    agents,
    relationships,
    tool_access: toolAccess,
    schedules: schedules ?? [],
    mcp_platforms: platforms ?? [],
    skills: skills?.skills ?? skills ?? [],
    datastores: datastores ?? [],
    soul,
    skipped,
  };

  const slug = organization.slug || profile.organization_id;
  const file = out ? path.resolve(out) : path.join(kitHome(), 'snapshots', slug, `${timestamp()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });

  return {
    file,
    organization: { name: organization.name, slug: organization.slug },
    ...snapshot.summary,
    schedules: snapshot.schedules.length,
    skipped,
    note: 'Instructions are inside the file. Compare two snapshots with `snapshot diff <older> <newer>`.',
  };
}

function indexBy(list, key) {
  return new Map((list || []).map((item) => [item[key], item]));
}

const IGNORED_FIELDS = new Set(['updated_at', 'created_at', 'last_run_at', 'next_run_at', 'run_count', 'relationships', 'skill_count']);

function changedFields(before, after) {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const field of fields) {
    if (IGNORED_FIELDS.has(field)) continue;
    const left = JSON.stringify(before[field] ?? null);
    const right = JSON.stringify(after[field] ?? null);
    if (left === right) continue;
    if (field === 'instruction') {
      changes.push({ field, before_chars: String(before[field] ?? '').length, after_chars: String(after[field] ?? '').length });
    } else {
      changes.push({ field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  return changes;
}

export function diffSnapshots(olderFile, newerFile) {
  const read = (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.kind !== 'junis-squad-snapshot') throw new KitError(`${file} is not a squad snapshot`, { code: 'bad_snapshot' });
    return data;
  };
  const older = read(olderFile);
  const newer = read(newerFile);
  const before = indexBy(older.agents, 'agent_id');
  const after = indexBy(newer.agents, 'agent_id');

  const added = [...after.values()].filter((agent) => !before.has(agent.agent_id)).map((agent) => agent.name);
  const removed = [...before.values()].filter((agent) => !after.has(agent.agent_id)).map((agent) => agent.name);
  const changed = [];
  for (const [id, agent] of after) {
    if (!before.has(id)) continue;
    const changes = changedFields(before.get(id), agent);
    const links = JSON.stringify((older.relationships[id] || []).map((link) => link.sub_agent_id));
    const linksNow = JSON.stringify((newer.relationships[id] || []).map((link) => link.sub_agent_id));
    if (links !== linksNow) changes.push({ field: 'sub_agents', before: JSON.parse(links), after: JSON.parse(linksNow) });
    // Compared only when both snapshots recorded it for this agent (an older
    // kit wrote none; a member key or a rate limit leaves it in `skipped`).
    if (recordedToolAccess(older, id, agent.name) && recordedToolAccess(newer, id, agent.name)) {
      const access = older.tool_access[id];
      const accessNow = newer.tool_access[id];
      if (JSON.stringify(access) !== JSON.stringify(accessNow)) changes.push({ field: 'tool_access', before: access, after: accessNow });
    }
    if (changes.length) changed.push({ agent: agent.name, agent_id: id, changes });
  }

  const platformChanges = listChanges(older.mcp_platforms, newer.mcp_platforms, 'platform', (item) => item.platform_id ?? item.id);
  const skillChanges = listChanges(older.skills, newer.skills, 'skill', (item) => item.skill_id ?? item.id);
  const datastoreChanges = listChanges(older.datastores, newer.datastores, 'datastore', (item) => item.datastore_id ?? item.id);

  const schedulesBefore = indexBy(older.schedules, 'id');
  const schedulesAfter = indexBy(newer.schedules, 'id');
  const scheduleChanges = [];
  for (const [id, schedule] of schedulesAfter) {
    if (!schedulesBefore.has(id)) scheduleChanges.push({ schedule: schedule.name, change: 'added' });
    else if (changedFields(schedulesBefore.get(id), schedule).length) scheduleChanges.push({ schedule: schedule.name, change: 'changed', fields: changedFields(schedulesBefore.get(id), schedule).map((entry) => entry.field) });
  }
  for (const [id, schedule] of schedulesBefore) if (!schedulesAfter.has(id)) scheduleChanges.push({ schedule: schedule.name, change: 'removed' });

  const soulChanges = ['soul.md', 'identity.md'].filter((key) => (older.soul?.[key] || '') !== (newer.soul?.[key] || ''));

  return {
    organization: newer.organization?.name,
    from: older.taken_at,
    to: newer.taken_at,
    identical: !added.length && !removed.length && !changed.length && !scheduleChanges.length && !soulChanges.length
      && !platformChanges.length && !skillChanges.length && !datastoreChanges.length,
    agents_added: added,
    agents_removed: removed,
    agents_changed: changed,
    schedules: scheduleChanges,
    mcp_platforms: platformChanges,
    skills: skillChanges,
    datastores: datastoreChanges,
    soul_changed: soulChanges,
  };
}

function recordedToolAccess(snapshot, agentId, agentName) {
  if (!snapshot.tool_access || typeof snapshot.tool_access !== 'object') return false;
  if (!(agentId in snapshot.tool_access)) return false;
  return !(snapshot.skipped || []).some((entry) => entry.part === `tool_access/${agentName}`);
}

// Added, removed and changed entries of a list saved in both snapshots, by id.
// Datastores are listed with display_name, the others with name.
function listChanges(olderList, newerList, label, keyOf) {
  const nameOf = (item) => item.name ?? item.display_name ?? keyOf(item);
  const before = new Map((olderList || []).map((item) => [keyOf(item), item]));
  const after = new Map((newerList || []).map((item) => [keyOf(item), item]));
  const changes = [];
  for (const [id, item] of after) {
    if (!before.has(id)) changes.push({ [label]: nameOf(item), change: 'added' });
    else {
      const fields = changedFields(before.get(id), item).map((entry) => entry.field);
      if (fields.length) changes.push({ [label]: nameOf(item), change: 'changed', fields });
    }
  }
  for (const [id, item] of before) if (!after.has(id)) changes.push({ [label]: nameOf(item), change: 'removed' });
  return changes;
}

function listSnapshots() {
  const root = path.join(kitHome(), 'snapshots');
  if (!fs.existsSync(root)) return { snapshots: [] };
  const snapshots = [];
  for (const slug of fs.readdirSync(root)) {
    const dir = path.join(root, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).sort()) {
      snapshots.push({ organization: slug, file: path.join(dir, name) });
    }
  }
  return { snapshots };
}

// Print one agent's saved instruction, to put it back or to compare by eye.
function showInstruction(file, agentName) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wanted = String(agentName).toLowerCase();
  const agent = (data.agents || []).find((entry) => entry.agent_id === agentName || String(entry.name).toLowerCase() === wanted);
  if (!agent) throw new KitError(`No agent "${agentName}" in that snapshot`, { code: 'not_found', detail: { agents: (data.agents || []).map((entry) => entry.name) } });
  return { agent: agent.name, agent_id: agent.agent_id, model: agent.model, taken_at: data.taken_at, instruction: agent.instruction ?? '' };
}

export async function commandSnapshot({ positionals, flags }) {
  const [action, first, second] = positionals;
  if (action === 'diff') {
    if (!first || !second) throw new KitError('Usage: snapshot diff <older.json> <newer.json>', { code: 'usage' });
    return diffSnapshots(first, second);
  }
  if (action === 'list') return listSnapshots();
  if (action === 'show') {
    if (!first || !second) throw new KitError('Usage: snapshot show <file.json> <agent name>', { code: 'usage' });
    return showInstruction(first, second);
  }
  return takeSnapshot({
    organizationId: typeof flags.org === 'string' ? flags.org : undefined,
    out: typeof flags.out === 'string' ? flags.out : undefined,
  });
}
