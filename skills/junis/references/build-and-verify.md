# Building and verifying

Read this when you are about to create or change agents. Design first
([squad-design.md](squad-design.md)). A build is finished when the checklist
passes and a real run produced the expected result.

## Contents

- The build sequence
- Step 1: inventory
- Step 2: snapshot
- Step 3: write the instructions
- Step 4: create and wire
- Step 5: checklist
- Step 6: run it
- Step 7: report
- Undoing a change
- The squad as a file

## The build sequence

```
inventory → snapshot → instructions → create and wire → checklist → run → report
```

Copy this list into your working notes and tick each step. If a step fails, fix
it and repeat that step; do not ask the user whether to fix your own build.

## Step 1: inventory

Call these for the target organization before deciding anything. Pass
`organization_id` on each.

| Call | Gives |
| --- | --- |
| `list_agents` | What exists. More than 100 agents: the list is cut; find one with `list_agents(name=…)`. |
| `list_sub_agents` on the orchestrator | Current wiring |
| `list_llm_models` | The only valid `model` values |
| `list_tools` | Built-in tools an agent can be given |
| `list_mcp_platforms` | Global and organization MCP platforms |
| `list_composio_integrations` | OAuth apps that can be linked |
| `list_skills` with `include_system=true` | Skills that can be assigned |

Decide after all results are in.

## Step 2: snapshot

If the organization already has agents beyond its orchestrator, run `snapshot`
(command line) before the first change, or read and keep the current values of
what you are about to change. The orchestrator's instruction is the most
valuable thing to keep: replacing it loses the existing routing.

## Step 3: write the instructions

Write each instruction to a file, following
[instructions.md](instructions.md), then check it:

```
lint instructions/collector.md instructions/analyzer.md --allow collected_data
```

`--allow` names the `output_key` values that an earlier agent in the same flow
writes. Proceed only when the check reports no errors.

## Step 4: create and wire

Order matters, because later steps refer to ids from earlier ones:

1. Create agents: RAG agents, then LLM agents, then containers.
2. Add children to containers and sub-agents to routing agents.
3. Link MCP platforms and Composio integrations; activate the platforms.
4. Update the orchestrator: instruction (patch in the new routing rules) and
   sub-agents.
5. Assign skills.
6. Create schedules.

### One by one, or in a batch

Individual tools (`create_agent`, `add_sub_agent`, …) are simplest for a few
agents. `apply_team_changes` sends many changes in one call:

```json
{"changes": [
  {"action": "create_agent", "agent": {"name": "ReviewCollector", "agent_type": "LLM_AGENT", "model": "<from list_llm_models>", "instruction": "…", "include_contents": "default", "output_key": "collected_data"}},
  {"action": "add_sub_agent", "base_agent_id": "<pipeline id>", "sub_agent_id": "<collector id>", "order_index": 1},
  {"action": "link_mcp", "agent_id": "<collector id>", "platform_id": "<platform id>"},
  {"action": "update_orchestrator", "changes": {"sub_agents": ["<pipeline id>"]}}
]}
```

Facts about the batch:

- The whole batch is checked first (known action, required keys). If any item
  fails, the result has `applied: false` and nothing was sent: fix the items in
  `rejected` and send the whole batch again. `dry_run=true` runs only this
  check.
- Once sent, it is not a transaction. A change the platform refuses lands in
  `errors` while the others apply, and nothing is rolled back. Compare
  `created`, `updated`, `relationships`, `already_linked` and `errors` with
  what you sent, and retry only the items in `errors`.
- A change that refers to an agent created in the same batch needs that
  agent's id, which you only learn from the response. Create the agents first,
  then send a second batch with the wiring.
- Actions: `create_agent`, `update_agent` (`{"agent_id", "agent": {…}}`),
  `delete_agent`, `update_orchestrator`, `add_sub_agent`, `remove_sub_agent`,
  and `link_mcp`, `link_composio`, `link_device` with the matching `unlink_…`
  actions. Action names differ from tool names.
- The `agent` object of `create_agent` and `update_agent` takes any agent
  field, including `output_schema` and `verify_enabled`, which the single
  tools lack. Lists in it replace the stored lists, as on `update_agent`.
- `add_sub_agent` twice for the same pair is an error. Linking a platform
  again is harmless; linking a switched-off organization platform fails.
