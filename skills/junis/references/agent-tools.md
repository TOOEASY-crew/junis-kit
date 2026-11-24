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
- Squad board
- Conversation notes
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
| Linked connection | MCP platforms, OAuth apps and devices bring their own tools, all of them (one OAuth app can bring dozens). Trim them per agent with `get_agent_tool_access` then `set_agent_enabled_tools` (per link; `null` means all), and mark the ones that need a person's approval with `set_agent_confirmation_tools`; `get_agent` does not show the trim, `get_agent_effective_config` does. `update_agent` keeps the trim of links that stay linked. At run time the agent sees an OAuth app's tools as `composio_<NAME>` (`composio_GMAIL_SEND_EMAIL`), but the selection stores the app's own names without that prefix (`GMAIL_SEND_EMAIL`), exactly as `list_composio_integration_tools` returns them; a prefixed or made-up name can match nothing. Choose an app's tools when linking: [connections.md](connections.md), "Choosing an app's tools". |
| Assigned action | `actions_agent_set` gives the agent one tool `action_<name>` per approved action of the organization ([actions.md](actions.md)). Never list those names in `tools`. An action whose risk is `confirm` asks the person first (a card in the web chat, or `tool_confirmation_required` to an app calling `/v1/chat/completions`) and is not run where nobody can answer (schedules, pipeline steps, agents called as tools, `/agents/<id>/completions`); `two_person` is filed for approval instead of run. |
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
| Generated media | `gen_content`, `waiting_gen_content`, `replicate_status`, `replicate_cancel` (`gen_content` brings `replicate_search_models` and `replicate_model_schema` with it; they are not in `list_tools` and are never listed in `tools`) |
| Document stores | `upload_rag_document`, `search_rag_documents` |
| HTTP services | `custom_api_call`, `list_custom_apis`, `direct_api_call` |
| Loops | `exit_loop` |
| Shared task board | `board_read`, `board_add_task`, `board_claim_task`, `board_complete_task`, `board_review_task`, `board_post_note` (see "Squad board") |
| Notes to the user's other conversations | `find_conversations`, `send_to_conversation` (see "Conversation notes") |
| Asking the user | `ask_user(question, options)`: a question card in the web chat; an app that calls `/v1/chat/completions` receives it as `tool_confirmation_required` and answers with `tool_confirmations[].answer` ([app-users.md](app-users.md), step 9). In a scheduled run, a widget, or a direct `/agents/<id>/completions` call nobody can answer and the tool returns `clarification_unavailable`, so give it only to agents that talk to people and tell them to proceed on their own when it is unavailable. |
| Messaging the user first | `notify_user(message, title, urgency, dedupe_key)`: writes to the feed of the user this run belongs to; their app reads it or receives it by webhook. For unattended runs (schedules, promised follow-ups). Never attached automatically; exempt from the "ask before writing" preset. The platform applies the user's settings, a daily cap, quiet hours and the dedupe key ([app-users.md](app-users.md), step 7). |
| Rooms the user is in | `list_my_rooms()`: the rooms of the user this run belongs to (id, name, how many members). `suggest_room_message(room_id, message, ask_room_assistant)`: prepares a message for one of those rooms as a feed item the user sees with [Send] and [Discard]; nothing is posted until the user presses Send in their app, and the tool cannot read a room. Shares the per-run cap with `notify_user`, 20 a day per user ([app-users.md](app-users.md), step 13). Never attached automatically. |
| Asking the user to sign in to a website | `request_browser_sign_in(url, reason)`: asks the user to sign in themselves, in the browser of their own workspace; the password never passes through the conversation. Needs the organization's `app_workspace` with `sign_in_view` on ([app-users.md](app-users.md), step 18). Never attached automatically. |
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
| `list_my_schedules`, `create_my_schedule`, `update_my_schedule`, `set_my_schedule_enabled`, `delete_my_schedule` | The schedules of the person chatting, their own only. `create_my_schedule(in_this_conversation=true)` makes the run continue the conversation it was asked in (a follow-up the agent promised); times use the user's saved time zone when they have one, otherwise Korea time, and the result names the zone. Creating and changing are refused inside a scheduled run and for anonymous widget visitors. From chat everyone, owners and admins included, is limited to 200 running schedules, 10 minutes apart at least; an owner or admin who needs more creates it in the web app or through the API. |
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

