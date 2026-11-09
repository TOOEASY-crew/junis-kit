# Actions: letting agents act in the user's systems

Read this when an agent should do something in the organization's own system
(open a ticket, order a part, send an event) as a fixed, typed operation that
a person approves before use and whose every run is recorded.

## Contents

- What an action is, and when to use one
- What you can do, and what only a person can
- The steps
- Connections
- Writing a definition
- Importing from OpenAPI
- Copying actions to another organization
- Running and reading results
- On an agent
- The user's part
- Errors
- A worked example

## What an action is, and when to use one

| Term | Meaning |
| --- | --- |
| Connection | One outside system: its address and how to authenticate. Kinds: `http`, `webhook`, `mcp`, `simulate`. |
| Action | One typed operation on a connection: name, description, parameters (JSON Schema), a request template, an effect and a risk level. Every change is a new version: `draft` → `approved` → `disabled`. |
| Run | The record of one execution: who asked, which action and version, the arguments, who approved, the result. Refusals and failures are recorded too. |
| Assignment | The action names given to one agent. Each approved one is that agent's tool `action_<name>`. |

| The user wants | Route |
| --- | --- |
| An agent that reads or explores a service freely, with many tools | MCP platform or OAuth app ([connections.md](connections.md)) |
| One agent calling an HTTP API whose request it composes from its instruction | `custom_api_call` ([instructions.md](instructions.md)) |
| A fixed operation, above all a write, that must be approved before use, takes only the stated parameters, can require a person's confirmation per run, and is listed afterwards | An action |

Choose an action whenever the user wants an agent to *do* something in their
system under control. The model fills in parameter values only: the address,
headers and body shape come from the definition a person approved, so a
prompt cannot redirect the call. An organization with no actions is unchanged.

## What you can do, and what only a person can

| From here | Only a person, in the web app |
| --- | --- |
| Create, test, change and delete connections | Approve a draft: nothing can call an action before that |
| Create, change and delete drafts; import drafts from OpenAPI; dry-run | Disable an approved action |
| Assign actions to agents | Approve or reject a run that is waiting |
| Run approved actions; read the run log | Change, or switch back on, a connection that approved actions use (409 `connection_in_use` from here) |

The right column has no tool and no route a key can call. Do not look for
one, and do not ask for the person's password or session to do it.
**Never report an action as live, working or available to agents until
`actions_get` shows an `approved` version.** A draft does nothing; say
"drafted, waiting for your approval" and give the step
("The user's part").

Permissions: `actions:read` (overview, connections, definitions, runs),
`actions:manage` (connections, drafts, dry runs, import, assignment) and
`actions:run`. They are never among a key's defaults. Browser login asks for
them, and so does the "Coding agents" preset; a key made before that, or with
the default permissions, lacks them. On 403 `insufficient_scopes` the user
ticks them with "Add permissions" on `https://junis.ai/settings/api-keys`, or
connects again with browser login. Reading and managing need the role owner
or admin. An owner's or admin's key runs every approved action; a member's
key with `actions:run` runs only the actions an admin opened to members with
a roles rule ("Writing a definition"), and gets 403 `precondition_failed` on
the rest.

## The steps

Pass `organization_id` on every call. A definition's fields ("Writing a
definition") are the arguments of `actions_draft_create`.

