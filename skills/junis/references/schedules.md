# Schedules

Read this when something should run by itself at set times, or once later.

## Contents

- What a schedule is
- Creating one
- The prompt
- Running now
- Reading results
- Stopping a run
- Limits
- Changing and removing
- Reporting a new schedule

## What a schedule is

A schedule sends its `prompt`, headed by a line with the run time in Korea
time, to the organization's orchestrator (or to the agent named in its
metadata) at the set time, in a new session, acting as the person who created
the schedule. That person's connections and role apply. Billing follows the
organization's setting: the owner by default, or the creator when the
organization bills members.

## Creating one

```
create_schedule(
  name="weekly-review-report-0929",
  prompt="Run the weekly review report.",
  schedule_type="weekly",
  schedule_config={"time": "09:00", "weekdays": [0]},
  enabled=true,
  organization_id="<uuid>"
)
```

| `schedule_type` | `schedule_config` | Notes |
| --- | --- | --- |
| `once` | `{"run_at": "2026-10-01T09:00:00"}` | A future time. Without a zone it is read as Korea time. |
| `daily` | `{"time": "09:00"}` | |
| `weekly` | `{"time": "09:00", "weekdays": [0, 2, 4]}` | 0 is Monday, 6 is Sunday |
| `monthly` | `{"day": 1, "time": "09:00"}` | Months without that day are skipped |
| `every_minutes` | `{"interval": 30}` | 1 to 60 |
| `every_hours` | `{"interval": 6}` | 1 to 24 |

- All times are Korea Standard Time (UTC+9). If the user is elsewhere, convert
  and state both times in the report.
- `schedule_config` is required even though the tool shows it as optional.
- There is no cron type.
- Names are unique in the organization: creating with a taken name answers
  400, and renaming to one fails with a plain server error (500) whose body
  does not say why. Add a suffix (project, date).
- Creating from here needs the owner or admin role. A member creates and
  manages their own schedules at `https://junis.ai/team/task-planning`.
- Defaults when the user gives none: daily at 09:00, weekly on Monday at
  09:00. Apply them and report them.
- For squads that call models heavily, no interval under ten minutes.

## The prompt

- Keep it short: which job to run. The logic belongs in the agents'
  instructions.
- Do not write dates into the prompt. The platform puts the run time at the
  top of the prompt by itself.
- Make sure the orchestrator's instruction routes this exact prompt to the
  right agent or pipeline. Patch the route map in the same change. Without a
  rule the prompt reaches whichever agent the orchestrator guesses.
- A run has no user to ask. The instructions along the route must not depend
  on questions being answered.

To run one agent directly without routing through the orchestrator, the
schedule's metadata can name it. The platform tool does not expose metadata;
use the API:

`junis_api POST /management/schedules` (CLI:
`api POST /management/schedules --file schedule.json`) with
`"metadata": {"target_agent_id": "<agent uuid>"}` in the body alongside
`name`, `prompt`, `schedule_type`, `schedule_config`. The prompt then goes to
that agent, still headed by the run-time line. `"metadata": {"required_tools":
["<tool name>", …]}` requires a successful call of every listed tool: a run that
misses one keeps the status `completed`, with `result.outcome =
"required_tool_missing"` and the missing names in
`result.completion_check.missing`. `"metadata": {"alert_webhook":
"{cred:NAME}"}` (or `{cred:private:NAME}`, a registered secret holding a
Slack-compatible webhook address; a plain address is ignored) makes the
platform POST a short text to that webhook after every run whose status is
not `completed` or whose outcome is not `success`. This is how an unattended
squad reports its own failures; put it on every schedule nobody watches, with
the secret in the user's checklist. A `PUT` with `metadata` replaces the whole
object, so send every key again.

## Running now

`junis_api POST /management/schedules/<id>/run-now` starts a run at once and
spends credits like any run. The answer carries a queue `task_id`, not the
run; find the run in `/runs`. A paused schedule is not run although the call
answers success: enable it first. While a run of that schedule is active, or
one started in the last 30 seconds, it answers `already_running` with
`existing_run_id` instead of starting another.

## Reading results

| Want | How |
| --- | --- |
| Did it run, when next | `list_schedules`: `last_run_at`, `run_count` (completed runs only), `next_run_at`, `enabled`. It returns at most 100; with a member's key, only the schedules that member created. One schedule: `junis_api GET /management/schedules/<id>` |
| Each run's session, status and verdict | `junis_api GET /management/schedules/<id>/runs`, newest first. Filters: `status` (`pending`, `running`, `completed`, `timeout`, `failed`), `limit` (up to 200), `offset` |
| What it produced | The run's `session_id` → `get_session_messages` |
| Which tools the run called, and which failed or were blocked | `list_tool_calls(agent=<name>, days=1)` (names, status ok / error / blocked, duration; never argument values), `tool_call_summary(days)` for the organization. Kept 90 days. A "tool not available" answer, a blocked write or a connection that silently was not there shows here first |
| Why it stopped running | `task_metadata.disabled_reason` in `list_schedules`: `credit_exhausted` (the payer adds credits and you enable it again), `owner_inactive` (the creator's account is gone or suspended; recreate the schedule as another owner or admin). A schedule with no successful run and no edit for 30 days is also switched off, without a reason |

A run marked `completed` only means nothing crashed. Each run's
`result.outcome` is the platform's own verdict; start a diagnosis from it (a
failed run may have no result; read `error_message`).

