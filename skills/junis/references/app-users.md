# A product with only a front end (app users)

Read this when the user wants to build their own app (web or mobile) on Junis:
a personal assistant, companion, coach or errand agent for the app's own end
users. They build the screens; Junis is the whole agent back end. For creating
the accounts and running as them from a server, read
[partner-accounts.md](partner-accounts.md) first; this file adds what the
front end does by itself.

## Contents

- The pieces
- Step 1: accounts without email
- Step 2: the app-user token
- Step 3: no server at all (sign-in token exchange)
- Step 4: chat from the front end
- Step 5: settings (time zone, quiet hours, how much to hear)
- Step 6: coming back later (schedules and follow-ups)
- Step 7: messaging first (the feed, the stream, push)
- Step 8: connections
- Step 9: approvals
- Step 10: approving later
- Step 11: photos, files and voice memos
- Step 12: the user's own computer
- Step 13: rooms (several people, one conversation)
- Step 14: Telegram, text messages and email
- Step 15: mini apps (pages the assistant makes, saved per user)
- Step 16: tools that need the user's own sign-in
- Step 17: watches (an event in a connected app wakes the assistant)
- Step 18: signing in to a website (the sign-in view; after "What the app owner does")
- Squad shape for a personal assistant
- Outside services the assistant acts in
- Check it before shipping
- What the app owner does (not the platform)

## The pieces

| Piece | What it is | Who calls it |
| --- | --- | --- |
| App user | One account per end user, made by the organization | Server or the token exchange |
| App-user token | `Authorization: Bearer …`, at most 15 minutes, acts as one account only | The front end |
| `/api/external/me/*` | That account's settings, schedules, feed, live stream, connections, approvals, files, computers, channels | The front end (token) or a server (`on_behalf_of`) |
| `/api/external/rooms/*` | Rooms that account is in | The same two callers |
| Feed | What the agent told the user first, and which scheduled runs finished | The front end reads it; a webhook pushes it |

Base URL `https://api.junis.ai/api/external`. Every `/me/*` path accepts either
the app-user token, or the organization key plus `?on_behalf_of=<user_id>`.
The organization key needs the opt-in scopes `users:provision`,
`users:delegate` and, for step 8, `users:credentials`; set them when creating
the key with the "Connect users from my own app" option.

## Step 1: accounts without email

```
POST /management/users   {"organization_id": "<org>", "external_id": "<the user's id in your app>", "name": "Dana"}
→ {"user_id": "…", "external_id": "…", "created": true, "delegable": true}
```

The same `external_id` always returns the same account, so call it on every
sign-in. `email` still works instead. Step 3 creates the account for you.

## Step 2: the app-user token

The organization key must never reach a browser or a phone. The app's server
(or one serverless function) signs the user in, then asks for a token:

```
POST /management/users/<user_id>/app-token   {"origin": "https://app.example.com", "agent_ids": ["<orchestrator id>"]}
→ {"token": "…", "expires_in": 600}
```

- `origin`: a web app's origin; it must be listed under the organization's
  allowed embed origins (Settings → Publish). Omit it for a native app.
- `agent_ids`: agents the token may address with `target_agent_id`. With one
  id (usually the orchestrator) it is also the default squad for step 8; with
  several, pass `agent_id` on the step 8 calls. A token issued without
  `agent_ids` cannot choose an agent there.
- Fetch a new token before `expires_in` runs out.

The token can call only these, and always as its own account:
`POST /v1/chat/completions`, `POST /v1/warmup`, its own sessions
(`GET /sessions`, `/sessions/<id>/messages|events|status|tool-confirmations`,
`POST /sessions/<id>/cancel`, `DELETE /sessions/<id>`), `/me/*` and `/rooms/*`.

Rules to build around:

- A web token works only from its origin; a native token works only in
  requests with no `Origin` header (so not from a browser).
- Do not send `X-API-Key` together with the token. Send
  `X-Junis-Route: <a stable string per user>` so the same user reaches the same
  server and the first reply is fast.
- `extra_context` is refused with a token, and so are file URLs other than
  the ones `/me/files` returned (400 `not_allowed_with_app_token`); send
  those from the server with the key.
- Limits are per user: 240 requests a minute, 30 chat requests a minute
  (429 with `window: app_user_minute` or `app_user_chat_minute`).
- Switching off the issuing key or the account ends every token at once.

## Step 3: no server at all (sign-in token exchange)

