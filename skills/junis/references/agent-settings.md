# Agent settings

Read this when creating an agent or changing any of its fields. The authority
for field names is the tool schema: `junis_describe_tool create_agent` or
`tools describe create_agent`.

## Contents

- Fields for every agent
- Fields for LLM and RAG agents
- Fields for containers
- Web search
- Vision
- Structured output
- Agents as tools
- What update can and cannot do

## Fields for every agent

| Field | Default | Notes |
| --- | --- | --- |
| `name` | required | Unique in the organization. Use letters, digits and underscores, starting with a letter (`ReviewCollector`, `review_collector`). Spaces, hyphens and other characters are turned into underscores at run time: `agent_tool:<name>` still resolves by the stored name, but the model sees and calls the sanitised name, so routing rules and hand-over targets must use that form. Create and rename both refuse a name that is taken or that becomes another agent's name after this clean-up (`My Agent`, `My-Agent`). Choose the name once. |
| `agent_type` | required | `LLM_AGENT`, `RAG_AGENT`, `SEQUENTIAL_AGENT`, `PARALLEL_AGENT`, `LOOP_AGENT`. The single tools cannot change it; the `agent` object of an `apply_team_changes` update and `PUT /management/agents/<id>` can (not on the orchestrator) and discard the old type's settings, so prefer a new agent. |
| `description` | none | Routing agents read it to decide hand-overs. Write what the agent takes and returns. |
| `is_active` | true | Set through `update_agent` or the batch `agent` object (the single `create_agent` has no such field; new agents start active). Inactive agents are not loaded. |
| `is_tool_agent` | false | Must be true for the agent to be callable as `agent_tool:<name>`. Always true for RAG agents. Cannot be set on an orchestrator. |
| `max_llm_calls` | 300 | Limit of model calls per run; passing `null` stores 200. Read only from the orchestrator. |
| `streaming_enabled` | true | |
| `profile_image_url` | none | Shown in the web app. |
| Payment fields | off | `wallet_address`, `payment_enabled`, `price_per_use_usdc_micro`, `payment_network` for agents that charge per use. |

## Fields for LLM and RAG agents

| Field | Default | Notes |
| --- | --- | --- |
| `model` | a platform default | Always pass it, taken from `list_llm_models`. See [models.md](models.md). |
| `instruction` | empty | See [instructions.md](instructions.md). |
| `reasoning_effort` | `none` | `none`, `low`, `medium`, `high`, `max`. At run time `xhigh` counts as `max`, `minimal` as `low`, `off`, `disable` and `disabled` as `none`, and any other word as `none`. Guidance in [models.md](models.md). |
| `temperature` | 0.7 | Stored as 0.7 when omitted. Dropped for current Claude and GPT, and for Gemini through OpenRouter; sent to direct `gemini/` models and RAG agents, so set 1.0 there. |
| `max_output_tokens` | 64000 | Leave unset. Lower values cut answers short, especially with reasoning on. |
| `include_contents` | `default` | `default` or `none`. Set it explicitly. See [handoff.md](handoff.md). |
| `output_key` | an underscore before every capital + `_output` (`SEOWriter` → `s_e_o_writer_output`) | At most 255 characters. Always set it and read it back. Unique within one flow. |
| `tools` | empty | Names from `list_tools`, plus `agent_tool:<name>` and the group token `sandbox`. See [agent-tools.md](agent-tools.md). |
| `rag_tools` | empty | RAG agents only: exactly one entry `rag_<datastore_id>`. |
| `mcp_platforms` | empty | Platform ids to link. Passing the list unlinks every platform not in it and resets the per-agent tool selection made in the web app. On an existing agent use `link_agent_mcp` / `unlink_agent_mcp`. |
| `web_search_enabled` | false | See below. |
| `vision_enabled` | false | See below. |
| `output_schema` | none | See below. |

Fields that are stored but do nothing: `tool_prefix`,
`aggregation_instruction`. `top_p` and `top_k` cannot be set.

Built-in answer checking (`verify_enabled`, `verify_rubric`) is not a
parameter of the `create_agent` and `update_agent` tools. Set it in an
`apply_team_changes` action ([build-and-verify.md](build-and-verify.md)) or
with `junis_api` (`PUT /management/agents/<id>` with
`{"verify_enabled": true, "verify_rubric": {…}}`). It acts only when Junis has
turned the verifier on for the organization (Junis enables this for an
organization on request). For
quality control from here, build a generate-and-review loop
([squad-design.md](squad-design.md)).

## Fields for containers