`gen_content` creates images, video, audio or 3D through a hosted model
(any public model on Replicate) and costs credits per generation. Give the
agent `gen_content` in `tools`, with `waiting_gen_content`, `replicate_status`
and `replicate_cancel` for long or background generations. No MCP platform is
involved: the `replicate-global` platform is inactive (2026-11-15) and is not
something to link.

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
- `version` is `owner/name` (the latest version) or
  `owner/name:version_hash` (pinned). Community models run by `owner/name`
  too.
- An agent with `gen_content` also has two free, read-only tools with nothing
  to configure: `replicate_search_models(query, limit=8)` finds a model's
  exact `owner/name`, and `replicate_model_schema(model)` returns its inputs
  (names, types, allowed options, defaults), output type and credit cost.
- For a model the instruction does not spell out, unfamiliar or newly
  released, write the order into the agent's instruction: search, read the
  schema, then run. Do not write input names from memory.
- A call that cannot run is refused before any credit is charged:
  `{"success": false, "generation_id": null, "reason", "message", "model"}`
  with `reason` `malformed_identifier`, `model_not_found`, `invalid_input`
  (a required input is missing or a value is outside the allowed options;
  the result then carries `input_schema` to fix the call from),
  `one_output_per_call` (on a model that returns a list of outputs, the
  call asks for more than one through
  `num_outputs`, `number_of_images`, `num_images`, `max_images`,
  `num_samples` or `batch_size`: one call returns one output, so call once
  per output) or `catalog_unavailable`. When the model cannot be looked up, an `owner/name`
  call goes ahead unchecked, while a pinned `owner/name:version_hash` is
  refused with `catalog_unavailable` (try again, or use `owner/name`). A
  pinned version costs what its `owner/name` costs.
- Prices per model are kept by Junis. A model without a price costs the
  default: 1 credit per run, or 5 for a video model. `replicate_model_schema`
  returns the amount as `credit_cost`, so tell the user before running a new
  or costly model (a price is registered on request at `contact@junis.ai`).
  A generation that fails or is cancelled while running is still charged and
  is not refunded.
- `output_url` in a result is the copy in Junis storage: it does not expire
  and plays in the chat.
- Agents show results as `https://junis.ai/content/<id>`, never as a raw
  storage address.
- You can inspect results with the platform tools `list_content` and
  `get_content`, and retry a failed one with `retry_content` at no extra
  charge (up to three times). A cancelled generation cannot be retried:
  start a new one.
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
Tools on a confirmation list cannot be called from a script (the agent must
call them directly so the approval card appears), and argument rules apply to
script calls as to direct calls. Calls made inside a script are listed by
`list_tool_calls` with `via_code: true`. To keep a write tool out of scripts,
put it on a confirmation list; to run scripts without internet access, turn
off code sandbox internet in tool safety (`set_tool_safety`) — script tool calls
still work because they run on the server.