| `result.outcome` | Meaning |
| --- | --- |
| `success` | No known fault |
| `empty_output` | The final answer was empty |
| `subagent_empty` | An agent with an `output_key` wrote nothing |
| `transfer_bounce` | An agent handed the work straight back without doing it |
| `tool_call_leaked` | A tool call was written out as text instead of run |
| `mcp_dropped` | An MCP connection failed; the agent ran without its tools |
| `loop_guard_truncated` | A loop was cut off and produced nothing else |
| `loop_incomplete` | The loop's last report says items remain (`K<N`); the loop ended before the work did |
| `confirmation_required` | A tool on the agent's confirmation list was needed, and a scheduled run has nobody to approve it, so it was not run. Take the tool off the list (`set_agent_confirmation_tools`) or have the squad prepare instead of act ([improving.md](improving.md)). An action whose risk is `confirm` behaves the same way and cannot be taken off a list: an unattended squad needs actions a person approved with risk `auto` ([actions.md](actions.md)) |
| `required_tool_missing` | A tool in `metadata.required_tools` never succeeded (see above) |
| `transient_error_only`, `transient_error_present` | A temporary provider error was the whole answer, or part of it |
| `model_error_present` | A model error message is part of the answer |
| `truncated` | An error ended the run after part of an answer (run status `timeout`); the partial answer is kept and `error_message` says why. A run cut at the 5-hour limit is `failed` instead |
| `failed` | The run failed; read `error_message` |

A run the platform reclaimed after a long stall with no activity also has
status `timeout`; its `error_message` starts with `[STALE_CLEANUP] Stalled`,
and it may have no answer at all. A run whose server was replaced mid-way is
closed as `failed` with `[POD_LOST]` at the start of `error_message`; the
next trigger runs normally.

The platform can also learn from runs: with "Lessons from runs" switched on
for the organization (an owner or admin, `https://junis.ai/admin/dashboard` →
Settings; off by default and not reachable through the API), repeated failing
outcomes are collected nightly and turned into instruction proposals that a
person reviews at `https://junis.ai/team/agent-proposals`. Nothing is applied
by itself, and the owner pays for the model call. Mention it when a squad
runs unattended.

`result.evidence.input_injection.<agent>.empty` lists the placeholders
(`{key}` or `{key?}`) that reached that agent empty: the hand-over that failed
([handoff.md](handoff.md)).

Completed runs regularly turn out not to have done their job: a hand-over with
empty text so nothing was sent, a connection that silently was not there, an
answer cut off. So:

- Have the last agent end with verifiable facts: the link of what was posted,
  the name of the file written, the number of rows saved.
- Do not put the smallest model at the end of a scheduled pipeline.
- After creating a schedule, check its first real run and report what you
  found.

## Stopping a run

Scheduled runs stream when the orchestrator's `streaming_enabled` is on (the
default), so they can be stopped within a second; with it off, cancel stops
the run after the step in progress, like `junis_run`
([running.md](running.md)):
`junis_api POST /sessions/<session_id>/cancel` with the run's `session_id`.
It works only with the key of the person the run acts as (the schedule's
creator), and only while the session is processing; otherwise it answers 409
`not_processing`. The platform bills up to the cut. Once a status check past
two hours has marked the session `timed_out`, cancel also answers 409, though
the run can go on. To stop future runs, pause the schedule.

## Limits

| Limit | Value |
| --- | --- |
| Longest run | 5 hours |
| Overlap | One run per schedule at a time; a trigger during a run is skipped |
| Session | New for each run by default, so earlier runs are not remembered unless results were saved to the wiki, a document store or files. Through the API, `session_config: {"use_existing_session": true, "session_id": "<a session of the creator>"}` continues one session instead; every run then pays for the growing history. |

## Changing and removing

| Job | Tool |
| --- | --- |
| Pause or resume | `toggle_schedule(schedule_id, enabled)`; `enabled` is required |
| Change time or prompt | `update_schedule` with only the fields to change |
| Remove | `delete_schedule` |

Members can see and change only schedules they created. Owners and admins can
change all.

## Reporting a new schedule

Tell the user: what runs, when (Korea time and their own), who pays, where
results appear, where failures are reported (`alert_webhook`, or nowhere),
and what they must still connect for it to work. Schedules run without anyone
watching, so anything missing fails silently until someone looks.