| Step | Tool | Notes |
| --- | --- | --- |
| 1. Look | `actions_overview`, `actions_connections`, `actions_list` | `enabled: false` means Actions are off for this organization (every other call then answers 404 `feature_disabled`): stop and say so. Reuse an existing connection. |
| 2. Connection | `actions_connection_create` (`name`, `kind`, `config`) | Nothing connected yet, or the secret is not registered: use `simulate` and go on. |
| 3. Test it | `actions_connection_test` | `http`: checks the address and that the secrets exist, sends nothing. `webhook`: sends one signed `junis.ping` event to the real endpoint, so say so first. `mcp`: lists the server's tools with their input schemas. `simulate`: always ok. |
| 4. Draft | `actions_draft_create`, or `actions_import_openapi_preview` → `actions_import_openapi` | Returns the draft's `id`, `version` and `tool_name`. |
| 5. Dry run | `actions_dry_run` (`definition_id`, `args`) | Shows the request that would be sent (`preview`) and the one-line `summary`; `would_fail` (`code`, `message`) is there when a real run with these arguments would be refused by a precondition. Sends nothing, records nothing, works on a draft. Show the preview to the user. |
| 6. Approval | none: the user | Stop here and hand over ("The user's part"). Continue when `actions_get` shows `approved`. |
| 7. Assign | `actions_agent_get` → `actions_agent_set` (`agent_id`, `actions`) | The list replaces the agent's whole list: read it, add, send all (at most 40). Asked of the user first. |
| 8. Run | `actions_run` (`name`, `args`) | Acts in the outside system. Asked of the user first, every time; `dry_run=true` is not. |
| 9. Read | `actions_runs` (`state`, `action`, `target_entity_id`, `limit`), `actions_run_get` | Up to 200 per call, newest first. `state` is one of `awaiting_approval`, `executing`, `succeeded`, `failed`, `unknown`, `rejected`, `expired` (422 `invalid_state` otherwise). |

Rules that hold across the steps:

- Only a draft can be edited or deleted (409 `not_a_draft` for an approved or
  disabled version, 404 `not_found` for an id that does not exist). To
  change an approved action, create a draft with the same name: it becomes the
  next version, the approved one keeps running until a person approves the new
  one, and approval disables the old one. One open draft per name (409
  `draft_exists` carries its `definition_id`: edit or delete that one).
- `actions_draft_update` replaces the draft: read it with `actions_get`, change
  it, send every field again. A field left out goes back to its default (no
  parameters, no preconditions, the default risk) without a warning. Only the
  name and, when `connection` is empty, the connection are kept.
- `actions_list` shows the newest version of each name, so an action with an
  approved version and a newer draft is listed as `draft`. `actions_get`
  returns `approved` (what runs now), `latest` and all `versions`.
- A connection no approved action uses is yours to change or delete. Once
  approved actions use it, a key can neither delete it, change its config nor
  switch it back on (409 `connection_in_use`: it would change where approved
  actions send data, so a person does it in the web app). Switching one off
  (`is_active=false`) always works and stops its actions.
- Without the tools, the same calls are `junis_api` under `/actions`:
  `GET /actions/overview`, `/actions/connections`, `/actions/definitions`,
  `/actions/definitions/<name>`, `/actions/runs`, `/actions/runs/<id>`,
  `/actions/agents/<agent_id>`, `/actions/export`; `POST /actions/connections`,
  `/actions/connections/<id>/test`, `/actions/definitions`,
  `/actions/definitions/<id>/dry-run`, `/actions/import/openapi/preview`,
  `/actions/import/openapi`, `/actions/import` (send `"dry_run": true` first;
  without it the route imports), `/actions/run` (with an `Idempotency-Key`
  header); `PUT` and `DELETE` on a connection or a draft;
  `PUT /actions/agents/<agent_id>`.

## Connections

Names are lower case with digits and underscores (2 to 64 characters).

| `kind` | `config` | The action's `executor` |
| --- | --- | --- |
| `http` | `{"base_url": "https://…", "headers": {"Authorization": "Bearer {cred:NAME}"}, "allowed_hosts": []}`, or instead of that header `"auth": {"type": "oauth2_client_credentials", "token_url": "https://…", "client_id": "…", "client_secret": "{cred:NAME}", "hosts": […]}` | `{"method", "path", "query", "headers", "body"}` |
| `webhook` | `{"url": "https://…", "secret_name": "NAME"}` (during a key change also `"previous_secret_name": "OLD"`: every event is signed with both) | `{"event_type": "ticket.opened", "body": {…}}` |
| `mcp` | `{"platform_id": "<from list_mcp_platforms>"}` | `{"tool": "<tool name>", "arguments": {…}}` |
| `simulate` | `{}` | `{"output": {…}}` |

