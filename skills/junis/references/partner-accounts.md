# Accounts for another app's users

Read this when a product of the user's should give each of its own users a
Junis account behind the scenes: create the accounts, run agents as them, show
or delete their conversations, and give them credentials or connection links.

## Contents

- How it works
- The key
- Creating accounts
- Running as an account (and what comes back)
- Reading and deleting conversations
- Credentials and connection links
- Rules the platform enforces

## How it works

Each user of the other app gets one Junis account in the user's organization.
The person never signs up or logs in. Their conversations, sessions and memory
belong to that account; subscription, credits and billing stay with the owner
of the key.

All calls go through `junis_api` with `profile="partner"`, paths relative to
the External API root. Deleting or overwriting (`DELETE`, `PUT`, `PATCH`) always
needs the user's agreement and `confirmed=true`.

For the app's own server code: the base URL is `https://api.junis.ai/api/external`
(`api_base` in `junis_status`) and the key goes in the header `X-API-Key: <key>`,
not `Authorization: Bearer`. The partner key's ordinary limits are 100 calls a
minute and 3,000 an hour, plus the organization's 300 a minute across all its
keys. Chat calls sent with `on_behalf_of` for an account the organization made
are counted apart from those: they share 6,000 a minute for the whole
organization (response header `X-RateLimit-Scope: delegated`), unless Junis or
the key's owner set a lower limit on purpose. Session reads, warm-up and
management calls stay on the ordinary limits, and so does a call refused
because its target is not one of the organization's accounts. A 429 carries
`Retry-After`.

## The key

1. An owner or admin opens `https://junis.ai/admin/dashboard` → API Keys →
   New Key, ticks "Connect users from my own app" and creates it. This adds
   `users:provision`, `users:delegate`, `sessions:delete` and
   `users:credentials`. A key made without the tick gets 403 on everything
   below; a user-level key cannot have them at all.
2. The key owner needs a Basic or Pro plan and credits, as for any run.
3. The user stores it next to their own key, in a terminal:
   `login --profile partner --from-clipboard`. Their own key stays the one in
   use; `status` lists `partner` under `other_profiles`. (On a fresh install with
   no key yet, the partner key is the one in use until they run a plain `login`
   with their own key — that stores it as `default` and keeps `partner`.)
4. Creating accounts needs the organization id. `junis_status` with the
   user's own key shows it (the key creation dialog shows it too).

Changing agents still needs the user's own key (the default profile), because
this key has no management permissions unless they were picked when it was
created. The web app cannot add permissions to an existing organization key:
make a new one.

## Creating accounts

`POST /management/users` with `{"email": "…", "name": "…", "organization_id": "<uuid>"}`.

| Response | Meaning |
| --- | --- |
| `created: true`, `user_id`, `delegable: true` | New account. Store `user_id` against the app's own user. |
| `created: false`, `user_id`, `delegable: true` | Already made earlier. Calling again on every sign-in is safe. |
| `created: false`, `delegable: false`, no `user_id` | The email belongs to a real Junis user or to an account another organization made. It cannot be used; the app must handle this case. |

- `organization_id` must be the key's organization (403 otherwise).
- `membership_status` starts as `pending`; everything works in that state. If
  the person later signs in to Junis with the same email, the account becomes
  theirs, and from then on this key can no longer read, delete or store
  credentials for it.
- `GET /management/users?limit=50&offset=0` lists only the accounts this
  organization made (`limit` up to 200).

## Running as an account

| Purpose | Call |
| --- | --- |
| A conversation, routed by the orchestrator | `POST /v1/chat/completions` with `{"messages": [{"role": "user", "content": "…"}], "on_behalf_of": "<user_id>", "session_id": "<to continue>"}` |
| One fixed job for one agent (classify, score, summarise) | `POST /agents/<agent_id>/completions` with `{"message": "…", "on_behalf_of": "<user_id>"}` |

