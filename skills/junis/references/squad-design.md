# Designing a squad

Read this before creating an organization or agents, and before restructuring
an existing squad. After designing, build with
[build-and-verify.md](build-and-verify.md).

## Contents

- Step 1: what kind of request is this
- Step 2: split the work
- Step 3: choose the structure
- The patterns
- Settings by position
- Size
- Reusing what exists
- Copying a squad to another organization
- Design mistakes to avoid
- Special squads: deep research, community simulation

## Step 1: what kind of request is this

| The request | Do |
| --- | --- |
| Ends with one answer ("summarize this", "research X once", "analyze this file") | Build nothing. Send it to the orchestrator of an existing organization, or answer yourself. |
| Changes something that exists ("add an agent", "change the routing", "connect Slack") | Read the current state, snapshot, change only that. |
| Needs new, repeatable capability ("every morning…", "whenever a review arrives…", "a team that…") | Design and build. |

Words that signal repeat use: every, daily, weekly, whenever, automatically,
from now on. Without them, treat the request as a one-off.

## Step 2: split the work

1. Write the request as independent units of work.
2. Put units that use different tools or connections in different agents.
   Units that use the same tools can share one agent.
3. Start from one agent. A second agent is justified when the branching no
   longer fits one instruction, when one agent would need more than about
   fifteen tools, or when a step needs a different model (for example a
   reviewer from another model family).

A multi-agent run costs several times the tokens of a single agent doing the
same job. Parallel steps reduce waiting time, not cost. Judge a design by cost
per successful result.

Example: "collect customer reviews, analyze them, send a weekly report to
Slack" becomes a collector (web collection), an analyzer (no tools), a sender
(Slack), run in order once a week.

## Step 3: choose the structure

| Relation between units | Structure |
| --- | --- |
| The user picks one of several jobs each time | Orchestrator routes to sub-agents |
| B needs A's result | `SEQUENTIAL_AGENT` with A then B |
| A, B, C are independent and can run together | `PARALLEL_AGENT`, followed by a combiner |
| The same step repeats over a list, or until good enough | `LOOP_AGENT` |
| A needs B's help in the middle of its own work and writes the final answer itself | B as a tool: `is_tool_agent=true`, and `agent_tool:<B's name>` in A's `tools` |
| Agents need documents | `RAG_AGENT` attached as a tool to whoever asks |

Structures nest: the orchestrator can route to a sequential pipeline whose
second step is a parallel group and whose last step is a loop.

## The patterns

### 1. Flat routing

```
Orchestrator
├── AgentA
├── AgentB
└── AgentC
```

For up to about six agents with no data flowing between them. The
orchestrator's instruction must state the routing rules explicitly; models do
not route reliably from agent names and descriptions alone. Still write each
`description` as a routing hint (what it takes, what it returns).

### 2. Pipeline

```
Orchestrator
└── Pipeline (SEQUENTIAL_AGENT)
    ├── Collector   order 1, output_key collected_data
    ├── Analyzer    order 2, output_key analysis_result
    └── Sender      order 3
```

Only a sequential agent guarantees order. The first child that must read the
user's request uses `include_contents="default"`.

### 3. Fan-out and combine

```
SEQUENTIAL_AGENT
├── Workers (PARALLEL_AGENT)
│   ├── WorkerA  output_key result_a
│   ├── WorkerB  output_key result_b
│   └── WorkerC  output_key result_c
└── Combiner (LLM_AGENT) reads {result_a?} {result_b?} {result_c?}
```

A parallel agent never merges anything itself. The combiner must reference
every worker's key, and its instruction must say what to do with an empty one
("mark the source as not collected; do not invent it"). Keep a fan-out to five
workers or fewer. Workers must not read each other's keys.

Also use a parallel agent to send one input to several destinations at once
(publish and back up, post to several channels).

### 4. List, then process one by one

```
SEQUENTIAL_AGENT
├── Lister   output_key item_list
└── ProcessLoop (LOOP_AGENT, max_iterations N)
    └── Processor  tools include exit_loop
