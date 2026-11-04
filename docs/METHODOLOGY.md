# Methodology

What the state of the art says about skills, plugins and MCP for operating a
product from an LLM agent, and how the kit applies it. Condensed from the team's
research notes.

## 1. Packaging: capability through MCP, judgement through skills

Anthropic's guidance for a product is a connector plus skills, packaged as a
plugin: "the connector so Claude can reach the product, and the skills so
Claude uses it the way you intend". Railway, Supabase, PostHog and
Sentry all ship that shape: one `skills/` tree, one MCP server, thin manifests
per agent. The kit follows it and adds a local bridge because
the hosted server takes a bearer key and has no OAuth.

Where the line falls:

| Belongs in the tools | Belongs in the skill |
| --- | --- |
| Reaching the platform, auth, pagination, timeouts, error mapping | When to build and when not to, defaults, order of operations |
| Discovering what exists now (models, tools, platforms) | Why each rule exists, so the agent applies it to new cases |
| Following a long run, refusing unsafe calls | How to report, what only the user can do |

### Paradigm comparison, criterion by criterion

The four packagings that were on the table, scored against what the goal
needs ("any agent, one install, everything by conversation"):

| Criterion | Skill only | Hosted MCP only | Claude Code plugin with the hosted URL | Hybrid (chosen) |
| --- | --- | --- | --- | --- |
| What it carries | Judgement (how, when, why) | Capability (what exists) | Both, one client | Both, every client |
| Where the API key lives | Nowhere (no tools) | In every agent's MCP config, plain text | Plugin config | One 0600 file; every agent config is secret-free |
| Context cost per session | ~100 words always, body on trigger | ~185 KB tool JSON (175 tools, 2026-11-04) + 1.5 K-char instructions (53 K-char guide on demand) | Same as hosted | Full mode: names only (Claude Code defers schemas); lazy mode: ~8 KB; 1.5 K-char instructions |
| Reaches which agents | Any agent that reads a skills folder, but with no way to act | Any MCP client, with no guidance | Claude Code only | Claude Code, Codex, Cursor, Gemini CLI, VS Code, Copilot CLI, OpenCode, Devin Desktop, Claude Desktop (skill by ZIP); behaviour measured in Claude Code only |
| Runs longer than a tool call | n/a | Die at the client's limit (60–240 s); model is told nothing | Same | Job handle: session id chosen first, bounded wait, follow by id, never resend |
| Destructive calls | A rule in text | `destructiveHint` annotations, no confirmation step | Hook, plugin route only | The hosted annotations in full mode; one shared list for `needs_confirmation` in lazy mode, on `junis_api` and for secret-revealing reads in full mode, and for a hook in the Claude Code plugin (MCP tools and the CLI through Bash) |
| Keeping up with platform change | Text goes stale (models changed the day this was written) | Live catalogue | Live | Live catalogue plus a rule to discover, not recall; new tools work without a kit change (tested) |
| Works with a shell but no MCP | No | No | No | Yes: the same file is the CLI |
| Install | Copy a folder per agent | Edit six config formats by hand | One plugin command | One command for every agent, idempotent, reversible, dry-run |
| Onboarding | Manual | Paste the key into a config file | Same | Browser approval (nothing copied), clipboard as fallback; the key never enters the chat |

Skill-only fails on capability, hosted-MCP-only on judgement, secrets and
context; the plugin alone fails on reach. The hybrid is the only column with
no red cell, at the price of a local process the installer must register,
which is what the installer and `doctor` exist for.

## 2. Skill authoring

- **Portable frontmatter only**: `name`, `description`, `license`,
  `compatibility`, `metadata`, `allowed-tools`. Claude Code extras break upload
  to claude.ai and the Skills API. `name` ≤ 64 chars, lowercase and hyphens,
  equals the folder name, no "claude"/"anthropic". `description` ≤ 1,024 chars.
- **The description is the trigger**. Third person, "Use when …", concrete
  situations and the words users say (in Korean too), "pushy" because agents
  under-trigger. It must not summarise the workflow: an agent then follows the
  summary and skips the body. Listings truncate (Claude Code 1,536 chars per
  entry, Codex 2 % of context or 8,000 chars), so the key use comes first.
- **Progressive disclosure**: metadata always loaded; body (< 500 lines) on
  trigger; references on demand, one level deep, each saying when to read it,
  with a table of contents when long. The kit's SKILL.md is a router: terms,
  two ways to act, start-of-session steps, a table to nineteen references,
  operating rules with their reasons, traps, a report format.
- **Explain the why** instead of MUST. Rules the agent understands transfer
  to cases the author did not foresee; bare imperatives get rationalised away.
- **Degrees of freedom**: fixed procedure where the cost of deviation is high
  (naming the organization, patch not replace, never resend a run), latitude
  where judgement is the point (squad design).
- **Scripts for the deterministic parts** (lint, snapshot, install), prose for
  the rest.
- **No volatile facts in the text**: model identifiers, tool lists and
  integration names are looked up, never recalled. Junis swapped its default
  models the day the kit was written.