- **Secrets never go into a connection or a definition.** A header holds
  `{cred:NAME}`, a webhook names its signing secret; the value lives in Org
  Keys (`https://junis.ai/team/mcp-skills`), is filled in only as the request
  leaves, and appears in no preview, run or log. A user without a webhook
  signing secret yet creates the connection in the web app (Team → Actions →
  Connections → Webhook → "Create a new secret"): Junis makes the secret,
  stores it as an Org Key and shows it to them once, with verification code
  for the receiver. Do not ask the user to paste a secret into this chat. A header that looks like a
  credential (`Authorization`, `X-Api-Key`, a name with token, secret, cookie
  or password) is refused unless it holds a `{cred:NAME}` reference. If the
  user pastes a key into the chat, do not send it anywhere: pick a name, ask
  them to register it under Org Keys, and tell them to replace the pasted key.
- A reference belongs in the connection's or the definition's headers only.
  Any argument value that contains `{cred:` is refused (`bad_arguments`)
  before anything is sent, wherever it would land: a caller or a model can
  never choose which secret is sent.
- The Org Key must exist before the connection is saved (422 `missing_secret`
  lists the names). Until the user has registered it, build and try the action
  on a `simulate` connection.
- `http`: https only, no query string or user name in `base_url`. Requests go
  only to the host of `base_url` and the exact hosts in `allowed_hosts` (at
  most 10); redirects are not followed; private network addresses are refused.
  `path` starts with `/` and holds no query string (use `query`). `body` goes
  with POST, PUT and PATCH only.
- `webhook`: a Standard Webhooks v1 delivery (`webhook-id`,
  `webhook-timestamp`, `webhook-signature`) with the body `{"type",
  "timestamp", "data"}`; `data` is the rendered `body`. A failed delivery is
  retried whatever `idempotent` says, with the same `webhook-id`, so the
  receiver must ignore an id it has seen. An endpoint that answers 410
  switches the connection off.
- `mcp`: a remote MCP server already registered in the organization with its
  credential. Take `tool` and its arguments from `actions_connection_test`.
  Leaving `arguments` out passes the parameters as they are. Approval pins the
  tool's name, description and input schema; if the server changes the tool,
  the run stops with `tool_changed` and the action moves to `needs_check`:
  agents and runs stop using it until a person reviews the tool and approves
  it again in the web app (which pins the tool as it is now) or disables it.
- `http` with `auth` (OAuth2 client credentials): Junis requests the token
  from `token_url` with the client ID and the Org Key named in
  `client_secret`, keeps it encrypted until it expires, and sends it as a
  Bearer token only to the connection's hosts (`hosts` lists every allowed
  host other than the token server's). A 401 from the API gets one fresh
  token and one resend; a token that cannot be issued means nothing is sent
  (`auth_failed`).
- `simulate`: sends nothing and answers with `output` (parameters filled in).
  Use it to show the whole flow (draft, dry run, approval, agent tool, run log)
  before any system is connected, and for demos. Say plainly that it is
  simulated; moving to the real system is a new version on a real connection,
  approved again.

## Writing a definition

```json
{
  "name": "open_maintenance_ticket",
  "title": "Open a maintenance ticket",
  "description": "Open a maintenance ticket for one piece of equipment. Use when a fault needs a technician; do not use for questions about existing tickets.",
  "connection": "cmms",
  "params_schema": {
    "type": "object",
    "properties": {
      "equipment": {"type": "string", "description": "Equipment tag, for example P-101"},
      "summary": {"type": "string", "maxLength": 200},
      "priority": {"type": "string", "enum": ["low", "normal", "high"]}
    },
    "required": ["equipment", "summary", "priority"]
  },
  "fixed_args": {"site": "ulsan-1"},
  "executor": {"method": "POST", "path": "/tickets", "body": {"site": "{site}", "asset": "{equipment}", "title": "{summary}", "priority": "{priority}"}},
  "effect": "write",
  "risk": "confirm",
  "idempotent": false,
  "summary_template": "Open a {priority} ticket for {equipment}: {summary}",
  "timeout_s": 30,
  "rate_limit_per_hour": 30
}
```

