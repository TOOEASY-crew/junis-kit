# Architecture

Why the kit is a skill plus a local MCP bridge plus an installer, and how the
pieces fit. Last updated 2026-11-05.

## Goal and constraints

One install, in any coding agent, after which everything Junis offers is
reachable by conversation. Constraints that shaped the design:

- The Junis platform, its hosted MCP server and the device CLI (`npx junis`)
  must not change for the kit to work (separate pipeline).
- Secrets must never sit in agent config files or in chat.
- Agents differ in how they load tools, how long a tool call may take, and
  where they read skills and MCP config from.
- What is true about Junis today (models, tool names, limits) changes without
  notice.

## Options considered

| Option | Why not |
| --- | --- |
| Skill only, pointing agents at the hosted MCP server | Every agent's MCP config would hold the bearer key in plain text; the hosted catalogue costs ~185 KB of tool JSON per session (175 tools in `tests/fixtures/tools-list.prod.json`, recorded 2026-11-04) (its instructions are short, about 1.5 K characters, and its 53 K-character guide is fetched on demand with `get_guide`); long runs exceed client tool timeouts; nothing runs in agents without MCP. |
| Hosted MCP only, no skill | The tools say what exists, not how to use it safely. Every pitfall in the research (wrong organization, `update_*` losing text, braces breaking agents, double-sent runs) happens with tools alone. The eval baseline arm shows this. |
| Claude Code plugin with the hosted URL | Claude Code only; same secret and context problems. |
| **Hybrid: skill + local bridge + installer** | Chosen. The bridge holds the one credential, shapes the tool surface per agent, follows long runs, and turns platform errors into next steps; the skill carries judgement; the installer makes it one command everywhere. |

## Components

```
agent (Claude Code, Codex, Cursor, …)
  │  stdio, JSON-RPC (MCP 2026-07-28 or legacy 2024-11-05 … 2025-11-25)
  ▼
junis.mjs mcp [--lazy]          ← same file: CLI · bridge · installer
  ├── kit tools    junis_status · junis_connect · junis_use_organization
  │                junis_run · junis_run_status · junis_api · junis_lint_instruction
  │                junis_find_tools · junis_describe_tool · junis_read_tool · junis_call_tool  (lazy mode)
  ├── platform tools  the hosted catalogue, re-exposed (full mode)
  ├── credentials  ~/.junis-kit/credentials.json (0600), env overrides
  └── HTTPS        Bearer → https://mcp.junis.ai/mcp      (platform tools)
                   X-API-Key → https://api.junis.ai/api/external   (runs, sessions, Brain, vault)
                   no key → https://api.junis.ai/api/user/api-keys/device   (browser login)
```

`skills/junis/SKILL.md` is loaded by the agent's skill mechanism; its references
are read on demand, only those the job needs. The agent sees the same platform
through either the tools or the CLI, so the skill describes both in one table.

### Two exposure modes

| Mode | Who | Why |
| --- | --- | --- |
| Full: every platform tool listed with its schema | Claude Code | It defers MCP tool schemas and loads them on use, so the catalogue costs only names. Graders and hooks can match `mcp__plugin_junis_junis__<tool>`. |
| Lazy: 11 kit tools; platform tools found with `junis_find_tools`, described with `junis_describe_tool`, read through `junis_read_tool` (read-only, safe to auto-approve) and changed through `junis_call_tool` (a call that `destructive.mjs` flags returns `needs_confirmation` until `confirmed=true`; `junis_api` does the same for `DELETE`/`PUT`/`PATCH`, Knowledge POSTs that replace data and `POST /actions/run`) | Everyone else | These clients load every schema up front. Eleven tools cost ~8 KB against ~185 KB for the 175-tool hosted catalogue (`tests/fixtures/tools-list.prod.json`, recorded 2026-11-04). |

The bridge answers both protocol eras: stateless `2026-07-28` (`server/discover`,
per-request version in `_meta`, `resultType` on results) and the `initialize`
handshake of older clients, with `-32022` for an unsupported version.

### Onboarding without the key entering the chat

1. `junis_status` reports "not connected" with the steps to relay and a
   preferred route: the browser.
2. Browser approval (`junis_connect` with `method: "browser"`, command
   `login --browser`) uses the platform's key request flow. The kit posts a
   request with a SHA-256 challenge of a one-time verifier and 29 scopes, every
   permission the skill uses (the web app's "Coding agents" preset minus two
   unused admin scopes). A platform that does not know one of them refuses
   the list with 400 `invalid_scopes`; the kit then asks once for the
   intersection with the `available_scopes` the refusal names (the 26 core
   scopes when it names none), and for the platform's defaults only if that
   fails or the 400 was about something else,
   keeps the pending request in `~/.junis-kit/pending-login.json` (0600), and
   hands back the approval link. The user signs in, reviews the permissions
   and approves. The bridge keeps polling in the background with the
   verifier, so knowing the code in the link is not enough to collect the key,
   and stores the key the moment it is approved; the next `junis_connect`
   call reports the result, waiting up to 45 s if it is still pending. The
   platform holds an approved key for collection for five minutes, and the kit
   keeps the pending request until five minutes after its approval window
   ends. A 429, a 5xx or a proxy's 403 while waiting is retried. Each profile
   has its own pending file (`pending-login.json`, `pending-login.<profile>.json`),
   reused only for the same server; `logout` removes the profile's own and
   `uninstall --purge` all of them. A key that arrived but failed its check
   stays in the file (0600) until it is stored; after storing, only a marker
   without secrets remains, so a second session waiting on the same request
   reports the connection. Outside a terminal a new request returns its link at
   once; after approving, `login --browser` run again (within five minutes)
   continues it and waits up to 90 s.
   Nothing is copied, which is why this works in remote shells and
   containers.
