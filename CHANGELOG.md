# Changelog

All notable changes to the Junis kit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
release tags users pin with `JUNIS_KIT_REF`.

## [Unreleased]

### Added

- Partner accounts (`references/partner-accounts.md`): deleting an account the
  organization made (`DELETE /api/external/management/users/<user_id>`, 30-day
  grace period, `…/deletion/cancel`), reading the accounts' usage by period
  (`GET /api/external/management/usage`, scope `usage:read`, a key the owner
  created), reading an account's personal wiki pages with `on_behalf_of`
  (scope `wiki:read_delegated`), the separate rate limit for `on_behalf_of`
  chats, and the `active` field of the account list.
- Wiki (`references/memory-and-identity.md`): a person's own pages as
  `@me/<key>` with their own key, and the organization setting that lets
  members read the shared wiki through agents.
- Schedules (`references/schedules.md`, `references/agent-tools.md`): a member
  creates schedules with their own key, the limits for plain members (200
  running schedules, 10 minutes apart at least), and the five tools the
  orchestrator now has for the schedules of the person chatting.

- Wiki: `junis_wiki` and `wiki` gain `verify` (a person confirms a page is
  correct today — text and version stay, its review timer restarts; hosted
  `POST /api/external/management/wiki/verify`) and `lint` (read-only check of
  the whole wiki — pages past their review date, broken `[[links]]`, orphans,
  empty pages, missing annotations, oversized pages — with a `findings` count;
  hosted `GET /api/external/management/wiki/lint`). `lint` takes no `file_key`.
  `references/memory-and-identity.md` describes soul version history and
  restore (`get_soul_history`, `restore_soul_version`), memory kept per
  (user, organization), and the wiki review period.
- Knowledge: `references/knowledge.md` gains "Live dashboards and custom
  front-ends" — building a team's own screen on an organization's Knowledge
  with the hosted server's new `knowledge_changes` (what changed since a
  cursor; SSE form `GET /api/external/brain/changes/stream`),
  `knowledge_entities_update_attrs` (state updates by type + external_id
  with no re-import and no credits), `knowledge_map_limits` /
  `knowledge_map_set_limits` (the map caps, with `confirm_cost`),
  `knowledge_graph_snapshot(as_of=…)`, and the External-only OpenAPI
  document at `GET /api/external/openapi.json`. Browser tokens
  (`POST /api/external/brain/browser-token`, read-only, ≤15 min, bound to the
  page origin) let the page call the read endpoints directly.
  `knowledge_geo_near` / `knowledge_geo_within` (entities near a point or in a
  box, from a `geo_point` attribute) and the AG-UI form of the run events
  (`GET /api/external/sessions/<id>/events?format=agui`) for screens.
  `knowledge_changes_webhook` / `_set` / `_delete`: a signed webhook that pushes
  the change feed every minute (Standard Webhooks headers, secret named by an
  Org Key).
- `examples/live-dashboard/`: a single-file reference front-end (browser token,
  paged first draw, SSE follow, map dots from a `geo_point` location) and the
  platform's new `ops` knowledge-map preset it is written against.
- `wiki get|put|append`: safe wiki page writes from the command line — empty bodies are refused, the current page is backed up under the kit home (one file per write), the write carries the version that was read (a 409 comes back as `conflict` with the backup path), and the page is read back and compared before success is reported. The Claude Code hook asks before `wiki put` like it does before `api PUT`.
- Actions: the skill's new reference `references/actions.md` covers the
  platform's typed, approvable operations on an organization's own systems
  (connections, drafts, OpenAPI import, dry runs, assignment to agents, runs
  and the run log) through the hosted server's `actions_*` tools, including
  the `simulate` connection for trying the flow with nothing connected. The
  kit drafts and runs; approving a draft, disabling an action and approving a
  waiting run stay with a person in the web app.
- Five behaviour eval cases for Actions (not yet run).
- Knowledge: `references/knowledge.md` covers set questions over the graph
  (`knowledge_graph_around`) and verified graph questions
  (`knowledge_graph_templates`, `knowledge_graph_template_create`,
  `knowledge_graph_template_test`; approval stays with a person in the web
  app), `qualifiers` on neighbor edges, what a kind's property definitions
  check, and the web-only settings for restricted kinds and member browsing.

### Security

- Confirmation now also covers Actions: `actions_run` (it acts in a system
  outside Junis; `dry_run=true` is not asked), `actions_agent_set`,
  `actions_connection_update`, `actions_connection_delete`,
  `actions_draft_delete`, `actions_draft_update` (it replaces the whole draft
  in place, as the External `PUT` already was asked), `actions_import_openapi`
  and `actions_import` (only when it really writes: the tool previews by
  default and is asked with `dry_run=false`; the route imports by default and
  is asked unless `dry_run=true`), and through `junis_api` `POST /actions/run`,
  `POST /actions/import/openapi` and `POST /actions/import`.

- `junis_wiki` (actions get, put, append) gives agents the same safe wiki operations through the MCP bridge; put on an existing page needs `confirmed=true`.

### Changed

