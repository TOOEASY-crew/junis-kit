# Connecting outside services

Read this when an agent needs a service outside Junis: an MCP server, an app
that needs the user's login, a key for an HTTP API, or the user's own computer.

## Contents

- Which route
- MCP platforms
- OAuth apps (Composio)
- Slack
- Secrets
- The user's computer
- Skills from outside
- When nothing fits

## Which route

| The service | Route |
| --- | --- |
| Already listed by `list_mcp_platforms` | Link that platform |
| Acts on a person's own account (mail, calendar, drive, social media) | OAuth app, if `list_composio_integrations` has it |
| Has a bot token or service key and an MCP server | MCP platform |
| Is a plain HTTP API with a key | Secret plus `custom_api_call` |
| Is the organization's own system, where an agent must perform a fixed operation (above all a write) that a person approves | An action on an Actions connection ([actions.md](actions.md)) |
| Is the user's machine, files or browser | Device |
| Is Slack | See "Slack": chatting in Slack and posting to it are different routes |

When two routes exist, choose by the table, proceed without asking, and state
the choice in the report.

An Actions connection is not a link and brings an agent no tools by itself: it
is the address that typed, approved actions call. Its `mcp` kind reuses a
remote MCP platform registered here for one pinned tool; its `http` and
`webhook` kinds take organization secrets by name.

## MCP platforms

### Steps

1. `list_mcp_platforms`. Prefer an existing global platform over creating one.
2. If it must be created: `create_mcp_platform` (below).
3. `link_agent_mcp(agent_id, platform_id)`.
4. A platform you create is already active. For a global platform,
   `toggle_mcp_active(platform_id, is_active=true)` records the organization's
   activation shown in the web app. Always state `is_active` as true or false:
   without it the call flips the state, and a platform you own that is switched
   off drops out of `list_mcp_platforms` and cannot be linked (400). Any other value
   (such as the text `"false"`) is refused with 422 `invalid_value`.
   For a global platform this activation only decides whether the
   organization's own credential is used: agents linked to it keep running on
   the shared credential when it is switched off here, so unlink them
   (`unlink_agent_mcp`) to stop them using it. A global platform that is
   switched off for every organization cannot be switched on for one (409
   `platform_inactive`), and its address, settings and shared credentials
   cannot be changed with an organization's key (403 `global_platform`).
5. Credentials: the user enters them at `https://junis.ai/team/mcp-skills`:
   the pencil button ("Edit") on the platform for the organization's credential
   (owner or admin), or "My Credentials" for their own.
6. Add the platform's tool names and argument examples to the agent's
   instruction, with the two lines: "Use only what the tools return" and "If
   the connection fails, say so and stop." `list_mcp_platform_tools(platform_id)`
   connects once with the organization's credential and returns the live tool
   names (owner or admin); when the platform cannot connect yet, take the names
   from the server's documentation and check them after the credential is in.
7. Test in a new session.

### Creating a platform

| Kind | Arguments |
| --- | --- |
| Remote server | `name`, `mcp_server_url`, `transport_type` (`streamable-http`, or `sse` for older servers), and `auth_config` if the key is shared by the organization. Only the `headers` object inside `auth_config` is sent to the server; `auth_type` and any other key are stored but never sent, so the server rejects the call (usually 401). |
| Command-based server | Set up by Junis (contact@junis.ai): Only Junis administrators can create a command-based platform or change its command; other keys get 403 `local_mcp_admin_only`. Create a remote server when one exists. An administrator passes `name`, `platform_type="local"`, `command` (for example `npx`), `args`, `env_vars_schema` describing which values the user must enter |

- Command-based servers are set up by Junis (contact@junis.ai); create a
  remote MCP when one exists. On 403 `local_mcp_admin_only`, do not retry and
  do not resend it as a remote server without an address: tell the user Junis
  sets it up.
- When an administrator creates one, `platform_type="local"` is mandatory.
  Without it the platform is stored as a remote server without an address and
  never starts.
- `env_vars` holds real values and is stored encrypted; `env_vars_schema` holds
  descriptions for the entry form, shaped `{"NAME": {"type": "string" or
  "file", "required": true, "description": "…"}}` (`file` hands the value over
  as a file path; `cli_args_mapping` `{"NAME": "--flag"}` passes it as an
  argument). A schema with no stored value at any level makes the platform be
  skipped silently. Do not swap the two. Prefer leaving `env_vars`
  empty and letting the user enter values in the web app, so that no secret
  passes through the conversation.