- Keep the returned `session_id` to continue the conversation. Send only the
  new message in `messages`: the session already holds the history, and every
  message in the list is joined into one request.
- `"session_hidden": true` marks internal calls, so the app's history can hide
  them. It is set when a session is created; on an existing session it changes
  only when sent.
- `model` in the chat body does not choose a model; the agents' settings do.
- Send a `session_id` of your own choosing (a new UUID) to start a
  conversation: the platform creates the session with that id, for both
  calls. Keep the `session_id` from the response: an id that already belongs
  to a real Junis user runs in a separate session under another id, and one
  used in another organization answers 409. Continue only with an id returned
  for the same account: an id of another account this organization made
  continues that account's conversation. If the call ends before the answer,
  the run continues and is billed.
  Do not send again: check `GET /sessions/<id>/status?on_behalf_of=<user_id>`
  and read the messages.
- Every run is billed to the key owner.
- The API cannot create a schedule in an account's name: `POST
  /management/schedules` makes it run as the key owner. For a recurring job per
  account, the app's own scheduler makes the call with `on_behalf_of`. An
  account can still ask the squad in its own conversation ("send me this every
  morning"): the orchestrator then creates a schedule that runs as that
  account, within the member limits (200 running schedules, 10 minutes apart
  at least), and its usage is settled with the organization like its chats.

### What comes back

| Call | Read |
| --- | --- |
| `POST /v1/chat/completions` | The OpenAI chat shape: the answer is `choices[0].message.content`, plus `session_id`. `usage` is a length estimate, not what is billed. |
| `POST /agents/<agent_id>/completions` | `id`, `agent_id`, `agent_name`, `session_id`, `response` (the answer), `created`, `model`. |
| Either, when a run fails after about 40 seconds | Still HTTP 200, because the response had already begun (spaces keep the connection open): the `id` starts with `chatcmpl-error-` or `agentcmpl-error-` and the text starts with `Error:`. Treat it as a failure, not as an answer. A failure before that is an ordinary HTTP error (500). |
| `GET /sessions/<id>/status` | `is_processing`, `started_at`, `current_agent`, `elapsed_seconds`, and `timed_out: true` once the platform stops tracking a run after two hours (it may still finish). |
| `GET /sessions/<id>/messages` | `messages`, oldest first, each `event_id`, `event_type` (`user_message` or `assistant_message`), `content`, `agent`, `created_at`, `visibility` (`visible`, or `internal` for messages the web app hides; show only `visible`); plus `total`, `page`, `page_size`, `has_next`. There is no `role` field. |

## Reading and deleting conversations

| Job | Call |
| --- | --- |
| List sessions, newest first | `GET /sessions?on_behalf_of=<user_id>&include_hidden=false&page=1&page_size=20` (`page_size` up to 100) |
| Read one | `GET /sessions/<id>/messages?on_behalf_of=<user_id>&page=1&page_size=50` (up to 200, oldest first) |
| Still running? | `GET /sessions/<id>/status?on_behalf_of=<user_id>` |
| Stop a run | `POST /sessions/<id>/cancel?on_behalf_of=<user_id>`. Needs `sessions:manage`, which this key has only if it was picked when it was created. A streaming run (`"stream": true`) stops within a second; a run without streaming stops after the current step and returns what it has. 409 `not_processing`: nothing is running. |
| Delete one | `DELETE /sessions/<id>?on_behalf_of=<user_id>` |

- Deleting is permanent. To remove all of a person's conversations, list with
  `include_hidden=true`, page until `has_next` is false, delete each.
- Deleting sessions leaves the account, its memory, its stored credentials,
  published pages and usage records.
- To erase an account the organization made, delete the account itself:
  `DELETE /management/users/<user_id>` (scope `users:provision`, a key made by
  an owner or admin; say what it does and get the user's agreement first). It
  answers `{"status": "scheduled", "erase_at": "…", "deactivated": true}`:
  the account is switched off at once (its `on_behalf_of` calls get 403, its
  schedules stop, its connection links are revoked) and after the grace period
  (`erase_at`, 30 days) its conversations, memory, personal wiki pages,
  credentials and schedules are erased. Usage records stay. Inside the grace
  period `POST /management/users/<user_id>/deletion/cancel` switches it back
  on, along with the schedules that were paused. Sending the delete again
  returns the same `erase_at`. While switched off, `POST /management/users`
  for its email returns `delegable: false`, `active: false`, and
  `GET /management/users` lists it with `active: false`. A real person's
  account is erased by an owner at `https://junis.ai/team/compliance`, not
  through this API (403).