| Type | Field | Notes |
| --- | --- | --- |
| Sequential | none | Children run in `order_index` order. |
| Parallel | none that work | Children run together. |
| Loop | `max_iterations`, default 10 | Set it explicitly: 3 for review loops, 1.2 to 1.5 times the item count for processing loops. |

Containers need no model and ignore `instruction` and `output_key`. A container
without children is skipped silently.

Limits that always apply to loops: 20 minutes and 50 tool calls per iteration;
a child that repeats nearly the same output without calling tools is stopped;
the first `exit_loop` of a child that used tools but wrote no text is refused
once, so the child writes its result first.

## Web search

`web_search_enabled=true` behaves differently by model family:

| Model family | What happens | Works alongside other tools |
| --- | --- | --- |
| Claude | The provider's hosted search | Yes |
| Gemini 3 and later | The provider's search grounding | Yes; verify in a test run that a search really happened |
| GPT, models through OpenRouter, Gemini before 3.x | The `openai_web_search` tool is added to the agent | Yes |

There is no setting for search depth. Use one search method per agent. For
page content rather than search results, use a fetch tool or a scraping
platform ([agent-tools.md](agent-tools.md)).

## Vision

`vision_enabled=true` lets the agent read images and files attached to the
request or given as URLs. The model must accept images; if it does not, the
attachments are dropped without an error. `list_llm_models` has no image flag:
check the model's description, or test with one image. Say in the instruction
what to look for in the image.

## Structured output

`output_schema` takes a JSON Schema whose root is an object with properties.

- An empty object `{}` clears it; omitting the field leaves it unchanged.
- Express optional fields as `{"type": ["string", "null"]}`; some providers
  treat every property as required.
- With tools attached, some model families enforce the schema only through
  the instruction. Keep an output contract in the instruction.
- On the orchestrator it applies only to answers the orchestrator writes
  itself, not to a sub-agent's answer after a hand-over.
- `create_agent` and `update_agent` do not take `output_schema`. Set it in an
  `apply_team_changes` action, or with `junis_api` / `api PUT
  /management/agents/<agent id>` and the body `{"output_schema": {…}}`, then
  read the agent back.
- With `output_key` set, the key holds the parsed JSON and a reply that is not
  JSON fails the step. The schema may be at most 64 KB.

## Agents as tools

An agent with `is_tool_agent=true`, named in another agent's `tools` as
`agent_tool:<name>`:

- runs in its own context, which keeps the caller's context small;
- receives only the request text the caller wrote, plus a copy of the session
  state, so `{key?}` works but history does not;
- returns its final text to the caller, who writes the actual answer;
- writes its `output_key` value back to the caller's state, so later agents
  can read it with `{key?}`.

Use a sub-agent instead when the agent should take over the conversation and
its answer should reach the user unchanged (for example exact JSON).

If the target lacks `is_tool_agent=true` or the name does not match, the tool
is dropped with only a log entry and the caller simply does not have it.

## What update can and cannot do

- `update_agent` changes only the fields you pass.
- `instruction` is replaced whole. For edits use `patch_agent_instruction`.
- `tools`, `rag_tools` and `mcp_platforms` replace the whole stored list, and
  an empty list removes everything. Read the agent, add to what is there, send
  the full list, and check with `get_agent`.
- An empty string is ignored and a number cannot be unset. `clear_fields=[…]`
  empties `description`, `profile_image_url`, `tool_prefix`,
  `wallet_address`, `tools`, `rag_tools` and `mcp_platforms`.
- The kit asks the user before an `mcp_platforms` list (it unlinks every
  platform not in it), an empty list, or a non-empty `clear_fields`.
- The response lists `warnings`: settings that have no effect (unknown field
  names, which are ignored; a container's `instruction` or `output_key`;
  `max_llm_calls` on a sub-agent; `max_iterations` outside a loop;
  `tool_prefix`; `aggregation_instruction`) and common traps (strict `{word}`
  placeholders, `include_contents="none"`). Read them after every create and
  update.
- `model` and `tools` are not checked when saved: an unknown tool is skipped at
  run time and an unknown model makes the agent fail. `include_contents` values
  other than `none` mean `default`. Take every value from `list_llm_models` and
  `list_tools`.
- A RAG agent is created with `reasoning_effort` `none` and
  `include_contents` `default`, whatever you pass. Effort can be raised later
  with `update_agent`; it takes effect on Gemini 3 models.
- Changing the model of a RAG agent to a non-Gemini model is accepted and then
  retrieval silently stops working.
- After changing a model, test in a new session.
