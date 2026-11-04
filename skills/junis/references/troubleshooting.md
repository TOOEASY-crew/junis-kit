# Troubleshooting

Find the message or symptom, apply the fix. For faults in how a squad behaves
(wrong answers, empty results), see [improving.md](improving.md).

## Contents

- Setup on this machine
- Access and billing
- Calls that are refused
- Building
- Running
- Connections
- When nothing here matches

## Setup on this machine

Run `doctor` first. It checks Node, the bridge, the platform, the key, the
organization and every installed agent, and names the fix for each failure.

| Symptom | Cause | Fix |
| --- | --- | --- |
| No Junis tools in the agent | The agent was open during install, or the install did not cover it | Restart the agent. `install --agents <id>`. |
| The MCP server "junis" fails to start | Node was moved or removed (version manager) | `install` again; it records the current Node path. |
| `redirect_refused` | The configured URL has a trailing slash or points to the wrong place | Use the exact endpoint, for example `https://mcp.junis.ai/mcp`. |
| `network`, `timeout` on every call | No connection, a proxy, or a wrong URL override | Check `JUNIS_API_BASE` and `JUNIS_MCP_URL`; unset them to use the defaults. |
| `no_clipboard` | No clipboard tool (remote shell, container) | Use browser login: `junis_connect` with `method: "browser"` (`login --browser`). Nothing is copied. |
| `no_key_in_clipboard` | Something else was copied | The user presses the copy button next to the key again, or use browser login. |
| `access_denied` | The user refused the key request in the browser | Start again only if the user wants to connect. |
| `login_expired` | The request was not approved within its window (about five minutes), or the approved key was not collected within five minutes | Start again: `login --browser --restart`. In the second case the user revokes the unused `Junis kit-…` key on the API keys page. |
| `key_not_checked` | The approved key arrived, but checking it failed (the platform was briefly unreachable, or organization reading was unticked on the approval page) | The key is kept on this machine. Call `junis_connect` with `method: "browser"` again (`login --browser`) to store it. If it keeps failing, `--restart` and revoke the unused `Junis kit-…` key. |
| `login_invalid` | The platform did not accept this machine's proof for the request (the waiting request was altered or replaced) | Start again: `login --browser --restart`. |
| `login_host_changed` | The request was started for another Junis server (`JUNIS_ENV` or `JUNIS_API_BASE` changed since) | Run it with the settings it started with, or `login --browser --restart`. |
| `browser_login_unavailable` | The platform did not start a key request (too many requests in a minute, or a deployment without it) | Wait a minute and retry, or use the clipboard. |
| `no_pending_login` | No key request is waiting: it was finished, discarded in another process, removed by `logout`, or dropped five minutes after its approval window ended | Start one: `login --browser`. If the user had approved the old one, they revoke that unused `Junis kit-…` key on the API keys page. |
| Approve on the key request page fails | No Basic or Pro plan, or five keys already active | Subscribe at `https://junis.ai/subscription`, or revoke an unused key (never `junis-magic-auto`, a key the platform uses); then approve again, or start a new request now with `login --browser --restart`. |
| `host_not_allowed` | `JUNIS_API_BASE`, `JUNIS_MCP_URL` or `JUNIS_WEB_URL` (set now, or saved by an earlier login under it) points outside `junis.ai` and this machine | Unset the override, or `logout` and connect again without it; for a private deployment set `JUNIS_ALLOW_CUSTOM_HOST=1` on purpose. |
| `needs_confirmation` from a command (exit code 2) | A destructive `api` or `tools call` ran without a terminal and without `--yes` | Tell the user what will be removed or replaced; only if they agree, run it again with `--yes`. |
| `bad_scopes` | `--scopes` named an unknown permission, or the platform refused the list | Use a preset (`read-only`, `operator`, `all`) or names from the permission table in [onboarding.md](onboarding.md). |
| The config file of an agent was reported as "manual" | It contains comments, could not be parsed, or already has a "junis" entry the kit did not make; it was left untouched | Add the shown entry by hand. `install --force` rewrites a file with comments (dropping them) or replaces the other entry; a file that cannot be parsed is always left alone. |
| Claude Desktop has the tools but not the skill | It has no skills folder | Upload `~/.junis-kit/dist/junis-skill.zip` under Customize > Skills. |

## Access and billing

See the table in [onboarding.md](onboarding.md), "Access errors". In short:

