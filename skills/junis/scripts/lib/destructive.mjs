import fs from 'node:fs';
import path from 'node:path';
import { BOOLEAN_FLAGS, parseArgs, parseQuery, splitShellWords } from './args.mjs';
import { parseJsonSafe } from './http.mjs';

// Text of a value from a tool call or a command line, never throwing (a JSON
// object such as {"toString": 0} must not cancel the question).
function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// One definition of "this call deletes or overwrites something on Junis",
// shared by the bridge (tool annotations) and the Claude Code hook
// (confirmation prompt), so the two can never disagree.

// Tools whose ordinary use removes or replaces data.
export const DESTRUCTIVE_TOOL =
  /^(delete_|remove_|unlink_|unassign_)|^knowledge_\w+_delete$|^actions_\w+_delete$|^(write_skill_file|switch_organization|update_soul_content|update_memory_content|apply_team_changes|update_mcp_platform|manage_skill_bundle|rollback_agent|restore_soul_version|knowledge_changes_webhook_set|set_agent_enabled_tools|set_agent_confirmation_tools|set_tool_safety|set_flag_org_opt_out|squad_apply|actions_run|actions_agent_set|actions_connection_update|actions_draft_update|actions_import_openapi|actions_import)$/;

// Tools that always replace or remove something, whatever their arguments
// (each needs a reason here: a tool on the list above without one would be
// let through unasked by the lazy bridge, the hook and the command line).
const ALWAYS_DESTRUCTIVE = {
  squad_apply: 'squad_apply changes every agent the squad document differs on (create, update, sub-agents, MCP links and tool lists).',
  rollback_agent: 'rollback_agent restores an earlier version of the agent and replaces its current settings.',
  restore_soul_version: 'restore_soul_version replaces the current soul or identity text with an earlier version, for every agent of the organization.',
  knowledge_changes_webhook_set: "knowledge_changes_webhook_set makes the platform send the organization's Knowledge changes to an outside address every minute, replacing any address set before.",
  set_agent_enabled_tools: 'set_agent_enabled_tools replaces which tools of a connection the agent may use.',
  set_agent_confirmation_tools: 'set_agent_confirmation_tools replaces the list of tools that need a human confirmation; in unattended runs those tools are not run at all.',
  set_tool_safety: "set_tool_safety replaces the organization's tool safety rules for every agent.",
  set_flag_org_opt_out: 'set_flag_org_opt_out switches a feature on or off for the whole organization.',
  actions_agent_set: 'actions_agent_set replaces the whole list of actions the agent can run; an action left out is taken away from it.',
  actions_connection_update: 'actions_connection_update replaces the connection settings (address, headers) as a whole or switches the connection on or off for every action that uses it.',
  actions_import_openapi: 'actions_import_openapi creates a connection and one draft action for each chosen operation in a single call.',
  actions_draft_update: 'actions_draft_update replaces the whole draft (address, parameters, effect and risk) with the one sent; what is left out is lost.',
};

// An action run reaches a system outside Junis (an HTTP API, a webhook, an MCP
// tool) or is filed for a person's approval; nothing sent can be taken back
// from here. A dry run only shows the request that would be sent.
const ACTION_RUN_REASON = 'runs an action in a system outside Junis, or files it for a person to approve; what it sends cannot be taken back from here.';

// A junis.actions/v1 import adds connections and drafts in one call (it never overwrites). The tool previews unless dry_run is
// false; the External route imports unless dry_run is true — each is asked only when it really writes.
const ACTION_IMPORT_REASON = 'imports a junis.actions/v1 document: it adds the connections and action drafts it lists in one call (nothing existing is changed).';

// Tools that are safe unless they carry a whole replacement text.
const OVERWRITES_TEXT = new Set(['update_agent', 'update_skill', 'update_orchestrator']);

export function isDestructiveTool(name) {
  return DESTRUCTIVE_TOOL.test(asText(name));
}

// The platform reads a boolean the pydantic way: true, 1, "true", "1", "t", "yes", "y" and "on" all mean yes.
const TRUE_WORD = /^(1|true|t|yes|y|on)$/i;
const yes = (value) => value === true || value === 1 || TRUE_WORD.test(asText(value).trim());
const FALSE_WORD = /^(0|false|f|no|n|off)$/i;

