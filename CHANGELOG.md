# Changelog

All notable changes to the Junis kit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
release tags users pin with `JUNIS_KIT_REF`.

## [Unreleased]

- Junis Space through the API: browser login now asks for `spaces:read` and
  `spaces:manage` too (33 permissions), so the calls in
  `references/publishing.md` (check a page before publishing, publish or
  update a link, versions, leaderboards, the team gallery) work with the key
  it makes. A platform that does not offer the two yet is asked again without
  them and the key keeps everything else. A key made earlier gets them with
  "Add permissions" on the API keys page or by connecting again; before this
  a 403 `insufficient_scopes` there could not be fixed by connecting again.
  `onboarding.md` lists the area with the others.

- App users, after an independent review of the platform (2026-11-24). The
  reference now says what the platform enforces: a sign-in issuer needs
  `audience` (and a `subject_prefix` each when there are several); inbound email is handled only with the mail service's `auth`
  verdict, and a text message's sender cannot be verified (set a narrow
  `agent_id`); the watch agent cannot be the orchestrator and its key needs
  `agents:invoke`; a token issued without `agent_ids` cannot choose an agent
  for the connection calls; the workspace is not permanent storage; room
  limits and what account deletion removes. `agent-tools.md` lists
  `list_my_rooms`, `suggest_room_message` and `request_browser_sign_in`.

- App users, rooms: the agent tools `list_my_rooms` and `suggest_room_message`
  let a person's own assistant prepare a message for one of their rooms. The
  tool posts nothing; the feed item (`kind: room`, `data.type: "room_draft"`)
  carries the text and the app sends it when the person presses Send. The
  reference (step 13) and the example app (a "Send to <room>" card with
  Discard) show it.

### Added

- Personal knowledge (`references/knowledge.md`, "Personal knowledge"): every
  `knowledge_*` tool on the hosted server takes the optional arguments
  `space` (`"org"` by default, `"me"` for personal knowledge) and
  `on_behalf_of` (an account the organization provisioned, with an
  organization key). Calls without them are unchanged. Hosted server 2.10.0;
  the kit passes the server's tool definitions through. Database roles,
  recall checks and the question index are organization-only and have no
  `space` argument.
- Personal knowledge is confirmed, not assumed: a request sent with
  `space=me` (through `junis_api` or the hosted tools) fails with
  `personal_knowledge_not_confirmed` unless the platform answers
  `X-Junis-Knowledge-Space: me`. A platform version without the feature
  ignores `space` and would read and write the organization's Knowledge.
- Attachments on runs: `junis_run` takes `files` (paths of files on this
  machine) and `file_urls` (links of files that are already online), and the
  command line takes `run … --files a.pdf,b.csv --file-urls https://…`. Local
  files are sent with the message as multipart parts and stored by the
  platform; five attachments at most per message. Works for the orchestrator
  and for one agent called directly. A run without attachments sends the same
  request as before. Local paths are resolved through symbolic links; a file
  under the kit home or a credentials folder (`~/.ssh`, `~/.aws`, …) is
  refused, a file over 200 MB is refused before it is read, the result lists
  what was sent (`attached`: names and sizes), and `--files` with no value is
  an error instead of a run without the file.
- `wiki list [--search text]` and `junis_wiki` action `list`: every page key
  with its annotation. `search` keeps the pages whose key contains the text,
  whatever the case; the annotation and the body are not searched. The filter
  is also applied to the answer, so it works on a platform that does not know
  `search` yet.
- `references/onboarding.md`: an organization update that could not change
  something now says so in `not_applied` (why, and where to change it); the
  skill tells the user.