| Field | Write it so that |
| --- | --- |
| `name` | Lower-case words with underscores, 2 to 48 characters; the agent's tool is `action_<name>`. It cannot be renamed. |
| `connection` | It names the connection the executor is written for. A definition without one, or on a `simulate` connection, may carry only `executor.output`; an HTTP, webhook or MCP executor without its connection is refused (422 `invalid_action`). |
| `description` | It says what the action does and when to use it (10 to 2,000 characters; keep it under 900). This is all the agent reads to decide. The platform adds what it acts on and that a person confirms. |
| `params_schema` | Few, typed, top-level parameters (at most 30): string, integer, number, boolean, a list of plain values, or a one-level object. `enum`, `minimum`, `maximum` and `maxLength` are enforced on every run, so put the limits here. Unknown parameters are refused. |
| `fixed_args` | Every value the model must not choose (site, project, channel, account) is here, not a parameter. Names differ from the parameters'. |
| `executor` | `{name}` inside text inserts the value as text; a string that is exactly `"{name}"` keeps the value's type (number, boolean, object). Only parameter and `fixed_args` names are allowed. |
| `effect` | Honest: `read`, `write` or `destructive` (cannot be undone: deletes, cancellations, payments). |
| `risk` | `auto` runs at once, `confirm` needs one person, `two_person` two different admins. Left out, `read` gets `auto` and everything else `confirm`. Never set `auto` on a write to get past the approval; propose it only when the user asks for unattended runs and say what that means. |
| `idempotent` | `true` only when sending the same request twice is harmless. The platform then sends up to three times on a timeout, a dropped connection, a 5xx or a 429, and a run that still got no answer ends `failed`, safe to run again. With `false` it sends once and reports `unknown` when no answer came. |
| `preconditions` | Conditions that must all hold, at most 10: `{"param", "op", "value"}` with `equals`, `not_equals`, `in`, `lte`, `gte`, `exists`, or `{"roles": ["OWNER", "ADMIN", "MEMBER"]}` for who may run it. A roles rule checks the organization role of the person the run is for: whoever presses Run in the web app, the owner of the session an agent is working in, or the owner of the API key. With no roles rule, API keys of owners and admins can run the action, members' keys cannot, and an agent it is assigned to runs it for any user. A roles rule without `MEMBER` also stops that agent when it is acting for a member. Listing `MEMBER` opens the action to members' own API keys as well: add it only when the user wants that, and tell them it is a deliberate widening, since any member can put `actions:run` on a key and then call the action directly. |
| `summary_template` | One line with `{name}` values (at most 300 characters). It is what the approver reads on the card and in the run list, so it must say what will happen to what. |
| `timeout_s`, `rate_limit_per_hour` | 1 to 120 seconds (default 30); an optional cap on runs per hour. |

When the organization uses Knowledge, a text parameter can point at an entity:
`"x-entity-type": "Equipment"` makes the value resolve to exactly one entity
of that kind by name, alias or id (none or several: `unknown_entity`, nothing
runs), and its proper name is what gets sent. `"x-target": true` on one such
parameter records that entity as the run's target, so `actions_runs` can list
what was done to it; `target_type` names the kind for the agent. Use these only
with a kind that exists in the knowledge map ([knowledge.md](knowledge.md));
otherwise leave the parameter as plain text.

## Importing from OpenAPI

`actions_import_openapi_preview` (`spec`: the JSON or YAML text itself, not a
URL, at most 2 MB) lists each operation with the name, effect and risk it
would get, whether it is `importable`, and warnings. `actions_import_openapi`
(`spec`, `connection`: `{"name", "headers"}`, plus `"base_url"` when the
document names no https server; `operations`: up to 100 chosen `operation_id`
values) then creates the HTTP connection, or reuses one of that name, and one
draft per operation. It saves everything or nothing (422 `invalid_operations`
names the ones in the way) and is asked of the user first.

- Import the few operations the agents need, not the whole document.
- GET becomes `read`/`auto`, DELETE `destructive`, the rest `write`. Only GET
  operations come in as `idempotent`; leave the others off unless the user
  confirms that repeating that request is harmless. Header and cookie
  parameters, form bodies and anything past 30 parameters are left out.
  Authentication belongs to the connection's `headers`.