When sign-in is done by an identity provider (Supabase, Firebase, Clerk, Auth0,
Cognito), the front end can trade the provider's ID token for an app-user
token directly. Set it up once, with the user's agreement (anyone those
providers sign in can then use the organization's agents at its cost):

```
PUT /management/app-auth
{"api_key_id": "<id of the organization key that issues tokens>",
 "issuers": [{"issuer": "https://<project>.supabase.co/auth/v1", "audience": "authenticated"}],
 "auto_provision": true, "agent_ids": ["<orchestrator id>"]}
```

`issuer` is the token's `iss` claim, character for character. Each issuer
needs `audience` (the token's `aud`: the app or client id it was issued for);
without it the setup is refused, because any token that issuer signs for
another app would be accepted. `authorized_parties` (the token's `azp`) can
narrow it further but does not replace `audience`. With more than one issuer,
give each its own `subject_prefix` (for example `"main:"`); the account's
`external_id` is then the prefix plus the user id, so decide prefixes before
launch (adding one later gives earlier users a new, empty account). Then, in
the app:

```
POST /app-token/exchange   {"organization_id": "<org>", "id_token": "<the provider's ID token>"}
→ {"token": "…", "expires_in": 600, "user_id": "…", "created": false}
```

A user seen for the first time gets an account (`auto_provision`). Only
asymmetrically signed tokens are accepted (RS, PS, ES, EdDSA). Send the ID
token, not an access token. With `user_claim: "email"` the token must carry
`email_verified: true`. From a browser the page's origin must be an allowed
embed origin.

## Step 4: chat from the front end

```js
const res = await fetch(`${BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Junis-Route': routeKey },
  body: JSON.stringify({ model: 'junis-orchestrator', stream: true, session_id, messages: [{ role: 'user', content: text }] }),
});
```

- Send only the newest user message; the session keeps the history. Keep one
  `session_id` per conversation (omit it to start a new one; read the id from
  `GET /sessions`).
- A second request on a session whose run is still going gets 409
  `session_busy` with `Retry-After`: queue the message in the app and send it
  when the run ends, or `POST /sessions/<id>/cancel` first.
- A dropped stream can be replayed: `GET /sessions/<id>/events?after=<n>`
  (`format=agui` for AG-UI clients).

## Step 5: settings (time zone, quiet hours, how much to hear)

```
GET  /me/settings
PATCH /me/settings   {"timezone": "Asia/Tokyo", "quiet_hours": {"start": "22:00", "end": "08:00"}, "proactive": "important"}
```

| Key | Effect |
| --- | --- |
| `timezone` | Default zone of that user's schedules and of quiet hours. Set it at first launch from the device |
| `locale` | For the app and the squad to read |
| `quiet_hours` | Messages the agent sends then appear when quiet hours end (urgent ones go through) |
| `proactive` | `off`, `important` (urgent only) or `all`: whether the agent may message first |

Only the keys sent change; `null` resets one.

## Step 6: coming back later (schedules and follow-ups)

The scheduler is the ordinary one ([schedules.md](schedules.md)); three things
make it fit a personal app:

- **In the user's name.** `GET/POST /me/schedules`, `PATCH /me/schedules/<id>`
  (`{"enabled": false}`), `DELETE /me/schedules/<id>`. The run uses that user's
  memory and connections. Organization limits on count and minimum interval
  apply.
- **In the user's time zone.** `schedule_config.timezone`, else the saved
  `timezone`, else Korea time. Daylight saving is handled.
- **Back into the same conversation.** The agent tool
  `create_my_schedule(..., in_this_conversation=true)` makes the run continue
  the conversation it was asked in. This is how the agent keeps a promise
  ("I'll check the order again in 30 minutes"). `list_my_schedules` is its list
  of open promises. Over the API pass `session_id` in `POST /me/schedules`.

If the user is talking in that conversation when the run is due, the run waits
(up to ten minutes) instead of running on top of the user's turn.

## Step 7: messaging first (the feed, the stream, push)

A scheduled run has nobody watching. To tell the user something, the agent
calls **`notify_user(message, title, urgency, dedupe_key)`**. Attach that tool
to the agent that does the unattended work (it is never attached
automatically). The platform applies, in order: the user's `proactive`
setting, a daily cap (20), quiet hours (the message waits, it is not dropped),
and `dedupe_key` (the same key is delivered once).

Every finished scheduled run of an app user also leaves a feed item of kind
`run`, so the app knows which conversation has a new reply.

| The app wants | Call |
| --- | --- |
| The list (inbox screen) | `GET /me/feed` (newest first), then `GET /me/feed?after=<cursor>` for later items |
| Unread badge | `unread` in the same reply; `POST /me/feed/read` with `{"ids": […]}` or `{"up_to": "<cursor>"}` |
| Live updates on every device | `GET /me/events`: server-sent events, `event: item` with the cursor as its id; after 5 minutes `event: end`, reconnect with `Last-Event-ID`. Read it with `fetch` streaming (it needs the Authorization header) |
| Push notifications, with no server | Turn it on once: `PUT /management/app-push {"expo": {"enabled": true}}` for Expo and React Native apps, and/or `{"fcm": {"service_account_secret": "<Org Key name>"}}` for Firebase (Android, iOS through Firebase, web). For Firebase the Org Key holds the whole service account JSON file from the Firebase console (Project settings → Service accounts → Generate new private key); for Expo with enhanced security on, add `"access_token_secret": "<Org Key name>"`. Send what you use in one call: it replaces the whole setup. The app registers each device: `PUT /me/push-tokens {"provider": "expo", "token": "ExponentPushToken[…]"}` or `{"provider": "fcm", "token": "<the FCM registration token>"}` (up to 10 devices per user; call it on every start; `GET /me/push-tokens` → `providers` empty means off; `DELETE /me/push-tokens` with the same body on sign-out: the token goes in the body, never in the address). Messages and approval requests then arrive as notifications after quiet hours, once, with `data.feed_item_id` to open the item |
| Push notifications, when you have a server | `PUT /management/user-feed/webhook` `{"url": "https://…", "secret_name": "<Org Key name>", "kinds": ["message"]}`. Each item is POSTed with Standard Webhooks headers; verify the signature, de-duplicate on `webhook-id`, then call APNs or FCM yourself |

Write the unattended agent's instruction so it earns attention: stay silent
when nothing changed, say only what this run found, never repeat what the user
was already told, and use `urgency="high"` only when waiting would cost the
user something.

To show the user what their assistant has been doing, read
`GET /me/activity?days=7`: the tools it called, in which conversation or run,
whether each worked and when. Argument values and results are never stored, so
they are not in the list.

## Step 8: connections

When an app the squad needs (Gmail, Calendar …) is not connected for that
user, the agent says so in its reply. The app shows a Connect button:

```
GET  /me/connections            → {"all_connected": false, "items": [{…, "connected": false}]}
POST /me/connect-sessions       {"return_url": "https://app.example.com/connected"}   → {"url": "https://…"}
```

An empty `items` means this squad needs nothing from the user: hide the
button (`all_connected` stays `false`, and `POST /me/connect-sessions` answers
400 because there is nothing to show).

Open `url` in a web view or a new tab; it shows only what this squad needs
from this user. Poll `GET /me/connections` (or come back through `return_url`)
and let the user repeat their request. With a token, `return_url` must lead
back into the app (the token's origin, or the app's own scheme for a native
app). Never put the link into the conversation.

## Step 9: approvals

Tools marked for confirmation pause the run and send
`tool_confirmation_required` in the stream; the app shows a card and answers
with the next request:

```
POST /v1/chat/completions   {"model": "junis-orchestrator", "session_id": "…", "messages": [{"role": "user", "content": "ok"}],
                             "tool_confirmations": [{"confirmation_id": "…", "approved": true}]}
```

`GET /sessions/<id>/tool-confirmations` lists what is waiting (for example
after the app was reopened). An `ask_user` question arrives the same way; the
answer goes in `tool_confirmations[].answer`. Requests expire after 24 hours.
Cards exist only where a person is in the conversation: a scheduled run does
not show one and the tool is not run; step 10 is how the user answers it
afterwards.

To make every write ask first in conversation and never run unattended, set
the organization's tool policy preset to `ask_before_write` (Team settings →
Tool safety). `notify_user` is exempt.

## Step 10: approving later

A scheduled run has nobody to show a card to, so a tool that needs
confirmation is not run there. For an app user it is kept as a request the
user can answer afterwards:

```
GET  /me/approvals                       → {"approvals": [{"confirmation_id", "session_id", "tool_name", "args_preview", "expires_at"}]}
POST /me/approvals/<confirmation_id>     {"approved": true}   → {"status": "granted", "session_id": "…", "next": "…"}
```

The request also arrives in the feed as an item of kind `approval` (held
during quiet hours). Approving runs nothing. Send a message in that
conversation right after ("Go ahead.") and the agent makes the same call
again; it then runs once without a card, only when the tool and its arguments
are exactly what the user approved. Anything else shows the usual card.
Requests expire after 24 hours.

## Step 11: photos, files and voice memos

```
POST /me/files      multipart/form-data, field "files" (up to 5)   → {"files": [{"publicUrl", "fileName", "mimeType", "error"}]}
POST /v1/chat/completions   {…, "files": ["<publicUrl>", …]}
```

With an app-user token the chat request accepts only addresses that
`/me/files` returned; any other URL is refused (400
`not_allowed_with_app_token`). Formats and sizes are those of the web chat
(images and documents 100 MB, audio and video 200 MB); 200 files a day per
user. A voice memo is an audio file: the reply quality depends on the squad's
model accepting audio.

## Step 12: the user's own computer

The assistant can work in a folder on the user's computer. Set it up once
(`PUT /management/app-devices {"agent_id": "<the agent that gets the device tools>"}`),
then, per user:

1. On the computer: `npx junis policy --folders ~/Documents/Assistant`, then
   `npx junis --pair`. A code appears. The first command limits the assistant
   to that folder and refuses commands, browser and screen control; tell users
   to run it first.
2. In the app: `GET /me/devices/pairing?code=<code>` shows which computer is
   asking; show its name and let the user confirm, then
   `POST /me/devices/pair {"code": "<code>"}`.

The computer is used only in that user's own conversations. `GET /me/devices`
lists them (`enabled: false` means the organization has not turned this on:
hide the button), `DELETE /me/devices/<device_id>` disconnects. Five computers
per user. Tell users to enter only a code shown on their own computer: the
computer joins the account of whoever enters the code.

A related setting for squads that use the sandbox tools (code, files):
`PUT /management/app-workspace {"enabled": true}` gives each app user one
sandbox of their own instead of one per conversation, so files saved in one
conversation are there in the next and in scheduled runs. It sleeps when
unused and wakes on the next use. It is not permanent storage: the platform
operator may clear workspaces left unused (30 days when that cleanup is on),
the sandbox provider keeps a sleeping sandbox only for a limited time, and
changing the organization's sandbox internet setting replaces existing
workspaces with empty ones. Keep anything that must last in Knowledge or the
user's own storage. If a tool answers that the workspace could not be reached,
it was not replaced: try again shortly. The agent's `sandbox_create` tool keeps
an existing workspace (`status: "kept"`); it erases it only with
`replace_workspace=true`, so tell the agent to ask the user first. The sign-in
view (step 18) is refused where the organization turned sandbox internet off.

The default sandbox has Chromium. With the per-user workspace on, an agent
that drives a browser keeps that user's cookies by starting it with a profile
folder inside the workspace (`--user-data-dir=/home/user/browser-profile`).
When a site needs the user to sign in, the user does it themselves on a live
view of that browser (step 18). Accounts that offer OAuth are better connected
that way (steps 8 and 16), and the browser already signed in on the user's own
computer is this step.

## Step 13: rooms (several people, one conversation)

Turn rooms on once: `PUT /management/app-rooms {"enabled": true}` (optionally
`agent_id` and `default_mode`).

| The app wants | Call |
| --- | --- |
| Create a room, list mine | `POST /rooms {"name": "…"}`, `GET /rooms` (with `unread`) |
| Invite | `POST /rooms/<id>/invites` → `{"code"}`; the other person: `POST /rooms/join {"code": "…"}` |
| Post | `POST /rooms/<id>/messages {"text": "…", "addressed": true}` → 202 `{"message", "reply": "pending"}` |
| Read and follow | `GET /rooms/<id>/messages?after=<seq>`, `GET /rooms/<id>/events` (server-sent events, like the feed), `POST /rooms/<id>/read {"seq": n}` |
| Leave | `DELETE /rooms/<id>/members/me` |

- `mode` decides when the agent speaks: `always`, `mention` (only messages
  with `addressed: true`; the default) or `silent`. Messages it did not answer
  are given to it with the next one it does answer.
- The agent's reply is not streamed to the poster: it arrives as a room
  message for everyone at once. Show "replying…" while `reply` is `pending`
  and no assistant message with a higher `seq` has come.
- A room runs as its own account, so the agent there knows only what was said
  in the room: no member's memory, connections or computer. Do not promise
  "it knows my calendar" in a room.
- Limits: 50 rooms a person can be in, 30 new rooms a day per person
  (`room_create_limit`), 20 members, 8 open room streams per person
  (`too_many_streams`). A new member can read what was said before they
  joined; open a new room when that is not wanted. When an account is deleted,
  its rooms pass to the longest-standing other member, and what that person
  wrote is removed, including the room agent's memory of the conversation.
- Bringing one person's own information into a room (two people finding a
  time, splitting a bill, planning a trip): give the personal agent the tools
  `list_my_rooms` and `suggest_room_message`. The user says "tell the trip
  room when I'm free" in their own conversation; the assistant looks it up on
  their side and prepares the message. Nothing is posted by the tool: the
  user's feed gets an item of kind `room` with `data.type: "room_draft"`,
  `data.room_id`, `data.room_name`, `data.others` (the other members' names),
  `data.member_count` and `data.addressed`, and the item's `body` is the
  text. Show that text, the room and who is in it, with a Send button; on
  Send call `POST /rooms/<data.room_id>/messages {"text": <body>,
  "addressed": <data.addressed>}` and mark the item read; offer Discard too
  (mark read, send nothing). The room's agent then works from what everyone
  sent.
  - Show `data.others`, not only the room's name: a room is named by whoever
    made it.
  - Limits: 20 prepared messages a user a day, 3 a run (shared with
    `notify_user`), the same text for the same room once a day. A scheduled
    run prepares nothing for a user who turned proactive messages off
    (`/me/settings`); a message they ask for in a conversation is prepared.
    Not available in Slack threads or public widgets.
  - A feed webhook (`/management/user-feed/webhook`) receives these items
    too, as `kind: "room"`: a server that treats every `room` item as a new
    room message must check `data.type` first.
  - Other feed items of kind `room` are notices of new messages (`data.seq`,
    no `data.type`): tell the two apart by `data.type`.
  - The person sees exactly what leaves their account before it does. No
    tool posts into a room by itself, reads what was said in a room, or lets
    two people's assistants talk to each other directly.
  - These items stay in the app: they are not sent to Telegram, text
    messages, email or push (there is no Send button there).
- With the organization key a server can put people in directly
  (`POST /rooms/<id>/members {"user_id": "…"}`); a token cannot.
- 20 people a room, 4,000 characters a message.

## Step 14: Telegram, text messages and email

Users can talk to the same assistant outside the app. The organization brings
its own accounts and stores each secret under Org Keys; the setup names them:

```
PUT /management/app-channels
{"api_key_id": "<organization key the channel conversations run under>",
 "telegram": {"bot_token_secret": "TG_TOKEN", "bot_username": "my_helper_bot"},
 "sms": {"account_sid": "AC…", "auth_token_secret": "TWILIO_TOKEN", "from_number": "+1…"},
 "email": {"smtp_host": "smtp.example.com", "smtp_port": 587, "smtp_user": "bot@example.com",
           "smtp_password_secret": "SMTP_PASS", "from_address": "bot@example.com",
           "inbound_secret": "MAIL_IN"}}
```

Send only the channels the app offers. Every `…_secret` field takes the **name**
of an Org Key, never the value: the user registers the values first at
`https://junis.ai/team/mcp-skills` → Org Keys (the Telegram bot token from
BotFather, the Twilio auth token, the SMTP password, and for `inbound_secret`
any long random string the mail service will send back). `smtp_port` is 25,
465, 587 or 2525; 465 connects with TLS, the others upgrade with STARTTLS.
Replies are sent from `from_address`, and that is also the address users write
to.