// The route as the platform will see it, whatever form the caller used: with or
// without a leading slash or the /api/external prefix, with %-escapes, "." and "..".
function normalizeRoute(path) {
  let raw = asText(path).split('#')[0].split('?')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // leave it as written
  }
  let route;
  try {
    route = new URL(`/${raw.replace(/^\/+/, '')}`, 'http://route.invalid').pathname;
  } catch {
    route = `/${raw.replace(/^\/+/, '')}`;
  }
  return route.replace(/\/{2,}/g, '/').replace(/^\/api\/external(?=\/|$)/, '').replace(/\/+$/, '');
}

// A read that puts stored credential values into the conversation. The tool is
// annotated read-only, so clients ask nothing on their own: the bridge asks.
export const SECRET_READ_TOOLS = new Set(['get_mcp_platform']);
export function secretReadReason(tool, input = {}) {
  const args = input && typeof input === 'object' ? input : {};
  if (asText(tool) === 'get_mcp_platform' && yes(args.reveal_secrets)) {
    return 'get_mcp_platform with reveal_secrets=true puts the stored credential values into this conversation.';
  }
  return '';
}

// The reason a platform tool call must be confirmed, or '' when it is safe.
export function destructiveReason(tool, input = {}) {
  const name = asText(tool);
  const args = input && typeof input === 'object' ? input : {};
  if (/^(delete_|remove_|unlink_|unassign_)/.test(name)) return `${name} removes data or a link on Junis and cannot be undone.`;
  if (/^knowledge_\w+_delete$/.test(name)) return `${name} removes Knowledge data on Junis and cannot be undone.`;
  if (/^actions_\w+_delete$/.test(name)) return `${name} removes an action draft or connection on Junis and cannot be undone.`;
  if (ALWAYS_DESTRUCTIVE[name]) return ALWAYS_DESTRUCTIVE[name];
  if (name === 'actions_run') return yes(args.dry_run) ? '' : `actions_run ${ACTION_RUN_REASON}`;
  if (name === 'actions_import') return args.dry_run === false || args.dry_run === 0 || FALSE_WORD.test(asText(args.dry_run).trim()) ? `actions_import ${ACTION_IMPORT_REASON}` : '';
  if (name === 'update_soul_content' || name === 'update_memory_content' || name === 'write_skill_file') {
    return `${name} replaces the whole text. Use the patch tool for edits.`;
  }
  if (name === 'switch_organization') return 'switch_organization changes the organization the user sees in the web app.';
  if (OVERWRITES_TEXT.has(name) && typeof args.instruction === 'string' && args.instruction.length > 0) {
    return `${name} with "instruction" replaces the whole text. Use the patch tool for edits.`;
  }
  const cleared = clearedFields(args);
  if (cleared.length) return `${name} with clear_fields empties ${cleared.join(', ')}; the stored values are gone.`;
  if (LIST_OWNERS.has(name)) {
    const list = replacedLinks(args);
    if (list) return `${name} replaces ${list}.`;
  }
  if (name === 'update_mcp_platform' && (args.env_vars !== undefined || args.auth_config !== undefined)) {
    return 'update_mcp_platform replaces the platform credentials as a whole.';
  }
  if (/^import_skill_from_/.test(name) && yes(args.overwrite)) {
    return `${name} with overwrite=true replaces the existing skill of the same name.`;
  }
  const secretRead = secretReadReason(name, args);
  if (secretRead) return secretRead;
  if (name === 'manage_skill_bundle' && /delete|remove|unassign/i.test(asText(args.action))) {
    return `manage_skill_bundle ${args.action} removes a bundle.`;
  }
  if (name === 'apply_team_changes' && !yes(args.dry_run)) {
    const changes = Array.isArray(args.changes) ? args.changes : [];
    const risky = changes
      .filter((change) => change && typeof change === 'object')
      .filter((change) => /^(delete_|remove_|unlink_|unassign_)/.test(asText(change.action)) || (/^update_/.test(asText(change.action)) && replacesTeamData(change)))
      .map((change) => change.action);
    if (risky.length) return `The batch contains ${[...new Set(risky)].join(', ')}.`;
  }
  return '';
}