For agents with many MCP tools, an owner or admin can turn on "Load MCP tools
through code" in the web dashboard (Settings tab). Agents that have
`execute_code` and 10 or more MCP tools that scripts can call then carry only
the tool names in their prompt and call those tools from scripts, where each
call returns the tool's data directly. Tools on a confirmation list, tools limited by an organization
tool rule, device tools and non-MCP tools stay direct. The setting takes effect
only where execute_code is enabled for the organization. It is off by default. Public widget conversations cannot run code, so
there the same tools stay normal direct calls. While code cannot run elsewhere
(the sandbox is unavailable, or code execution is turned off), the agent gets
these tools as direct calls. Because the model has not seen
what these tools return, each `execute_code` response lists `result_shapes`
(field names and types of each tool's result) and warns when a script read a
field that does not exist.

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

## Squad board

Six tools give agents one shared list of tasks and notes, kept in the
database for the whole organization. Agents that have them coordinate through
the list instead of through messages, and the list is still there in the next
run. They are never attached automatically: name them in `tools` on every
agent that should use the board, sub-agents included.

| Tool | Use |
| --- | --- |
| `board_read(board, task_number, status, limit, offset)` | The goal, counts per status, tasks and latest notes; with `task_number`, one task in full. It lists 20 tasks unless `limit` (up to 100) says otherwise; `tasks_total` is the full count and `offset` reads the next page. `stuck: true` marks a task that cannot be claimed. The reply's `run` shows the minutes and model calls this run has used. |
| `board_add_task(title, details, board, parent_task_number)` | Add a task for any worker. |
| `board_claim_task(board, task_number, lease_minutes)` | Take the next open task, or a given one. Calling it again while holding a task returns that task and renews its lease. `claimed: false` comes with a reason: `empty` (no unfinished task is left) or `nothing_claimable` (the rest is held by other workers, waits for review or is stuck; `counts` shows which). |
| `board_complete_task(task_number, result, outcome, board)` | Record the result of the claimed task: `done`, `failed` or `released`. |
| `board_review_task(task_number, verdict, notes, board)` | On a board that requires review: `pass` or `fail` a task another agent completed. |
| `board_post_note(text, board, task_number)` | A note for other workers and later runs. |

- `board` is a name; left empty it is `main`. The first write creates a board.
- The platform records who wrote what from the running agent's name. The
  tools take no author argument, so an agent cannot write as another agent.
- A claim lasts `lease_minutes` (60 by default, 5 to 300). After that the
  task is open again for the next worker or the next run.
- Only the worker that claimed a task can complete it. `not_yours` means
  another worker has the task, or the same agent claimed it in another
  conversation: the caller must not redo or re-record it.
- A refused call answers with `success: false` and the reason in `status`
  (`not_yours`, `too_long`, `limit`, `archived` and so on). An archived board
  refuses every write, also completing a task that was claimed before.
- Limits: title 200 characters, details 8,000, result 20,000 (4,000 when the
  task is released, where the result is only the reason), note 4,000;
  5,000 tasks per board and 500 unfinished. A text over the limit is refused
  with the limit in the reply, never cut.
- They run only when the person behind the run is a member of the
  organization. In a widget visitor's or provisioned account's conversation
  they answer `denied`.
- You manage boards with `squad_board_list`, `squad_board_get`,
  `squad_board_save`, `squad_board_add_task`, `squad_board_update_task`,
  `squad_board_review_task`, `squad_board_post_note` and `squad_board_delete`
  (hosted server 2.5.0 and later; key permissions `board:read` and
  `board:manage`), or on `https://junis.ai/team/board`.

The squad shape that uses them is pattern 8 in
[squad-design.md](squad-design.md).

## Conversation notes

`find_conversations` and `send_to_conversation` let an agent leave a note in
another conversation of the same user, for example "the budget was approved"
from a research conversation into a planning one. Attach them with
`set_agent_enabled_tools` or `update_agent(tools=[...])`; they are never added
automatically.

| Tool | What it does |
| --- | --- |
| `find_conversations(query, limit)` | The user's other conversations in this organization, most recent first: `conversation_id`, `title`, `agent`, `last_activity`, `running`. `query` matches the title. |
| `send_to_conversation(conversation_id, message)` | Leaves the note. `status` is `sent`, or a refusal: `not_found`, `full`, `duplicate`, `too_long`, `limit`, `empty`, `denied`, `unavailable`. |

What to know before designing with them:

- A note does not start a reply. It appears in the other conversation as a
  card and the agent that answers there reads it with the user's next
  message. Use the squad board when work has to continue without a person.
- An agent that does not see conversation history (`include_contents: "none"`,
  or an organization history limit that keeps only the current turn) does not
  see notes either. Notes are for conversations answered by an agent that
  reads its history, which the orchestrator does by default.
- Only the same account's own conversations can receive notes. Slack threads,
  the public widget, playground conversations and a conversation that a
  schedule keeps continuing cannot. An agent answering in a Slack thread
  cannot send or list. To pass something to another member, use
  `board_post_note`.
- Limits: 8,000 characters per note, 5 notes per turn, 20 unread notes per
  conversation, and the same note is not stored twice while unread.
- The note is information, not an instruction from the user: the receiving
  agent is told so, and a note cannot approve a confirmation card.
- `search_conversations` (given to orchestrators automatically) searches
  message text; a `session_id` it returns also works as `conversation_id`.
- An integration that serves several people through one organization key
  without provisioned accounts runs all of them as the key owner's account. Do
  not attach these tools to agents used that way.
- Reading: `get_session_messages` returns notes as `event_type`
  `peer_message` with a `peer` object (`from_session_id`, `from_title`,
  `from_agent`, `during_turn`).

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