The reply lists `inbound_urls`. Telegram is registered when you save; set the
`sms` URL as the messaging webhook of the Twilio number; for `email`, have the
mail service post `{from, subject, text, message_id, auth}` with the header
`X-Junis-Channel-Secret` set to the value stored under `inbound_secret`.

Before launch, try each channel once with a real account (a message in, an
answer back, and one `notify_user` message out): a wrong token or an
unregistered sender number shows up only then.

Who really sent it:

- Email: anyone can write any `From`. A message is handled only when `auth`
  carries the mail service's verdict that the sender is authentic:
  `{"dmarc": "pass"}`, or `{"dkim": "pass", "dkim_domain": "<the From domain>"}`,
  or `{"spf": "pass", "spf_domain": "<the From domain>"}`. Map your mail
  service's fields to it (SES `dmarcVerdict`, the `Authentication-Results`
  header). Without it the reply is `{"handled": false, "reason":
  "sender_not_verified"}` and nothing runs. The verdict proves the domain, not
  the mailbox: on a shared company domain a colleague can still write as the
  user, so say so where the app offers email.
- Text messages: a sender's number cannot be verified and can be forged. When
  you turn `sms` on, set `agent_id` to an agent that has no irreversible tools,
  or put those tools on the confirmation list; saving without `agent_id`
  returns a `warnings` entry saying so.