- A command-based server runs inside the platform and only works if its package
  is available there. Common packages are. For an unusual one, say in the
  report that it may need to be enabled by Junis support.
- Never invent a package name. Look it up, or ask the user for the exact name.
- `transport_type` must be `sse` or `streamable-http`; anything else is refused
  (422). A type that does not match what the server speaks shows up at the
  first call, often as a 405 or a connection error in the agent's answer.

### Credentials

Looked up in this order; the first found is used:

1. The user's own credential for that platform in that organization
2. The organization's credential
3. The platform's built-in credential

A user's credential replaces the organization's, it is not merged with it.
An agent's tools are built once and kept for up to 30 idle minutes. Saving a
credential in the web app clears that; changes made through `update_mcp_platform`,
`toggle_mcp_active` or `delete_mcp_platform` do not, so call `link_agent_mcp`
again for each linked agent (it is idempotent and reloads the agent), then test
in a new session. 401 means the token is wrong or expired; 403 means the token
lacks permission.

### Things to know

- `get_mcp_platform` masks stored values. `reveal_secrets=true` shows them and
  is asked of the user first; use it only when the user asks to see them.
  Through `junis_api`, `GET /management/mcp-platforms/<id>` returns plain
  values unless you pass `query: {reveal: "false"}`, so the kit asks first
  without it. Never show or paste a value; name the keys only.
- Credentials the user entered in the web app (Edit on the platform) are the
  ones the platform runs with, and `get_mcp_platform` shows those (masked).
  `update_mcp_platform` with `env_vars` or `auth_config` replaces them.
- A server address with a credential in it is masked as a whole: a
  `user:password@` or `token@` part, or a query or fragment parameter whose
  name ends in key, token, secret, auth, password, pass, pw, code, config,
  signature, credential, jwt, pat or bearer, plural forms included (`api_key`,
  `apiKey`, `access_token`, an encoded `api%5Fkey`). Names for counts and
  pages (`max_tokens`, `page_token`, `next_token`) are not masked.
  `mcp_server_url` then reads `••••••` and `mcp_server_url_host` shows the
  host. In the command settings the masked view also hides values under a
  credential name (`X-Key`, `DB_PASS`, `api_keys`, lists included; the
  `type`, `description`, `label` and `required` of a variable's description
  stay visible), the `value` of an entry named like a credential
  (`{"name": "Authorization", "value": ...}`; the entry's own `name` or
  `key` field stays visible), `--api-key VALUE`, `--token=...`,
  `API_KEY=...`, `Authorization: ...` and `apikey: ...` anywhere in an
  argument or the command, and values shaped like a known token (`sk-`,
  `xoxb-`, `ghp_`, a JWT, a Slack or Discord webhook address) whatever their
  key. After a flag, an `=` assignment or a one-word `name:value`, a value
  stays readable when it is a mode word (`none`, `oauth2`, `true`), a
  complete template (`${TOKEN}`, `$TOKEN`, `{{...}}`, `%APPDATA%`,
  `<your-...>`), a file path or a number or word of up to 8 letters. In a
  hyphenated header line (`X-Api-Key: ...`), a `{"name": ..., "value": ...}`
  entry or under a credential-named key only a template, or a value made of mode words alone, stays readable
  (`X-Api-Key: Bearer abc...` is masked); a lone `{"key": ...}` with no
  `value` field holds a value and is masked; after a password-like name (`password`, `pass`,
  `pwd`, `passwd`, `passphrase`) only `none`-like words and templates; after
  `Authorization:` or `Cookie:` only templates (the scheme word is skipped).
  So `POSTGRES_PASSWORD=password`, `--password admin`, `X-Api-Key: abcdefgh`
  and `Authorization: Bearer password` are masked, while `--max-tokens
  4096`, `--use-jwt true`, `--auth oauth2`, `ssl_key=/etc/ssl/key.pem` and
  text under `description` or `note` stay readable. A
  secret with no name and no known shape (`-k VALUE`, an `env` entry with a
  plain name, a token inside an address path) is not detected and stays
  visible. The detail of a global platform is always masked: every
  credential value, every setting except variable descriptions and the
  command, and the address (only its host is shown). Sent
  back in an update, the masked address keeps the stored one;
  `create_mcp_platform` refuses it (400 `masked_placeholder`). To copy such a
  platform, ask the user for the address, or read it with
  `reveal_secrets=true` after they agree.
