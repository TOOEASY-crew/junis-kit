# Security

The Junis kit holds a key that can build, change and run agents in your Junis
organizations. This page says how to report a problem, what the kit keeps on
your machine, and how to take a key back.

## Reporting a vulnerability

Email **contact@junis.ai** with "junis-kit security" in the subject. Please
include:

- the kit version (`node <kit>/skills/junis/scripts/junis.mjs --version`) or
  the commit you installed;
- the agent you used it with and how the kit was installed (plugin,
  `install.sh`, skill only);
- steps to reproduce, and what an attacker could gain.

Do not open a public GitHub issue for a vulnerability, and do not include a
working API key in the report. Problems in the Junis platform itself (junis.ai,
its API or its hosted MCP server) go to the same address.

Fixes land on `main` and in the next release tag.

## Supported versions

| Version | Supported |
| --- | --- |
| The latest release tag (`v0.1.0`) | Yes |
| `main` | Yes. Every commit on `main` reaches plugin users. For a fixed version, install with `install.sh` and a tag (`JUNIS_KIT_REF`). |
| Older tags | No: move to the latest tag |

## What the kit stores on your machine

Everything lives under `~/.junis-kit` (or `JUNIS_KIT_HOME` if you set it). The
folder is created with mode 0700.

| Path | Contents | Secret |
| --- | --- | --- |
| `credentials.json` (mode 0600 on macOS and Linux; on Windows the file takes the folder's permissions, and `doctor` does not check them) | Which profile is in use, and for each profile: the Junis API key; the default organization's id, name and slug; the environment and the API, MCP and web addresses it uses; when it was saved | **Yes** |
| `pending-login.json`, `pending-login.<profile>.json` (mode 0600, one per profile) | While a browser approval is waiting: the request code, the one-time verifier the kit uses to collect the key, the approval link, and the profile and server the request is for. If an approved key arrived but could not be checked, the file also holds that key until it is stored, `login --browser --restart` discards it, or you log out of that profile or run `uninstall --purge`. Otherwise the file is removed when the request is declined, you log out of that profile or run `uninstall --purge`, or five minutes after the approval window ends; once the key is stored, only a marker without secrets stays until then. | **Yes** while it holds a received key; otherwise short-lived |
| `snapshots/<organization>/*.json` (mode 0600) | Organization snapshots you asked for: agents with their instructions, schedules, MCP platform settings as the platform lists them, skills, document stores, personality text | Treat as sensitive |
| `skills/junis/`, `src/`, `dist/junis-skill.zip`, `install.json` | The installed skill, the downloaded kit, the Claude Desktop archive, and a record of the last install | No |

Outside that folder the installer creates a `junis` link to the skill in each
agent's skills folder (a copy where links are unavailable), writes the `junis`
entry in each agent's MCP configuration, and keeps a backup next to each
configuration file it changes. The entry is the command
`<node> …/junis.mjs mcp [--lazy]` and contains no key. Before every change it
copies the file to `<file>.junis-kit-backup-<time>` (mode 0600). A backup
holds whatever your configuration held before, and uninstalling keeps it.

If you set `JUNIS_API_KEY`, the kit uses that value and does not need the
file.

## What leaves your machine

- Requests go to `https://api.junis.ai` and `https://mcp.junis.ai`.
  `JUNIS_API_BASE`, `JUNIS_MCP_URL` and `JUNIS_WEB_URL` override those
  addresses; an override wins over whatever a profile saved. An override is
  accepted when it is https and its host is `junis.ai`, a subdomain of it, or
  this machine (loopback, where plain http is allowed too). Any other host is
  refused with the error `host_not_allowed` unless `JUNIS_ALLOW_CUSTOM_HOST=1`
  is set as well; then `junis_status`, `doctor` and the bridge's start-up log
  name the host the key is sent to. `JUNIS_WEB_URL` only sets the links the
  kit shows and opens, but follows the same rule. `install.sh` also clones the
  kit from GitHub.
- A `login` run while an override is set saves that address in the profile,
  and later runs without the override keep using it (the bridge reads the
  saved profile). A saved address outside `junis.ai` fails the same way as an
  override until `JUNIS_ALLOW_CUSTOM_HOST=1` is set or you run `logout` and
  connect again without the override.
- The key is sent only in request headers. Requests that carry it never
  follow redirects, and `junis_api` paths cannot leave the External API root.
- The key is never written to an agent's configuration. `junis_status` and
  `junis_connect` return a masked form only (the prefix, four characters and
  the length), so the key does not enter the conversation unless you paste it
  there.
- Tool results do enter the conversation: agent answers, session messages,
  instructions, documents. So does any value you ask the agent to send, which
  includes a service secret stored in your Junis vault through `junis_api`
  or put into an MCP platform's settings. To keep such a secret out of the
  conversation and away from your model provider, enter it at
  https://junis.ai/team/mcp-skills instead.

## Confirmation before destructive calls

The kit asks before deletions, whole-text and credential replacements, list
replacements, `clear_fields`, overwriting imports, revealing stored secrets
(including a `junis_api` read of an MCP platform without `reveal=false`),
Knowledge POSTs that replace data, and Actions calls that reach beyond a
draft: running an action (it acts in your own system; a dry run is not
asked), replacing an agent's action list, changing or deleting a connection,
deleting a draft and importing an OpenAPI document. The kit has no way to
approve an action or a waiting action run; a person does that in the web app.
The exact rules are in `skills/junis/scripts/lib/destructive.mjs`.

How it asks depends on the agent. In the Claude Code plugin a PreToolUse hook
asks, including for kit commands run through Bash. In other agents the
tools carry `destructiveHint` annotations, and in lazy mode the kit returns
`needs_confirmation` until the agent calls again with `confirmed=true`. The
agent sets that flag itself, so the check makes it stop and ask but cannot
prove that you answered. In full mode outside the plugin, platform tools rely
on their `destructiveHint` and your agent's approval prompt, while `junis_api`
and secret-revealing reads still return `needs_confirmation`. On the command
line, a destructive `api` or `tools call` run without a terminal (standard
input is not a TTY, which is how agents run it) stops with exit code 2 and
the reason until it is run again with `--yes`; a person at a terminal is not
asked. Your agent's approval for shell commands applies as well.

What the Bash hook can and cannot see: it inspects a command line by name and
by shape. It reads lines that name `junis.mjs` or `junis-kit`, and lines of
the form `node <any script> api …` or `node <any script> tools call …`, so a
copy or link of `junis.mjs` under another name is caught. A wrapper script or
program that calls the kit from inside (`./deploy.sh`, `make clean`, a Python
script) is not caught: the hook sees only the outer command. A line it cannot
follow (command substitution, `eval`, a script run through a variable, a
cut-off event) is asked about rather than let through. Claude Code gives each
hook run 10 seconds (`hooks/hooks.json`); if the hook does not answer in time,
or its input is not an event it can read and does not name the kit, Claude
Code continues with its normal permission flow, that is, the hook fails open.

## Taking a key back

1. Open https://junis.ai/settings/api-keys and revoke the key the kit uses. A
   key approved through the browser is listed there too, named `Junis kit-…`
   unless you named it yourself when approving. A key you approved but the kit
   never collected (it must collect it within five minutes of the approval) is
   listed too; revoke it. `junis.mjs status` shows the start of the stored key, which
   helps to find it. Leave the automatic `junis-magic-auto` key in place; it
   is a key the platform uses.
2. Remove the local copy:
   `node ~/.junis-kit/skills/junis/scripts/junis.mjs logout` (add
   `--profile <name>` for another profile), or `uninstall --purge`, which also
   removes the kit from your agents.
3. If the key was pasted into a chat, committed or otherwise exposed, revoke it
   first. Removing the local file does not revoke a key.

To connect again, ask the agent to check the Junis connection.

## Updates and pinning

Plugin users receive every commit on `main` when they update, and `install.sh`
installs the latest commit on `main` unless `JUNIS_KIT_REF` names a tag or
branch. To control when new code runs next to your key, pin `install.sh` to a
release tag (`JUNIS_KIT_REF=<tag>`), read the changes before moving to a newer
one, and keep plugin auto-update off if you want to review updates first.
