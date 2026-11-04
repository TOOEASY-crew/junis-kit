#!/usr/bin/env node
// Junis kit command line. One file is the entry point for every agent:
// the skill calls it through the shell, agents that speak MCP start it with
// the `mcp` subcommand, and the installer is the `install` subcommand.
//
// Output contract: results go to stdout as JSON (one document), messages for
// humans go to stderr. Exit code 0 on success, 1 on failure, 2 on misuse.
import fs from 'node:fs';
import readline from 'node:readline';
import { BOOLEAN_FLAGS, parseArgs, parseQuery, resolvePayload, expandFileReferences, readStdin, shellWord } from './lib/args.mjs';
import { KIT_VERSION, credentialsPath, deleteProfile, loadStore, loginUrl, resolveProfile } from './lib/config.mjs';
import { destructiveApiReason, destructiveReason } from './lib/destructive.mjs';
import { KitError } from './lib/http.mjs';
import { unwrapToolResult } from './lib/mcp-remote.mjs';
import { openInBrowser } from './lib/browser.mjs';
import { seconds } from './lib/run.mjs';
import * as kit from './lib/kit-tools.mjs';

const HELP = `junis ${KIT_VERSION} — operate Junis from any agent

Setup
  status [--offline]                 Connection state, organizations, next step
  login [--browser [--restart] [--wait-seconds n] [--scopes read-only|operator|all|a,b]|--from-clipboard|--key-stdin|--from-env] [--keep-clipboard]
                                     --browser: approve a key request in the browser, nothing to copy
                                     --scopes: ask for fewer permissions than the default (all)
  logout
  org list | org use <name|slug|id>
  install [--agents a,b|all] [--dry-run] [--full|--lazy] [--force] [--home dir] [--no-cli]
  uninstall [--agents a,b] [--dry-run] [--purge] [--home dir] [--no-cli]
  doctor [--home dir]                Check the local setup end to end

Operate
  tools [search words] [--category c] [--limit n|--all]
  tools describe <name>
  tools call <name> [key=value ...] [--json '{...}' | --file payload.json] [--timeout s]
                                     key=@path reads a value from a file
  api <METHOD> <path> [key=value ...] [--query k=v,k2=v2] [--json|--file]
  run <agent|orchestrator> <message|@file> [--session id] [--wait-seconds n|--no-wait]
  session status <session-id>        Is it still running?
  session wait <session-id> [--wait-seconds n]
  session messages <session-id> [--tail n|--all] [--page-size n]
  lint <file ...|-> [--allow key1,key2] Check instruction text before saving
  snapshot [--org id] [--out file]      Save an organization's squad as JSON
  snapshot list | snapshot show <file> <agent> | snapshot diff <older> <newer>

Agent integration
  mcp [--lazy]                       stdio MCP server (used by agent configs)

Global flags
  --profile <name>   --org <uuid>   --pretty   --help   --version
  --yes              Run a destructive api or tools call without a terminal (stdin not a TTY),
                     after the user agreed. Without it such a call stops with exit code 2.
  "--" ends flag parsing; everything after it is positional text.
`;

function print(data, { pretty = false } = {}) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, pretty || process.stdout.isTTY ? 2 : 0);
  process.stdout.write(`${text}\n`);
}

function note(message) {
  process.stderr.write(`${message}\n`);
}

function applyGlobalFlags(flags) {
  if (typeof flags.profile === 'string') process.env.JUNIS_PROFILE = flags.profile;
  if (typeof flags.org === 'string') process.env.JUNIS_ORG_ID = flags.org;
}

// On the command line nothing can ask. A person at a terminal typed the call
// themselves; an agent (stdin is a pipe) must have asked the user first and
// says so with --yes. The bridge has its own confirmation and never comes here.
function requireYes(reason, flags) {
  if (!reason || flags.yes || process.stdin.isTTY) return;
  throw new KitError(reason, {
    code: 'needs_confirmation',
    hint: 'Tell the user exactly what will be removed or replaced and ask. Only if they agree, run the same command again with --yes.',
  });
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // Echo nothing while the key is typed or pasted. This relies on an
    // undocumented readline hook; if a Node release drops it, say so rather
    // than silently echoing the key.
    if (typeof rl._writeToOutput === 'function') {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
      };
    } else {
      process.stderr.write('Warning: this Node version cannot hide input; the key will be visible while you type it.\n');
    }
    rl.question(question, (answer) => {
      rl.close();
      rl.output.write('\n');
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new KitError('Login cancelled', { code: 'cancelled' }));
    });
  });
}