- Usage of the accounts, by period: `GET /management/usage?start=2026-11-01&
  end=2026-12-01` (add `user_id=<id>` for one account). It needs the scope
  `usage:read` on an organization key **made by the organization owner** (an
  admin's key gets 403; the kit's own key cannot hold this scope). It returns
  `totals`, `by_origin` (`conversation`, `schedule`, `other`) and per account
  `items` with `kind` (`model` or `tool`), `name`, tokens and
  `junis_settlement_amount` in USD. Each chat response also carries
  `credit_usage` for that one request: `credit_cost`, `input_tokens`,
  `output_tokens` and `items`.
- The person's memory ([memory-and-identity.md](memory-and-identity.md))
  cannot be read or written with this key, or with any key but the person's
  own: `GET`/`PUT /management/memory/…` with another account's `user_id`
  answers 403 `memory_target_not_self`. An account's memory changes only
  through its own conversations (the orchestrator's memory tools).
- The account's personal wiki pages can be read, not written, with this key:
  `GET /management/wiki?on_behalf_of=<user_id>` lists them and
  `GET /management/wiki/content?file_key=@me/<key>&on_behalf_of=<user_id>`
  reads one. The key needs `wiki:read`, `wiki:read_delegated` and
  `users:delegate`; `wiki:read_delegated` is picked when the key is created
  and cannot be given to a user's own key. Each read is recorded in the
  organization's audit log.

## Credentials and connection links

Two ways to give an account what a squad needs.

**Store a key for them.** `PUT /management/users/<user_id>/secrets/<NAME>` with
`{"value": "…", "description": "…"}`; `GET /management/users/<user_id>/secrets`
lists names only; `DELETE` on the same path removes one. The agent that has
`custom_api_call` references it as `{cred:private:NAME}` in its own
instruction ([connections.md](connections.md), "Secrets"). Values are at most
8,192 characters, 200 per account, and can never be read back. Only for a
value the user supplied for that purpose.

**Let the person connect things themselves.** OAuth apps (Gmail, Slack) cannot
be stored for someone; the person must approve them.

1. `GET /management/users/<user_id>/connect-status?agent_id=<orchestrator id>`
   lists what that squad needs from this person (`items`, with `connected`)
   and what is already covered (`skipped`). An empty `items` needs no link.
2. `POST /management/users/<user_id>/connect-sessions` with
   `{"agent_id": "<orchestrator id>", "return_url": "https://…"}` returns a
   `url` and `expires_at` (30 minutes by default, `ttl_minutes` up to 1440).
   The app opens it; the person connects OAuth apps, MCP credentials and
   personal keys there. Values never pass through the app. To show only
   chosen items instead of the squad's needs, send `composio` (a list of
   `auth_config_id`) and `mcp` (a list of platform ids) in place of
   `agent_id`.
3. `DELETE /management/users/<user_id>/connect-sessions` cancels all open
   links for that person.

## Rules the platform enforces

- Billing never moves: every call is charged to the key owner.
- Running, reading and deleting with `on_behalf_of` work only for accounts
  this organization made. A real member of the organization is refused (403
  `delegation_target_not_provisioned`), and so is an account its owner later
  signed in to.
- Credentials can be written but not read, by anyone.
- The key belongs on the app's server only, never in a browser or mobile app.