- Telegram senders are verified by Telegram.

The key named by `api_key_id` needs `users:delegate` and `orchestrator:invoke`,
plus `agents:invoke` when `agent_id` is set.

A user connects a channel from the app: `POST /me/channels/telegram/link`
returns a code and, for Telegram, a link to open; sending the code on that
channel ties the address to the account. After that, what they write there
goes to their assistant (one conversation per channel) and the answer comes
back on the same channel. Messages the agent sends first (`notify_user`) and
approval requests also go out there, after quiet hours end. Messages a user
sends while an answer is still being written wait their turn and are answered
in order.
`GET /me/channels` shows what is available and connected;
`DELETE /me/channels/<channel>` disconnects.

Say these limits before promising a channel: Telegram private chats only; text
messages to some countries (Korea among them) need the sender registered with
the carrier through Twilio first; WhatsApp, KakaoTalk and iMessage need an
agreement with those companies and are not offered (send to them yourself from
the feed webhook, step 7).

## Step 15: mini apps (pages the assistant makes, saved per user)

The assistant can write a small web page for the user (a habit tracker, a
budget, a quiz, a game) and the app can keep it as that user's own: what the
page saves stays on the account, not on the device. Turn it on once:
`PUT /management/app-spaces {"enabled": true}`.

| The app wants | Call |
| --- | --- |
| Keep the page the agent wrote | `POST /me/apps {"html_content": "<!DOCTYPE html>…", "title": "…"}` → 201 `{"slug", …}` |
| List mine | `GET /me/apps` |
| Replace its content | `POST /me/apps/<slug>/versions {"html_content": "…"}` (same address; saved data stays) |
| Delete | `DELETE /me/apps/<slug>` |
| Open it as this user | `POST /me/apps/<slug>/open` → `{"url", "expires_at"}` |