- `update_mcp_platform` merges command settings (the tool does the merge; a
  direct `junis_api PUT` replaces the whole config). The credentials are one
  stored object: `env_vars` or `auth_config` replaces it as a whole (keys you
  leave out are removed; a masked value sent back keeps the stored one),
  `auth_type` alone changes only that label, and `clear_fields=["env_vars"]`
  removes all of them. To change one secret value, the user edits it in the
  web app. Masked values inside a list (such as `args`) are restored in the
  order they were masked. Plain items around them can be added, removed or
  changed (adding and removing in the same update is checked strictly), a
  masked value can be removed when the update only removes items, and
  several entries of a list of objects can be edited in place at once, each
  keeping its own values. A list whose masked values moved (even one, since
  a secret moved next to another flag would then be shown), where only some
  of several adjacent masked values were replaced, where an entry was
  changed and moved at once, where one of two entries of the same shape
  disappeared while something else took its place, or with tens of
  thousands of items or more than 32 levels of nesting is refused (400
  `masked_placeholder`, "could not be matched ... without guessing") rather
  than guessed: make one kind of change at a time, send the real values, or
  leave the field out.
- The test-tube button ("Test Connection") at
  `https://junis.ai/team/mcp-skills` checks a remote platform without running
  an agent; local platforms do not have it.
- A platform that fails to start or answer within its time limit is dropped for
  that session and the agent runs without its tools. The agent's answer then
  usually says the tool is unavailable.
- MCP tools reach the model as `<platform_id>_<tool>`, so two platforms with
  the same tool name do not collide. Only the same platform linked twice is
  deduplicated.
- Platforms of another organization cannot be linked. Create the platform again
  in the target organization.
- Global platforms cannot be edited or deleted from here (404; the
  organization that created one gets 403 `global_platform` on an edit). Create
  an organization platform instead.
- Which of a platform's tools one agent may use, and which need a person's
  approval first: `get_agent_tool_access(agent_id)`, then
  `set_agent_enabled_tools(agent_id, link_type="mcp", link_id, tools)` and
  `set_agent_confirmation_tools`. `update_agent` keeps these selections for
  links that stay linked. Details: [improving.md](improving.md).

## OAuth apps (Composio)

### Steps

