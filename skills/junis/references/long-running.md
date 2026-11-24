# Work that spans many sessions

Read this when a job is too large for one run: building an application over
days, migrating a large set of items, research that accumulates over weeks.
For repetition inside one run, use a loop ([squad-design.md](squad-design.md)).

## Contents

- The problem
- Structure
- The record
- The squad board as the record
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

Created by the initializer, kept where it survives: the squad board, a
document store, the wiki, or a repository. Never only in the sandbox or in
session state.

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

## The squad board as the record

The squad board is the platform's own record for the task list and the
progress notes: tasks and notes kept in the database, shared by every agent
that has the board tools, and still there in the next session. It replaces a
hand-kept task file, and it lets several workers run at once.

| Item of the record | On the board |
| --- | --- |
| Task list | Tasks with a status. `board_add_task` adds one; `board_claim_task` hands the next open task to exactly one worker; `board_complete_task` records the result. |
| Progress notes | `board_post_note`, and each task's result. |
| What is left | `board_read`: counts per status, the open tasks, the latest notes. |

Give the initializer `board_add_task` and `board_post_note`, and the worker
`board_read`, `board_claim_task`, `board_complete_task` and `board_post_note`.
The board tools are never attached automatically.

- A worker that stops in the middle leaves its task claimed. The claim runs
  out (60 minutes unless the worker asked for another time with
  `lease_minutes`) and a later session's worker gets the task again, so no
  clean-up step is needed. Keep the claim time shorter than the schedule's
  interval: a run that starts while the dead run's claim is still held gets
  no task.
- A claim that returns no task says why. Reason `empty` means no unfinished
  task is left: the job is done. Reason `nothing_claimable` means the rest is
  still held, waits for review or is stuck; `counts` in the reply shows
  which. Only `empty` is the signal to switch the schedule off.
- Every claim counts, also one that was released or sent back by a review. A
  task claimed five times without finishing is marked stuck and no worker
  gets it until a person reopens it. Read its notes, edit the task if it is
  unclear (`squad_board_update_task`, or the task's "Edit task" on the board
  page), then reopen it with `status="open"`.
- Done is recorded by the tool, with the result text, and cannot be undone by
  a worker. With review required on the board
  (`squad_board_save(require_review=true)`), a completed task counts as done
  only after a different agent or a person passes it.
- You and the user read the same record: `squad_board_get`, or
  `https://junis.ai/team/board`.
- The board tools work only in runs of the organization's members. A widget
  visitor's or a provisioned account's conversation cannot read or write it.

The setup script and the repository stay as they are: the board holds the
list and the notes, not the work itself.

With the board, the worker's session below changes in four places. Step 4:
the worker takes what `board_claim_task` hands it (the lowest open number)
instead of choosing. Step 6: done is `board_complete_task` with the result. A
task that cannot be finished in the session is released
(`outcome="released"`) with a note saying where it stands. Step 7: there is
no "ALL DONE" line to write, because notes are only added; the job is done
when a claim answers `empty`.

One worker per session, as in "Structure", still uses
`include_contents="default"` because it reads the schedule's prompt. Several
workers at once are the loop children of pattern 8 in
[squad-design.md](squad-design.md), and those use `"none"`.

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
- With the board as the record, give the worker's schedule the precondition
  `board_has_work` (`work: "claimable"`; a reviewer's schedule `"active"`): a
  beat with nothing to take then calls no model and costs nothing
  ([schedules.md](schedules.md), "Running only when there is work").
- The worker cannot switch its own schedule off (agents have no schedule
  tools). When the notes say "ALL DONE" (with the board: when
  `squad_board_get` shows no open, claimed, review or stuck task), disable
  the schedule yourself (`toggle_schedule`) the next time you look, or tell
  the user.
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
