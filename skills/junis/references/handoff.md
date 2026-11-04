# Passing results between agents

Read this when one agent needs what another produced, or when an agent
"receives nothing" and answers as if no input was given.

## Contents

- Two channels
- What gets stored
- What `include_contents` does
- Do I need `{key?}`
- Writing the receiver
- Writing the sender
- Checking that data flowed

## Two channels

| Channel | What arrives | Controlled by |
| --- | --- | --- |
| History | Earlier messages of the conversation | `include_contents` |
| State | The last final text an agent wrote, stored under its `output_key` | `{key?}` in the receiver's instruction |

They are independent. Using both for the same result puts it in the prompt
twice.

## What gets stored

An agent's text is stored under its `output_key` only when it is the agent's
final response and contains visible text.

- Text written in the same response as a hand-over or tool call is not stored.
- An agent that ends on a tool call, or produces only reasoning, stores nothing.
- Every LLM and RAG agent has a key. If none is set, it is the agent's name in
  snake case plus `_output`. The orchestrator stores its answer only when its
  `output_key` is set; a new organization's orchestrator has
  `orchestrator_output`.
- An agent called as a tool writes its key back into the caller's state.
- Container agents store nothing; their children do.
- Loop children overwrite their key on each iteration.
- Values are reliable within one run. A later message in the same session may
  not see them (another server, a restart, an idle hour), and they never carry
  over to another session. Persist anything longer-lived in a document store,
  the wiki or a file.
- Keys are flat names. `{plan.steps}` does not work; give each value its own
  agent and key.

## What `include_contents` does

| Value | The agent sees |
| --- | --- |
| `default` | The whole conversation of its branch. |
| `none` | Only the current turn: from the most recent message written by the user or by another agent, to the end. |

Consequences of `none`:

- Reached through a hand-over, the agent's turn starts at the message of the
  agent that handed over. It does not see the user's original request unless
  that agent repeated it.
- Called directly by the user, it sees the user's message.
- Its own earlier messages never start a turn, so in a loop it keeps the final
  text of its earlier iterations; their tool calls and results are removed
  once they grow large.

## Do I need `{key?}`

| Arrangement | Arrives by itself with `none` | Need `{key?}` |
| --- | --- | --- |
| Pipeline A → B, B needs A | A's latest answer | No, it would duplicate |
| Pipeline A → B → C, C needs A | Only B's answer | Yes, A's key |
| Parallel (A, B, C) → D | Only whichever finished last | Yes, all three keys |
| Parallel siblings reading each other | Nothing | Not possible; they run at once |
| Loop with one child, iteration N | The hand-over and its own earlier iterations | No |
| Loop with children A → B, A at iteration N | Only B's previous answer | Yes, A's own key |
| Hand-over from a routing agent | The routing agent's hand-over text | Usually no |
| Agent called as a tool | Only the request text it was called with | Yes, for anything else |
| Any, with `default` | The whole branch history | No |

Rule of thumb: the one directly before arrives by itself; anything further
back, any parallel worker, and anything you want at a fixed place in the
prompt comes through `{key?}`.

## Writing the receiver

```
<input>
Research results:
{research_output?}

If the results above are empty, reply "No research results were received" and stop.
Do not write from general knowledge.
</input>
```

- Copy the producer's `output_key` exactly. A one-letter difference yields an
  empty value without any error.
- Always use the optional form with `?`, and always say what to do when empty.
- For a loop's first iteration the agent's own key is empty: "If the previous
  draft is empty, start from the request."

## Writing the sender

- "Finish with a summary of the results as text." An agent that ends on a tool
  call hands nothing on.
- In a loop: "End each iteration with one line: `done: <item>`."
- When handing over: "Before handing over, write the full request and your
  findings as text. Never hand over with an empty message."
- Gemini 3.7 and 3.8 agents write no text in the turn that hands over: the
  model follows the hand-over rule literally and puts its findings in its
  reasoning, which is not stored, so the receiver gets an empty message
  whatever the instruction says. On those models pass results with a
  sequential agent and `{key?}` and use hand-overs for routing only.
- Do not use the cheapest model tier for agents whose whole job is to pass work
  on. They tend to hand over with empty text, and the receiver then runs on
  nothing.

## Checking that data flowed

A run that "completed" proves nothing here. In the final answer, look for the
content of each stage. An empty section, a generic answer, or a reply such as
"please provide the data" means a key did not arrive. For a scheduled run, the
run's `result.evidence.input_injection.<agent>.empty` names each placeholder
(`{key}` or `{key?}`) that arrived empty ([schedules.md](schedules.md), "Reading results"). Then
check, in order:

1. Did the producer end with text? Read the session messages.
2. Does the receiver's `{key?}` match the producer's `output_key` exactly?
3. Is the producer before the receiver in the same sequential flow?
4. Does the receiver have `include_contents="none"` while expecting to read
   the user's request?