- Improving a squad by conversation (2026-11-22, hosted server 2.9.0).
  `references/improving.md` now runs health → change ledger → one change
  with a `change_note` the agent writes itself → measured by the next
  scheduled runs → offered rollback: `squad_health`, `get_agent_change_ledger`,
  `get_agent_turn_outcomes`, `list_schedule_runs`, and "What changed, and
  taking it back" (`diff_agent_versions`, rollback `restore` options and the
  `restore.widens` warning). `references/schedules.md`: success rules
  (`metadata.contract`, verdict `contract_unmet`) built from
  `get_schedule_contract_suggestion`, and the `board_has_work` precondition
  (`skipped_no_work`); `create_schedule` and `update_schedule` take
  `metadata`. `references/squad-design.md` and `agent-settings.md`: for-each
  `item_timeout_seconds`, `on_item_error` with the `_item_error` filter, and
  the verifier rubric's `evidence` key. `references/build-and-verify.md`: the
  five `[structure:…]` plan warnings and `unresolved_children` in the
  checklist; versions now cover links and assignments. `references/connections.md`:
  skill history, undo and restoring a deleted skill, unused skills.
  `references/knowledge.md`: the relation question index (estimate, then
  confirm), recall checks, agent-note settings and the
  `agent_note_unreviewed` marker, `key_noun` / `inverse_noun`.
  `references/memory-and-identity.md`: what an agent saved right after
  reading outside content, kept or undone; the wiki playbook convention.
  Tools missing from an older hosted server are reached by the path given
  next to each with `junis_api`. Two eval cases:
  `improves-a-squad-from-its-ledger`, `measures-the-question-index-before-turning-it-on`.
  `restore_skill_version` and `resolve_memory_provenance` with `undo` (and
  their API routes) now ask before they run, like `restore_soul_version`.
  Taking back a whole squad apply (`references/improving.md`,
  `build-and-verify.md`): `squad_receipts` → `squad_rollback` preview →
  the user agrees → `confirm=true`; created agents stay, edited agents are
  overwritten only with `force_drifted` on the user's word.
  `squad_rollback` with `confirm` and `POST /management/squad/rollback` with
  `"confirm": true` ask first; the preview does not. The change note gained
  `expected`, and skipped schedule beats fold into one row
  (`result.skipped_count`).

- `references/agent-settings.md` (2026-11-22): Claude organization billing. An
  owner or admin links the organization's own Claude Console organization once
  in the web app; `claude_org_billing: true` on an LLM agent with a direct
  `anthropic/claude-*` model then runs its Claude calls on that organization
  instead of Junis credits (state: `GET /management/claude-billing`). The
  capabilities table has a row for it.

- `references/app-users.md` step 18 (2026-11-22): the sign-in view. A user
  signs in to a website themselves on a live view of the browser in their own
  workspace (`PUT /management/app-workspace {"enabled": true, "sign_in_view":
  true}`, the agent tool `request_browser_sign_in`, `POST`/`GET`/`DELETE
  /me/browser-sign-in`). The example app handles the feed item
  (`signInRow`), with three new cases in `tests/example-app.test.mjs`. Step 12
  now says a workspace nobody used for 30 days is cleared.

- `tests/example-app.test.mjs` (2026-11-21): the personal-assistant example is
  now run, not only read. Its script runs against a stand-in for the page and
  for `fetch`, and the tests type, click, attach, approve and end replies the
  way a person does (14 cases).