- `on_behalf_of` runs are for accounts the organization made only; a real
  member is refused (403 `delegation_target_not_provisioned`). The references
  no longer say otherwise.
- Memory is the key owner's own: the references no longer describe reading or
  writing the memory of an account the organization made (now 403
  `memory_target_not_self`).
- `references/user-steps.md`: full erasure of a person is done by the owner or
  an admin at Team → Compliance, exporting another person's data is owner-only.

- A write whose body sets `instruction` or `content` to an empty string is refused before it leaves the kit, on every path: `api`, `tools call` and the MCP bridge (`junis_api`, `junis_call_tool`). Typical cause: `instruction=@file` with a file that was never written.
- `api --file` with a missing or empty payload file is now a clear `file_not_found` / `empty_payload` error (before: a raw ENOENT or a generic `bad_json`).
- `actions_run` is given 420 seconds before the kit reports a timeout, because
  the platform holds the call open while the action executes.
- Browser login asks for 29 permissions: the 26 as before plus
  `actions:read`, `actions:run` and `actions:manage`. A platform that does
  not know one of them yet refuses the list (400 `invalid_scopes`); the kit
  then asks once more for the permissions that platform offers, so the key is
  the same as before this change instead of the platform's narrower default
  set. Permissions named with `--scopes` are still never replaced.
- The hint for a missing permission says that browser login requests the
  permissions the platform offers, rather than every permission.

### Fixed

- The hint for a missing permission no longer points at "Add permissions" when
  the permission is one only organization keys can hold (`usage:read`,
  `wiki:read_delegated`, `users:delegate`, `users:provision`,
  `sessions:delete`, `users:credentials`): it says an organization key is
  needed and who creates it.
- `knowledge_changes_webhook_set` now asks before it runs: it sends the organization's Knowledge changes to an outside address every minute.
- Live dashboards send `X-Junis-Route` (a random value per page load) so the platform spreads browser-token viewers across its servers instead of putting them all on one. The example page and the Knowledge reference show it.

- `restore_soul_version` now asks before it runs, like `update_soul_content` and `rollback_agent`: it replaces the soul or identity text for every agent of the organization.
- `wiki verify` on a platform that does not have the route yet answers `unsupported` instead of `not_found` (which read as "the page is missing").
- The catalogue fixture carries the hosted server's 214 tools, including `update_soul_content`'s `expected_version` and `summary`.
- The catalogue fixture follows the hosted server's 2.3.3: the memory tools are described as the key owner's own, the schedule tools state the limits for plain members, and `apply_team_changes` carries its action shapes in the `changes` argument.

- `tools describe <wrong name>` suggests tools by name words (`make_agent` → `create_agent`, `clone_agent`, …) instead of by description search, which stopped naming `create_agent` once the catalogue grew.
- The catalogue fixture the tests check documentation against now carries all 202 platform tools (actions_* and knowledge_* were never checked before). `doctor` decodes the bridge's output as one UTF-8 stream.

- `doctor` reported the local bridge as broken on macOS once its tool list
  grew past 8 KiB: it parsed the second answer before the pipe had delivered
  all of it. It now waits for whole lines.

## [0.1.0] - 2026-11-05

First tagged release.

### Security

- URL overrides (`JUNIS_API_BASE`, `JUNIS_MCP_URL`, `JUNIS_WEB_URL`) and
  saved addresses are accepted only for `junis.ai`, its subdomains and this
  machine. Any other host needs `JUNIS_ALLOW_CUSTOM_HOST=1`, and is then named
  by `status`, `doctor` and the bridge's start-up log (`host_not_allowed`
  otherwise).
- The Claude Code Bash hook also reads the kit's shape under another script
  name (`node <script> api …`, `node <script> tools call …`), so a copy or
  link of `junis.mjs` is asked about. A hook event that cannot be parsed but
  names the kit is asked about instead of passing.
- On the command line, a destructive `api` or `tools call` run without a
  terminal stops with exit code 2 until it is repeated with `--yes`.
- `install.sh` refuses a `JUNIS_KIT_REF` or `JUNIS_KIT_REPO` that is an option
  or several words, passes both to git after `--`, and switches an existing
  clone to a changed `JUNIS_KIT_REPO` instead of ignoring it.

### Added

- `login --browser --scopes read-only|operator|all|<list>` asks for a
  narrower key. A list the platform refuses is an error, never widened.
- CI on GitHub Actions (Node 18 and 20), code owners, a bug report template,
  this changelog and a "Supported versions" section in `SECURITY.md`.

### Changed

- Documentation: the hook's limits (name and shape, wrapper scripts not
  caught, 10-second fail-open), that `login` under an override saves the
  address, the masked key returned by `status`, Windows file permissions, and
  wording about the platform's own `junis-magic-auto` key.

### Initial (2026-09-30)

The kit as first published: the `junis` skill, the stdio MCP bridge (`mcp`, `mcp --lazy`),
the command line (`status`, `login`, `tools`, `api`, `run`, `session`, `lint`,
`snapshot`, `doctor`) and the installer for Claude Code, Codex, Cursor, Gemini
CLI, OpenCode and Copilot.
