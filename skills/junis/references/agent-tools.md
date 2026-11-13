# Tools an agent can be given

Read this when deciding what goes into an agent's `tools`, or when an
instruction needs to tell the agent how to call one. Connections to outside
services (MCP, OAuth apps, the user's computer) are in
[connections.md](connections.md).

## Contents

- Two kinds of tools
- How a tool reaches an agent
- Built-in tools by purpose
- Given automatically
- Names that do not exist
- Web research
- Generated media
- Code and files in a sandbox
- Calling HTTP services
- Loops
- Judging and ranking at volume
- Social simulation

## Two kinds of tools

| Kind | Who calls it | Examples |
| --- | --- | --- |
| Platform tools | You, to build and operate | `create_agent`, `list_schedules`, `junis_run` |
| Agent tools | The agents inside Junis, while they work | `openai_web_search`, `gen_content`, `exit_loop` |

You give agent tools to agents by name; you do not call them yourself. Only
`upload_rag_document` exists on both sides, with different arguments; in an
agent's `tools` or instruction the agent-side version is meant. `list_content`,
`get_content` and `retry_content` are platform tools only.

## How a tool reaches an agent

| Route | How |
| --- | --- |
| Named in `tools` | Names from `list_tools`, which lists built-in tools only. An unknown name is skipped with only a log entry, so the agent runs without it. |
| Group token | `"sandbox"` expands to all sandbox tools. |
| Another agent | `agent_tool:<agent name>`; the target has `is_tool_agent=true` and belongs to the same organization or is global. |
| Setting | `web_search_enabled=true`: Claude models search through the provider, Gemini 3 through Google; OpenAI, OpenRouter, Azure and Gemini 2 models get `openai_web_search` added. Turning it off does not remove an `openai_web_search` listed in `tools`. |
| Assigned skill | Adds `use_skill` and `read_skill_file`; a code skill adds `run_code`, the sandbox tools and `openai_web_search`; a skill with required connections adds `check_connections`. |
| Linked connection | MCP platforms, OAuth apps and devices bring their own tools, all of them (one OAuth app can bring dozens). Trim them per agent with `get_agent_tool_access` then `set_agent_enabled_tools` (per link; `null` means all), and mark the ones that need a person's approval with `set_agent_confirmation_tools`; `get_agent` does not show the trim, `get_agent_effective_config` does. `update_agent` keeps the trim of links that stay linked. OAuth app tools appear as `composio_<ACTION>`. |
| Assigned action | `actions_agent_set` gives the agent one tool `action_<name>` per approved action of the organization ([actions.md](actions.md)). Never list those names in `tools`. An action whose risk is `confirm` asks the person in the web chat first and is not run where nobody can answer (schedules, pipeline steps, agents called as tools); `two_person` is filed for approval instead of run. |
| Automatic | See "Given automatically". |

Keep five to ten tools per agent. Beyond fifteen, the agent chooses worse;
split the agent. This is advice, not a platform limit: every listed tool is
described to the model on every call, except MCP platforms Junis has set to
load on demand, which the agent reaches through `search_mcp_tool`.

`tools` in `update_agent` replaces the whole list. To add one, read the agent,
add to what is there and send the full list. Confirm with `get_agent`, then in
a test run that the agent could call them.

## Built-in tools by purpose

`list_tools` is the authority; this table is for orientation.

| Purpose | Tools |
| --- | --- |
| Web research | `openai_web_search` (GPT-6.1 Sol: searches, opens and reads pages including any URL in the query; the agent picks `depth` quick / standard / deep / exhaustive), `webfetch_safe`, `google_search` (Gemini models only; with other tools present the platform wraps it as a separate search agent) |
| Documents | `claude_pdf_processor`, `claude_xlsx_processor`, `claude_pptx_creator`, `claude_docx_processor`, `claude_skill_executor` |
| Generated media | `gen_content`, `waiting_gen_content`, `replicate_status`, `replicate_cancel` |
| Document stores | `upload_rag_document`, `search_rag_documents` |
| HTTP services | `custom_api_call`, `list_custom_apis`, `direct_api_call` |
| Loops | `exit_loop` |
| Asking the user | `ask_user(question, options)`: a question card in the web chat. In a scheduled, API or widget run nobody can answer and the tool returns `clarification_unavailable`, so give it only to agents that talk to people and tell them to proceed on their own when it is unavailable. |
| Code and files | `sandbox` (group), `execute_code` |
| Judging at volume | `jev_decide`, `jev_classify`, `jev_score`, `jev_rerank`, `jev_verify` |
| Simulation | `sim_create`, `sim_run`, `sim_report` and ten more `sim_*` tools |
| Payments | `require_payment`, `verify_payment`, `settle_payment` |
| Older or proxied | `claude_web_search`, `claude_web_fetch` (web research through the Claude provider; `openai_web_search` replaced them on new agents), `apollo_people_api_search`, `apollo_people_title_search`, `apollo_organization_search_trimmed`, `apollo_bulk_enrich_trimmed`, `hunter_discover_companies` (lead data through a proxy key Junis holds; empty results when it is not configured) |

Some tool names exist but do nothing unless Junis has turned a feature on for
the organization (Junis enables this for an organization on request):
`add_objective`, `mark_objective_passed`, `ledger_view`, `propose_skill`,
`search_mcp_tool`. With the feature off they return `ff_off` or empty
results. Do not build on them. `read_externalized_result` only reads
back a large tool result the platform stored elsewhere, which happens only
where that feature is on.

## Given automatically

Every orchestrator receives these without being listed, unless the
organization has switched orchestrator auto-tools off (an organization
setting; then none of them is attached and `get_agent_effective_config`
shows the gap). Do not add them to `tools`.

| Tools | Purpose |
| --- | --- |
| `update_user_memory`, `save_to_eternal_memory` | The user's memory |
| `update_soul`, `update_identity` | The organization's personality |
| `wiki_list`, `wiki_read`, `wiki_search`, `wiki_create`, `wiki_update`, `wiki_edit`, `wiki_append`, `wiki_rename`, `wiki_history` | The shared wiki (`wiki_history` reads a page's earlier versions) |
| `search_conversations`, `read_conversation` | The user's past conversations |
| `list_my_schedules`, `create_my_schedule`, `update_my_schedule`, `set_my_schedule_enabled`, `delete_my_schedule` | The schedules of the person chatting, their own only. Creating and changing are refused inside a scheduled run and for anonymous widget visitors. From chat everyone, owners and admins included, is limited to 200 running schedules, 10 minutes apart at least; an owner or admin who needs more creates it in the web app or through the API. |
| `squad_list`, `call_another_squad` | Other organizations the acting user belongs to. Waits up to 180 s, returns at most 6,000 characters, nests at most 3 deep, and bills the called organization. |
| `brain_search`, `brain_graph_count`, `brain_graph_path`, `brain_graph_whatif`, `brain_graph_subgraph`, `brain_graph_neighbors`, `brain_graph_documents`; with database sources `brain_sql` (not when the organization allows templates only), `brain_query` (approved query templates) and `brain_db_schema` (large schemas); `brain_ask` where the planner is on; `brain_graph_around` where an owner or admin switched on "Set-level graph questions", and `brain_graph_query` once a verified graph question is approved | Knowledge, on the orchestrator, once the organization has a ready source. The exact set depends on the sources and on organization settings: read it with `get_agent_effective_config`. |

Sub-agents do not receive them. A sub-agent that must write to the wiki needs
the wiki tools named in its `tools`, and they only work when the acting user is
an owner or admin of the organization. Knowledge tools are not attached to
sub-agents unless Junis has enabled that for the organization (then the
sub-agents chosen in the web app get them); route knowledge questions through
the orchestrator.

Any agent that has `agent_tool:<a RAG agent>` also receives
`search_rag_documents` for searching by upload date.

## Names that do not exist

Never put these in `tools` or instructions: `share_file` (it exists only as a
device tool on a linked computer), `state_get`, `state_set`,
`call_device_mcp`, `list_device_mcp_tools`, and platform tools such as
`list_content` or `retry_content`.

## Web research

| Need | Use |
| --- | --- |
| Answers from current sources | `web_search_enabled=true`, or `openai_web_search` in `tools` |
| The content of a known page | `openai_web_search` with the URL and what to extract in `query` |
| Many pages, structured extraction, pages that need rendering | A scraping platform such as Firecrawl ([connections.md](connections.md)) |

One method per agent. Give research agents a stopping rule in the instruction.

Firecrawl's scrape tool has one shape that works; include it in the
instruction of any agent that uses it:

```json
{"url": "<page>", "formats": ["json"], "jsonOptions": {"prompt": "<what to extract; return JSON>"}, "onlyMainContent": true, "waitFor": 3000, "removeBase64Images": true}
```

`formats` is a list of strings. Putting the prompt inside `formats` is rejected
with error -32602. If structured extraction fails, fall back to
`"formats": ["markdown", "links"]`.

## Generated media

`gen_content` creates images, video, audio or 3D through a hosted model and
costs credits per generation.

```
gen_content(
  version="<model slug the user or the organization uses>",
  input_values={"prompt": "<English description>", "aspect_ratio": "3:4", "output_format": "png"},
  prefer_wait=True
)
```

- All model inputs go inside `input_values`.
- `prefer_wait=True` waits for the result (up to fifteen minutes).
  `prefer_wait=False` returns at once with an id; the agent then calls
  `waiting_gen_content(prediction_id=…)`.
- The model slug is not validated; a wrong slug fails at the provider.
- Agents show results as `https://junis.ai/content/<id>`, never as a raw
  storage address.
- You can inspect results with the platform tools `list_content` and
  `get_content`, and retry a failed one with `retry_content`.
- Confirm with the user before building anything that generates media in bulk.

## Code and files in a sandbox

`tools: ["sandbox"]` gives the agent an isolated Linux machine: shell, file
read/write/edit, search, upload and download.

- A sandbox lives about five minutes by default and ends with the session.
  The agent extends it with `sandbox_extend_timeout`. Anything worth keeping
  must be pushed elsewhere (a repository, a document store).
- A single command times out after two minutes by default.
- Do not rely on platform credentials inside the sandbox; reach outside
  services through linked connections.
- For browser automation, the agent creates the sandbox from the
  browser-capable template and drives the browser from the shell.
- Templates are listed by `list_e2b_templates`.
- If the agent also has the user's computer linked, tell it in the instruction
  which one to use for what; by default it should prefer the user's computer
  for work on the user's files.

`execute_code` lets an agent write a short script that calls its other tools
as functions, which saves many round trips when processing lists. It is
attached automatically when the organization has it enabled: on the
orchestrator (unless orchestrator auto-tools are off); on other agents only if
they have an MCP platform linked or at least two regular tools.

## Calling HTTP services

| Tool | Use |
| --- | --- |
| `custom_api_call` | Calls an API declared in the instruction's `[CUSTOM_API_CONFIG]` block, with secrets referenced by name. The right choice. |
| `list_custom_apis` | Lets the agent see what is declared. |
| `direct_api_call` | The model supplies URL, headers and key itself. Give it only when the user explicitly wants free-form HTTP and no other route exists. Agents with this tool have bypassed their proper connection, guessed a key and reported the service as blocked. |

Block format and secret references: [instructions.md](instructions.md).
Header values must be ASCII. The default timeout is thirty seconds.

When the call is a write that a person must approve before agents may use it,
or confirm each time, define it as an action instead ([actions.md](actions.md)):
the request is fixed by the approved definition and every run is recorded.

When an instruction describes a request body, show the exact JSON. Prose such
as "call it with an empty body" has led models to send `{"body": {}}`.

## Loops

`exit_loop` is the only way an agent ends a loop before `max_iterations`. It
is never added automatically. Put it in the `tools` of the loop's last child.
The platform's loop guards can also end a loop early: a child that stalls or
repeats itself, or passes the per-iteration tool limit, is stopped and the run's
outcome says `loop_guard_truncated`; a loop whose last report says items remain
gets `loop_incomplete` ([schedules.md](schedules.md)).

```
exit_loop(final_report="<what was done>")
```

Passing `final_report` appends that text to the child's `output_key` and lets
the exit through, except when the report's own progress line says work remains
(`K<N` of the forms in [squad-design.md](squad-design.md), pattern 4): that is
refused once, then accepted. Without `final_report`, the first exit is refused
once if the iteration used tools but wrote no text, if its last progress line
says work remains, or if the previous iteration was cut off and this one did
nothing.

## Judging and ranking at volume

The `jev_*` tools classify, score, rank or verify up to 200 items per call at
very low cost. Useful for filtering lists before an expensive model reads
them.

- Instructions, options, categories and levels must be written in English; the
  items may be in any language.
- The judged text is processed by a third-party service. Do not use these
  tools on data the organization must keep inside its own providers.
- They are never added automatically, except on the orchestrator of a newly
  created organization.

## Social simulation

The `sim_*` tools build a population of simulated people from a seed text, let
them interact over several rounds, and produce a report. They go in an LLM
agent's `tools`; they are not an MCP platform.

- Prerequisite: the organization's own Zep key, registered by an owner or
  admin at `https://junis.ai/team/simulations` (stored as the organization
  secret `ZEP_API_KEY`). Without it `sim_create` answers `zep_not_configured`
  with the fix.
- Tools: `sim_create`, `sim_run`, `sim_control`, `sim_inject_event`,
  `sim_run_counterfactual`, `sim_trending`, `sim_round_summary`, `sim_search`,
  `sim_interview`, `sim_interview_batch`,
  `sim_discussion_vs_interview_delta`, `sim_query`, `sim_report`.
- Stages: `sim_create` (prepares the community in the background, ten to
  thirty minutes), `sim_run` (the rounds), analysis, `sim_report`. One LLM
  agent per stage, chained by hand-over from the orchestrator, not a
  sequential container: each stage waits on a long tool call and must be able
  to report on its own.
- A full run takes thirty to sixty minutes and costs noticeably more than a
  normal request; cost grows with agents times rounds. Confirm with the user
  first, try a small run (few agents, few rounds), and start the squad through
  a `once` schedule or follow the session ([running.md](running.md)). Never
  send the request twice.
- Arguments the model gets wrong: `seed_text` is plain text up to 20,000
  characters; `config` is a JSON string; the `agent_id` of an interview is the
  integer id of a simulated person, not a Junis agent.
- Size: `agent_count` (default 50) and `total_rounds` go inside `config`.
  When given they are clamped to 5–3,000 agents and 3–2,160 rounds; the 100
  agents and 144 rounds in the tool's description cap only its own choice. A
  trial run names small values for both.
- `sim_control` with `action="cancel"` stops a simulation. Results are at
  `https://junis.ai/team/simulations`, where each person sees only the
  simulations their own runs created.