- `references/app-users.md` steps 15 to 17 (2026-11-21): mini apps (the app
  keeps a page the agent wrote as the user's own with `POST /me/apps`, and
  `POST /me/apps/<slug>/open` returns an address that opens it with saves kept
  on that user's account), MCP servers that take the user's own sign-in
  (`GET` and `PUT /management/mcp-platforms/<platform_id>/oauth`, then Connect
  on the connect page), and watches (`/management/app-watches`,
  `/me/watches*`: an event in an app the user connected runs one turn of the
  assistant). Step 12 now says how an agent keeps a per-user browser profile in
  the user's workspace. The hosted connect page shows Korean or Japanese when
  the web view's language is one of them.
- `references/app-users.md` step 7 (2026-11-21): push notifications with no
  server (`PUT /management/app-push` for Expo's push service or Firebase, then
  the app registers device tokens with `PUT /me/push-tokens`), and
  `GET /me/activity` for a "what my assistant did" screen.
- `references/app-users.md` and `examples/personal-assistant/` (2026-11-21): a
  product with only a front end. The app's end users get accounts by
  `external_id` (no email), the front end calls Junis with a short-lived
  app-user token (`POST /management/users/<id>/app-token`, or the sign-in token
  exchange `POST /app-token/exchange` when there is no server), and
  `/api/external/me/*` gives that one account its settings (time zone, quiet
  hours, how much to hear), schedules, feed, live event stream and connection
  links. Agent side: `notify_user` (messaging the user first, attached by
  hand), `create_my_schedule(in_this_conversation=true)` (a follow-up that
  continues the same conversation) and the `ask_before_write` preset for
  unattended runs. The example is one HTML page (chat, approval cards, inbox,
  follow-ups, settings, Connect, approve-later, file attach) plus a 30-line
  token endpoint. The reference also covers what an app can turn on beyond
  chat: approvals answered later (`/me/approvals`), uploads (`/me/files`), the
  user's own computer (`npx junis --pair` and `/me/devices/pair`), rooms where
  several users and the agent share one conversation (`/rooms/*`), and
  Telegram, text-message and email channels (`/management/app-channels`). The hosted
  tools gain 30 app-user tools (junis-magic 2.6.0: `create_app_user`,
  `issue_app_user_token`, `set_app_auth`, `get_app_user_feed` …).
- `references/agent-tools.md` "Conversation notes" (2026-11-20): the agent
  tools `find_conversations` and `send_to_conversation` — a note left in
  another conversation of the same user, read with that conversation's next
  message and never starting a reply; who can send and receive, the limits,
  and the `peer_message` rows `get_session_messages` returns.
- `references/publishing.md` "Run a page in a browser before publishing"
  (2026-11-20): the browser check `POST /api/external/spaces/verify` → poll
  `GET /spaces/verify/<job_id>` every 2 seconds → `DELETE` to cancel
  (start and cancel need `spaces:manage` and a key that belongs to a user,
  reading needs `spaces:read`). It runs the page in a disposable Linux
  Chromium and is billed as sandbox time (about $0.013 a check, at most
  $0.10); refusals before start (switched off, no credit, limits, scripts from
  hosts other than three.js 0.187.0) are free. Organizations turn it on in
  Team Settings (off by default); people get "Run checks" in the chat preview.
  No kit tool was added; `junis_api` reaches it. Junis Space Phase B2.
- `skills/junis/assets/space-builder/` (2026-11-20): the platform's
  `space-builder` skill, copied unchanged — `SKILL.md`, the `window.junis`
  text and two tested game skeletons (2D canvas, three.js 0.187.0).
  `references/publishing.md` "Give a game-making agent the skeletons" says how
  to import it (`import_skill_from_upload` or Upload ZIP) and assign it to one
  agent. A test pins the four files and the `window.junis` text to the
  platform's SHA-256 values. Junis Space Phase B1.
- `references/publishing.md` "Check a page before publishing": the static
  check `POST /api/external/spaces/lint` (permission `spaces:read`, no model
  call, not billed) that the publish dialog also shows. The chat preview now
  reports a page's script errors with a "Fix this" button that fills the
  message box without sending. Junis Space Phase B1.
- `references/publishing.md` (2026-11-20): unpublish, republish and delete a
  link through the API (`PATCH`/`DELETE /spaces/links/<slug>`, working while
  Junis Space is off), `has_more` and newest-first order on the link list, and
  the Phase D routes — link detail, team gallery listing, remix links and
  leaderboard rows (`/spaces/links/<slug>/team`, `/remixes`,
  `/leaderboard/entries`). People get the same at `/team/published`
  ("Published Pages": their links, a team gallery each author opts into per
  link, and "Remix in chat"). No kit tool was added; `junis_api` reaches them.
- `references/publishing.md` "HTML results: what runs in the preview and on the
  published page": the rules an agent that makes HTML apps or games needs in
  its instruction (no browser storage, the script hosts that load, pointer
  input, fixed time step, a pinned three.js module build), measured on
  2026-11-19 in Chromium and WebKit. Applies once the web release that aligns
  the preview and publish rules is live.
- `references/publishing.md` "Saves and leaderboards: `window.junis`"
  (2026-11-19): the instruction text for agents that make apps or games
  (saved data per viewer, shared data and counters, scores and the platform's
  leaderboard, pause behaviour, the rule that a save the page could not load
  is never overwritten). After a review that wrote a page from the text alone,
  the text also states the per-minute call budget (30 writes, 10 of them
  shared, 12 run starts, 6 scores), the characters a key may use, the
  `storage.list` call, that calls need a module script or an async function,
  and what each optional score limit means; its board declaration example no
  longer carries limits that would hide every score of a fast game. The same
  section now says that "Update link" keeps a
  published address, its saves and leaderboard across edits with restorable
  versions (it replaces "an edited result creates a new link"), that the JUNIS
  mark is a strip below the frame (it replaces the bottom-right badge note),
  and lists the `/api/external/spaces/*` endpoints (permissions `spaces:read`,
  `spaces:manage`). No kit tool was added. Applies once the Junis Space
  Phase A web release is live.
- Squad board (`references/squad-design.md` pattern 8, `references/agent-tools.md`
  "Squad board", `references/long-running.md` "The squad board as the
  record"): the platform's shared task list for agents, added on 2026-11-19.
  Agents with the `board_*` tools add tasks, claim the next open one (two
  workers never get the same task), record results and leave notes, and the
  list is still there in the next run. The references cover the squad shape
  (a lead plus workers in loops), the worker instruction and settings, when a
  for-each step is the cheaper choice, review before done, stuck tasks, and
  using the board as the record of work that spans sessions. Managing boards
  from the kit (`squad_board_*`) needs the platform release of 2026-11-19 and
  the hosted server 2.5.0; on a platform that has the release but an older
  hosted server, use `junis_api GET /board/boards`. No eval case covers the
  board yet. Keys need the `board:read` and
  `board:manage` permissions: browser login now asks for them (31
  permissions; a platform that does not offer them yet is asked again
  without them and the key keeps everything else), and an existing key gets
  them with "Add permissions" on the API keys page.
- Models (`references/models.md`, "Claude Fable 5.2"): reasoning effort by
  role, the lines to remove from instructions written for earlier models, and
  where a long single request can time out. `references/handoff.md` records
  that it writes its text and a hand-over in one reply (measured 2026-11-19).
  The READMEs list it (56 chat models).
- `references/squad-design.md`, pattern 8: a worker pool built from one worker
  definition under a for-each step (each slot claims as a separate worker), as
  the lighter alternative to one loop per worker.
- A Claude request that the provider declines before any answer now comes
  back as a notice ("The model declined this request …") instead of an empty
  answer, once the platform release of 2026-11-19 is live.
  `references/models.md`, `references/troubleshooting.md` and the outcome
  table in `references/schedules.md` (`model_error_present`) describe it.
- Squad design (`references/squad-design.md`, patterns 4a and 4b): two step
  settings the platform added on 2026-11-19. `map_config` on a parallel agent
  runs its single worker once for each item of a list, several at a time, and
  saves the results in order. `transform_config` on an LLM agent merges,
  de-duplicates, filters, sorts and cuts lists without calling a model. The
  structure table, the settings-by-position table, `agent-settings.md` ("Step
  settings"), `handoff.md` and `build-and-verify.md` cover when to use them,
  how to set and clear them and what later agents read.
- OAuth apps (`references/connections.md`, "Choosing an app's tools"): choose
  an app's tools when linking it. The hosted server's new
  `list_composio_integration_tools(auth_config_id, search, limit)` returns
  the exact names, `link_agent_composio` takes `enabled_tools`, and the
  results name entries that match nothing (`unknown_tools`) or a large
  toolkit linked whole (`warning`). Without a selection every tool of the app
  is sent on every model call (measured 2026-11-15: Gmail 63, Slack 174,
  Higgsfield MCP 101, ElevenLabs 396). Apps connected with the user's own API
  key (`auth_scheme` `API_KEY` / `BEARER_TOKEN`) are connected on the same
  web page as OAuth apps. Needs the hosted server 2.4.0; until then the list
  is `junis_api GET /management/composio/integrations/<id>/tools`.
- Generated media (`references/agent-tools.md`): an agent with `gen_content`
  also has `replicate_search_models` and `replicate_model_schema`; the order
  for an unfamiliar or new model (search, schema, run), pinned versions
  (`owner/name:version_hash`), community models, calls refused before any
  credit is charged (`reason`, `input_schema`), and the default price of
  1 credit for a model without a registered price.
- The `connects-an-oauth-app` eval case checks that the app's tools are
  listed before linking and that the link carries a selection (not yet run).

- Partner accounts (`references/partner-accounts.md`): deleting an account the
  organization made (`DELETE /api/external/management/users/<user_id>`, 30-day
  grace period, `…/deletion/cancel`), reading the accounts' usage by period
  (`GET /api/external/management/usage`, scope `usage:read`, a key the owner
  created), reading an account's personal wiki pages with `on_behalf_of`
  (scope `wiki:read_delegated`), the separate rate limit for `on_behalf_of`
  chats, and the `active` field of the account list.
- Wiki (`references/memory-and-identity.md`): a person's own pages as
  `@me/<key>` with their own key, and the organization setting that lets
  members read the shared wiki through agents.
- Schedules (`references/schedules.md`, `references/agent-tools.md`): a member
  creates schedules with their own key, the limits for plain members (200
  running schedules, 10 minutes apart at least), and the five tools the
  orchestrator now has for the schedules of the person chatting.

- Wiki: `junis_wiki` and `wiki` gain `verify` (a person confirms a page is
  correct today — text and version stay, its review timer restarts; hosted
  `POST /api/external/management/wiki/verify`) and `lint` (read-only check of
  the whole wiki — pages past their review date, broken `[[links]]`, orphans,
  empty pages, missing annotations, oversized pages — with a `findings` count;
  hosted `GET /api/external/management/wiki/lint`). `lint` takes no `file_key`.
  `references/memory-and-identity.md` describes soul version history and
  restore (`get_soul_history`, `restore_soul_version`), memory kept per
  (user, organization), and the wiki review period.
- Knowledge: `references/knowledge.md` gains "Live dashboards and custom
  front-ends" — building a team's own screen on an organization's Knowledge
  with the hosted server's new `knowledge_changes` (what changed since a
  cursor; SSE form `GET /api/external/brain/changes/stream`),
  `knowledge_entities_update_attrs` (state updates by type + external_id
  with no re-import and no credits), `knowledge_map_limits` /
  `knowledge_map_set_limits` (the map caps, with `confirm_cost`),
  `knowledge_graph_snapshot(as_of=…)`, and the External-only OpenAPI
  document at `GET /api/external/openapi.json`. Browser tokens
  (`POST /api/external/brain/browser-token`, read-only, ≤15 min, bound to the
  page origin) let the page call the read endpoints directly.
  `knowledge_geo_near` / `knowledge_geo_within` (entities near a point or in a
  box, from a `geo_point` attribute) and the AG-UI form of the run events
  (`GET /api/external/sessions/<id>/events?format=agui`) for screens.
  `knowledge_changes_webhook` / `_set` / `_delete`: a signed webhook that pushes
  the change feed every minute (Standard Webhooks headers, secret named by an
  Org Key).
- `examples/live-dashboard/`: a single-file reference front-end (browser token,
  paged first draw, SSE follow, map dots from a `geo_point` location) and the
  platform's new `ops` knowledge-map preset it is written against.
- `wiki get|put|append`: safe wiki page writes from the command line — empty bodies are refused, the current page is backed up under the kit home (one file per write), the write carries the version that was read (a 409 comes back as `conflict` with the backup path), and the page is read back and compared before success is reported. The Claude Code hook asks before `wiki put` like it does before `api PUT`.
- Actions: the skill's new reference `references/actions.md` covers the
  platform's typed, approvable operations on an organization's own systems
  (connections, drafts, OpenAPI import, dry runs, assignment to agents, runs
  and the run log) through the hosted server's `actions_*` tools, including
  the `simulate` connection for trying the flow with nothing connected. The
  kit drafts and runs; approving a draft, disabling an action and approving a
  waiting run stay with a person in the web app.
- Five behaviour eval cases for Actions (not yet run).
- Knowledge: `references/knowledge.md` covers set questions over the graph
  (`knowledge_graph_around`) and verified graph questions
  (`knowledge_graph_templates`, `knowledge_graph_template_create`,
  `knowledge_graph_template_test`; approval stays with a person in the web
  app), `qualifiers` on neighbor edges, what a kind's property definitions
  check, and the web-only settings for restricted kinds and member browsing.

### Security

- Confirmation now also covers Actions: `actions_run` (it acts in a system
  outside Junis; `dry_run=true` is not asked), `actions_agent_set`,
  `actions_connection_update`, `actions_connection_delete`,
  `actions_draft_delete`, `actions_draft_update` (it replaces the whole draft
  in place, as the External `PUT` already was asked), `actions_import_openapi`
  and `actions_import` (only when it really writes: the tool previews by
  default and is asked with `dry_run=false`; the route imports by default and
  is asked unless `dry_run=true`), and through `junis_api` `POST /actions/run`,
  `POST /actions/import/openapi` and `POST /actions/import`.

- `junis_wiki` (actions get, put, append) gives agents the same safe wiki operations through the MCP bridge; put on an existing page needs `confirmed=true`.

### Changed

- `references/partner-accounts.md`: a schedule can now be created in an
  account's name (`POST /me/schedules?on_behalf_of=`), accounts can be created
  by `external_id`, and the "key never in a browser" rule points to the
  app-user token. `references/agent-tools.md`: an approval or `ask_user`
  question reaches an app that calls `/v1/chat/completions` as
  `tool_confirmation_required` (the earlier text said only the web chat).
- Schedules (`references/schedules.md`): a run a person stops (`cancel_run`,
  Stop in the app) now ends with `result.outcome = stopped` instead of
  `success`. The status stays `completed`, the partial answer is kept, and
  the run sends no alert and is left out of "Lessons from runs". Needs the
  platform release of 2026-11-16.
- OAuth apps (`references/connections.md`): a very large app linked with no
  tool selection is no longer loaded (about 800,000 characters of tool
  declarations: ElevenLabs, GitHub). The agent says its tools have
  to be selected, the tool list reports this ahead of time as
  `without_selection`, and the link result's `warning` says so. An agent
  whose user or organization has not connected a linked app now names the app
  and where to connect it.
- Media generation (`references/agent-tools.md`): one call returns one output
  (a call asking for more is refused before any charge with
  `one_output_per_call`); a video model without a registered price costs 5
  credits instead of 1; `output_url` is the copy in Junis storage; a
  cancelled generation cannot be retried, and failed or cancelled
  generations are not refunded.

- `on_behalf_of` runs are for accounts the organization made only; a real
  member is refused (403 `delegation_target_not_provisioned`). The references
  no longer say otherwise.
- Memory: a real person's memory is their own (another person's id is 403
  `memory_target_not_self`). An account the organization made is still read
  and written with the partner key, as before; the references say which key
  that takes.
- `references/user-steps.md`: full erasure of a person is done by the owner or
  an admin at Team → Compliance, exporting another person's data is owner-only.

- A write whose body sets `instruction` or `content` to an empty string is refused before it leaves the kit, on every path: `api`, `tools call` and the MCP bridge (`junis_api`, `junis_call_tool`). Typical cause: `instruction=@file` with a file that was never written.
- `api --file` with a missing or empty payload file is now a clear `file_not_found` / `empty_payload` error (before: a raw ENOENT or a generic `bad_json`).
- `actions_run` is given 420 seconds before the kit reports a timeout, because
  the platform holds the call open while the action executes.
- Browser login asks for 29 permissions: the 26 as before plus
  `actions:read`, `actions:run` and `actions:manage`. A platform that does
  not know one of them yet refuses the list (400 `invalid_scopes`); the kit
  then asks once more for the permissions that platform offers, so the key is
  the same as before this change instead of the platform's narrower default
  set. Permissions named with `--scopes` are still never replaced.
- The hint for a missing permission says that browser login requests the
  permissions the platform offers, rather than every permission.

### Fixed

- `references/publishing.md` and `assets/space-builder/` (2026-11-22, copied from the platform): the `window.junis` text now states which failures are `null` and which are `{ok:false, code}` (with the codes and the 20 a second / 300 a minute call limit), and both skeletons resend a score that came back `unavailable` or `timeout` (4 tries at most, never scored twice); the platform's prod `space-builder` skill row is synced by the owner after deploy.
- `examples/personal-assistant/index.html` (2026-11-21, found by running the
  page in a browser against a real back end and a real model): a message typed
  while a reply was streaming stayed in the queue until the person sent
  another one, and then left after it. Messages now leave in the order typed
  as soon as the reply ends. An approval answered while another reply was
  streaming, or retried after `409`, lost its decision and went out as the
  plain text "ok"; it now keeps it. A retry after `409` no longer draws the
  message twice. The Connect button showed `POST /me/connect-sessions → 400`
  for a squad with nothing to connect; it now says so. `references/app-users.md`
  step 8 says what an empty `items` means.
- `examples/personal-assistant/index.html` (2026-11-21, from an independent
  read of the page): a message keeps the conversation it was typed in, so
  approving something from the inbox no longer carries waiting messages into
  the other conversation; it keeps the files picked with it, and a `409` retry
  sends the same uploaded addresses instead of none; an answer to a card that
  fails to send brings the card back, and goes before waiting messages; a reply
  cut off part-way keeps what was shown; a stream silent for 90 s (the server
  sends a keepalive every 15 s) is dropped so the chat cannot stay stuck.

- `references/connections.md`, `agent-tools.md`, `build-and-verify.md`:
  `get_agent_tool_access` shows the saved selection of a link, not the tools
  an app has; a selection stores the app's own tool names (`GMAIL_SEND_EMAIL`),
  not the `composio_` name the agent sees; the list of apps is no longer cut
  by a large logo, so that workaround is gone; categories of apps are free
  text, not a fixed set; a squad file's `composio` list is about apps linked
  to the agent, whether or not the user has authorized them yet; a model slug
  for `gen_content` is checked before credits are charged; the Replicate MCP
  platform is inactive and not a route.
- Eval mocks: an app's `id` in `list_composio_integrations` is a UUID, as on
  the platform (it was `ac_…`).

- The hint for a missing permission no longer points at "Add permissions" when
  the permission is one only organization keys can hold (`usage:read`,
  `wiki:read_delegated`, `users:delegate`, `users:provision`,
  `sessions:delete`, `users:credentials`): it says an organization key is
  needed and who creates it.
- `knowledge_changes_webhook_set` now asks before it runs: it sends the organization's Knowledge changes to an outside address every minute.
- Live dashboards send `X-Junis-Route` (a random value per page load) so the platform spreads browser-token viewers across its servers instead of putting them all on one. The example page and the Knowledge reference show it.

- `restore_soul_version` now asks before it runs, like `update_soul_content` and `rollback_agent`: it replaces the soul or identity text for every agent of the organization.
- `wiki verify` on a platform that does not have the route yet answers `unsupported` instead of `not_found` (which read as "the page is missing").
- The catalogue fixture carries the hosted server's 214 tools, including `update_soul_content`'s `expected_version` and `summary`.
- The catalogue fixture follows the hosted server's 2.3.4: the memory tools say whose memory a key can reach (the key owner's own, or an account the organization made with an organization key), the schedule tools state the limits for plain members, and `apply_team_changes` carries its action shapes in the `changes` argument. The hosted server now accepts ids that are not ASCII (an orchestrator's id is made from the organization's name).

