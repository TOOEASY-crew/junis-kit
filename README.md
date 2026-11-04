# Junis kit

[![CI](https://github.com/TOOEASY-crew/junis-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/TOOEASY-crew/junis-kit/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Latest tag](https://img.shields.io/github/v/tag/TOOEASY-crew/junis-kit?sort=semver)](https://github.com/TOOEASY-crew/junis-kit/tags)

[한국어](README.ko.md)

A skill and a local MCP bridge that let your coding agent build, run and fix squads of AI agents on
[Junis](https://junis.ai).

You describe the squad in Claude Code, Codex, Cursor, Gemini CLI, OpenCode or GitHub Copilot. The agent
reads your organization first, takes model and tool names from the platform's live lists, checks each
instruction before saving it, runs the squad once and reports what it changed, what it assumed and what
is left for you. The squad then keeps running on Junis, on its schedule, with its own models, knowledge
graph, memory, wiki and tool-call log, after your coding session ends.

## Install

Requires Node.js 18 or newer, git, and a junis.ai account on a Basic or Pro plan.

Claude Code, as a plugin:

```bash
claude plugin marketplace add TOOEASY-crew/junis-kit
claude plugin install junis@junis-kit --scope user
```

Every other supported agent on this machine, pinned to a release tag:

```bash
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh
```

The latest commit:

```bash
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/main/install.sh | sh
```

`install.sh` registers the agents it finds. `--agents` takes a list of ids or `all`: Codex (`codex`),
Cursor (`cursor`), Gemini CLI (`gemini-cli`), VS Code with Copilot (`vscode`), GitHub Copilot CLI
(`copilot-cli`), OpenCode (`opencode`), Devin Desktop or Windsurf (`devin-desktop`), Claude Desktop
(`claude-desktop`, which also needs `~/.junis-kit/dist/junis-skill.zip`, built by the installer,
uploaded once under Customize > Skills) and Claude Code (`claude-code`).

```bash
# Print the plan and change no agent configuration
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh -s -- --dry-run
# Only some agents
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh -s -- --agents codex,cursor
# Skill only, for any agent that reads Agent Skills
npx skills add TOOEASY-crew/junis-kit -g
```

Piped, the script clones the kit into `~/.junis-kit/src` (or updates that clone) and runs the installer.
From a checkout, `sh install.sh` installs the checkout. A skill-only install has no bridge and no plugin
hook: the skill uses its own command line, and confirmations rely on the skill's rules and your agent's
approval for shell commands.

The plugin follows `main`: update it with `claude plugin marketplace update junis-kit`, then
`claude plugin update junis@junis-kit`. Update an `install.sh` install by running it again. The kit
holds your Junis key, so read `CHANGELOG.md` before moving to a newer tag.

To uninstall, run `claude plugin uninstall junis@junis-kit` or
`node ~/.junis-kit/skills/junis/scripts/junis.mjs uninstall` (`--purge` also deletes stored keys,
`--dry-run` shows the plan). Then delete `~/.junis-kit` to remove the kit files, and revoke the key at
https://junis.ai/settings/api-keys. Deleting local files does not revoke it.

## Connect

The API key is created in the first conversation. Open a new session and ask, in any language:

```
You:    Check my Junis connection
Agent:  Not connected yet. Open https://junis.ai/auth/api-key?code=…, sign in,
        check the permissions the kit asks for and press Approve.
You:    Approved
Agent:  Connected. The key reaches two organizations: Globex (OWNER) and
        GlobexSales (ADMIN). Which one should I work in?
```

Nothing is copied or pasted, so this also works over SSH and in containers.

Alternatively, create a key at https://junis.ai/settings/api-keys with the "Coding agents (recommended)"
preset, press its copy button and tell the agent it is copied; the kit reads, verifies and stores it,
then clears the clipboard. Never paste a key into the chat. From a terminal, run
`junis.mjs login --browser`. In CI, set `JUNIS_API_KEY`.

## Usage

```
Build a squad that summarizes https://example.com/blog every Monday, and run it once now
```

The agent works through the steps described at the top of this page and ends with its report.

## Examples

Requests the platform supports today, written as you would type them. They are examples, not customer
stories.

- "Load our supplier contracts and the parts list. Which products depend on Northwind Metals, and what
  do the contracts say about a supply failure?" Knowledge turns the contracts into a graph of suppliers,
  parts, products and clauses. The orchestrator follows it to the affected products, quotes each clause
  with its document and page, and answers quantity questions from the parts database through query
  templates your team approved.
- "Every hour, check new Sentry issues for the checkout service, test a fix in a sandbox and open a pull
  request. Merging stays with me." A triage agent on the Sentry server, a fixer with the GitHub server
  and a code sandbox, and a reviewer on a different model family in a review loop. The merge tool goes on
  the agent's confirmation list, which is off until you set it, and a scheduled run never calls a tool
  on that list.
- "Every Monday, find out what changed in EU battery regulation, update our wiki page and show me what
  changed since last week." Three to five parallel researchers search the web at the depth you set, a
  synthesizer merges their findings with sources, and a reviewer loops until the draft passes or the
  loop limit is reached. The page keeps its version history, so last week's text and the difference are
  one call away.
- "Every weekday morning, brief me from my Gmail and Linear, and remember what I decide." Gmail and
  Linear connect through OAuth in the web app. Memory keeps your profile, the facts you ask it to keep,
  a daily log and monthly, quarterly and yearly summaries; past conversations are searchable by date.
- "Every night, run the tests in ~/work/shop on my laptop and send me only the failures." `npx junis`
  links your computer, and a sub-agent runs commands, reads files and drives a browser there with your
  rights. With the device tool marked as required, an offline laptop marks the run as missing its tool
  instead of reporting an empty success.
- "Answer customer questions on help.example.com from these 40 help articles." The articles go into
  Knowledge, marked as shared publicly. Once you switch on public embedding in the web app, the chat
  widget's knowledge search sees only those sources. It runs only on the domains you allow, with a
  message limit per visitor and without the tools you block.

## Capabilities

Counts are as of November 2026. The kit reads every list live, so new models and tools work without a
kit update.

| Area | What the platform does |
| --- | --- |
| Knowledge | Reads documents, spreadsheets, images, audio, video, CAD and BIM drawings and web pages into a knowledge graph without configuration. Answers cite document, page and passage. |
| Graph queries | Neighbors, paths, subgraphs and snapshots without a model call, with an `as_of` date for past facts. For piping and instrument drawings, a what-if tool reports what closing valves would cut off. |
| Databases | PostgreSQL, Oracle, MySQL or MariaDB, and SQL Server connect as Knowledge sources through an account you give read-only rights. A guard checks each query before it runs, and each query leaves a trace without values. |
| Semantic layer (PostgreSQL only) | People approve query templates, glossary terms and metrics, and agents answer through them. Database roles decide which rows and columns each person can query. |
| Squads | An orchestrator routes each request to sub-agents, which run in sequence, in parallel or in a loop. Squads can call other squads and ask the user a question in the web chat. |
| Squad as code and versions | A squad exports to one JSON file that you plan against the live organization and apply. Every agent change is kept and can be rolled back. |
| Runs and audit | Runs start on a schedule, from Slack, from CI or through the External API. Every tool call is recorded with its status. |
| Publishing | A chat widget for your website that searches only the sources you mark public (see the examples above). |
| Wiki | Markdown pages that agents read and write, with version history, diffs and restore. |
| Memory per user | A profile, kept facts, a daily log and periodic summaries reach the orchestrator each turn. Agents search past conversations by keyword and date. |
| Identity | The organization's values and tone (its "soul") shape every orchestrator answer. |
| MCP servers | 14 available to every organization, including GitHub, Notion, Salesforce, Sentry and PostgreSQL. An organization can also register any remote MCP server. |
| Apps | 25 connected with OAuth or an API key, including Gmail, Slack, Google Docs, Drive and Sheets, GitHub, Linear and Shopify. |
| Your computer | Commands, files and a browser through `npx junis` (see the examples above). Device tools can be marked as required, so an offline computer shows up as a missing tool. |

Details for each area are in [docs/CAPABILITIES.md](docs/CAPABILITIES.md).

86 built-in tools, including:

| Area | What agents get |
| --- | --- |
| Code | An isolated Linux sandbox (shell, files, Jupyter, Chromium, ffmpeg) and programmatic tool calling: a Python script that calls the agent's other tools in one step |
| Research | Web search and page reading at four depths, from quick to exhaustive |
| Documents | Document skills for docx, pdf, pptx and xlsx files |
| Media | Image, video, audio and 3D generation |
| Decisions | Yes/no decisions, classification, scoring, reranking and claim verification with probabilities, up to 200 items per call |
| People in the loop | A question card in the web chat, and per-tool approval lists |
| Simulation | A simulated community that reacts to a text over rounds and can be interviewed (needs a key the organization registers) |

55 chat models, set per agent:

| Family | Models |
| --- | --- |
| Anthropic | Claude Fable 5 and 5.1, Opus 4.8, 5 and 5.5, Sonnet 4.6, 5 and 5.5 |
| OpenAI | GPT-5.4 to GPT-6.1, including the sol, terra, luna and astra variants |
| Google | Gemini 2.5 to 3.8, flash and pro |
| Open-weight and others | DeepSeek V4 and V4.1, Qwen 3.6, Kimi K2.6 and K3.1, GLM 5.1 and 5.3, Grok 4.3 and 4.6, MiniMax M2.7 and M3.1, MiMo V2.5 |

## How it works

With the hosted URL alone, each agent's configuration would hold the key in plain text, the full tool
catalogue would load into every session, and long runs would exceed client timeouts. The bridge keeps
the key in one file, shapes the tool list per agent and returns a session id to follow. Details are in
`docs/ARCHITECTURE.md`.

| Part | Role |
| --- | --- |
| Skill (`skills/junis/`) | Operating rules, known traps and 19 reference files, one per kind of job |
| Local MCP bridge (`junis.mjs mcp`) | Connects the agent to the hosted Junis MCP server (about 177 tools) and the External API. Keeps the key in `~/.junis-kit/credentials.json` (or reads `JUNIS_API_KEY`), follows long runs and turns platform errors into next steps |
| Installer (`install.sh`, `junis.mjs install`) | Finds the coding agents on this machine and registers the skill and the MCP server with each |

`skills/junis/scripts/junis.mjs` and its `lib/` modules are the command line, the bridge and the
installer. They use only Node.js built-in modules.

Claude Code gets full mode: every Junis tool is listed, and Claude Code loads a schema only when the
tool is used. The others load every schema up front, so they get lazy mode: 11 kit tools that find
platform tools on demand. `--full` or `--lazy` overrides the choice.

The installer copies the skill to `~/.junis-kit/skills/junis`, links it into each agent's skills folder
and adds an MCP server named `junis` to each agent's configuration, backing every file up first. It
never rewrites a file it cannot parse, and unless you pass `--force` it leaves alone files with comments
and any `junis` entry it did not write. With the Claude Code plugin installed, it skips Claude Code so
tools do not appear twice.

## Security

- The key is stored in `~/.junis-kit/credentials.json` (mode 0600 in a 0700 folder) or read from
  `JUNIS_API_KEY`. It is never written to an agent's configuration and never returned by a tool. If it
  reaches a chat, revoke it.
- Requests that carry the key never follow redirects. Address overrides must use https (plain http only
  for this machine) and point at `junis.ai`, a subdomain of it or this machine, unless
  `JUNIS_ALLOW_CUSTOM_HOST=1` is also set.
- Deletions, unlinks, whole-text and list replacements, revealing stored secrets, switching the web
  app's organization, and Knowledge calls that replace data stop for your answer. In Claude Code the
  plugin's hook turns them into a permission prompt. In lazy mode they return `needs_confirmation` until
  the agent calls again with `confirmed=true`. In full mode without the plugin (Claude Code set up by
  `install.sh`, or `--full`), platform tools rely on their `destructiveHint` and your agent's approval
  prompt; `junis_api` and secret-revealing reads still return `needs_confirmation`. From the command
  line without a terminal, such commands exit with code 2 until repeated with `--yes`.

[SECURITY.md](SECURITY.md) lists everything the kit stores, how to revoke a key and how to report a
vulnerability.

## Limits

- The agent sets `confirmed=true` itself, so the kit cannot prove that you answered.
- The hook recognizes kit commands by name and shape. A wrapper script that calls the kit from inside is
  not caught.
- Treating text from Junis as data is a rule for the agent, not a technical barrier.
- A service key you hand the agent passes through the conversation and your model provider. Enter it at
  https://junis.ai/team/mcp-skills instead.
- claude.ai web and mobile connectors accept only OAuth, which the hosted server does not offer, so the
  kit works in desktop and command-line agents.
- Runs started by the kit do not stream. `cancel_run` stops one after the current step; that step
  finishes and is billed.
- The kit sees no prices or spending. The payer reads them at https://junis.ai/usage.
- For work longer than about 20 minutes, the skill uses a one-off schedule.

## Command line

The same features work from a shell, with JSON results on stdout. Run it as
`node ~/.junis-kit/skills/junis/scripts/junis.mjs <command>`. A Claude Code plugin install keeps the
file under `~/.claude/plugins/cache/junis-kit/` instead, and a skill-only install keeps it in the
agent's skills folder.

```
junis.mjs status | login --browser | login --from-clipboard | logout | org use <name> | doctor
junis.mjs tools <words> | tools describe <tool> | tools call <tool> key=value instruction=@file
junis.mjs api <METHOD> <path> [--json '{...}']
junis.mjs run orchestrator "<message>" | run <agent> "<message>" | session wait <id> | session messages <id>
junis.mjs lint <file> | snapshot [--org id] | snapshot diff <older> <newer>
junis.mjs install | uninstall | mcp [--lazy]
```

`--help` lists every flag. A run that outlasts the wait returns a session id; the kit never sends a run
twice.

| Variable | Effect |
| --- | --- |
| `JUNIS_API_KEY` | Use this key instead of the stored one (CI) |
| `JUNIS_ORG_ID` | Default organization id |
| `JUNIS_PROFILE` | Use a named profile with its own key |
| `JUNIS_KIT_HOME` | Kit folder instead of `~/.junis-kit` |
| `JUNIS_KIT_REF`, `JUNIS_KIT_REPO` | Tag or branch, and repository, that `install.sh` installs |
| `JUNIS_API_BASE`, `JUNIS_MCP_URL`, `JUNIS_WEB_URL` | Address overrides (see Security) |
| `JUNIS_ALLOW_CUSTOM_HOST` | `1` allows an override outside `junis.ai`; `status` and `doctor` then name the host |

`junis.mjs doctor`, or asking your agent to check the Junis connection, checks Node, the bridge, the
hosted MCP server, the key, the organization and each agent's registration, and names the fix for each
failure. Error messages and their fixes are in `skills/junis/references/troubleshooting.md`. Steps only
you can do in the web app (plans, OAuth apps, publishing, team roles) are in
`skills/junis/references/user-steps.md`.

## Testing

| Agent | What is tested |
| --- | --- |
| Claude Code | Behaviour: 20 `claude plugin eval` cases in `evals/`, each run 3 times in real, isolated sessions against mocked Junis servers, with and without the plugin. Also `claude plugin validate .`, install tests and MCP handshake tests. |
| Codex, Cursor, Gemini CLI, GitHub Copilot CLI, OpenCode | Install and MCP handshake tests. No behaviour evals. |
| VS Code (Copilot) | Install planning (dry run) and MCP handshake tests. |
| Devin Desktop, Claude Desktop | MCP handshake tests. Their file locations are not tested. |

Latest full eval run, November 4, 2026, on the skill as it was that day. Later changes have not been
re-measured.

| Result | Cases |
| --- | --- |
| Passed in 3 of 3 runs (score 1.00) | 16 |
| `schedules-a-slack-report-safely` | 2 of 3 runs (score 0.89) |
| `tunes-search-and-model` | 2 of 3 runs (score 0.67) |
| `tunes-tone-and-wiki`, `writes-partner-integration-code` | Not measured in this run: it stopped at an account usage limit |
| Without the plugin (no Junis tools or skill) | 0 of the 18 measured cases passed; the graders check for Junis tool calls |

Results are not committed (`evals/results/` is ignored).

The handshake tests drive the bridge over stdio in both MCP protocol eras; they do not start the agents.
Whether agents other than Claude Code follow the skill has not been measured. `npm test` runs against an
in-process mock of the platform; nothing in the tests or evals touches a real Junis organization.

## Contributing

Issues and pull requests are welcome. Development rules are in `AGENTS.md`, the design rationale in
`docs/ARCHITECTURE.md` and the research summary in `docs/METHODOLOGY.md`. Run `npm run check` before you
open a pull request; it checks that every manifest matches `kit.json` and runs the test suites. A change
to the skill's behaviour comes with an eval case. Change `README.md` and `README.ko.md` together.

Every commit on `main` reaches plugin users. For a fixed version, install with `install.sh` and a tag (`JUNIS_KIT_REF`). To release, run
`node scripts/build-manifests.mjs --set-version <x.y.z>` and `npm run check`, then tag the commit
`v<x.y.z>`.

## License

Apache-2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). Under its terms, anyone may use, modify and
redistribute the kit, and the license includes a patent grant. It grants no right to use the Junis name
or marks beyond describing the kit's origin.

## Contact

- Bugs and questions about the kit: https://github.com/TOOEASY-crew/junis-kit/issues
- Security issues: follow [SECURITY.md](SECURITY.md); do not open a public issue.
- Account, billing and platform questions: contact@junis.ai

Junis is built by TOOEASY Inc.
