# Diagnosing and improving a squad

Read this when a squad gives wrong, empty, slow or expensive results, or when
the user asks to make it better.

## Contents

- The loop
- Step 1: get the evidence
- Step 2: locate the fault
- Step 3: change one thing
- Step 4: prove it
- Keeping a regression set
- Making it cheaper or faster
- Reviewing a whole organization
- What the agent actually runs with

## The loop

```
evidence → locate → one change → same request again → compare → report
```

Change one thing at a time. Two changes at once tell you nothing about which
one helped.

## Step 1: get the evidence

1. The exact request that went wrong, and the answer. If the user only
   describes it, find the session: `search_sessions(query)` finds the user's
   own sessions by words (also by tool or by schedule); `list_sessions` lists
   them newest first. Then `get_session_messages`. For a scheduled run, start from
   `junis_api GET /management/schedules/<id>/runs`: each run has its
   `session_id`, the platform's verdict `result.outcome` and, in
   `result.evidence.input_injection`, the placeholders (`{key}` or `{key?}`)
   that arrived empty
   ([schedules.md](schedules.md)). `list_tool_calls(agent=…, days=…)` shows
   which tools the run called and which failed or were blocked, without
   argument values; `tool_call_summary` the whole organization.
2. The structure: `list_sub_agents` from the orchestrator downwards.
3. The settings and instruction of each agent on the route: `get_agent`.
4. A snapshot of the organization, before any change.

Read the session messages in order. They show which agent spoke, what it
passed on, and where the content stopped making sense.

## Step 2: locate the fault

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Wrong agent answered | Routing rule missing or ambiguous; session continued after an earlier hand-over; orchestrator model changed from the chat header | Orchestrator instruction and model; was `session_id` reused? |
| Agent answers as if it got no input | Key mismatch, producer ended on a tool call, `include_contents="none"` on an agent that must read the request | [handoff.md](handoff.md), last section; `input_injection` of a scheduled run |
| Agent fails on every call | Model not registered; `{artifact.…}` in the instruction; the provider refuses a setting (a 400 in the session messages) | `list_llm_models`; brace check; `get_session_messages` |
| Agent acts as if part of its instruction were missing | A brace read as a variable becomes empty text without an error | Brace check; `warnings` of the last create or update |
| "Tool not available" in the answer | Tool name unknown, connection not linked or not activated, OAuth missing or expired, device offline | `get_agent`, `get_agent_composio_status`, `list_composio_connections`, `list_devices` |
| Tool called with wrong arguments | Instruction lacks an exact example | Instruction |
| Answer invents facts | No source attached, or instruction allows answering from general knowledge | Tools; "use only what the tools return" |
| Knowledge agent finds nothing | Store empty or still indexing; files uploaded as `.jsonl` or named `existing_*` (never indexed); RAG agent moved off Gemini; question routed to the wrong store | `list_datastore_files`, `get_upload_status`, `get_agent` |
| Loop runs to the limit | `exit_loop` missing, or no checkable exit condition | Child's `tools` and instruction |
| Loop stops early | `max_iterations` too low; nested loop; the child repeated itself and was stopped | Settings; add progress markers |
| Parallel results missing from the report | Combiner does not reference every worker's key | Combiner instruction |
| Output format varies | No exact contract; tools or search switched on for a format-only agent | Instruction; settings |
| Scheduled run did nothing useful | No routing rule for the schedule's prompt; creator's connection missing; last agent wrote no result; a tool on a confirmation list was needed (`confirmation_required`) | The run's `result.outcome`; orchestrator instruction; connections of the schedule's creator; `list_tool_calls` for blocked calls |
| The same fault keeps coming back in scheduled runs | Nobody reads the runs | "Lessons from runs" (an organization setting, web app only) turns repeated failing outcomes into instruction proposals for review at `https://junis.ai/team/agent-proposals`; `alert_webhook` on the schedule reports each failure ([schedules.md](schedules.md)) |
| Worked yesterday, fails today for all agents of one provider | Provider outage, quota or spending cap | Error text mentions 429, quota or capacity |
| Answer cut off | Output limit lowered; a very long context | `max_output_tokens`; session length |

If the cause is not visible from settings and messages, reproduce: send the
same request in a new session and read the new messages.

## Step 3: change one thing

Prefer, in this order:

1. **Instruction**, by patch. Most faults are here: a missing rule, a missing
   example, a missing "when empty".
2. **Wiring**: order, a missing combiner, a tool agent instead of a sub-agent.
3. **Settings**: `include_contents`, `output_key`, `reasoning_effort`,
   `max_iterations`.
4. **Model**, only when the instruction is already clear and the model still
   cannot do it. Raise effort before raising the tier.
5. **Structure**: split or merge agents.

When fixing an instruction, fix the class of mistake, not the one example. If
the agent mishandled one product name, do not add that name; add the rule that
covers such names, with the reason.

## Step 4: prove it

1. Send the original request again, in a new session.
2. Compare old and new answers on the point that was wrong.
3. Send two or three other typical requests to see that nothing else broke.
4. For unattended squads, repeat several times. Models vary; one success is
   not proof.
5. `snapshot diff <before> <after>` to list exactly what changed.

Report to the user: what was wrong and why, what you changed (agent and
field), what the same request returns now, and what you could not verify.