- Open `url` in a web view (mobile) or a new tab (web). A published page
  cannot be placed in another site's iframe.
- The address carries a pass after `#` that makes this user the page's viewer
  for 2 hours by default (`ttl_seconds` 300 to 43200). When it runs out the
  page falls back to saving on the device: call `open` again and reopen.
- The page uses `window.junis` (`junis.storage.get/set`, scores) to save.
  Load the `space-builder` skill bundle on the agent that writes pages so it
  writes them that way. See [publishing.md](publishing.md).
- Any published page of the same organization can be opened this way, so the
  organization can ship one mini app to every user (publish it with the
  organization key: `POST /spaces/links`).
- Anyone who has a page's address can see the page (each viewer's saved data
  is separate). Do not put private content in the HTML itself. 20 new pages a
  day per user.
- Not offered: pages that refresh on a schedule without the agent, addresses
  only the user can open.

## Step 16: tools that need the user's own sign-in

Some MCP servers take no key: each user signs in (OAuth 2.1). Set the
platform up once, then users connect it from the same connect page as their
other accounts (step 8).

1. Ask the server: `GET /management/mcp-platforms/<platform_id>/oauth` →
   `{"supported", "issuer", "registration", "redirect_uri", "problem"}`.
   Nothing is saved. `supported: false` with a `problem` means the server
   cannot be connected this way.