// Tools whose list arguments replace the stored list as a whole.
const LIST_OWNERS = new Set(['update_agent', 'update_orchestrator']);

// clear_fields empties stored fields (an agent's tools or links, a platform's
// credentials, a schedule's settings). Any non-empty list is a removal.
function clearedFields(args) {
  // A list, or (as a command line may write it) one name or a comma-separated string.
  const raw = Array.isArray(args.clear_fields) ? args.clear_fields : typeof args.clear_fields === 'string' ? args.clear_fields.split(',') : [];
  const fields = raw.filter((field) => typeof field === 'string').map((field) => field.trim()).filter(Boolean);
  return [...new Set(fields)];
}

// mcp_platforms unlinks every platform not in the list; an empty tools,
// rag_tools or mcp_platforms list removes all of them. A non-empty tools
// list is the ordinary way to add a tool and is covered by the skill's
// "lists replace too" rule instead of a question on every build step.
function replacedLinks(args) {
  if (Array.isArray(args.mcp_platforms)) return 'the agent\'s MCP platform links as a whole (platforms not in the list are unlinked)';
  for (const key of ['tools', 'rag_tools']) {
    if (Array.isArray(args[key]) && args[key].length === 0) return `the agent's ${key} with an empty list (all of them are removed)`;
  }
  return '';
}

// An update in a team batch that replaces a whole instruction. The server takes
// update_agent as { agent: {...} } and update_orchestrator as { changes: {...} }
// (the hosted batch tool); a flat "instruction" is accepted too. clear_fields and
// link lists count the same way as on the single-agent tool. A sub_agents
// list is not a replacement: the server only adds links (existing ones come back
// as already_linked), which is how the documented build batch wires a pipeline.
function replacesTeamData(change) {
  const nonEmptyText = (value) => typeof value === 'string' && value.length > 0;
  const agent = change.agent && typeof change.agent === 'object' ? change.agent : {};
  const edits = change.changes && typeof change.changes === 'object' ? change.changes : {};
  if (nonEmptyText(change.instruction) || nonEmptyText(agent.instruction) || nonEmptyText(edits.instruction)) return true;
  return [change, agent, edits].some((part) => clearedFields(part).length > 0 || Boolean(replacedLinks(part)));
}

// The same question for a raw External API call. POST is safe except where
// the body or query turns it into a replacement (Knowledge map and imports).
export function destructiveApiReason(method, path = '', { query, body } = {}) {
  const verb = (asText(method) || 'GET').toUpperCase();
  const where = asText(path);
  if (verb === 'DELETE') return `DELETE ${where} removes data on Junis and cannot be undone.`;
  if (verb === 'PUT' || verb === 'PATCH') return `${verb} ${where} overwrites data on Junis.`;
  const route = normalizeRoute(where);
  const params = { ...Object.fromEntries(new URLSearchParams(where.split('#')[0].split('?')[1] || '')), ...(query && typeof query === 'object' ? query : {}) };
  // One platform's details return its stored credentials in plain text unless reveal=false.
  if (verb === 'GET' && /^\/management\/mcp-platforms\/[^/]+$/.test(route) && !FALSE_WORD.test(asText(params.reveal).trim())) {
    return `GET ${route} returns the stored credential values in plain text. Add reveal=false to see them masked.`;
  }
  if (verb !== 'POST') return '';
  const data = body && typeof body === 'object' ? body : {};
  if (/\/brain\/ontology\/preset$/.test(route) && data.mode !== 'merge') {
    return 'POST /brain/ontology/preset replaces the knowledge map (mode "replace" is the default): kinds the preset lacks are removed and documents are re-read overnight. Preview first, or send mode "merge".';
  }
  if (/\/brain\/(graph|sources\/files)$/.test(route) && data.mode === 'replace') return `POST ${route} with mode "replace" replaces what was imported before.`;
  if (/\/brain\/sources\/[^/]+\/retry$/.test(route) && TRUE_WORD.test(asText(params.confirm_removal).trim())) {
    return 'The retry applies a large removal the last sync held back.';
  }
  if (route === '/actions/run' && !yes(data.dry_run)) return `POST /actions/run ${ACTION_RUN_REASON}`;
  if (route === '/actions/import/openapi') return 'POST /actions/import/openapi creates a connection and one draft action for each chosen operation in a single call.';
  if (route === '/actions/import' && !yes(data.dry_run)) return `POST /actions/import ${ACTION_IMPORT_REASON}`;
  if (route === '/management/squad/apply') {
    return 'POST /management/squad/apply changes every agent the squad document differs on (create, update, sub-agents, MCP links and tool lists).';
  }
  if (/^\/management\/agents\/[^/]+\/versions\/[^/]+\/rollback$/.test(route)) {
    return `POST ${route} restores an earlier version of the agent and replaces its current settings.`;
  }
  if (/\/skills\/import\/(github|npx|upload)$/.test(route) && yes(data.overwrite)) {
    return `POST ${route} with overwrite=true replaces the existing skill of the same name.`;
  }
  return '';
}