- `update_orchestrator.sub_agents` only adds, at positions 1..n. To detach, use
  `remove_sub_agent`; to insert or reorder, call `reorder_sub_agents` with
  every child id in order.
- Assigning skills and creating schedules are not batch actions.
- `order_index` starts at 1. Omit it to append.

### The orchestrator

- Its id is `orchestrator-<slug>`. Use that id with `get_agent`,
  `update_agent` and `patch_agent_instruction`.
- A new organization's orchestrator starts from a template: the platform's
  default GPT model (`openai/gpt-6.1-sol` as of 2026-10-01; read it with
  `get_agent` and check it against `list_llm_models`), effort medium, web
  search and vision on, `output_key` `orchestrator_output`, and the tools
  `sandbox` (sixteen tools), `gen_content`, `waiting_gen_content`,
  `replicate_status`, `replicate_cancel` and five `jev_*`. Read it with
  `get_agent` first. Remove the tools the squad does not need by sending the
  reduced list: every tool is described to the model on every call.
- Add routing rules with `patch_agent_instruction`. Replacing the whole
  instruction is only for an organization you just created.
- Set its `output_key` and `max_llm_calls` with `update_agent`;
  `include_contents` has no effect on the orchestrator (it always sees the full
  history). Users can change its model from the chat header, so check the model
  before and after a change.
- Several tools are given to every orchestrator automatically (memory, wiki,
  conversation search, calling other squads, and Knowledge search when
  sources exist), unless the organization has switched orchestrator
  auto-tools off. Do not list them in `tools`; check what arrived with
  `get_agent_effective_config`.

## Step 5: checklist

Read the state back (`get_agent`, `list_sub_agents`) and confirm each line.

Structure
- [ ] The orchestrator has the intended sub-agents.
- [ ] Every container has children, in the intended order.
- [ ] No loop inside a loop. No RAG agent as a sub-agent.
- [ ] Every target of `agent_tool:<name>` has `is_tool_agent=true`, and the name matches exactly.
- [ ] No batch result had `applied: false`, and every `errors` list was empty.

Settings
- [ ] Every `model` is in the current `list_llm_models` result.
- [ ] `include_contents` is set on every agent and matches its position.
- [ ] `temperature` is 1.0 on direct Gemini and RAG agents. `max_output_tokens` is 64000.
- [ ] No loop sits beneath another loop at any depth.
- [ ] Each consumer's `{key?}` matches its producer's `output_key` character for character.
- [ ] Every loop has `exit_loop` in the `tools` of its last child and a sensible `max_iterations`.
- [ ] RAG agents: a Gemini model, exactly one `rag_<datastore_id>`, no other tools.

Connections
- [ ] Linked MCP platforms appear under `mcp_platforms` in `get_agent`, and were activated with `is_active=true`.
- [ ] `get_agent_composio_status` reports what is still missing.
- [ ] No agent has `direct_api_call` unless the user asked for free-form HTTP.
- [ ] Every action an agent relies on is under `active` in `actions_agent_get` (assigned and approved). A draft is not a tool ([actions.md](actions.md)).

Instructions
- [ ] The brace check passes for every instruction.
- [ ] No key, token or secret URL appears in any instruction or schedule prompt.
- [ ] Every tool an instruction names exists for that agent.
- [ ] The orchestrator's instruction routes each new job, including the prompt of each new schedule.

Schedules
- [ ] Type is one of the six; `schedule_config` is present; times are Korea time; the name is unique.

## Step 6: run it

Send one realistic request and read the whole answer.

```
run orchestrator "<a request the user would actually send>"
```

