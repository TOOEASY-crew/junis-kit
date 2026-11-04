# Connecting to Junis

Read this when the connection state says `logged_in: false`, when a call is
rejected for access reasons, or when the user wants another account,
organization or environment.

## Contents

- First connection
- Which key the user needs
- Choosing the organization
- Access errors
- Other environments and accounts
- Disconnecting

## First connection

The user approves once in the browser. You do the rest. Nothing is copied, so
this works in remote shells and containers too.

1. Tell the user, in their language: you will give them a Junis page where they
   approve a key for this agent. Signing in with Google creates an account on
   first use. Using Junis from outside the web app needs a Basic or Pro plan
   (`https://junis.ai/subscription`).
2. Start the request: tool `junis_connect` with `method: "browser"`, or command
   `login --browser`. The result has a link (`verification_uri`); give it to
   the user. In a terminal the command also opens it.
3. The user opens the link, signs in, checks the 26 permissions asked for
   (every permission this skill uses: the web "Coding agents" preset minus two
   unused admin scopes), presses Approve and comes back.
4. Finish: call `junis_connect` with `method: "browser"` again. After it
   returns the link, the tool keeps waiting in the background and stores the
   key the moment the user approves; the next call reports the result, waiting
   up to 45 seconds if the approval is still pending, and shows the link again
   if it is not approved yet. The command `login --browser` run by an agent
   (no terminal) returns the link at once; run it again after the user
   approves, within five minutes of the approval: it continues the same
   request and waits up to 90 seconds. A person at a terminal waits in the
   command itself. Either way the key is verified and saved in
   `~/.junis-kit/credentials.json`, readable only by the user.
   A request waits about five minutes for approval, and an approved key waits
   five minutes to be collected. A 429, a 5xx or a refusal from a proxy while
   waiting is retried. Each profile has its own waiting request, reused only
   for the same server; `restart: true` (`--restart`) discards it and starts
   anew.
5. Read the result.
   - `connected: true` with one organization: it becomes the default. Tell the
     user you are connected and to which organization.
   - Several organizations: ask which one to work in (see below).
   - No organization: offer to create one.
   - An error: see "Access errors", or [troubleshooting.md](troubleshooting.md)
     for errors of the login itself.

The new key is listed on `https://junis.ai/settings/api-keys` as "Junis kit-…".
It lasts one year and counts toward the limit of five active keys.

A narrower key: `login --browser --scopes read-only` asks only for reading
(sessions, agents, organizations, content, RAG, Knowledge and wiki reads),
`--scopes operator` adds running squads and reading their results, and a
comma-separated list of permission names asks for exactly those. Without
`--scopes` the request asks for every permission (the default; building needs
it). A request the platform refuses is an error, never widened. The clipboard
route has no such option: the user picks the permissions when creating the key
on the API keys page, and `JUNIS_API_KEY` works with a key of any width.

Other ways to connect:

- Clipboard: the user opens `https://junis.ai/settings/api-keys`, presses "New
  Key", presses "Coding agents (recommended)", names the key (for example
  "coding agent"), creates it, presses the copy button next to it and says it
  is copied. Then call `junis_connect` (the default method) or `login
  --from-clipboard`: the key is read, verified and stored, and the clipboard
  is cleared. Do not use the automatic `junis-magic-auto` key: it is a key
  the platform uses; leave it in place. At the five-key limit, revoke a key no
  longer in use (never `junis-magic-auto`).
- Hidden prompt: the user runs `node <skill folder>/scripts/junis.mjs login`
  in a separate terminal window. Started by an agent (no terminal), `login`
  returns the setup steps instead of a prompt.
- Automation: set the environment variable `JUNIS_API_KEY`.

Ask the user never to paste a key into the chat: a pasted key stays in the
conversation history. If they paste one anyway, use it (`login --key-stdin`
with the key on standard input, never as a command argument), then suggest they
revoke it on the API keys page and create a new one.

## Which key the user needs

