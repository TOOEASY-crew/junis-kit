# Changelog

All notable changes to the Junis kit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
release tags users pin with `JUNIS_KIT_REF`.

## [Unreleased]

### Added

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