A run started from here does not stream. Cancel stops it only after the
step in progress, so a send or payment already under way still happens. If the squad sends, posts, pays or
deletes anything outside Junis, point it at a test destination (a test
channel, the user's own address) for this run, or ask the user once before the
first run and name the recipient.

| Check | Pass when |
| --- | --- |
| Routing | The intended agent answered. |
| Content | The answer has the substance asked for, not a placeholder, an apology or a question back. |
| Data flow | Later steps used earlier results. Empty sections mean a key did not arrive. |
| Side effects | The promised thing exists: the post, the message, the file, the row. |
| Connections | No "tool not available" or authorization text in the answer. |

If a connection still needs the user (OAuth, a secret, documents), the run will
fail at that step. Verify everything up to it, state what could not be
verified, and put the rest in "Your part".

For a squad that runs unattended, one success proves little. Run it several
times; for a schedule, start it with run-now (on an enabled schedule: a paused
one is not run, although the call answers success) and read the run's outcome
and session ([schedules.md](schedules.md)). For runs longer than a few minutes see
[running.md](running.md).

Test sessions are recorded in the key owner's memory and session list like any
other. Keep test messages free of private data.

## Step 7: report

Use the report shape from the skill's main page. Under "Your part" go through
these categories and name each item with its link, or write "nothing":

1. MCP credentials to enter
2. Secrets to register
3. OAuth apps to authorize
4. Documents to upload
5. Computer to connect
6. Subscription or credits
7. Schedules to confirm (time and recipients)
8. Actions to approve (each draft, and each run that is waiting)

## Undoing a change

| To undo | Do |
| --- | --- |
| An instruction edit | Patch it back, or `update_agent` with the text from the snapshot (`snapshot show <file> <agent>`), or `rollback_agent` to the version before it (see below). |
| A new agent | `delete_agent`. Its relationships and assignments go with it. |
| A wrong link | `remove_sub_agent`, `unlink_agent_mcp`, `unlink_agent_composio`, `unlink_agent_device`, `unassign_skill`. |
| A replaced list | `update_agent` with the full list from the snapshot. |
| A schedule | `toggle_schedule` with `enabled=false` to pause, `delete_schedule` to remove. |
| Test leftovers | Delete test agents and schedules, restore the orchestrator instruction, and say what remains (test sessions). |

After undoing, compare with the snapshot: `snapshot`, then
`snapshot diff <before> <after>` should report `identical: true`.

The snapshot is the undo for whole lists and links (it records each agent's
tool selections per connection, the platforms, skills and stores of the
organization, and every schedule). The platform also keeps a version of every
agent at each create, update and restore, including changes made through the
kit (on by default; `get_effective_feature_flags` shows whether it is on
for the organization). Read and restore them from here (owners and admins):
`list_agent_versions` → `get_agent_version` → `preview_agent_rollback` (writes
nothing; returns `current_state_sha256`) → ask the user → `rollback_agent` with
that `expected_current_sha256`, so an edit made in between is refused with 409
`stale_current` instead of being overwritten. The web page
`https://junis.ai/team/agent-versions` shows the same versions. It refuses the orchestrator, restores
settings, instruction, sub-agent order and MCP connections, keeps the tool
selections of connections that are still linked, and leaves Composio apps and
skills as they are now. Adding or removing a sub-agent alone does not make a
version; the next update records it.

Deleting agents, skills, datastores or sessions cannot be undone. Confirm with
the user first, naming exactly what will be removed.

## The squad as a file

A whole squad (a root agent and its sub-agent tree) can live in one
`junis.squad/v1` file that you keep with the user's project and review like code.

1. `squad_export` with `root=<agent name>` → save the result as
   `squad.json`. It holds no secrets: MCP connections appear by platform name,
   credentials stay on the platform.
2. Edit the file. Only the fields you keep in an agent are managed; remove a
   field to leave it as it is on the platform. `sub_agents` and `mcp` are the
   complete lists (order of `sub_agents` is the run order). `composio`, when
   present, must name every connected app of that agent exactly (it sets their
   tool lists; the plan rejects a list that leaves one out or names one that
   is not connected), so leave the key out to leave the apps alone.
   `actions` (exported only for agents that have some) is the complete list
   of action names assigned to the agent: an empty list removes them all, a
   name that does not exist is a plan error, and one not approved yet is a
   warning, since it becomes a tool only after a person approves it. Action
   definitions and their connections are not in the file
   ([actions.md](actions.md)). Agents
   missing from the file are never changed or deleted. A document holds at
   most 60 agents, 10 levels deep.
3. `squad_plan` with `document=@squad.json` → read `errors` (fix them),
   `warnings` (for example a `{placeholder}` nothing fills) and `changes`.
   Show the user the changes.
4. With their go-ahead, `squad_apply` with the same document and the plan's
   `plan_id`. 409 `stale_plan` means the organization changed since the plan:
   plan again. A `partial` result lists the steps that were saved; `rollback`
   gives each updated agent's previous version for `rollback_agent`.

Planning the same file again after applying shows no changes.

For a new squad, there is nothing to export: write the file from the user's
description (each new agent needs `agent_type`), then continue at step 3. Connect
Composio apps first, because the plan rejects links that are not connected.