3. Clipboard fallback: the user creates a key at
   `https://junis.ai/settings/api-keys` and presses copy; `junis_connect`
   reads the clipboard and clears it.
4. Either way the key is verified against the platform first, stored only if
   it works, never printed, and the result lists the organizations it reaches.
5. `junis_use_organization` resolves a name or slug to the UUID and stores it.

The device login of `npx junis` is not used for this: it is a full account
login with side effects (it registers a device, creates a workspace
organization and changes the user's current organization), which is the wrong
grant for a coding agent. The key request flow creates only an API key.

### Runs as job handles

Client tool timeouts are 60 s (Codex default), 240 s (claude.ai) or a few
minutes; squads often run longer, and a run continues on the server after the
client disconnects and is billed. `junis_run` therefore:

1. chooses the `session_id` itself before sending (the chat endpoint creates
   the session if absent), so the run is addressable from the first second,
   and refuses to send into a session that is still processing
   (`already_running`);
2. waits at most `wait_seconds` (45 default, hard cap 50 s) and otherwise
   returns `{status: "running", session_id, next_step}`;
3. on a lost connection follows the session by polling
   `GET /sessions/{id}/status` (`is_processing`), and reads the answer from the
   messages of this turn only: the message count before sending is the
   baseline, and a reader without one stops at the latest user message. The
   platform marks a run as processing before it writes the turn's user message,
   so "this turn's user message exists and nothing is processing" means the
   turn ended; no message of the turn yet means it is still starting;
4. distinguishes `completed`, `finished_without_text`, `running` (with
   `starting` before the turn begins), `failed`, `timed_out` (reporting stopped
   after two hours; the run may continue) and `not_started`; only the last one
   is safe to resend.

`junis_run`, `junis_run_status` and `junis_api` take an optional
`organization_id`, so work built in one organization is not run or read in the
stored default.

Direct agent runs (`POST /agents/{id}/completions`) create the session
with the id the kit chose, as orchestrator runs do, so both are confirmed,
followed and read back the same way by session id.

### Guard rails in code, not only in text

| Guard | Where |
| --- | --- |
| Redirects refused: a request that carries the credential is never replayed to another URL | `http.mjs` |
| Organization ids that are not UUIDs refused before the call | `kit-tools.mjs` |
| Platform errors mapped to the user's next step (scopes, subscription, credits, rate limit) | `explainError` |
| Instruction lint: brace state keys (an unknown one silently becomes empty text), artefacts, a few common key shapes (not a general secret scanner) | `lint.mjs`, exposed as a tool and a command |
| One definition of a destructive call: deletions, whole-text and credential replacements, list replacements, `clear_fields`, overwriting imports, revealing stored secrets, Knowledge POSTs that replace data, and action runs (they act in a system outside Junis; a dry run is not asked), action assignments, connection changes and OpenAPI imports | `destructive.mjs`, shared by the bridge and the hook |
| Confirmation prompt, including kit commands run through Bash, recognised by name (`junis.mjs`, `junis-kit`) and by shape (`node <any script> api …`, `node <any script> tools call …`, so a copy or link under another name counts): the line is split and parsed like the CLI does, and a line it cannot follow (command substitution, `eval`, heredocs, a script run through a variable, more than 64 KB) or a check that fails is asked about rather than let through. A wrapper script that calls the kit from inside is not seen. Claude Code allows the hook 10 seconds and fails open past that | `hooks/confirm-destructive.mjs` (Claude Code PreToolUse; plugin installs only) |
| `needs_confirmation` until `confirmed=true` (the agent sets the flag, so this makes it ask but cannot prove the user answered) | `bridge.mjs`: `junis_call_tool` and `junis_read_tool` in lazy mode, `junis_api` in both modes, and `get_mcp_platform` with `reveal_secrets=true` in full mode |
| `readOnlyHint` / `destructiveHint` on every platform tool: the hosted server's own annotations (every tool that changes or deletes existing data is destructive), derived by name only when the server sends none | `bridge.mjs`, `mcp-remote.mjs` |
| Browser login: one-time verifier, pending request stored 0600 and tied to its profile and server | `kit-tools.mjs` |
| Snapshots before changing an organization in use; diff afterwards | `snapshot.mjs` |

### Installer

- One canonical copy of the skill in `~/.junis-kit/skills/junis`, symlinked
  into `~/.claude/skills` and `~/.agents/skills` (copy fallback). A folder the
  kit did not create is never replaced without `--force`.
- Per-agent MCP writers: JSON with the indent preserved; JSONC read with
  string-aware comment stripping, but a file that has comments is not
  rewritten (that would delete them) unless `--force`; a TOML managed block for Codex written directly (it carries
  `startup_timeout_sec = 20` and `tool_timeout_sec = 600`, which `codex mcp add`
  cannot set; Codex's 60 s default would cut builds off while they keep
  running), `claude mcp add` when the binary is present and the home is not
  overridden. Every file is backed up before the first change; running the
  installer again changes nothing.
- Only entries the kit wrote (they run `junis.mjs mcp`) are replaced or
  removed. A `junis` entry the user added, such as the hosted-server snippet
  the web app shows, is left alone unless `--force`.
- Claude Code is skipped when the Junis plugin is installed there (two servers
  would show every tool twice).
- The command recorded uses an absolute Node path, because agents start MCP
  servers without the user's shell PATH: the stable path to the same binary
  when one exists (Homebrew `opt/`, the PATH `node`), with a warning to re-run
  the install when Node comes from a version manager.
- With `--home`, environment overrides (`XDG_CONFIG_HOME`, `APPDATA`,
  `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are ignored so a test install never touches
  the real configuration; `JUNIS_KIT_HOME` is passed on to the server.
- `doctor` verifies the result end to end and names the fix for each failure.

### Manifests

`kit.json` is the single source; `scripts/build-manifests.mjs` writes
`.claude-plugin/plugin.json`, `marketplace.json`, `.mcp.json`, Agent Plugins
1.0 `plugin.json` + `mcp.json`, `.codex-plugin/`, `.cursor-plugin/`,
`.agents/plugins/marketplace.json` and `gemini-extension.json`. `--check` fails
when any file or version string drifts, and the structure test runs it.

The Claude Code manifest carries no version. Claude Code skips `plugin update`
while the manifest version string is unchanged; without one it takes the commit
SHA of the git-hosted marketplace, so every push to main is an update, as it is
for `install.sh` without `JUNIS_KIT_REF`. Users who want a fixed version pin
`install.sh` to a release tag (`v<x.y.z>`). `--set-version <x.y.z>` changes the
displayed version in `kit.json` and the hand-written files in one step; the
release commit is then tagged.

## Verification strategy

| Layer | Tool | What it proves |
| --- | --- | --- |
| Unit and integration | `node --test` against an in-process mock of the External API and the hosted MCP server, serving the real production tool catalogue | CLI, bridge, runs (including dropped connections), installer on sandbox homes, snapshot, doctor |
| Structure | `tests/skill.test.mjs` | Frontmatter rules, reference links, every tool name in the text exists, no secrets, manifests in sync, hook behaviour |
| Behaviour (Claude Code only) | `claude plugin eval` with MCP mocks and a no-plugin baseline arm, twenty-five cases in `evals/`; a run writes its results to `evals/results/` | The skill fires on natural Korean requests and changes what the agent does: connects before building, builds from the live inventory, follows long runs, keeps secrets out, diagnoses by reading the run, links OAuth apps and MCP servers and devices the safe way, builds RAG agents within the platform's rules, tunes settings by reading first and verifying by running, edits identity by patch, starts runs from GitHub events once per event, keeps a regression set around instruction changes, stays quiet on unrelated requests |
| Other agents | Install tests on sandbox homes (Codex, Cursor, Gemini CLI, Copilot CLI, OpenCode written and checked; VS Code planned in a dry run) and MCP handshake tests with a scripted stdio client | The installer writes each agent's format without a credential, and the bridge answers both protocol eras. Not that each agent loads and follows the skill |
| Extensibility | `tests/extensibility.test.mjs` | A tool the platform adds after the kit was written is listed, found, described and called through the full bridge, the lazy bridge and the command line without any change to the kit |

Nothing talks to a real tenant. The remaining risk is drift between the mock
and production; refresh the catalogue fixture from the hosted server's
`tools/list` when the platform changes.

## Extending

- A new area of Junis: one reference file under `references/`, one row in the
  "Where to read next" table, a test case in `evals/` if behaviour matters.
- A new kit tool: add it to `kit-tools.mjs` (shared by CLI and bridge) and to
  the bridge's tool list; regenerate `evals/mocks/junis/_tools.json`.
- A new agent client: one entry in `agents.mjs` (skills dir, config file, key,
  entry shape) and, if it has a plugin format, one line in the manifest
  builder.

## Not done, on purpose

- No OAuth: the hosted server does not offer it, so claude.ai web and mobile
  connectors cannot use the kit.
- Claude Desktop skills are uploaded by hand; the installer only builds the ZIP.
- The clipboard path is untested on Windows (PowerShell reader is present).
- Behaviour evals exist for Claude Code only; parity in the other agents is
  assumed from the shared skill and bridge, not measured.
- Runs the kit starts are non-streaming. `POST /sessions/{id}/cancel` stops
  them after the current step (the call in progress finishes and is billed);
  streaming runs stop within a second.
- `install.sh` and the marketplace address assume the repository
  `TOOEASY-crew/junis-kit`.