- Imported drafts are raw: rewrite each description for the agent, move fixed
  values into `fixed_args`, add a `summary_template`, check effect and risk,
  then dry-run before asking for approval.

## Copying actions to another organization

`actions_export` returns one `junis.actions/v1` document: every connection and,
per action, the version in use (`exported_status` says which). It holds no
secret values (headers carry `{cred:NAME}`, a webhook names its Org Key) and no
pinned MCP fingerprint. `actions_import` (`document`: that object) previews by
default (`dry_run` true) with the same checks as the real import (the Org Keys
and MCP server a connection names must exist in the target organization):
show the user each row's `result` (`would_create`, `exists` — a connection with
that name and kind is kept as it is — or `skipped` with a `reason` such as
`kind_mismatch`, `draft_exists`, `missing_secret`, `connection_inactive`,
`connection_not_found`), then call again with `dry_run: false` only after they
agree, and report the rows of that answer.

- Nothing is overwritten, and every action comes in as a draft that a person
  approves in the web app of the target organization.
- The Org Keys the document names must exist there first; an MCP connection
  names a server of the source organization and is skipped elsewhere until
  one with the same id exists.
- One bad row does not stop the others; read the result instead of assuming
  everything arrived.

## Running and reading results

`actions_run` (`name`, `args`, optionally `idempotency_key`, `dry_run`) runs
the approved version. Give every write an `idempotency_key` built from the
request (for example `ticket-P-101-2026-11-06`): the same key with the same
arguments returns the first run (`replayed: true`) instead of acting again,
even when the action's hourly limit is used up, and the target receives it as
an `Idempotency-Key` header. Without one the
tool makes a key for that single call and returns it, which does not protect
a later resend. With `dry_run=true` the arguments, entity references and
preconditions are checked and the request is shown, nothing more.

The call stays open while the platform executes, up to several minutes for an
action that retries. If it ends without a result (a timeout, a dropped
connection, a 5xx), the run may still have happened: find it with
`actions_runs(action=<name>)`, or call again with the same `idempotency_key`
and the same arguments. Never start it under a new key.

| `status` | Meaning | What to do |
| --- | --- | --- |
| `succeeded` | The system answered 2xx; `output` holds its answer (cut at 8,000 characters) | Check the promised thing exists, then report it. For `simulate`, say nothing was sent. |
| `awaiting_approval` | Nothing has run. A key cannot confirm, so every `confirm` and `two_person` run from here waits for a person (`approvals_needed`, `expires_at`, 24 hours) | **Do not send it again**: that files a second request. Give the user the Approvals step and the `summary`; read the outcome later with `actions_run_get`. |
| `unknown` | The request was sent and then timed out or the connection dropped, or the run was interrupted (`error.code: interrupted`). The system may have processed it | **Never run it again on your own.** Tell the user it may have happened and to check the target system (or check it with a read action); run again only after it is confirmed absent and they agree. |
| `failed` | It never reached the system (refused before sending, or no connection could be made), or the system answered with an error (`http_status`). `error.code` and `error.message` say which | Fix the cause ("Errors"), then it can be run again. |
| `rejected` | A person refused it; the reason is in `error.message` | Report it. Do not resubmit unchanged. |
| `expired` | Nobody decided within 24 hours; nothing ran | Ask whether it is still wanted before submitting again. |
| `executing` | Its approvals are complete and the request is being sent now | **Do not send it again.** Read it with `actions_run_get` until it ends. |
| `dry_run` | A preview | Nothing happened. |

A run filed for approval executes with the arguments stored at that moment,
after the approval, even when this session has ended. If the action was
disabled or replaced in between, the run fails instead of using the new
version. A run costs no credits by itself; an agent that calls an action is
billed for its model turn as usual.

## On an agent

- `actions_agent_set` gives an agent its actions; each approved one arrives as
  the tool `action_<name>` with the definition's description and parameters,
  on the orchestrator or a sub-agent. `actions_agent_get` shows `actions`
  (assigned) and `active` (assigned and approved). A draft can be assigned
  ahead of time; it becomes a tool once approved. Never list `action_…` names
  in an agent's `tools`. Test in a new session. An agent's `execute_code`
  scripts cannot call `action_…` tools; the agent calls them directly.
