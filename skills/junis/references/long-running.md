# Work that spans many sessions

Read this when a job is too large for one run: building an application over
days, migrating a large set of items, research that accumulates over weeks.
For repetition inside one run, use a loop ([squad-design.md](squad-design.md)).

## Contents

- The problem
- Structure
- The record
- The worker's session
- Failure modes and defences
- Schedules for the worker
- Sandbox facts
- Cost
- Reporting progress

## The problem

Each session starts without the memory of the last one. Results passed between
agents in a run vanish with the session. Sandboxes are temporary. An agent
asked to "continue" without a written record starts something else, repeats
work, or declares the job done.

The solution is a harness: a fixed record outside the session, and a fixed way
of starting every session from that record.

## Structure

```
Orchestrator
├── Initializer   runs once: writes the plan, the task list and the setup
└── Worker        runs every session: reads the record, does one task, updates the record
```

Keep the two side by side under the orchestrator. Wrapped in a sequential
agent, the initializer would run again every session. The worker reads the
user's request, so it uses `include_contents="default"`.

A schedule sends the worker's prompt at intervals. Either the orchestrator's
instruction routes that prompt to the worker, or the schedule names the worker
in its metadata (`target_agent_id`, see [schedules.md](schedules.md)).

## The record

Created by the initializer, kept where it survives: a document store, the
wiki, or a repository. Never only in the sandbox or in session state.

| Item | Content | Rule |
| --- | --- | --- |
| Task list | Every task with its acceptance steps and a status, all starting as not done | Tasks are never removed or reworded to make them pass |
| Progress notes | What was done last, what comes next, what is broken | Updated at the end of every session |
| Setup script | How to get a working environment from nothing | Run at the start of every session |
| Repository | The actual work | Committed at the end of every session |

For code, a remote repository is required. The worker reaches it through a
linked GitHub platform or OAuth app (`list_mcp_platforms`,
`list_composio_integrations`), not through a token inside the sandbox:
platform credentials must not be assumed available there, and the sandbox is
gone after the session.

## The worker's session

Put this sequence in the worker's instruction:

1. Read the progress notes and the task list.
2. Get the work: clone or pull; run the setup script.
3. Check that what was marked done still works.
4. Choose the most important task that is not done. One task per session.
5. Do it. Verify it by its acceptance steps, by running it, not by reading it.
6. Commit. Mark the task done only if every acceptance step passed.
7. Update the progress notes. If everything is done, write "ALL DONE" at the
   top.
8. Stop.

And these rules:

- If the task cannot be finished in this session, commit what works, write in
  the notes what remains, and stop.
- Leave a clean state: nothing uncommitted, no temporary files, notes current.
- Never write a secret into the notes, the task list or a commit.
- When the notes and the repository disagree, the repository history is right.

## Failure modes and defences

| Failure | Defence in the instruction |
| --- | --- |
| Tries to do everything at once and runs out of context mid-task | One task per session |
| Declares the job finished early | Done only when every task in the list is done |
| Marks tasks done without testing | Acceptance steps must be executed and pass |
| Leaves broken or undocumented state | Clean state rule; verify earlier work at the start |
| Loses time finding out how to run things | Setup script |

## Schedules for the worker

- `every_hours` or `daily`, with an interval longer than a session takes.
- Each scheduled run is a new session; the record carries everything.
- The worker cannot switch its own schedule off (agents have no schedule
  tools). When the notes say "ALL DONE", disable the schedule yourself
  (`toggle_schedule`) the next time you look, or tell the user.
- Check the first two or three scheduled runs by reading their sessions.
- Scheduled runs stream (while the orchestrator's `streaming_enabled` is on),
  so one that goes wrong can be stopped ([running.md](running.md), "Stopping a
  run"). Give a schedule nobody watches an `alert_webhook`
  ([schedules.md](schedules.md)).

## Sandbox facts

| Fact | Consequence |
| --- | --- |
| A sandbox lives about five minutes unless extended, and ends with the session | The worker extends it at the start of long work and pushes results out before stopping |
| A single command times out after two minutes by default | Long commands run in the background and are polled |
| Do not rely on platform credentials inside the sandbox | Use linked connections for outside services |
| The default working folder is the sandbox user's home | Create project folders explicitly |

## Cost

Long-running work with several agents uses many times the tokens of a chat.
Before starting, tell the user the rough daily cost if it is likely to be
significant, and get their agreement once. Afterwards, report progress and
spending when asked: tasks done of total, what was done last, what is next,
and the link to `https://junis.ai/usage`.

## Reporting progress

When the user asks how it is going, read the record, not your memory of it:
the progress notes, the task list counts, the most recent sessions.
