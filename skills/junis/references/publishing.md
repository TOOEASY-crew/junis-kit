# Putting a squad in front of people

Read this when a squad should serve people beyond its builder: a website chat
widget, a public team page, a Slack bot, a shared result, or teammates with
roles. The switches are the user's, in the web app; this file says what each
one exposes and who pays.

## Contents

- Website chat widget
- Knowledge graph widget
- Public team page and showcase
- Slack
- Sharing a chat or a result
- Team roles and who pays

## Website chat widget

Owners and admins set it at `https://junis.ai/settings/organization` →
Publish. The iframe code for `https://junis.ai/embed/<slug>` appears only after
Embed Mode is set to Public Anonymous.

| Setting | Effect |
| --- | --- |
| Embed Mode | "Team Members Only" (default) keeps the website widget off: `/embed/<slug>` answers "not available" and there is no iframe code (members use the web app, or `/team/public/<slug>` when the team is public). "Public Anonymous": anyone on an allowed site chats without signing in, and the organization's billing switches to the owner for everyone, members included |
| Allowed Domains | Up to 20 exact origins (`https://www.example.com` is not `https://example.com`); other sites are refused |
| Messages per visitor | 1 to 500 per 24 hours, default 20 |
| Blocked Tools for Public Widget | Tools visitors cannot use, MCP and Composio tools included (shown only in Public Anonymous mode) |
| Spoken Replies | Server voice, billed to the owner; off by default (shown only in Public Anonymous mode) |

Anonymous visitors run under the owner's account: the owner pays and tools act
with the owner's access. The owner's identity is not passed on: `{user_email}`
and `{user_name}` are empty in visitors' turns.

- Always refused: the owner's memory (not read, not written), changing the
  personality (it still shapes answers), the wiki, other squads, conversation
  search, code execution, jev tools, media generation.
- Knowledge answers only from sources marked "Shared publicly" at
  `https://junis.ai/team/knowledge` (per ready source, not database sources;
  `GET /brain/sources` shows `public_in_widget`). Search only: no graph facts,
  no path, count, what-if, documents or SQL. With none shared, it finds nothing.
- Everything else runs with the owner's access unless blocked: RAG agents
  (visitors can read the whole store), MCP platforms, Composio apps,
  `custom_api_call` with organization secrets. Personal secrets are refused.
- Visitor conversations appear in `list_sessions` under the owner, unmarked.

A test run from the kit runs as you, where every tool works, so it proves
nothing about the widget. Ask the user to ask one question through the widget
on their allowed site and report the answer. Opened directly,
`https://junis.ai/embed/<slug>` says the domain is not allowed.

## Knowledge graph widget

Switch it on at `https://junis.ai/team/knowledge` → "Embed the knowledge graph
on your site" and add the site under Publish → Allowed Domains (the chat embed
mode does not matter). It shows only entities and relations from sources marked
"Shared publicly", without summaries, attributes or passages. With "Require
signed embed token" on, the site's server calls `POST /brain/embed-token` with
`{"embed_domain": "https://site"}` (a `brain:read` key) for each page view and
uses the returned `embed_url` (token in the `#t=` fragment). A token works once,
for five minutes (`ttl_seconds` up to 600). 409: the graph widget is off; 403:
the domain is not allowed. Never put the API key in browser code.

## Public team page and showcase

- "Public Team" (Publish tab, or `https://junis.ai/admin/dashboard` →
  Settings) lists the team on `https://junis.ai/showcase` and opens
  `https://junis.ai/team/public/<slug>`. Any signed-in Junis user can then chat
  with the squad without an invitation, at the owner's cost unless Billing
  Target is Individual Users. Confirm with the user first.
- It is independent of the widget: a private organization can embed Public
  Anonymous, and a public one still needs the widget settings.
- Welcome Suggestions (chips on the first chat screen) and the Setup Guide are
  in dashboard Settings. Cloning is offered only for Junis template teams.

## Slack

- The install lands in the web app's current organization, so an owner or
  admin first switches to it (the `?join=` link, [user-steps.md](user-steps.md)),
  installs at `https://junis.ai/slack`, then links a key on the success page:
  their own key or an organization key of that organization.
- One linked key serves the whole workspace. Everyone who mentions @Junis runs
  as that key's user: that user's memory is read and written, and billing is as
  for that user (the owner under the default Billing Target). Link a key made
  for this purpose.
- Knowledge and conversation search answer only the installer; others are
  refused. A workspace-wide knowledge bot needs a RAG agent
  ([knowledge.md](knowledge.md)).
- `@Junis *OrgName* question` picks an organization; plain mentions go to the
  default one, set by the installer in dashboard Settings → Slack. Channels
  need a mention; direct messages do not. Attached files serve that turn only
  and are not added to Knowledge.

## Sharing a chat or a result

| What | How | Link |
| --- | --- | --- |
| A conversation, read-only | Share in the chat | `https://junis.ai/shared/<slug>`, anyone can open it |
| An HTML result | the code block's preview → Publish to Web | `https://junis.ai/publish/<slug>`, public switch and view count |
| Generated images and video | automatic; delete at `https://junis.ai/team/content` | `https://junis.ai/content/<id>` |

## Team roles and who pays

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| Invite at `https://junis.ai/team/members` (needs the inviter's own Basic or Pro monthly plan); switch a role between Admin and Member | yes | yes | no |
| Make someone an owner, or change or remove an owner: not in the web pages or the kit (the pages offer only Admin and Member and never edit or remove an owner row); ask Junis staff at `contact@junis.ai` | no | no | no |
| Remove a member at `https://junis.ai/settings/organization` → Members (never an owner) | yes | yes | no |
| See the member list there | yes | yes | yes |
| Rename the organization in the web app; delete it | yes | no | no |
| Billing Target, Publish, dashboard Settings, install Slack | yes | yes | no |

- The owner pays for everyone by default (Billing Target "Team Owner"), also in
  new and cloned organizations. "Individual Users" bills each member, and stops
  a Public Anonymous widget, which needs the owner to pay.
- Whoever pays sees the spending on their own `https://junis.ai/usage`, By AI
  Team. Dashboard → Usage shows activity, not cost.
- `update_organization` changes name and description (owner or admin of that
  organization). Never send `settings` with `junis_api PUT
  /management/organizations/<id>`: that replaces the whole settings object and
  can switch the graph widget off.

The user's steps for each surface, with their links, are in
[user-steps.md](user-steps.md) ("Putting a squad in front of people").