2. Turn it on: `PUT /management/mcp-platforms/<platform_id>/oauth
   {"enabled": true}`. If `registration` was
   `preregistered_client_id_needed`, first register `redirect_uri` with that
   server and pass `"client_id"` (and `"client_secret_name"`, the name of an
   organization key holding the secret: never the secret itself).
3. The user opens a connect link (`POST /me/connect-sessions`), presses
   Connect on that server, signs in there and comes back.

Open the connect link in the system browser or an in-app browser tab
(SFSafariViewController, Chrome Custom Tabs), not in an embedded web view. The
sign-in must finish in the same browser where the user pressed Connect:
starting in a web view and handing the sign-in step to another browser ends
with "This sign-in was started in another browser", and sign-in pages such as
Google's refuse embedded web views anyway.

Tokens are stored per user, refreshed before they expire and revoked when the
user disconnects. If the server stops accepting a user's sign-in, the item
shows as not connected again: ask the user to connect once more. Only remote
platforms the organization owns can be set this way.

## Step 17: watches (an event in a connected app wakes the assistant)

A schedule wakes the assistant at a time. A watch wakes it when something
happens in an app the user connected: a new mail, a new calendar event, a new
issue. Turn it on once:

```
PUT /management/app-watches
{"api_key_id": "<organization key the event runs use>",
 "agent_id": "<an agent made for events>", "max_per_user": 5,
 "daily_runs_per_user": 50}
```