1. `list_composio_integrations` without a category. Each entry's `id` is the
   `auth_config_id`. The result can be cut ("truncated … characters"): the
   list carries logos, and one large logo hides every app after it. Then read
   the full list with `junis_api GET /management/composio/integrations`
   (command: `api GET /management/composio/integrations`) and work from
   `toolkit_slug`; filtering by `category` does not help when the large entry
   is in that category. Slack is listed as `slack` (a person's account) and
   `slackbot` (a bot token), category "team chat".
2. `link_agent_composio(agent_id, auth_config_id, is_required)`. Use
   `is_required=true` when the agent cannot do its job without it. A 409 means
   it was already linked.
3. Tell the user: open `https://junis.ai/team/integrations`, press connect on
   the named app, and approve.
4. When they return: `list_composio_connections` shows each connection with
   its status. `get_agent_composio_status(agent_id)` shows what the agent still
   lacks.
5. Test in a new session. Tools of a connection exist only in sessions started
   after it became active.

### Things to know

- Statuses: `PENDING`, `ACTIVE`, `INACTIVE`, `EXPIRED`, `FAILED`. Only `ACTIVE`
  counts. `get_agent_composio_status` cannot tell expired from never
  connected; `list_composio_connections` can.
- `personal` connections belong to one user; each person who uses the agent
  connects their own at `https://junis.ai/team/integrations`. `organization`
  connections are made there once by an owner or admin and shared. A person
  removes their own connection with "Disconnect" on the same page.
- One connection serves any number of agents.
- A required but missing connection does not stop the agent; it runs without
  those tools. Put in the instruction: "If the <app> tools are not available,
  tell the user to authorize <app> and stop."
- In instructions and answers, name the service ("Gmail"), never an id.
- Scheduled runs act as the schedule's creator, so that person's connections
  are the ones used; when the creator has left, the organization owner's.
- An OAuth app brings every tool of the app. Narrow them per agent with
  `get_agent_tool_access` and `set_agent_enabled_tools(link_type="composio")`;
  the web app shows the same selection.

## Slack

| Want | Route |
| --- | --- |
| People chat with the squad inside Slack | The Junis Slack app. An owner or admin installs it at `https://junis.ai/slack` and links a Junis key. Everyone in the workspace who mentions it runs as that key's user: that user's memory is used, and billing follows the organization's Billing Target (by default the organization owner pays). Knowledge search and conversation search answer only the person who installed it. Details: [publishing.md](publishing.md). |
| An agent posts reports to a channel | The `slackbot` OAuth app from `list_composio_integrations` (category "team chat"; a bot token an owner or admin enters once at `https://junis.ai/team/integrations`, shared by the organization). Link it with `link_agent_composio`; the tools arrive as `composio_SLACK_…` names, which `get_agent_tool_access` lists once the connection is active. The platform has no Slack MCP platform; if `list_mcp_platforms` ever lists one, read its settings with `get_mcp_platform` (masked) and use the variable names it shows, never names from memory. |
| An agent posts as a person | The `slack` OAuth app (OAuth, the person's own account), also from `list_composio_integrations`. |

- A bot reaches only channels it was invited to.
- Point test runs at a test channel; posting tools send to real people.

## Secrets

| Kind | Reference | Who registers it | Where |
| --- | --- | --- | --- |
| Organization secret | `{cred:NAME}` | Owner or admin | `https://junis.ai/team/mcp-skills`, "Org Keys" |
| Personal secret | `{cred:private:NAME}` | Any member, for themselves | Same page, "My Keys" |

- Names start with a capital letter, then capitals, digits or underscores (up
  to 128). There is no `{cred:org:NAME}` form. Spell references exactly: a
  misspelt personal reference (`{cred:PRIVATE:NAME}`, a lower-case name) is
  reported as an error only when the block has no correct reference. Otherwise
  it, like any other unknown `{cred:…}` form, is sent as literal text and the
  service usually answers 401.
- References are resolved only inside an API definition block used by
  `custom_api_call` ([instructions.md](instructions.md)) and in the headers of
  an Actions connection or action (organization secrets only;
  [actions.md](actions.md)). Values never reach the model and cannot be read
  back by anyone.
- Personal secrets are refused in anonymous conversations on a public widget:
  there is no signed-in user to take them from. An agent that answers widget
  visitors uses organization secrets.
- You cannot register an organization secret. Design with the reference, and
  put "register NAME" with the link in the user's checklist.
- Personal secrets can be managed through the API with a user-level key
  (`jns_user_`) that has `secrets:manage` (browser login asks for it; a key made
  on the API keys page needs it ticked, or the "Coding agents" preset); an
  organization-level key gets 403. `junis_api PUT /management/me/secrets/<NAME>`
  with `{"value": "…"}` stores or replaces one, `DELETE` on the same path
  removes it, and `GET /management/me/secrets` lists names only. A secret
  belongs to one user in the organization the call targets: pass
  `organization_id`. Only store a value the user supplied for that purpose,
  and prefer that they enter it in the web app.
- If the user sends a key in the chat, do not put it in any instruction.
  Design with a reference and ask them to register it.

### Secrets in connection calls (`@env:`)

Database passwords and API keys must not be typed into the conversation. From
the kit's command line, write `@env:NAME` where a secret goes and the kit
substitutes the environment variable on the machine before anything is sent;
the model never sees the value:

```
export DB_PASSWORD=…   # in the shell that runs the kit
node <skill>/scripts/junis.mjs tools call knowledge_add_postgres_source --json '{"organization_id":"<uuid>","host":"db.example.com","database":"shop","user":"reader","password":"@env:DB_PASSWORD"}'
node <skill>/scripts/junis.mjs tools call knowledge_db_connect --json '{"organization_id":"<uuid>","kind":"oracle","host":"…","database":"FREEPDB1","user":"READER","password":"@env:ORA_PASSWORD"}'
```

`@env:` works at any depth of the JSON. A missing variable is an error, never
an empty string. Without a shell (MCP tool calls only), pass a **stored**
secret instead of the value: `password_secret_name` / `api_key_secret_name` =
an organization secret name (Org Keys, stored by an owner or admin in the web
app) or `private:NAME` for the calling user's My Keys (stored with
`junis_api PUT /management/me/secrets/NAME`, above). `private:NAME` works only
with a user-level key (400 `invalid_secret_ref` otherwise); an unknown name is
400 `secret_not_found`. The platform resolves the name server-side; no endpoint
returns a secret value. A validation error from the platform repeats the
submitted body; the kit removes that part before showing the error.

## The user's computer

A device is a machine running the Junis device agent. Agents linked to it can
run commands, read and write files and drive a browser there.

### Steps

1. The user runs `npx junis` in a terminal on that machine, chooses background
   mode, and approves the connection in the browser window that opens.
2. Tell the user beforehand what approval does: it registers the machine,
   on the first connection creates a small workspace organization with an
   assistant agent for it, and makes that organization the one shown in the
   web app. They can switch back in the web app; a reconnect reuses the
   organization.
3. `list_devices` shows the key owner's devices with `status`. It must be
   `online` when the agent runs (linking works either way). Listing and
   linking need the role owner or admin.
4. `link_agent_device(agent_id, device_id)`. The device's tools attach to that
   agent. No entry in `tools` is needed.
5. Test in a new session.

### Things to know

- Only owners and admins link devices to agents. From here they link their
  own devices; in the web app (`https://junis.ai/team/orchestration`, agent →
  Local Devices) they can also attach another owner's or admin's device. A
  member's device can be linked only after that member is made an owner or
  admin. `https://junis.ai/team/devices` only lists and removes devices.
- Linking works while the device is offline; its tools attach only if it is
  online when a session starts.
- Link devices to sub-agents. The orchestrator does not load device tools.
- An offline device is skipped without an error; the agent runs without those
  tools. Put a fallback in the instruction. For a schedule, list a device tool
  in `metadata.required_tools` so a run without it is marked
  `required_tool_missing` ([schedules.md](schedules.md)).
- Tool names are lower case with underscores: `execute_command`, `read_file`,
  `list_processes`, `kill_process`, `browser_navigate`, and others.
- The platform stops waiting for a device call after thirty minutes, but the
  process on the machine keeps running. For long jobs the agent starts the
  command in the background and checks on it.
- Commands run with the user's own rights on their machine. Write into the
  instruction what the agent must not touch (system folders, credentials,
  anything outside the project folder), and that destructive commands need the
  user's confirmation. Scheduled runs have nobody to confirm: list the exact
  commands the agent may run instead.
- On macOS, screen tools need Screen Recording and Accessibility permissions
  granted in System Settings; browser tools need a browser runtime
  (`npx playwright install chromium`).
- Do not register a device as an MCP platform. The device agent's local HTTP
  mode listens only on this machine by default (from `junis` 0.4.7), where
  any program on the machine can call it. `--host` opens it to the network
  behind a bearer token but over plain HTTP, so keep it off shared networks.

## Skills from outside

Skills package reusable know-how for agents inside Junis.

| Source | Tool |
| --- | --- |
| A repository or folder on GitHub | `import_skill_from_github(url)` |
| An npm package or an install command | `import_skill_from_npx(command)` |
| A local folder or file | `import_skill_from_upload(file_content_base64, filename)` with a ZIP or a `SKILL.md`, at most 10 MB after decoding (`@base64:path` on the command line) |
| Written now | `create_skill`, then `write_skill_file` for reference files |

Then `assign_skill(agent_id, skill_id)`, or group skills with
`manage_skill_bundle` and assign the bundle.

An import with `overwrite=true` replaces an existing skill of the same name;
the user is asked first. An imported skill with a `scripts/` folder becomes a
code skill by itself (runtime from the script files).

- Only LLM agents use skills.
- The agent sees each skill's name and description and loads the body when it
  decides to. A vague description means the skill is never used.
- No braces in a skill's name or description.
- Edit with `get_skill` then `patch_skill`. System skills are read-only.
  `get_skill` returns every reference file by default; pass
  `include_files=false` for a skill with large files.
- For code skills pass `container_type="code_execution"` together with
  `runtime` (`python` or `node`; use `node` for JavaScript even where a tool
  schema says `javascript`) and `e2b_template` from `list_e2b_templates`.
  Without `container_type` the skill is a text skill and the agent gets no
  `run_code` or sandbox tools. `packages` lists extra packages for the
  skill's sandbox.
- Skills of another organization cannot be assigned; create them again in the
  target organization.

## When nothing fits

1. Look for another route to the same service: an HTTP API with a registered
   secret instead of a missing MCP server, or a public MCP server the user can
   name.
2. If there is none, tell the user the integration is not available yet and
   that new integrations are requested at `contact@junis.ai`.

Build everything else regardless, and list the missing connection in the
report.