| Key | Starts with | Can do |
| --- | --- | --- |
| User-level | `jns_user_` | Everything in this skill, across all the user's organizations; building needs the role owner or admin in that organization. |
| Organization-level | `jns_live_` | One organization. Made by an owner or admin at `https://junis.ai/admin/dashboard` → API Keys. By default it only runs agents and reads sessions; management permissions can be picked when it is created. Partner permissions (accounts for another app's users) exist only on these keys. It works in its own organization only. |

A key from browser login or the "Coding agents (recommended)" preset holds
every permission below. A key made with the default permissions covers
building, running, schedules, skills, MCP, Composio and RAG, and needs these
added for four more areas:

| Area | Permission to add |
| --- | --- |
| Knowledge (Second Brain) through the API | `brain:read`, and `brain:manage` for any change: sources, the knowledge map, graph imports and their previews |
| The user's own credential vault | `secrets:manage` |
| Deleting RAG documents (`delete_datastore_file`, `DELETE /rag/...`) | `rag:delete` |
| The organization wiki through the API | `wiki:read`, `wiki:manage` |

To add a permission, the user presses "Add permissions" next to the key on the
API keys page, or connects again with browser login. Permissions can be added
to a key but not removed: to drop one, revoke the key and make a new one. An
account can hold five active keys. Creating a key needs a Basic or Pro plan
(credit packs alone do not count); the automatic key exists without one but
does not work until the account subscribes.

Leave `junis-magic-auto` in place; it is a key the platform uses. Create a new
key for this kit instead of revoking it.

## Choosing the organization

`junis_status` lists the organizations the key can reach, with the user's role
in each. Building and managing need the role OWNER or ADMIN.

- Set the default with `junis_use_organization` (name, slug or id). It is stored
  on this machine only.
- The default is a convenience for reads. On every call that changes something,
  still pass `organization_id` explicitly, taken from the status result.
- When the user names an organization mid-conversation ("now do the same for
  GlobexSales"), resolve the name to its id and say which organization you are
  switching to.
- To create one: `create_organization` with `name` (at least three characters)
  and a lowercase, hyphenated `slug`. A taken slug gets a random suffix: use the
  returned `id` and `slug`; the orchestrator is `orchestrator-<returned slug>`.
  Creating an organization also switches the user's web app to it; say so.
  Plans limit how many organizations an account can own (Free 1, Basic 3, Pro
  unlimited); a limit error names the plan.
- To rename an organization or change its description: `update_organization`
  (owner or admin of that organization). Renaming also renames its orchestrator to
  `Orchestrator_<new name>`; its id `orchestrator-<slug>` stays. Never send
  `settings` through `junis_api PUT /management/organizations/<id>`: it
  replaces all of the organization's settings.

## Access errors

| You see | Meaning | What to do |
| --- | --- | --- |
| `not_logged_in` | No key stored | Run the first connection steps. |
| 401, "Invalid or expired API key" | Key revoked, expired (keys last one year) or mistyped | Connect again (browser login makes a new key). |
| 403 `subscription_required`, `no_subscription`, `invalid_plan` | No active Basic or Pro plan | The user subscribes at `https://junis.ai/subscription`. Then retry. |
| 402 `insufficient_credits` | The paying balance is empty. Credits belong to people: by default the organization owner pays for everyone | Credits are bought at `https://junis.ai/subscription`. "Organization credits are insufficient" or `billing_role: member` means the owner must add them. Schedules switched off for this reason must be enabled again. |
| 403 `insufficient_scopes` | The key lacks a permission; the message lists `missing_scopes` | Personal key: the user adds them ("Add permissions", above) or connects again with browser login. Organization key: an owner or admin makes a new one with those permissions picked (it cannot be extended). |
| 403 "Organization admin or owner access required" | The user is a MEMBER there | An owner or admin changes the role at `https://junis.ai/team/members`, or pick another organization. |
| 403 "You don't have access to this organization" | The UUID is not an organization this key's user belongs to | Resolve the id with `list_organizations`. (A name or slug is refused earlier as `bad_organization_id`.) |
| 403 `email_domain_not_allowed` | The organization restricts member email domains | An owner or admin allows the domain at `https://junis.ai/admin/dashboard` → Settings. |
| 400 "No organization specified" | No `organization_id` and no default | Pass `organization_id`. |
| 429 `rate_limit_exceeded` | Over the key's limit (by default 100 calls a minute; 2,000 an hour for a personal key, 3,000 for an organization key) or the organization's (300 a minute by default). The key's own limits are shown on the API keys page and can be raised there (up to 1,000 a minute, 100,000 an hour); the response's `X-RateLimit-*` headers show them too | Wait the `Retry-After` time. Never retry in a loop. |

An empty list is not always an empty organization: members see only their own
sessions and schedules.

## Other environments and accounts

| Need | How |
| --- | --- |
| A second account or a test key | `login --profile <name>` stores a separate key; the key in use stays the same unless none was stored yet. A plain `login` always stores the user's own key as `default` and makes it the key in use (a partner key stored first is kept). Use the other key with `--profile <name>` after a command, or `profile="<name>"` on `junis_api`. `status` lists stored profiles under `other_profiles`. |
| Private deployment | Set `JUNIS_API_BASE`, `JUNIS_MCP_URL` and `JUNIS_WEB_URL`. Use the exact MCP URL without a trailing slash. A host outside `junis.ai` (and not this machine) is refused with `host_not_allowed` until `JUNIS_ALLOW_CUSTOM_HOST=1` is set as well; `junis_status` then names the host. A `login` under an override saves the address in the profile. |
| Accounts for another app's users (partner integration) | An organization key made with "Connect users from my own app", stored with `login --profile partner`. Everything else is in [partner-accounts.md](partner-accounts.md). A user key gets 403 on all of it. |

## Disconnecting

`logout` removes the stored key in use from this machine (`logout --profile
<name>` removes another one), and any waiting browser-login request. Other
stored keys stay but are not used until
named or logged in again. A key itself stays valid until the user revokes it on
the API keys page. `uninstall --purge` removes the kit, every stored key and
any waiting browser-login request.