- **Evaluation-driven**: write the behaviour test first, watch the agent fail
  without the skill (baseline arm), write the minimum that makes it pass, then
  close the loopholes the transcripts reveal. `claude plugin eval` provides
  isolated sessions, MCP mocks, tool-order and judge graders, and a with/without
  comparison.

## 3. MCP

- **Specification**: the current revision `2026-07-28` is stateless: no
  `initialize`, no sessions, `server/discover`, the protocol version travels
  in each request's `_meta`, results carry `resultType`, list results carry
  cache hints. Clients are mid-transition, so a server must serve both eras
  from one endpoint. The kit's bridge does; so does the hosted server.
- **Auth**: static headers work in the CLIs and IDEs; claude.ai and Claude
  Desktop want OAuth. A product server should accept both.
- **Tool design**: names ≤ 64 chars, read and write separated, a
  `title` and `readOnlyHint`/`destructiveHint` on every tool, descriptions with
  the key use in the first 512 characters, errors that say what to do next,
  pagination, idempotency keys for creates, confirmation for destructive
  actions. Fewer, well-described tools beat many: selection accuracy falls as
  the count grows.
- **Context efficiency**: Claude Code defers tool schemas and
  truncates server instructions at 2,048 characters; other clients load
  everything. Hence the kit's two modes and its 1.5 K-character instructions.
  The hosted server now does the same: about 1.5 K characters of
  instructions, and a 53 K-character guide fetched on demand with
  `get_guide`. Tool search, code execution over MCP and skills-plus-MCP are
  the published techniques; the kit uses the first (lazy mode) and the third.
- **Long jobs**: the Tasks extension is not yet supported by
  mainstream agents; the reliable pattern is a start tool that returns a
  handle and a status tool, with server-side keepalive. Client limits: Codex
  60 s default, claude.ai 240 s, Claude Code aborts after 5 idle minutes.
- **Security**: tokens never in files an agent reads, least-privilege
  scopes, tool results and descriptions are untrusted input, local servers
  must not listen on all interfaces without auth.

## 4. Cross-agent distribution

- **Skills**: two directories cover every file-based agent. `~/.agents/skills`
  is read by Codex, Gemini CLI, Cursor, VS Code, Copilot CLI, OpenCode and
  Devin Desktop; Claude Code reads `~/.claude/skills`. Install a canonical copy
  and link it into both.
- **MCP config is not standardised**: six file locations, three top-level
  keys, JSON and TOML, different remote-URL keys. An installer needs
  per-agent writers or each agent's own CLI. The kit does both.
- **One repository serves every plugin system**: `.claude-plugin/`,
  `.codex-plugin/`, `.cursor-plugin/`, `.agents/plugins/`, Agent Plugins 1.0
  `plugin.json` + `mcp.json`, `gemini-extension.json` side by side.
- **Single command**: Stripe's `stripe agent setup` (detect agents, run each
  one's native install) is the model; generic tools (`npx skills`,
  `npx add-mcp`) each cover only a part.
- **Login**: a non-interactive start step that returns a URL and a completion
  step; credentials in the OS store or a 0600 file; config files reference
  them, never contain them. Junis now has a key request flow of that shape
  (start, approve in the browser, poll with a one-time verifier) that yields a
  scoped API key, so the kit uses it first and keeps the clipboard as a
  fallback.
- **Claude Desktop** breaks the "no UI steps" goal: stdio servers only in its
  config file, skills by ZIP upload.

## 5. What Junis itself requires

The inventories turned up the rules the skill enforces. The ones that cost
users the most:

1. Name the organization (UUID) on every change; omission writes into the
   key's default organization.
2. Never resend a run that outlasted the wait; it continues and is billed.
3. Models only from `list_llm_models`; defaults in the hosted docs are stale.
4. `update_*` replaces whole text and cannot clear fields; use `patch_*`.
5. `{word}` in an instruction is a state lookup; an unknown key silently
   becomes empty text, which deletes that part or feeds the agent empty input
   (`{artifact.name}` fails the call).
6. `include_contents="none"` hides the user's message; `output_key` is stored
   only from a final text response; `{key?}` for optional input.
7. Parallel `aggregation_instruction`, sub-agent `max_llm_calls`,
   `tool_prefix` have no effect.
8. RAG agents: Gemini model, one datastore, no other tools, reached as
   `agent_tool`.
9. `toggle_mcp_active` without `is_active` flips; local platforms need
   `platform_type="local"`; `apply_team_changes` continues after failures.
10. Every External call needs an active subscription; a user key's
    permissions can be added to but never removed, so scopes are chosen at
    issuance.
11. Agent names are sanitised to identifiers at run time; text in parentheses
    is dropped, and hyphens, spaces and other characters become underscores.

## 6. How the kit was verified

Unit and integration tests run against an in-process mock that serves the
real production tool catalogue and behaves like the hosted endpoints
(stateless SSE, trailing-slash redirect, dropped connections). Structure tests
lock the authoring rules above. Behaviour was measured with `claude plugin
eval` in real isolated Claude Code sessions with mocked MCP servers and a
no-plugin baseline. The other agents are covered by install tests on sandbox
homes and MCP handshake tests only; whether each of them loads and follows the
skill has not been measured. No real tenant was touched.