async function commandBrowserLogin(flags) {
  const pending = await kit.startBrowserLogin({ restart: Boolean(flags.restart), scopes: kit.parseKeyRequestScopes(flags.scopes) });
  if (!pending.api_key && !pending.stored) {
    note(`Approve the key request at ${pending.verification_uri}`);
    // The browser opens only for a person at a terminal; an agent relays the link.
    openInBrowser(pending.verification_uri, { allowedOrigin: resolveProfile().web_url });
  }
  const interactive = Boolean(process.stdout.isTTY);
  // A person at a terminal waits here. An agent gets a new link at once, to relay,
  // and waits on the next run, after the user has approved.
  const out = await kit.finishBrowserLogin({ waitSeconds: seconds(flags.wait_seconds, interactive ? 600 : pending.reused ? 90 : 0) });
  if (out.status === 'waiting_for_approval') {
    // Quoted when the name has characters a shell would split or expand.
    const again = pending.profile ? ` --profile ${shellWord(pending.profile)}` : '';
    return { ...out, then: `After the user approves, run \`login --browser${again}\` again within five minutes: it continues the same request.` };
  }
  return out;
}

async function commandLogin({ flags }) {
  const options = { keepClipboard: Boolean(flags.keep_clipboard) };
  if (flags.browser || flags.device) return commandBrowserLogin(flags);
  if (flags.scopes !== undefined) {
    throw new KitError('--scopes applies to --browser only', {
      code: 'usage',
      hint: 'A pasted key already has the permissions chosen when it was created on the API keys page; choose them there.',
    });
  }
  if (flags.from_clipboard) return kit.connect({ ...options, fromClipboard: true });
  if (flags.key_stdin) return kit.connect({ ...options, key: readStdin() });
  if (process.env.JUNIS_API_KEY && flags.from_env) return kit.connect({ ...options, key: process.env.JUNIS_API_KEY });

  // Same choice as connect: this run's overrides only, so the sign-in page shown is
  // never a host saved by an earlier override login.
  const profile = resolveProfile({ profile: process.env.JUNIS_PROFILE || 'default', storedUrls: false });
  if (!process.stdin.isTTY) {
    // Started by an agent: there is no terminal to type into, so hand back
    // the steps for the agent to relay instead of hanging on a prompt.
    // The next command runs in a new process: repeat this run's flags, or a
    // partner key would be saved as the default key and made the one in use.
    // Taken from what this run resolved, so JUNIS_PROFILE set for this one
    // command is carried over as well as the flag.
    const again = profile.name !== 'default' ? `--profile ${shellWord(profile.name)}` : '';
    const steps = kit.setupSteps(profile);
    if (again) steps.then = steps.then.replace('`login --from-clipboard`', `\`login --from-clipboard ${again}\``);
    return { ...steps, reason: `No interactive terminal. Use --from-clipboard${again ? ` ${again}` : ''} after the user copies the key.` };
  }
  note(`Get your API key at ${loginUrl(profile)}`);
  const key = await promptHidden('Paste the API key (input is hidden): ');
  return kit.connect({ ...options, key });
}

function commandLogout() {
  const profile = resolveProfile();
  kit.forgetBrowserLogin(profile.name);
  const removed = deleteProfile(profile.name);
  const remaining = Object.keys(loadStore().profiles);
  return {
    logged_out: removed,
    profile: profile.name,
    ...(remaining.length ? { other_profiles: remaining } : {}),
    note: removed
      ? `Removed the stored key from ${credentialsPath()}. The key itself stays valid until it is revoked at ${loginUrl(profile)}.`
      : 'No stored key for this profile.',
  };
}

async function commandOrg({ positionals }) {
  const [action = 'list', ...rest] = positionals;
  if (action === 'list') {
    const profile = resolveProfile();
    const organizations = await kit.fetchOrganizations(profile);
    return { default_organization_id: profile.organization_id || null, organizations };
  }
  if (action === 'use') {
    if (!rest.length) throw new KitError('Usage: org use <name|slug|id>', { code: 'usage' });
    return kit.useOrganization(rest.join(' '));
  }
  throw new KitError(`Unknown org action "${action}"`, { code: 'usage' });
}