`agent_id` is required. An event's content (a mail body, an issue text) is
written by people outside the app, and it is read in a run nobody watches. So
make a narrow agent for it: `notify_user` and read-only tools, with an
instruction to judge the event against what the user asked and say nothing
otherwise. Never point watches at an agent that can send, pay or delete, and
give it no sub-agents: whatever that agent can reach, an event can try to use.
The organization's orchestrator is refused (`agent_too_broad`), and the key
named by `api_key_id` needs `agents:invoke` as well as `users:delegate` and
`orchestrator:invoke`. Event runs do not use the user's workspace sandbox.

If the reply says `"webhook_signature_ready": false`, events do not start runs
yet: the platform operator has to set the Composio webhook signing secret.

| The app wants | Call |
| --- | --- |
| What can be watched | `GET /me/watches/events?app=gmail` → `events[] = {"event", "name", "description", "config"}` |
| Create | `POST /me/watches {"event": "…", "instruction": "Tell me in one line if it is about an invoice."}` → 201 |
| List, delete | `GET /me/watches` (`enabled: false`: hide the screen), `DELETE /me/watches/<id>` |

- The user must have connected that app first (step 8), on their own account.
- Each event runs one turn of that agent in a hidden conversation, in the
  user's name, and is billed. The event's content is passed as data; the
  agent must not follow instructions found inside it.
- One watch runs one turn at a time. Events that arrive while a turn is
  running are not lost: they wait (up to an hour, 50 events) and go into the
  next turn together, up to five per turn. Ten mails at once are all seen.
- Limits: the same event is handled once, and one user gets
  `daily_runs_per_user` turns a day; when that is reached, waiting events are
  dropped. Only turns that actually ran count. Setting `min_interval_seconds`
  above 0 makes events that come sooner than that wait for the next event's
  turn, so use it only to cap cost.
- For an app that sends no events, keep using an interval schedule with
  `notify_user(dedupe_key=…)` (step 6).
- Watches are created by the app's screen. The agent has no tool that creates
  one from the conversation.

## Squad shape for a personal assistant

Start from pattern 1 or 2 in [squad-design.md](squad-design.md) and add:

- **Orchestrator** talks to the user. It already has memory tools and
  `create_my_schedule`; tell it to use `in_this_conversation=true` for
  follow-ups and to read the user's time zone from what the tools return.
- **A quiet worker** for scheduled checks: read-only tools for the sources it
  watches, plus `notify_user`. Its instruction: "Compare with what you last
  reported. If nothing the user asked about changed, end without calling
  notify_user."
- **Writes** (send, book, pay) stay on agents the user talks to, behind
  confirmation.

Keep one orchestrator per organization and one account per end user; do not
create an organization per end user.

## Outside services the assistant acts in

An errand assistant is only as useful as the services it can reach. Sort each
service the user names into one of three rows before promising anything:

