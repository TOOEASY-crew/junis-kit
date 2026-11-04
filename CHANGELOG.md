# Changelog

All notable changes to the Junis kit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
release tags users pin with `JUNIS_KIT_REF`.

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