async function commandTools({ positionals, flags, pairs }) {
  const [action, ...rest] = positionals;
  if (action === 'describe') {
    if (!rest[0]) throw new KitError('Usage: tools describe <name>', { code: 'usage' });
    return kit.describeTool(rest[0]);
  }
  if (action === 'call') {
    const name = rest[0];
    if (!name) throw new KitError('Usage: tools call <name> [key=value ...]', { code: 'usage' });
    const payload = expandFileReferences(resolvePayload({ flags, pairs }) || {});
    requireYes(destructiveReason(name, payload), flags);
    const profile = resolveProfile();
    const timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : undefined;
    const raw = await kit.callRemoteTool(name, payload, { timeoutMs });
    const result = unwrapToolResult(raw);
    if (!result.ok) {
      throw new KitError(result.error, kit.explainError(result.error, profile));
    }
    return result.data;
  }
  // Anything else is a search: `tools`, `tools schedule`, `tools list`.
  const words = action === 'list' || action === 'search' ? rest : positionals;
  return kit.findTools({
    query: words.join(' '),
    category: typeof flags.category === 'string' ? flags.category : '',
    limit: flags.limit ? Number(flags.limit) : flags.all ? 1000 : 25,
  });
}

async function commandApi({ positionals, flags, pairs }) {
  let [method, path] = positionals;
  if (method && !path && method.startsWith('/')) [method, path] = ['GET', method];
  if (!method || !path) throw new KitError('Usage: api <METHOD> <path> [key=value ...]', { code: 'usage' });
  const upper = method.toUpperCase();
  const payload = expandFileReferences(resolvePayload({ flags, pairs }));
  const query = parseQuery(flags.query);
  // For reads, key=value pairs are the query string; for writes, the body.
  if (upper === 'GET' || upper === 'DELETE') {
    const merged = { ...(payload || {}), ...query };
    requireYes(destructiveApiReason(upper, path, { query: merged }), flags);
    return kit.callApi({ method: upper, path, query: merged });
  }
  requireYes(destructiveApiReason(upper, path, { query, body: payload ?? {} }), flags);
  return kit.callApi({ method: upper, path, query, body: payload ?? {} });
}

function commandLint({ positionals, flags }) {
  const allowedKeys = typeof flags.allow === 'string' ? flags.allow.split(',').map((key) => key.trim()).filter(Boolean) : [];
  // Reading stdin is explicit ("-"): a caller that forgot the file name must
  // not hang on an open pipe.
  if (!positionals.length) throw new KitError('Usage: lint <file ...|->', { code: 'usage' });
  const files = positionals.map((target) => {
    const text = target === '-' ? readStdin() : fs.readFileSync(target, 'utf8');
    return { file: target === '-' ? '(stdin)' : target, characters: text.length, ...kit.lint(text, { allowedKeys }) };
  });
  const ok = files.every((file) => file.ok);
  return { ok, files, exitCode: ok ? 0 : 1 };
}

const COMMANDS = {
  status: ({ flags }) => kit.status({ check: !flags.offline }),
  login: commandLogin,
  logout: commandLogout,
  org: commandOrg,
  tools: commandTools,
  api: commandApi,
  lint: commandLint,
  run: async (context) => (await import('./lib/run.mjs')).commandRun(context),
  session: async (context) => (await import('./lib/run.mjs')).commandSession(context),
  snapshot: async (context) => (await import('./lib/snapshot.mjs')).commandSnapshot(context),
  install: async (context) => (await import('./lib/installer.mjs')).commandInstall(context),
  uninstall: async (context) => (await import('./lib/installer.mjs')).commandUninstall(context),
  doctor: async (context) => (await import('./lib/doctor.mjs')).commandDoctor(context),
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    print(KIT_VERSION);
    return 0;
  }

  // Commands whose positionals are prose or names keep "key=value" tokens.
  const prose = ['run', 'session', 'org', 'lint', 'snapshot'].includes(command);
  const parsed = parseArgs(rest, { booleans: BOOLEAN_FLAGS, pairs: !prose });
  if (parsed.flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  applyGlobalFlags(parsed.flags);

  if (command === 'mcp') {
    const { runBridge } = await import('./lib/bridge.mjs');
    await runBridge({ mode: parsed.flags.lazy ? 'lazy' : 'full' });
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    note(`Unknown command "${command}".\n`);
    process.stderr.write(HELP);
    return 2;
  }

  const result = await handler(parsed);
  let exitCode = 0;
  if (result && typeof result === 'object' && 'exitCode' in result) {
    exitCode = result.exitCode;
    delete result.exitCode;
  }
  if (result !== undefined) print(result, { pretty: Boolean(parsed.flags.pretty) });
  return exitCode;
}

// Exit explicitly once output is flushed: a run handed back as "running"
// leaves its request open, and that must not keep the command from returning.
function finish(code) {
  process.stdout.write('', () => process.exit(code));
}

main()
  .then(finish)
  .catch((err) => {
    const payload = err instanceof KitError ? err.toJSON() : { error: 'internal', message: err.message };
    if (err.code === 'not_logged_in' && !payload.detail) payload.detail = kit.setupSteps(resolveProfile());
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    finish(err.code === 'usage' || err.code === 'needs_confirmation' ? 2 : 1);
  });