| Message contains | The user must |
| --- | --- |
| `subscription_required`, `no_subscription`, `invalid_plan` | Subscribe at `https://junis.ai/subscription` |
| `insufficient_credits` | Buy credits at `https://junis.ai/subscription`; when the message mentions organization credits or `billing_role: member`, the owner adds them |
| `insufficient_scopes` | Personal key: add the missing permissions ("Add permissions" on the API keys page), or connect again with browser login. Organization key (partner): make a new key at `https://junis.ai/admin/dashboard` → API Keys with the permissions picked |
| "admin or owner access required" | Get the role from an owner or admin of the organization |
| `rate_limit_exceeded` | Wait; you must not retry in a loop |

## Calls that are refused

| Message | Cause | Fix |
| --- | --- | --- |
| `bad_organization_id` | A name or slug was passed as `organization_id` | Use the UUID from `list_organizations`. |
| 403 on a call that worked for another organization | The id belongs to an organization the key cannot reach | `list_organizations`; check the role. |
| 404 "Agent not found" | The id is from another organization, or the agent was deleted | List the agents of the target organization. |
| 409 on a patch | `old_string` matched nothing or several places | Read the text again; copy exactly; include surrounding lines. |
| 400 or 409 on creating | The name exists: 400 for an agent or a schedule, 409 for a datastore or a skill | Choose another name, or update the existing one. |
| 409 on deleting a datastore | Agents still use it | Detach them, or confirm with the user and force. |
| 409 on linking an OAuth app | Already linked | Nothing to do. |
| 400 on creating a RAG agent | Non-Gemini model, more than one store, or other tools | [knowledge.md](knowledge.md), "Rules". |
| 400 "Invalid schedule_type" | `cron` or a misspelt type | One of the six types in [schedules.md](schedules.md). |
| 400 on creating a schedule | `schedule_config` missing, or `run_at` in the past | Add the config; use a future Korea time. |
| 422 | A field failed validation; the message names it | Read the tool's schema with describe. `order_index` starts at 1. |
| 413 | Body too large | Send fewer or smaller files per call. |
| 400 `file_too_large` on a RAG upload | Over 10 MB per file through the API (10 files per call) | Split the file, or the user uploads it at `https://junis.ai/team/rag-knowledge` (PDF and Word files up to 50 MB there). |
| "failed after 3 attempts" | The platform tool's connection to the backend failed; a POST is retried only when the platform was certainly not reached | Check the state before repeating a create or send. |

## Building

| Symptom | Cause | Fix |
| --- | --- | --- |
| `apply_team_changes` returned `applied: false` | A change failed the check before sending, so nothing was sent | Fix the items in `rejected` and send the whole batch again. `dry_run=true` checks a batch without sending. |
| The batch was sent but agents are missing | Once sent, it continues after failures | Read `errors`; retry only those items. |
| `update_orchestrator` did not set a field | It maps only some fields and drops the rest silently | Use `update_agent` on `orchestrator-<slug>`. |
| A sub-agent was not detached by leaving it out of the list | The list only adds | `remove_sub_agent`. |
| `update_agent` did not clear a field | Empty text is not sent | Name the field in `clear_fields` (description, profile_image_url, tool_prefix, wallet_address, tools, rag_tools, mcp_platforms). The user is asked first. |
| Tools or MCP links vanished after `update_agent` | A `tools`, `rag_tools` or `mcp_platforms` list replaces the whole list | Read the agent with `get_agent` and send the full merged list; link the lost platforms again. |
| The agent has no such tool although it is in `tools` | The name is not a registered tool | `list_tools`; fix the name. |
| `agent_tool:<name>` has no effect | Target lacks `is_tool_agent=true`, or the name differs | Fix both. |
| A container does nothing | It has no children | `add_sub_agent`. |

## Running