// The field names after clear_fields= (a word, a comma list or a JSON list)
// or in "clear_fields": [...]; "fields" when they cannot be read.
function clearedFieldNames(text) {
  const listed = /\\?"clear_fields\\?"\s*:\s*\[([^\]]*)\]|\bclear_fields=["']?\[?([^\s'"\]]*(?:"[^\]]*)?)/.exec(text);
  const raw = listed ? listed[1] ?? listed[2] ?? '' : '';
  const names = raw.split(',').map((part) => part.replace(/[\\"'\[\]\s]/g, '')).filter(Boolean);
  return names.length ? names : ['fields'];
}

// And for a shell command that reaches the same tools through the CLI. The
// command line is split into words and parsed with the CLI's own parser, so
// options anywhere (`api --org <id> DELETE …`), a missing method (`api /path`
// is a GET), typed values (`reveal_secrets=1`) and JSON bodies are read the way
// the CLI will send them. The word-pattern reading below is the fallback for a
// line that cannot be split (unbalanced quotes) or a body read from stdin.
// A word that names the kit: junis.mjs, junis-kit, with a path, a version or a
// source suffix (junis-kit@0.1, github:org/junis-kit#main), in any letter case.
const KIT_NAMED = /junis(-kit|\.mjs)\b/i;
const KIT_WORD = /(^|[\\/:])junis(-kit|\.mjs)([@#][^\s]*)?$/i;
// Shell features this reading does not follow; a line that uses them with the
// kit is asked about instead of guessed.
const UNFOLLOWED = /`|\$\(|<\(|>\(|\$'|(^|[\s;&|(])(eval|xargs|alias|source|exec)(\s|$)|(^|[\s;&|(])\.\s/;
const MAX_LINE = 65_536;
const CANNOT_CHECK = 'The command runs the Junis kit in a way this check cannot follow; confirm it.';

// `node "$K" api DELETE …`: a script run through a variable may be the kit, whose name then never shows.
const SCRIPT_FROM_VARIABLE = /(^|[\s;&|(])node\s+["']?\$\{?\w+\}?["']?\s+(api|tools|wiki)(\s|$)/;
// `node <any script> api DELETE /…` or `node <any script> tools call …`: the kit's
// own shape under another name (a copy or a link of junis.mjs). Such a line is
// read as a kit call. A wrapper script that calls the kit from inside is not
// seen: this check knows the name and the shape, nothing more.
const NODE_WORD = /^(.*[\\/])?node(\.exe)?$/i;
const KIT_SHAPED = /(^|[\s;&|()'"])node(\.exe)?\s+(?:-\S*\s+)*\S+\s+(?:api\s+(?:--?\S+\s+)*["']?(?:GET|POST|PUT|PATCH|DELETE|\/)|tools\s+(?:--?\S+\s+)*["']?call\b|wiki\s+(?:--?\S+\s+)*["']?put\b)/i;

export function destructiveCommandReason(command, { cwd } = {}, depth = 0, untrusted = false) {
  const text = asText(command);
  const named = KIT_NAMED.test(text);
  if (!named && !KIT_SHAPED.test(text)) {
    if (!SCRIPT_FROM_VARIABLE.test(text) || text.length > MAX_LINE) return SCRIPT_FROM_VARIABLE.test(text) ? CANNOT_CHECK : '';
    try {
      return patternCommandReason(text) || CANNOT_CHECK;
    } catch {
      return CANNOT_CHECK;
    }
  }
  if (text.length > MAX_LINE) return CANNOT_CHECK;
  let pattern = '';
  try {
    pattern = patternCommandReason(text);
  } catch {
    return CANNOT_CHECK;
  }
  if (UNFOLLOWED.test(text)) return pattern || CANNOT_CHECK;
  if (SCRIPT_FROM_VARIABLE.test(text)) return pattern || CANNOT_CHECK;
  try {
    // The parsed reading may only add questions to the pattern reading, never remove one.
    return parsedCommandReason(text, { cwd, depth, untrusted, named }) || pattern;
  } catch {
    return pattern || CANNOT_CHECK;
  }
}

function parsedCommandReason(text, { cwd, depth, untrusted, named = true }) {
  const words = splitShellWords(text);
  if (!words) return CANNOT_CHECK;
  // Running state instead of rescanning earlier words (linear on long lines);
  // a line past these caps is asked about rather than read in part.
  const MAX_CALLS = 64;
  const MAX_ARGS = 256;
  let calls = 0;
  let sawKit = false;
  let earlierCommand = untrusted;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (typeof word !== 'string') {
      earlierCommand = true;
      continue;
    }
    if (word === 'cd' || word === '-C' || word.startsWith('--chdir')) earlierCommand = true;
    if (NODE_WORD.test(word)) {
      // `node [options] <script> api|tools …` under any script name: skip the options, take the script word.
      let k = i + 1;
      while (k < words.length && typeof words[k] === 'string' && words[k].startsWith('-')) k += 1;
      const script = words[k];
      const verb = words[k + 1];
      if (typeof script === 'string' && !KIT_WORD.test(script) && (verb === 'api' || verb === 'tools' || verb === 'wiki')) {
        sawKit = true;
        calls += 1;
        if (calls > MAX_CALLS) return CANNOT_CHECK;
        if (expandsInShell(script)) return BUILT_FROM_SHELL;
        const argv = [];
        let j = k + 1;
        for (; j < words.length && typeof words[j] === 'string' && argv.length < MAX_ARGS; j += 1) argv.push(words[j]);
        if (argv.length >= MAX_ARGS && j < words.length && typeof words[j] === 'string') return CANNOT_CHECK;
        const reason = invocationReason(argv, { trustFiles: !earlierCommand, cwd });
        if (reason) return reason;
      }
      continue;
    }
    if (!KIT_NAMED.test(word)) {
      // A quoted script (`bash -c "…"`) with the kit's shape inside is read as a line of its own.
      if (/\s/.test(word) && KIT_SHAPED.test(word)) {
        if (depth >= 3) return CANNOT_CHECK;
        sawKit = true;
        const inner = destructiveCommandReason(word, { cwd }, depth + 1, true);
        if (inner) return inner;
      }
      continue;
    }
    if (!KIT_WORD.test(word)) {
      // A quoted script (`bash -c "…"`) is read as a command line of its own, with files untrusted.
      if (/\s/.test(word)) {
        if (depth >= 3) return CANNOT_CHECK;
        sawKit = true;
        const inner = destructiveCommandReason(word, { cwd }, depth + 1, true);
        if (inner) return inner;
      }
      continue;
    }
    sawKit = true;
    calls += 1;
    if (calls > MAX_CALLS) return CANNOT_CHECK;
    const argv = [];
    let j = i + 1;
    for (; j < words.length && typeof words[j] === 'string' && argv.length < MAX_ARGS; j += 1) argv.push(words[j]);
    if (argv.length >= MAX_ARGS && j < words.length && typeof words[j] === 'string') return CANNOT_CHECK;
    // A payload file is trusted only when nothing earlier in the line can have written it or changed directory.
    const reason = invocationReason(argv, { trustFiles: !earlierCommand, cwd });
    if (reason) return reason;
  }
  // The kit is named but no call to it was found (inside a heredoc, a here-string,
  // or text the shell reads differently): ask rather than assume it is harmless.
  // A line that only looked like the kit (the shape under another name) and
  // held no such call is left alone: it is some other program.
  return sawKit || !named ? '' : CANNOT_CHECK;
}

// The payload the CLI would build, without reading stdin; null when it cannot be known here.
function commandPayload({ flags, pairs }, { trustFiles = true, cwd } = {}) {
  let source;
  if (flags.json === '-' || flags.file === '-') return null;
  if (typeof flags.json === 'string') source = flags.json;
  else if (typeof flags.file === 'string') {
    if (!trustFiles) return null;
    try {
      source = fs.readFileSync(path.resolve(cwd || process.cwd(), flags.file), 'utf8');
    } catch {
      return null;
    }
  }
  if (source === undefined) return { ...pairs };
  const data = parseJsonSafe(source);
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...data, ...pairs };
  return null;
}

const BUILT_FROM_SHELL = 'The command builds its Junis call from shell variables, so it cannot be checked.';

// '' when harmless, the reason when not.
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// A value the shell fills in at run time ($VAR) cannot be judged here.
const fromShell = (value) => /[$`]/.test(asText(value));
// A verb, method or tool name the shell may still expand ({DELETE,}, globs).
const expandsInShell = (value) => /[$`{}*?[\]]/.test(asText(value));

// `wiki put` replaces a page when it exists (the command itself backs the page up first). get and append are not asked.
export function wikiCommandReason(action, fileKey) {
  return action === 'put' ? `The command runs wiki put, which replaces the wiki page '${asText(fileKey)}' on Junis if it already exists.` : '';
}

function invocationReason(argv, options = {}) {
  const [verb, ...rest] = argv;
  if (verb === 'wiki') {
    const [action, fileKey] = parseArgs(rest, { booleans: BOOLEAN_FLAGS, pairs: false }).positionals;
    if (expandsInShell(action) || expandsInShell(fileKey)) return BUILT_FROM_SHELL;
    return wikiCommandReason(action, fileKey);
  }
  if (verb !== 'tools' && verb !== 'api') return expandsInShell(verb) ? BUILT_FROM_SHELL : '';
  const parsed = parseArgs(rest, { booleans: BOOLEAN_FLAGS, pairs: true });
  let payload = commandPayload(parsed, options);
  if (payload && fromShell(payload)) payload = null;
  if (verb === 'tools') {
    const [action, name] = parsed.positionals;
    if (expandsInShell(action) || expandsInShell(name)) return BUILT_FROM_SHELL;
    if (action !== 'call' || !name) return '';
    if (payload === null) {
      // Arguments read from stdin or a file this check cannot trust: every tool whose effect depends on them is asked.
      return isDestructiveTool(name) || /^(update_|import_skill_from_|get_mcp_platform$|apply_team_changes$|manage_skill_bundle$)/.test(name)
        ? `The command calls ${name} with arguments that cannot be read here.`
        : '';
    }
    const reason = destructiveReason(name, payload);
    return reason ? `The command calls ${name}: ${reason}` : '';
  }
  let [method, path] = parsed.positionals;
  if (expandsInShell(method) || fromShell(path) || fromShell(parsed.flags.query)) return BUILT_FROM_SHELL;
  if (method && !path && method.startsWith('/')) [method, path] = ['GET', method];
  if (!method || !path) return '';
  const upper = method.toUpperCase();
  if (!HTTP_METHODS.has(upper)) return '';
  if (payload === null) return destructiveApiReason(upper, path) || (upper === 'POST' ? `The command sends a ${upper} body that cannot be read here.` : '');
  const query = parseQuery(parsed.flags.query);
  if (upper === 'GET' || upper === 'DELETE') return destructiveApiReason(upper, path, { query: { ...payload, ...query } });
  return destructiveApiReason(upper, path, { query, body: payload });
}

// Word patterns: the fallback reading of a command line.
function patternCommandReason(text) {
  // Options may sit between the words (`api --pretty DELETE …`, `tools --pretty call …`).
  const call = /(?<=^|[\s;&|()'"])tools\s+(?:--?\w[\w-]*(?:=\S+)?\s+)*call\s+(?:--?\w[\w-]*(?:=\S+)?\s+)*["']?([A-Za-z_]+)/.exec(text);
  if (call) {
    const name = call[1];
    // key=value and --json '{...}' arguments alike (also with \" escapes inside a double-quoted
    // argument), so the command route reads the same rules as a tool call
    const action = /\baction=(delete|remove|unassign)|\\?"action\\?"\s*:\s*\\?"(delete|remove|unassign)/.exec(text);
    const has = (key) => new RegExp(`\\b${key}=|\\\\?"${key}\\\\?"\\s*:`).test(text);
    const flag = (key) => new RegExp(`\\b${key}=["']?true\\b|\\\\?"${key}\\\\?"\\s*:\\s*(true|\\\\?"true\\\\?")`, 'i').test(text);
    const emptyList = (key) => new RegExp(`\\b${key}=["']?\\[\\s*\\]|\\\\?"${key}\\\\?"\\s*:\\s*\\[\\s*\\]`).test(text);
    const guessed = {
      instruction: has('instruction') ? 'x' : undefined,
      action: action ? action[1] || action[2] : undefined,
      env_vars: has('env_vars') || has('auth_config') ? 'x' : undefined,
      clear_fields: has('clear_fields') ? clearedFieldNames(text) : undefined,
      mcp_platforms: has('mcp_platforms') ? [] : undefined,
      tools: emptyList('tools') ? [] : undefined,
      rag_tools: emptyList('rag_tools') ? [] : undefined,
      overwrite: flag('overwrite') ? true : undefined,
      reveal_secrets: flag('reveal_secrets') ? true : undefined,
      dry_run: flag('dry_run') ? true : undefined,
    };
    if (name === 'apply_team_changes') return guessed.dry_run ? '' : 'The command runs a batch of team changes that may delete or replace agents.';
    const reason = destructiveReason(name, guessed);
    if (reason) return `The command calls ${name}: ${reason}`;
  }
  const FLAGS = String.raw`(?:--?\w[\w-]*(?:=\S+)?\s+)*`;
  const wikiPut = new RegExp(String.raw`(?<=^|[\s;&|()'"])wiki\s+${FLAGS}["']?put["']?\s+["']?([^\s"']+)`, 'i').exec(text);
  if (wikiPut) return wikiCommandReason('put', wikiPut[1]);
  const api = new RegExp(String.raw`(?<=^|[\s;&|()'"])api\s+${FLAGS}["']?(DELETE|PUT|PATCH)["']?\s+(\S+)`, 'i').exec(text);
  if (api) return destructiveApiReason(api[1], api[2]);
  const get = new RegExp(String.raw`(?<=^|[\s;&|()'"])api\s+${FLAGS}["']?GET["']?\s+["']?(\S+?)["']?(\s|$)`, 'i').exec(text);
  if (get) return destructiveApiReason('GET', get[1], { query: /\breveal=(false|0|no|off)\b/i.test(text) ? { reveal: 'false' } : {} });
  const post = new RegExp(String.raw`(?<=^|[\s;&|()'"])api\s+${FLAGS}["']?POST["']?\s+["']?(\S+?)["']?(\s|$)`, 'i').exec(text);
  if (post) {
    const mode = /\bmode=(merge|replace)|\\?"mode\\?"\s*:\s*\\?"(merge|replace)/.exec(text);
    const overwrite = /\boverwrite=["']?true\b|\\?"overwrite\\?"\s*:\s*(true|\\?"true\\?")/i.test(text);
    const removal = /confirm_removal=(1|true|t|yes|y|on)\b/i.test(text);
    const dryRun = /\bdry_run=["']?true\b|\\?"dry_run\\?"\s*:\s*(true|\\?"true\\?")/i.test(text);
    return destructiveApiReason('POST', post[1], {
      body: { mode: mode ? mode[1] || mode[2] : undefined, overwrite, dry_run: dryRun || undefined },
      query: removal ? { confirm_removal: 'true' } : {},
    });
  }
  return '';
}