- `tools describe <wrong name>` suggests tools by name words (`make_agent` → `create_agent`, `clone_agent`, …) instead of by description search, which stopped naming `create_agent` once the catalogue grew.
- The catalogue fixture the tests check documentation against now carries all 202 platform tools (actions_* and knowledge_* were never checked before). `doctor` decodes the bridge's output as one UTF-8 stream.

- `doctor` reported the local bridge as broken on macOS once its tool list
  grew past 8 KiB: it parsed the second answer before the pipe had delivered
  all of it. It now waits for whole lines.

## [0.1.0] - 2026-11-05

First tagged release.

### Security

- URL overrides (`JUNIS_API_BASE`, `JUNIS_MCP_URL`, `JUNIS_WEB_URL`) and
  saved addresses are accepted only for `junis.ai`, its subdomains and this
  machine. Any other host needs `JUNIS_ALLOW_CUSTOM_HOST=1`, and is then named
  by `status`, `doctor` and the bridge's start-up log (`host_not_allowed`
  otherwise).
- The Claude Code Bash hook also reads the kit's shape under another script
  name (`node <script> api …`, `node <script> tools call …`), so a copy or
  link of `junis.mjs` is asked about. A hook event that cannot be parsed but
  names the kit is asked about instead of passing.
- On the command line, a destructive `api` or `tools call` run without a
  terminal stops with exit code 2 until it is repeated with `--yes`.
- `install.sh` refuses a `JUNIS_KIT_REF` or `JUNIS_KIT_REPO` that is an option
  or several words, passes both to git after `--`, and switches an existing
  clone to a changed `JUNIS_KIT_REPO` instead of ignoring it.

### Added

- `login --browser --scopes read-only|operator|all|<list>` asks for a
  narrower key. A list the platform refuses is an error, never widened.
- CI on GitHub Actions (Node 18 and 20), code owners, a bug report template,
  this changelog and a "Supported versions" section in `SECURITY.md`.

### Changed

- Documentation: the hook's limits (name and shape, wrapper scripts not
  caught, 10-second fail-open), that `login` under an override saves the
  address, the masked key returned by `status`, Windows file permissions, and
  wording about the platform's own `junis-magic-auto` key.

### Initial (2026-09-30)

The kit as first published: the `junis` skill, the stdio MCP bridge (`mcp`, `mcp --lazy`),
the command line (`status`, `login`, `tools`, `api`, `run`, `session`, `lint`,
`snapshot`, `doctor`) and the installer for Claude Code, Codex, Cursor, Gemini
CLI, OpenCode and Copilot.
