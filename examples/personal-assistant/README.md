# Personal assistant — reference front end for app users

One HTML page that is a whole personal-assistant product on Junis: streamed
chat, approval cards, an inbox of what the assistant sent first, the
follow-ups it promised, quiet hours, and a Connect button. Junis is the entire
agent back end; the page holds no API key. It is the smallest working shape of
what `skills/junis/references/app-users.md` describes.

| Screen | Calls (all with `Authorization: Bearer <app-user token>`) |
| --- | --- |
| Chat | `POST /v1/chat/completions` (stream). The first chunk carries `session_id`; later messages send it back. One request per conversation at a time: what is typed while a reply streams waits in a queue and leaves in order when the reply ends; 409 `session_busy` → the same call again after `Retry-After` |
| Approval or question card | the stream line `{"event": "tool_confirmation_required", "confirmations": [...]}` → answered with `tool_confirmations` in the next call |
| Inbox | `GET /me/feed`, then `GET /me/events` read with `fetch` streaming (`EventSource` cannot send the header); `POST /me/feed/read` |
| Approve later | a feed item of kind `approval` → `POST /me/approvals/<id>` `{approved}` → one message in that conversation, and the assistant runs what was approved |
| Sign in to a site | a feed item of kind `connection` with `data.type: "browser_sign_in"` → `POST /me/browser-sign-in {url}` → the returned `view_url` opens in a new tab (a live view of the browser in the user's workspace) → `GET /me/browser-sign-in` until `active: false` → one message, "I signed in." |
| Attach a photo, file or voice memo | `POST /me/files` (multipart) → the returned `publicUrl` goes in the chat request's `files` |
| Follow-ups | `GET /me/schedules`, `DELETE /me/schedules/<id>` |
| Settings | `GET /me`, `PATCH /me/settings` (time zone from the device on first launch) |
| Connect | `GET /me/connections` → (`items` empty: nothing to connect) → `POST /me/connect-sessions` → open `url`. Needs `JUNIS_AGENT_ID` on the token endpoint: the token then names the squad whose connections are meant |

## The token

The page asks `TOKEN_URL` for `{"token", "expires_in"}`. Two ways to provide it:

1. **One small endpoint of yours** (`token-endpoint.mjs` here, about 30 lines):
   it knows who is signed in, creates the account once
   (`POST /management/users` with your user id as `external_id`) and returns
   `POST /management/users/<user_id>/app-token`. The organization key stays on
   that endpoint.
2. **No server**: register your identity provider once
   (`PUT /management/app-auth`), then replace `getToken()` with a call to
   `POST /api/external/app-token/exchange` carrying the provider's ID token.

## To try it

1. Build the squad (see "Squad shape for a personal assistant" in the
   reference): an orchestrator, and a quiet worker with `notify_user`.
2. In the web app, Settings → Publish: add this page's origin to the allowed
   embed origins.
3. Create an organization key with "Connect users from my own app" and run
   `token-endpoint.mjs` with `JUNIS_ORG_KEY`, `JUNIS_ORG_ID`,
   `JUNIS_AGENT_ID` and `APP_ORIGIN` set.
4. Serve `index.html` from that origin and open it.

## What this page does on purpose

- One request at a time, through one queue: messages leave in the order typed,
  each in the conversation it was typed in and with the files picked for it.
  An answer to a card goes first; if it fails to send, the card comes back.
- A reply that goes silent for 90 seconds is dropped (the server sends a
  keepalive every 15); what already arrived stays on screen.
- The token stays in a variable: not in storage, a cookie or a URL.
- Everything from the assistant or the feed is written with `textContent`.
- The connection link is opened, never shown or logged.
- The sign-in view's address is opened in a new tab, never shown, logged or
  stored, and the new tab cannot reach back into this page.
- It never sends `X-API-Key`.