- In a squad file ([build-and-verify.md](build-and-verify.md), "The squad as
  a file") an agent's `"actions": ["name", …]` is the same assignment.
  Connections and definitions are not in the file. Assignments are not part
  of an agent's version history: to undo one, set the previous list again.
- Name the tool in the instruction and say when to call it; the agent reads
  the result's `status` like any tool result. Add: "If the result says
  `awaiting_approval`, tell the user it is waiting for approval and do not
  call it again. If it says `unknown`, say the outcome is not known and stop."
- Who confirms: an `auto` action runs wherever the agent runs. A `confirm`
  action shows a confirmation card to the person in the web chat and runs
  when they agree. Where nobody can answer (scheduled runs, children of
  sequential, parallel and loop agents, agents called as tools,
  `call_another_squad`, direct agent API calls) it is not run, the same rule
  as tools on a confirmation list ([improving.md](improving.md)). A
  `two_person` action is never run by an agent: the call is filed as
  `awaiting_approval`. Anonymous visitors of the public widget cannot run any
  action.
- So give `confirm` actions to agents people talk to, and make an unattended
  squad's actions `auto` (reads, or writes the user accepts unattended) or
  expect them to wait for approval. A run started from here cannot answer the
  card: verify a `confirm` action with `actions_run` plus the user's approval,
  or have the user ask the agent in the web chat.

## The user's part

Web pages show the organization selected in the web app
([user-steps.md](user-steps.md)).

| Step | Where |
| --- | --- |
| Register the secret a connection refers to | `https://junis.ai/team/mcp-skills` → Org Keys, with the exact name |
| Review and approve a draft (parameters, request, effect, risk) | `https://junis.ai/team/actions` → Actions tab → "Approve" on the draft's row → "Approve this version" |
| Approve or reject a run that is waiting | `https://junis.ai/team/actions?tab=approvals` → "Approve" or "Reject" on the run |
| Disable an action; start a new version | `https://junis.ai/team/actions` → Actions tab → "Disable", "New version" on the approved row |
| Assign actions to an agent by hand | The same row → "Assign to agents", or `https://junis.ai/team/orchestration` → edit the agent → Actions |
| Change a connection that approved actions use | `https://junis.ai/team/actions?tab=connections` → "Edit", or the switch, on the connection |
| Add `actions:read`, `actions:manage`, `actions:run` to a key that lacks them | `https://junis.ai/settings/api-keys` → Add permissions, or browser login again |

The page (Team menu → Actions) is for owners and admins. Its Runs tab shows
the same log as `actions_runs`.

When handing over an approval, give the action's name, what it will send
(the dry-run preview), its effect and risk, and the link. Continue when they
say it is done, and verify with `actions_get`.

## Errors

| Code | Cause | Fix |
| --- | --- | --- |
| 403 `insufficient_scopes` | The key lacks `actions:read`, `actions:manage` or `actions:run` (made before Actions existed, or with the default permissions) | The user adds them (above), or connects again with browser login. |
| 404 `feature_disabled` | Actions are switched off for the organization, or not enabled on the platform yet; every call answers this, runs included | Nothing to do from here: `contact@junis.ai`. |
| 404 `action_not_found` on a run | No approved version of that name (still a draft, disabled, or misspelt) | `actions_get`; hand the draft over for approval. |
| 422 `invalid_action`, `invalid_connection` | The definition or connection failed validation; `errors` lists each fault (an executor that does not fit its connection is one) | Fix every listed item and send again. |
| 404 `not_found` | The connection, definition or run id does not exist in this organization | List them again and use the id from that answer. |
| 422 `missing_secret` | An Org Key the connection or action refers to is not registered | The user registers it under that exact name; meanwhile use `simulate`. |
| 422 `connection_not_found` | The draft names a connection that does not exist | `actions_connections`; fix the name. |
| 409 `name_taken`, `draft_exists`, `not_a_draft`, `connection_in_use` | See "The steps" | Reuse, edit the open draft, create a new version, or hand over to the user. |
| `bad_arguments` | The arguments do not fit `params_schema` (`expected` shows the schema), or a value contains `{cred:` | Correct the arguments. Nothing ran. |
| `unknown_entity` | An entity parameter matched no entity, or several | Use the exact name from Knowledge. Nothing ran. |
| `precondition_failed` | A condition or the caller's role does not allow this run (a dry run shows it beforehand as `would_fail`). With 403 and "Only owners and admins can run this action with an API key": the key belongs to a member and the action has no roles rule listing `MEMBER` | Report it; do not change the arguments to get past it. For a member's key, an owner or admin runs it, or a new version with the roles rule is approved if the user wants members to run it. |
| `call_limit` (status `skipped`) | The agent already ran 10 actions in this turn | Report what was done and ask before running more. |
| 429 `rate_limited` | The action's hourly cap was reached (a repeat under a used `idempotency_key` is still answered) | Wait. Do not loop. |
| `idempotency_key_reused` | The key was used with other arguments | Use a new key for a different request. |
| `auth_failed` | The OAuth2 token server refused or did not answer (the message carries its error) | Check the client ID, the client secret's Org Key and the token URL. Nothing was sent. |
| `host_not_allowed`, `ssrf_blocked` | The request would leave the connection's allowed hosts, or the address is on a private network | Fix `base_url` or `allowed_hosts` (a person, if approved actions use the connection). |
| 409 `connection_inactive` | The connection is switched off or was removed, or the MCP server has no usable credential | Switch it on or attach a connection; then a new version is approved. |
| `tool_changed` | The MCP tool differs from the one approved; the action is now `needs_check` | Tell the user. A person reviews the tool and approves the action again in the web app, or disables it. |
| `executor_error` | The system answered with an error (`http_status`, `output`), could not be reached, or the run could not be recorded | Read the message and the run's `status`: `failed` can be fixed and run again, `unknown` cannot. A 3xx means the address redirects: point the connection at the final address. |
| `interrupted` | The run was cut off while executing and closed as `unknown` | Have the target system checked before anything is run again. |
| `not_sent` | The run was cut off after its approvals and before anything was sent; closed as `failed` | Nothing reached the system. It can be run again with the user's agreement. |

## A worked example

"Let the maintenance agent open tickets in our CMMS."

1. `actions_overview`: enabled, no connections. The user has not registered
   the CMMS key yet, so start simulated:
   `actions_connection_create(name="cmms_sim", kind="simulate", config={})`.
2. `actions_draft_create` with the definition above, `"connection":
   "cmms_sim"` and `"executor": {"output": {"ticket_id": "SIM-1", "asset":
   "{equipment}", "priority": "{priority}"}}`.
3. `actions_dry_run(definition_id, args={"equipment": "P-101", "summary":
   "Seal leak", "priority": "high"})`: show the user the `summary` ("Open a
   high ticket for P-101: Seal leak") and the preview.
4. Report: drafted and simulated, nothing is sent anywhere, not usable until
   approved. Their part: approve `open_maintenance_ticket` at
   `https://junis.ai/team/actions`; register `CMMS_TOKEN` under Org Keys for
   the real system.
5. After approval: `actions_agent_set` for the maintenance agent (asked
   first), add the call rule to its instruction, then `actions_run` with an
   `idempotency_key` (asked first). The action is `confirm`, so the result is
   `awaiting_approval`: point the user to Approvals and send nothing again.
   Once approved, `actions_run_get` shows `succeeded` with the simulated
   output.
6. When `CMMS_TOKEN` exists: `actions_connection_create(name="cmms",
   kind="http", config={"base_url": "https://cmms.example.com/api",
   "headers": {"Authorization": "Bearer {cred:CMMS_TOKEN}"}})`,
   `actions_connection_test`, then a new draft of the same name on `cmms` with
   the HTTP executor above, a dry run, and the user's approval of version 2.
   The agent's assignment stays; the tool now calls the real system.