If the change did not help, undo it before trying the next idea, so changes do
not pile up.

## Keeping a regression set

For a squad that people rely on, keep a short list of requests that must keep
working and run it around every instruction or model change.

1. **Write the set once**, with the user, in a file in their project (for
   example `junis-regression.md`): 3 to 10 typical requests, each with the
   points a good answer must contain (the user's own wording of "correct").
   Take them from real sessions that went well; include the request that just
   failed.
2. **Leave out requests that act on the world** (send, post, pay, delete) or
   point them at a test target the user names. Every request in the set runs
   for real and is billed; say how many runs a round costs before starting.
3. **Before the change**, take a snapshot and run each request 3 times, each
   in a new session (`run orchestrator "@<file>"` with no `--session`). Models
   vary; one run proves little.
4. **After the change**, run the same requests the same way.
5. **Compare** per request: how many of the 3 answers contain every required
   point, before and after. Judge by the required points, not by wording.
6. **If any request got worse**, undo the change before trying another idea:
   patch it back from the snapshot, or restore the previous version with
   `preview_agent_rollback` then `rollback_agent` (see
   [build-and-verify.md](build-and-verify.md), "Undoing a change"). Report
   both rounds to the user either way.

Add each new failure the squad has to the set once it is fixed, so it cannot
come back unnoticed.

## Making it cheaper or faster

The kit sees no prices and no spending. Compare what you can count: model
calls on the route (agents passed, loop iterations), reasoning effort, tools
per agent, history carried along. For money, the payer reads
`https://junis.ai/usage` ("By AI Team") for the same request before and after
the change; until then, state any saving as an estimate.

Ask what matters to the user first: cost, time, or quality. Then look at the
structure before the models.

| Lever | Effect |
| --- | --- |
| Remove agents that only pass work along | One model call less per agent |
| Call the target agent directly (or name it in a schedule's metadata) instead of routing | Saves the routing call |
| `reasoning_effort` none or low on simple steps | Fewer output tokens, faster |
| Smaller model on classification, extraction, formatting | Lower price per call |
| `include_contents="none"` on steps that get everything through keys | Shorter prompts |
| One item per loop iteration, short progress lines | Context stays small |
| New session per unrelated request; no session reuse in schedules | History is not paid for again |
| Filter lists with a cheap judging tool before an expensive model reads them | Fewer tokens where they cost most |
| Shorter instructions; move long know-how into a skill | The skill body is loaded only when used |
| Remove tools an agent does not use (a new orchestrator starts with `sandbox`, media and `jev_*` tools) | Every tool is described on every call |
| Remove `{current_time}` where the time is not needed | Prompt caching works |
| Parallel instead of sequential for independent steps | Less waiting, same cost |

Keep the expensive model where a wrong answer is costly: the final writer, the
reviewer, the planner. Measure by cost per successful result, which includes
the cost of the runs that failed.

After each change, run the usual request and compare quality. Cheaper with
worse answers is not an improvement unless the user accepts it.

## Reviewing a whole organization

When the user asks "check my squad" without a specific fault:

1. Snapshot, then walk the tree from the orchestrator.
2. Run the checklist of [build-and-verify.md](build-and-verify.md) against
   every agent.
3. Run the brace check on every instruction in the snapshot.
4. Look at recent sessions, especially scheduled ones, with the table in
   [running.md](running.md) ("Judging the answer").
5. Report findings in three groups: broken now, likely to break, could be
   better. For each, name the agent, the evidence and the proposed change.
6. Change nothing in an organization in use until the user agrees to the list.

## What the agent actually runs with

When an answer looks like the agent ignored part of its setup, compare what is
stored with what runs: `get_agent_effective_config` (with `organization_id`).

- `instruction.placeholders.unfilled`: `{names}` nothing fills. They become
  empty text at run time, so the sentence around them silently loses its
  meaning. Use `{name?}`, give an earlier agent that `output_key`, or remove
  the braces.
- `effective.output_key`: the key this agent's answer is stored under (the
  default is `<snake_name>_output` when none is set).
- `tool_access`: per MCP or Composio link, the tools the agent may use and the
  ones that ask a person first. Only a web chat with the agent itself can
  show the question: in scheduled and API runs, in the children of sequential,
  parallel and loop agents, in agents called as tools, through
  `call_another_squad` and on the public widget the tool is not run at all
  (outcome `confirmation_required`). Put confirmations only on agents people
  talk to directly.
- `context_window`: when this model's history gets compacted.
- `flags`: platform behaviours in effect for this organization and which
  layer decided each one. `get_effective_feature_flags` lists them all.

Narrow an agent's tools to the ones it needs with `list_mcp_platform_tools`
then `set_agent_enabled_tools`; require a person's approval for irreversible
ones with `set_agent_confirmation_tools`. Organization-wide: `get_tool_safety`
/ `set_tool_safety`. Widening access or removing an approval needs the user's
go-ahead.

For a rule across all agents, use `tool_policy` in `set_tool_safety`: a preset
(`ask_before_write` or `read_only`) and rules per tool, such as asking before
`GMAIL_*` or not running a tool when an argument contains a value. Nothing is on
by default. A tool that asks does not run in scheduled runs, pipeline steps,
agents called as tools or `/agents/{id}` API runs, so check the squad's
schedules and pipelines before turning a preset on.