| Symptom | Cause | Fix |
| --- | --- | --- |
| The agent fails immediately on every request | An unregistered model; `{artifact.…}` in the instruction; a provider error (400) shown in the session messages | `list_llm_models`; remove the `{artifact.…}` reference; read the error in the messages and fix the setting it names. |
| A RAG agent answers without using its documents | Its model was changed to a non-Gemini model; the retrieval tool is dropped silently | Put it back on a Gemini model ([models.md](models.md), "RAG agents"). |
| The agent ignores part of its instruction or acts on empty input | An unknown `{word}` in the instruction silently becomes empty text | Brace check (`junis_lint_instruction`); write placeholders as `<word>`, and real keys correctly or as `{key?}` ([instructions.md](instructions.md), "The brace rule"). |
| The answer is wrapped in a code fence although JSON was required | No rule against it, often on the orchestrator's own replies | Add the output contract to that agent. |
| The second request in a session is answered by the wrong agent | The session stays with the last sub-agent | New session per unrelated request. |
| A run "completed" with an empty answer | An agent ended on a tool call or handed over with empty text | [handoff.md](handoff.md), "Writing the sender". |
| The tool call timed out in the agent client | The run is longer than the client waits | It is still running. `junis_run_status` (or `get_run`) with the session id; for `send_message` or `chat_completion` started without a session id, find the newest session with `list_sessions`. Do not send again. Next time use `junis_run`, or `start_run` without the kit's tools. |
| A run must be stopped | Runs started with `junis_run`, `send_message`, `chat_completion` or `start_run` stop only after the current step | `cancel_run`: [running.md](running.md), "Stopping a run". |
| 409 `not_processing` on cancel | Nothing is running in that session, or a status check after two hours has marked it `timed_out` (the run can go on) | Nothing to stop from here. |
| A schedule stopped firing | Disabled for lack of credits (`credit_exhausted`), because the creator's account is gone (`owner_inactive`), after 30 days with no successful run and no edit, toggled off, or a `once` schedule that already ran | `list_schedules` (`disabled_reason`); fix the cause, then enable it again (`owner_inactive`: recreate it as another owner or admin). For a `once` schedule, first set a future `run_at` with `update_schedule` (enabling a past one answers 404 "The scheduled time has already passed"). Add `alert_webhook` so the next failure is reported ([schedules.md](schedules.md)). |
| A scheduled run reports a time one day off | `current_time` is UTC | Use `{current_time_kst?}` or the run-time line the platform adds to scheduled prompts. |
| Gemini agent prints a tool call as text | Very long context | Shorten the context: one item per loop iteration, `none` for steps fed by keys. |
| All agents of one provider fail with 429 or quota messages | Provider-side limit or outage | Wait, or move affected agents to another family temporarily, with the user's agreement. |

## Connections

| Symptom | Cause | Fix |
| --- | --- | --- |
| Platform linked, agent has no tools from it | Switched off; values the platform needs are stored nowhere (a command-based platform is then skipped silently); the server did not start within 60 s; the agent was built before the change | `toggle_mcp_active` with `is_active=true`; the user enters the values in the web app; check command and package name; `link_agent_mcp` again to reload. A remote platform can be checked with "Test Connection" at `https://junis.ai/team/mcp-skills`. |
| 405 from an MCP server | Wrong transport type | `streamable-http` or `sse`, as the server requires. |
| 409 `platform_inactive` when switching on a global platform | The shared platform is switched off for every organization | It cannot be switched on for one organization; the user asks Junis (contact@junis.ai). |
| 403 `global_platform` from `update_mcp_platform` | The platform is shared; an organization can only switch it on or off for itself | Send only `is_active` (or use `toggle_mcp_active`); the address, settings and shared credentials are changed by Junis. |
| An agent still uses a global platform switched off for the organization | Switching off decides only whether the organization's own credential is used; linked agents fall back to the shared one | `unlink_agent_mcp` for the agents that must not use it. |
| 400 `masked_placeholder` from `update_mcp_platform` | Masked values sent back could not be matched to the stored ones without guessing (moved, partly replaced, an entry changed and moved at once, or too many) | Make one kind of change at a time, send the real values, or leave the field out; to see the stored values, read with `reveal_secrets=true` after the user agrees. |
| 401 or 403 from an MCP server | Token wrong or expired; token lacks permission; for a remote platform, the shared key was stored outside the `headers` object of `auth_config` (only `headers` is sent) | The user replaces the token in the web app; fix the stored shape (see [connections.md](connections.md)); test in a new session. |
| A saved change to an MCP platform has no effect | The agent was built before the change and is kept up to 30 idle minutes | `link_agent_mcp` again for the agent (it reloads it), then a new session. |
| OAuth app connected but tools missing | Session older than the connection; connection `EXPIRED` | New session; the user connects again. |
| Command-based platform never starts | Created without `platform_type="local"` | Create it again with the type; delete the broken one. |
| 403 `local_mcp_admin_only` | Only Junis administrators create command-based platforms or change their command | Use a global or remote platform, or ask contact@junis.ai. Do not retry or resend it as a remote server without an address. |
| Device tools missing | Device offline when the session started, or linked to the orchestrator instead of a sub-agent | `list_devices`; link to a sub-agent; the user starts `npx junis`, then a new session. |
| Slack report never arrives | The `slackbot` connection is not active for the organization (`list_composio_connections`), the agent's tool selection leaves the posting tool out (`get_agent_tool_access`), or the bot was not invited to the channel | See [connections.md](connections.md), "Slack". |
| Scraping call fails with -32602 | Wrong argument shape | [agent-tools.md](agent-tools.md), "Web research". |

## When nothing here matches

1. Reproduce in a new session with the smallest request that shows it.
2. Read the session messages in order.
3. Compare the agent's settings with a working agent of the same kind.
4. Report to the user exactly what you sent, what came back, and what you
   ruled out. For platform faults the contact is `contact@junis.ai`.