```

One item per iteration keeps each step small. The processor's instruction:
find the last item number handled, handle the next, begin the answer with
progress in the form `item 4 of 12 (8 remaining)` or, in Korean,
`(12개 중 4번째, 잔여 8개)` (the platform reads these two forms; `(4/12)` is
ignored), end each iteration with one line of text saying what was done, and
call `exit_loop` after the last item or when nothing is left. Set
`max_iterations` to 1.2 to 1.5 times the expected item count; when the count is
known only at run time, size it for the longest list you expect.

### 5. Generate and review

```
LOOP_AGENT (max_iterations 3)
├── Generator  output_key draft
└── Reviewer   tools include exit_loop
```

The reviewer calls `exit_loop` when the draft passes; otherwise it writes
feedback and the loop continues. Three iterations is the useful range; more
tends to oscillate. Use a reviewer from a different model family than the
generator, and give it a checkable pass condition. Where a deterministic check
exists (a test, a schema, a count), run it before the model's opinion.

### 6. Knowledge as a tool

```
Orchestrator or Writer   tools: agent_tool:ProductDocs, agent_tool:WeeklyReports
ProductDocs   (RAG_AGENT, one datastore)
WeeklyReports (RAG_AGENT, one datastore)
```

One RAG agent per kind of data. One large mixed store searches worse and costs
more. RAG agents are never sub-agents. The caller's instruction says which
store answers which kind of question.

### 7. Hierarchy

```
Orchestrator
├── ResearchRouter (LLM_AGENT that routes)
│   ├── NewsPipeline    (pattern 2 or 3)
│   ├── ReviewPipeline  (pattern 4)
│   └── …
├── Publishers (one agent per channel)
└── Analyst
```

Above eight direct sub-agents, group related agents under routing agents or
pipelines. Every container sits inside the tree; none is left unattached.

## Settings by position

Set these explicitly on every agent. Field details are in
[agent-settings.md](agent-settings.md).

| Position | `include_contents` | `output_key` | `reasoning_effort` |
| --- | --- | --- | --- |
| Orchestrator | ignored (always full history) | set one | medium |
| Sub-agent reached by hand-over | `default` | optional | by difficulty |
| First pipeline child that reads the user's request | `default` | set, for the next child | none or low |
| Later pipeline child whose whole input arrives through `{key?}` | `none` | set, unless it is last | none or low; medium for a combiner |
| Parallel worker | `none` | set, unique in the group | none or low |
| Loop child | `none` | set | none or low |
| RAG agent | stored as default; irrelevant as a tool | set | none at creation; can be raised later on Gemini 3 models |
| Agent used as a tool | either | set | by difficulty |

`none` means the agent sees only the current turn, which starts at the last
message written by the user or by another agent. An agent reached through a
hand-over therefore does not see the user's original message unless the agent
handing over repeats it. See [handoff.md](handoff.md).

Set `temperature=1.0` on direct Gemini and RAG agents; leave it at its default
elsewhere, and `max_output_tokens` at its default.
`max_llm_calls` has effect only on the orchestrator.

## Size

| Agents | Shape |
| --- | --- |
| up to 6 | Flat routing |
| 7 to 8 | Flat, with very explicit routing rules |
| more than 8 | Hierarchy |
| more than 30 | Routers per domain, pipelines, several RAG agents |

Five to ten tools per agent works well. Never more than fifteen. The group
token `sandbox` alone brings sixteen, and a new organization's orchestrator
starts with it ([build-and-verify.md](build-and-verify.md), "The orchestrator").

## Reusing what exists

- Another organization of the same user already does part of the job: the
  orchestrator can call it with its built-in `call_another_squad` tool instead
  of rebuilding it (other agents need `squad_list` and `call_another_squad` in
  their `tools`). The called squad answers in a new session, so the message
  must carry all the context it needs.
- A global MCP platform or system skill already exists: link it rather than
  registering a copy.
- A similar agent in the same organization: `clone_agent` with a `new_name` of
  letters, digits and underscores (always pass it: the default is
  `<name>-copy`, with a hyphen), then patch the instruction and set a new
  `output_key` (the clone keeps the original's). Clones lose
  `include_contents`, `max_llm_calls`, `max_iterations`, answer checking,
  skills, OAuth apps, devices and sub-agents; set them again. A cloned
  container is empty.

Organization skills and non-global MCP platforms can be attached only inside
their own organization. To use one elsewhere, create it again there.

## Copying a squad to another organization

`clone_agent` stays inside one organization, so a copy is a rebuild. First
offer the alternative: the target's orchestrator calls the source squad with
`call_another_squad`, nothing is copied, and the source organization's billing
rule applies to its part (its owner pays by default). To copy, in this order:

1. Snapshot the source (`snapshot`, or `get_agent` on every agent and
   `list_sub_agents` on every parent).
2. Create each agent in the target with every field from `get_agent`,
   including `include_contents`, `max_iterations`, `output_schema` and
   `verify_*` (an `apply_team_changes` batch takes them all). Keep the names,
   so `agent_tool:<name>` still resolves.
3. Wire children in the same order; patch the target orchestrator's route map.
4. Organization MCP platforms and skills: create them again, then link and
   assign. The user re-enters MCP credentials.
5. OAuth connections belong to one organization: link the apps, then the
   people authorize again in the target ([connections.md](connections.md)).
6. The user registers every `{cred:NAME}` secret again in the target, and each
   person their own `{cred:private:NAME}`.
7. Copy personality, identity and wiki pages worth keeping
   ([memory-and-identity.md](memory-and-identity.md)). Upload documents again,
   as Knowledge sources or to new stores ([knowledge.md](knowledge.md)); each
   RAG agent then needs its new `rag_<datastore_id>`.
8. Recreate schedules ([schedules.md](schedules.md)). Keep the source's
   schedules paused until the target passes a real run; then the user decides
   what happens to the source.

## Design mistakes to avoid

| Mistake | Why it fails |
| --- | --- |
| Siblings under flat routing passing results through `output_key` | No order is guaranteed between them, and text written in the same response as a hand-over is never stored. Use a pipeline. |
| A container created without children | It builds to nothing and is skipped without an error. Add children right after creating it. |
| Initializer and worker wrapped in one sequential agent for multi-session work | The initializer runs again every session. Keep them side by side under the orchestrator. |
| A relay agent with no tools on the cheapest model | Cheap models often hand over with an empty message, and the receiver then has no input. Use a mid-tier model for agents whose job is to pass work on. |
| Two search methods on one agent | Pick one: the web search setting, a search tool, or a scraping platform. |
| A schedule added without a routing rule | The schedule's prompt goes to the orchestrator; without a rule it reaches the wrong agent. |
| Human approval expected mid-run | A run cannot pause. Put the approval in the conversation: the agent asks and makes no tool call until the user answers. |
| Agents that can read private data, read untrusted content and send data out, all at once | That combination is how prompt injection leaks data. Allow at most two of the three in one agent, or require the user's confirmation before sending. |

## Special squads: deep research, community simulation

### Deep research

For questions that need many sources and a written synthesis.

```
Orchestrator
└── ResearchPipeline (sequential)
    ├── Searchers (parallel, 3 to 5)   one angle each, web search on, output_key per searcher
    ├── Synthesizer                    include_contents="none", reads every {searcher_key?}
    └── ReviewLoop (loop)              Reviewer → Reviser with exit_loop
```

- Put a scaling rule in the orchestrator's instruction: a single fact needs
  one agent; a comparison two to four; a broad survey the whole pipeline.
  Three to five parallel searchers is the useful range; more repeat each
  other.
- Each searcher gets one search method (the web search setting or one
  scraping platform), a fixed angle, and an output contract with sources.
- The synthesizer reads only keys, so it needs `include_contents="none"` and
  a placeholder for every searcher.
- Multi-agent research costs on the order of ten to fifteen times the tokens
  of a single agent answering. Say so to the user before building one.

### Community simulation

For "how would people react to X" questions: a simulated community reacts to
a seed text over rounds, and the squad interviews it and writes a report.
Tools, prerequisites, stages and arguments are in
[agent-tools.md](agent-tools.md), "Social simulation".