| The service offers | How the squad reaches it | Whose credential |
| --- | --- | --- |
| A sign-in for third-party apps (Gmail, Calendar, Notion, Slack …) | An OAuth app or MCP platform linked to the agent ([connections.md](connections.md)); each user connects through step 8 | Each user's own |
| A public developer API with a key (search, maps and places, weather, transit, public data portals; in Korea for example the Naver and Kakao developer APIs and data.go.kr) | An approved action over HTTP ([actions.md](actions.md); import the provider's OpenAPI document when it has one), or `http_request` with a secret reference | The organization's key, stored as an Org Key by name |
| No public API (most ordering, ride-hailing, delivery and booking apps) | Not reachable without an agreement with that company. Say so. Do not script the service's website or app with a user's password | — |

Read the provider's developer terms before building: many public APIs forbid
storing results or have daily quotas, and one organization key is shared by
every user, so a busy app reaches the quota early. Keep writes (orders,
payments, messages to other people) behind confirmation.

## Check it before shipping

1. Create a test account, issue a token (`issue_app_user_token` in the hosted
   tools, or the endpoint) and send one message with it.
2. Call something the token must not reach (`GET /management/users`): expect
   403 `app_token_scope`.
3. Set quiet hours around now, have the agent call `notify_user`, and read
   `GET /me/feed`: the item appears only after quiet hours end.
4. Ask the assistant to "check again in two minutes" and confirm the reply
   lands in the same conversation and a `run` item appears in the feed.
5. Disconnect an app and confirm the agent says so and `GET /me/connections`
   shows `all_connected: false`.

## What the app owner does (not the platform)

- Tell users they are talking to an AI, and handle age rules, in the app's own
  screens.
- Payments and each user's allowance: read usage from `credit_usage` in chat
  replies or `GET /management/usage?user_id=` and charge in the app.
- Push credentials: the Firebase service account (which carries the APNs key for
  iOS) or the Expo project. With `app-push` on (step 7) Junis sends the
  notification; with the feed webhook the app's own server sends it.
- Store listing, privacy policy and deleting an account on request
  (`DELETE /management/users/<id>`).

## Step 18: signing in to a website (the sign-in view)

Some sites have no API and no OAuth: someone has to sign in once. The user
does it themselves, on a live view of the browser in their own workspace. No
password goes through the conversation, and the login stays in that user's
browser profile for the assistant's later runs.

Turn it on once (it needs the per-user workspace of step 12):

```
PUT /management/app-workspace {"enabled": true, "sign_in_view": true}
```

Give the agent the tool `request_browser_sign_in` and an instruction like:
"When a site asks for a login, call request_browser_sign_in with the page and
a one-line reason, tell the user you are waiting, and stop. Never ask for a
password or a code. Start your browser with
--user-data-dir=/home/user/browser-profile." The tool puts one item in the
user's feed:

```
{"kind": "connection", "title": "Sign in to shop.example.com",
 "data": {"type": "browser_sign_in", "url": "https://shop.example.com/login", "site": "shop.example.com"}}
```

| The app | Call |
| --- | --- |
| Shows the request | the item's title and `data.site`: the site name made from the address (look-alike letters show as `xn--…`). Show `data.site` next to the button |
| Opens the view | `POST /me/browser-sign-in {"url": "<data.url>", "ttl_seconds": 300}` → `{"id", "view_url", "site", "expires_at"}` |
| Shows it | open `view_url` in a web view or a new tab |
| Knows it ended | the view posts `{"type": "junis-browser-login", "status": "done"}` to its parent, or `GET /me/browser-sign-in` → `{"active": false}` |
| Closes it | `DELETE /me/browser-sign-in` (also stops billing) |
| Tells the assistant | one message in that conversation: "I signed in." |

- `view_url` is the key to that view. Open it; never show, log or store it,
  and never put it in a conversation. It stops working when the view closes.
- The view works with mouse, touch and keyboard, input methods (Korean,
  Japanese), paste, and sign-in pop-ups. It stays open 2 to 10 minutes
  (`ttl_seconds`, default 5) and closes by itself when nobody is watching.
- One view per user: a second `POST` returns the open one (`"reused": true`).
  `409 browser_busy` means the assistant is using that browser right now.
- The time the view is open is billed at the sandbox rate, once per view. A
  view that was closed by the user is finished by the next `GET` or `DELETE`;
  one that nobody finishes is finished when its time runs out.
- `409 sign_in_view_off`: the organization has not turned it on (hide the
  button). `402`: no credit left.
- Which site it is: the agent picks the address, and an agent can be tricked
  by something it read. So only `https://` addresses with a plain ASCII host
  are accepted (an international name must come in its `xn--` form, and is
  shown that way), the name the user sees is the host of the address (not the
  agent's words), and the bar
  of the view always shows the site on screen, marked when it is not the site
  that was asked for. List the sites a view may open and nothing else opens:
  `PUT /management/app-workspace {"enabled": true, "sign_in_view": true,
  "sign_in_sites": ["shop.example.com", "*.example.net"]}` (others answer
  `403 site_not_allowed`).
- While a view is open, the assistant's code tools in that user's workspace
  answer "try again in a moment": code in the same sandbox could watch the
  browser. Tell the agent to wait for the user's "I signed in."
- Close the view as soon as the user is back in the app: `DELETE
  /me/browser-sign-in` (the example does it when the user presses "I signed
  in"). A view left open keeps the assistant's code tools waiting.
- What this does not protect against: code that was already running in that
  workspace before the view opened (an unfinished run, a background process an
  agent left behind) runs as the same user and could watch the browser. Give
  the sandbox tools only to agents you trust, list the sites
  (`sign_in_sites`), and connect accounts that offer OAuth with OAuth.
- A browser the agent left running on the profile is closed (cleanly) when
  the user opens a view: the user's sign-in comes first.
- Large identity providers (Google, Apple) often refuse automated browsers.
  Connect those accounts with OAuth (steps 8 and 16) instead.

The example app shows a "Sign in" button on such a feed item, opens the view
in a new tab, asks every few seconds whether it ended, and then tells the
assistant (`examples/personal-assistant/index.html`, `signInRow`).
