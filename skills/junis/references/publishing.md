# Putting a squad in front of people

Read this when a squad should serve people beyond its builder: a website chat
widget, a public team page, a Slack bot, a shared result, or teammates with
roles. The switches are the user's, in the web app; this file says what each
one exposes and who pays.

## Contents

- Website chat widget
- Knowledge graph widget
- Public team page and showcase
- Slack
- Sharing a chat or a result
- Team roles and who pays

## Website chat widget

Owners and admins set it at `https://junis.ai/settings/organization` →
Publish. The iframe code for `https://junis.ai/embed/<slug>` appears only after
Embed Mode is set to Public Anonymous.

| Setting | Effect |
| --- | --- |
| Embed Mode | "Team Members Only" (default) keeps the website widget off: `/embed/<slug>` answers "not available" and there is no iframe code (members use the web app, or `/team/public/<slug>` when the team is public). "Public Anonymous": anyone on an allowed site chats without signing in, and the organization's billing switches to the owner for everyone, members included |
| Allowed Domains | Up to 20 exact origins (`https://www.example.com` is not `https://example.com`); other sites are refused |
| Messages per visitor | 1 to 500 per 24 hours, default 20 |
| Blocked Tools for Public Widget | Tools visitors cannot use, MCP and Composio tools included (shown only in Public Anonymous mode) |
| Spoken Replies | Server voice, billed to the owner; off by default (shown only in Public Anonymous mode) |

Anonymous visitors run under the owner's account: the owner pays and tools act
with the owner's access. The owner's identity is not passed on: `{user_email}`
and `{user_name}` are empty in visitors' turns.

- Always refused: the owner's memory (not read, not written), changing the
  personality (it still shapes answers), the wiki, other squads, conversation
  search, code execution, jev tools, media generation.
- Knowledge answers only from sources marked "Shared publicly" at
  `https://junis.ai/team/knowledge` (per ready source, not database sources;
  `GET /brain/sources` shows `public_in_widget`). Search only: no graph facts,
  no path, count, what-if, documents or SQL. With none shared, it finds nothing.
- Everything else runs with the owner's access unless blocked: RAG agents
  (visitors can read the whole store), MCP platforms, Composio apps,
  `custom_api_call` with organization secrets. Personal secrets are refused.
- Visitor conversations appear in `list_sessions` under the owner, unmarked.

A test run from the kit runs as you, where every tool works, so it proves
nothing about the widget. Ask the user to ask one question through the widget
on their allowed site and report the answer. Opened directly,
`https://junis.ai/embed/<slug>` says the domain is not allowed.

## Knowledge graph widget

Switch it on at `https://junis.ai/team/knowledge` → "Embed the knowledge graph
on your site" and add the site under Publish → Allowed Domains (the chat embed
mode does not matter). It shows only entities and relations from sources marked
"Shared publicly", without summaries, attributes or passages. With "Require
signed embed token" on, the site's server calls `POST /brain/embed-token` with
`{"embed_domain": "https://site"}` (a `brain:read` key) for each page view and
uses the returned `embed_url` (token in the `#t=` fragment). A token works once,
for five minutes (`ttl_seconds` up to 600). 409: the graph widget is off; 403:
the domain is not allowed. Never put the API key in browser code.

## Public team page and showcase

- "Public Team" (Publish tab, or `https://junis.ai/admin/dashboard` →
  Settings) lists the team on `https://junis.ai/showcase` and opens
  `https://junis.ai/team/public/<slug>`. Any signed-in Junis user can then chat
  with the squad without an invitation, at the owner's cost unless Billing
  Target is Individual Users. Confirm with the user first.
- It is independent of the widget: a private organization can embed Public
  Anonymous, and a public one still needs the widget settings.
- Welcome Suggestions (chips on the first chat screen) and the Setup Guide are
  in dashboard Settings. Cloning is offered only for Junis template teams.

## Slack

- The install lands in the web app's current organization, so an owner or
  admin first switches to it (the `?join=` link, [user-steps.md](user-steps.md)),
  installs at `https://junis.ai/slack`, then links a key on the success page:
  their own key or an organization key of that organization.
- One linked key serves the whole workspace. Everyone who mentions @Junis runs
  as that key's user: that user's memory is read and written, and billing is as
  for that user (the owner under the default Billing Target). Link a key made
  for this purpose.
- Knowledge and conversation search answer only the installer; others are
  refused. A workspace-wide knowledge bot needs a RAG agent
  ([knowledge.md](knowledge.md)).
- `@Junis *OrgName* question` picks an organization; plain mentions go to the
  default one, set by the installer in dashboard Settings → Slack. Channels
  need a mention; direct messages do not. Attached files serve that turn only
  and are not added to Knowledge.

## Sharing a chat or a result

| What | How | Link |
| --- | --- | --- |
| A conversation, read-only | Share in the chat | `https://junis.ai/shared/<slug>`, anyone can open it |
| An HTML result | the code block's preview → Publish to Web | `https://junis.ai/publish/<slug>`, public switch and view count |
| Generated images and video | automatic; delete at `https://junis.ai/team/content` | `https://junis.ai/content/<id>` |

### HTML results: what runs in the preview and on the published page

An HTML result runs in a sandboxed frame with no access to the Junis page, in
the chat preview and on `/publish/<slug>` alike (measured 2026-11-19 in
Chromium and WebKit). State these in the agent's instruction; nothing else
enforces them:

- One complete HTML document in one `html` code block; no separate files.
- No browser storage: `localStorage`, `sessionStorage` and `indexedDB` throw
  `SecurityError` and stop the script. To keep progress, use
  `window.junis.storage` (below): signed-in viewers keep it on their account,
  guests on that device. Without it, state lives in memory only.
- Scripts load only from `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`,
  `unpkg.com`, `cdn.tailwindcss.com` and `esm.sh`; on the published page any
  other host is blocked without a visible error. Styles and fonts: the first three and Google Fonts.
- `fetch` works to any HTTPS server that answers with
  `Access-Control-Allow-Origin: *`. The page cannot call the Junis API or read
  the signed-in user; the agent puts the data it needs into the HTML.
- Use pointer events (not mouse-only), give keyboard controls an on-screen
  button too, and start on a tap: sound, full screen and tilt open only after
  a user action. Size to `100dvh`. The JUNIS mark on a published page is a
  strip below the frame, so it covers no part of the page.
- Games: update on a fixed time step with a capped frame delta; draw art in
  code (canvas, CSS, shapes). Check portrait and landscape: panels and HUD
  that vanish only in landscape were a common defect in test builds (5 of 6).
  Keep start and end overlays off the controls, and CSS class names distinct.
- three.js: pin a version and import it as a module through an import map
  (`three` → `https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js`,
  `three/addons/` → `.../three@0.187.0/examples/jsm/`). `three.min.js`,
  `examples/js/`, `*BufferGeometry` and `.getInverse()` do not exist in that
  version; `outputEncoding` and `texture.encoding` are ignored without an error.
- Publishing an edited result: when the conversation already has a link, the
  publish dialog offers "Update link" first. It keeps the same address, saves,
  leaderboard and view count, and keeps the earlier version (restorable from
  "Version history": the last 20 versions or 25 MiB per link, whichever comes
  first). "Publish as a new link" makes a new address.

#### Saves and leaderboards: `window.junis`

A published page that mentions `window.junis` gets saved data per viewer,
shared data, a leaderboard and pause handling without server code. The
platform adds a small SDK to the frame only for such pages; the frame never
receives a token, and the page sees a per-app pseudonymous viewer id, not who
the viewer is. Put this text in the instruction of an agent that makes apps or
games (not in a global prompt):

```text
Saving and leaderboards on published pages — window.junis (optional; a page that never mentions window.junis gets no SDK)
1. Always write `window.junis.…` in full (the SDK is added only to pages that contain that text) and `await` each call inside `<script type="module">` or an async function. No call throws or rejects. `null` = not available on this page (no host, saves off, or line 6's guest case): carry on without it. storage.list, run.start and leaderboard.list fail only with `null`; the other calls fail with `{ok:false, code, reason}` — code conflict, quota, invalid, denied, not_found, throttled, unavailable (unreachable now) or timeout (no answer in 15 s; it may still have happened).
2. Start: `const ctx = await window.junis.ready()` → ctx.viewer {id, name ('' unless the player is listed on the leaderboard), isGuest, isOwner}, ctx.locale, ctx.timeZone, ctx.now (ISO time; server time on a published page). Begin the app after this line.
3. Save: `await window.junis.storage.set('save', obj)` → `{ok:true, etag}` · Load: `const r = await window.junis.storage.get('save'); if (r && r.ok && r.exists) state = r.value;` · Delete: `await window.junis.storage.delete('save')` · List: `const l = await window.junis.storage.list({prefix:'slots/'})` → `{keys:[{key, etag, bytes}]}`.
4. Limits: a key is 1–128 characters, an ASCII letter or digit first, then ASCII letters, digits, `_`, `.`, `/` or `-` (`save`, `slots/1`). A value is plain JSON nested at most 64 levels, 64 KB per key; 1 MB and 256 keys per viewer. Signed-in viewers keep saves on their account; guests keep them on this device only, 64 KB for the whole app.
5. Budget per viewer per minute: 30 writes (set, delete and incr together, at most 10 of them shared), 12 run.start, 6 run.end; keep reads under 60, and all calls together under 20 a second and 300 a minute. Autosave at most every 3 s. Over budget a call returns `{ok:false, code:'throttled', retryAfterMs}` (run.start and the list calls: `null`) and nothing was written: wait that long, then call again. Retry unavailable or timeout a few seconds later, a few times at most — except an incr that timed out (it may have counted).
6. Shared data everyone can read: pass `{scope:'shared'}` as the last argument of get/set/delete or inside list's options (16 KB per key). Only signed-in viewers write; for guests a shared set, delete, incr or list returns `null`. Counter: `const c = await window.junis.storage.incr('votes/a', 1)` → `{ok:true, value}` (within ±9,007,199,254,740,991; decimals add as decimals, 0.1 three times is 0.3); read it with `window.junis.storage.get('votes/a', {scope:'shared'})`.
7. Safe update: `window.junis.storage.set(key, value, {ifMatch: r.etag})` — an etag is an opaque string or null, pass it back unchanged. On `{ok:false, code:'conflict', current:{etag, value}}` merge with `current.value` and save again with `{ifMatch: current.etag}`. `{ifNoneMatch:'*'}` creates only if the key is missing; never pass it together with ifMatch.
8. If a get did not return a value (refused or timed out), a later set of that key without ifMatch only creates it: when the account already holds a value you get the same `conflict` instead of overwriting it — handle it as in line 7.
9. Score: `await window.junis.run.start()` (→ `{runId, seed}`) when play begins; `const res = await window.junis.run.end({score})` once when it ends (a finite number, rounded to an integer) → `if (res && res.ok)` use res.best and res.rank (null until the player is listed). On throttled, unavailable or timeout send the same run.end again (line 5) before starting another run; a run never scores twice — a repeat after the first got through returns conflict or invalid: treat it as done. Rounds shorter than 10 s exceed line 5 — score several of them as one run.
10. Board: `window.junis.leaderboard.open()` opens the platform's leaderboard. Never ask for a name — the platform asks once after the player's first score. For your own list: `const b = await window.junis.leaderboard.list()` → `{records:[{rank, score, name, isMe}], myRank}` (up to 20 rows; `{limit}` 1–50).
11. Declare the board once near the top of <head>: <script type="application/json" id="junis-space">{"schema":"junis.space/v1","leaderboards":[{"key":"main","label":"High score","sort":"desc"}]}</script> — use "sort":"asc" when lower is better (time attack).
12. Optional anti-cheat limits go in the same JSON as "score":{"max":100000,"maxPerSecond":50,"minRunMs":3000}: max and min = bounds of an honest score, minRunMs = shortest possible round, maxPerSecond = most points per second between run.start and run.end (not checked for "asc"). A score outside them stays private to the player and no name prompt appears, so set each about twice as loose as the best honest play, or leave it out.
13. The platform freezes requestAnimationFrame, timers and Web Audio (AudioContext; one you suspend yourself stays suspended) while the tab is hidden or the leaderboard is open, and performance.now() does not jump afterwards: use performance.now(), not Date.now(), for game time. `window.junis.on('pause', fn)` / `window.junis.on('resume', fn)`: show a paused state and stop what is not frozen (CSS animations, <audio>/<video>).
14. Never use localStorage, sessionStorage, indexedDB or document.cookie — storage access throws in this frame and cookies are not kept.
15. In the chat preview saves and scores last only while the preview is open; they become real after Publish. In a downloaded file `ready()` still resolves and the storage, run and leaderboard.list calls return `null`.
16. Publishing an edited result: choose "Update link" to keep the same address, saves and leaderboard.
```

What the viewer sees: a strip below the frame shows the save state ("Saved",
or "Saved on this device · Sign in to keep it" for a guest, whose device save
moves to the account at the first sign-in without replacing account data) and
a leaderboard button when the page declares a board or has used the run or
leaderboard calls. If the page could not load a signed-in viewer's save, the
platform refuses to overwrite it (line 8) and the strip offers Reload.

An organization admin can turn viewer data off in Team Settings ("Saves and
leaderboards on published pages"); pages keep running and the calls return
`null`. A key with the opt-in permissions `spaces:read` and `spaces:manage`
(owner or admin keys) manages links through `/api/external/spaces/*`: list
links, publish HTML, update a link in place, list and restore versions, read
or reset a leaderboard, and read or change the organization setting. No API
writes a viewer's saves or scores. Since 2026-11-20 the same keys also
unpublish or republish a link (`PATCH /spaces/links/<slug>` with
`{"is_published": false}`) and delete one (`DELETE /spaces/links/<slug>`; both
work while Junis Space is switched off), and `GET /spaces/links` returns
`has_more` with the newest link first. Further routes, reached with `junis_api`
(paths are under `/api/external`):

- `GET /spaces/links/<slug>`: one link with `uses_sdk` and the number of
  scores and shared values a reset would delete.
- `PUT /spaces/links/<slug>/team` with `{"listed": true}`: show the link in
  the team gallery. Only the author's own key can list a link someone
  published; any admin key can take it down.
- `POST /spaces/links/<slug>/remixes` with `{"html_content", "title"}`: publish
  edited HTML as a new link recorded as a remix of `<slug>` (read the original
  with `GET https://api.junis.ai/api/publish/public/<slug>`). Saves, scores and
  versions are not copied.
- `GET /spaces/links/<slug>/leaderboard/entries` and
  `DELETE /spaces/links/<slug>/leaderboard/entries/<entry_id>`: list the rows of
  a leaderboard and remove one row (the whole board: `POST .../reset`).

People see the same things at `https://junis.ai/team/published`: their links
(Manage includes "Version history" with restore, also for a link whose chat was
deleted), the team gallery and "Remix in chat", which attaches the page's source
to a new chat without sending it; in a chat that remixes their own page, the
publish dialog can also update the original link instead of making a new one.

#### Check a page before publishing

`junis_api POST /spaces/lint` with `{"html_content": "<the whole page>"}`
(permission `spaces:read`) returns `{ok, findings, more}`: up to five findings,
each with `rule`, `severity` (`error` or `warn`), `message`, `fix_hint` and
`where` (a line number, or `whole document`). `ok` is false when any finding is an `error`. It finds
what breaks in this runtime (browser storage, blocked script hosts, missing
three.js files, a `window.junis` call the SDK never sees or refuses, a score
declaration that hides every score) and warns about text that looks like an API key, without echoing
it. No model call, not billed, nothing stored; 20 checks a minute. A clean
result does not prove the page runs; the publish dialog shows the same check.

#### Run a page in a browser before publishing

Since 2026-11-20 an organization can turn on "Browser checks for HTML pages"
in Team Settings (off by default). Then the chat preview shows "Run checks",
and an automation can run the same check with `junis_api`:

1. `POST /spaces/verify` with `{"html_content": "<the whole page>"}`
   (permission `spaces:manage`; the key must belong to a user, who pays)
   returns 202 with a `job_id`. The same page from the same key within 10
   minutes returns the earlier job with 200; add `"rerun": true` for a new one.
2. `GET /spaces/verify/<job_id>` (`spaces:read`) every 2 seconds until
   `status` is `done`, `failed` or `cancelled`. `result` has the same `ok`,
   `findings` and `more` as the static check, plus `stages` (`boot`, `play`,
   `screens`) and `withheld` (parts that were not judged). Pass failing
   findings to the next chat turn and check the fixed page again.
3. `DELETE /spaces/verify/<job_id>` (`spaces:manage`) cancels; time already
   used is billed.

It opens the page in a disposable Linux Chromium (portrait and landscape, no
internet, no saves or leaderboards) and is billed as sandbox time: $0.0005 a
second, at least $0.001, about $0.013 for a typical 15 to 60 second check and
never more than $0.10. Nothing is billed when it refuses to start: switched
off, no credit, too many checks (3 per key and 6 per organization a minute,
200 per organization a day, 2 at once per organization), or a page that loads
scripts or styles from anywhere except three.js 0.187.0 on jsDelivr
(`offline_dependency`, with the hosts). It cannot see Safari or iOS problems.

#### Give a game-making agent the skeletons

`assets/space-builder/` in this skill holds a Junis skill: `SKILL.md`, the
`window.junis` text above as `references/window-junis.md`, and two tested
skeletons (`skeletons/canvas2d-2.txt` for 2D canvas, `skeletons/three-2.txt`
for three.js 0.187.0). An agent that has it copies a skeleton and writes only
inside its marked regions; input, a fixed time step, pause, the start and end
screens, the best score and the leaderboard button are already in the
skeleton. To use it:

1. Zip the folder so the archive holds `space-builder/SKILL.md` and its
   subfolders (for example `cd assets && zip -r space-builder.zip space-builder`).
2. `import_skill_from_upload` with that ZIP (`@base64:space-builder.zip` on the
   command line), or use "Upload ZIP" at `https://junis.ai/team/skills`.
3. `assign_skill(agent_id, skill_id)` for the agent that makes games or apps.

The skill adds its name and description to that agent's prompt; the files are
read only when the agent opens them. Other agents are unchanged.

## Team roles and who pays

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| Invite at `https://junis.ai/team/members` (needs the inviter's own Basic or Pro monthly plan); switch a role between Admin and Member | yes | yes | no |
| Make someone an owner, or change or remove an owner: not in the web pages or the kit (the pages offer only Admin and Member and never edit or remove an owner row); ask Junis staff at `contact@junis.ai` | no | no | no |
| Remove a member at `https://junis.ai/settings/organization` → Members (never an owner) | yes | yes | no |
| See the member list there | yes | yes | yes |
| Rename the organization in the web app; delete it | yes | no | no |
| Billing Target, Publish, dashboard Settings, install Slack | yes | yes | no |

- The owner pays for everyone by default (Billing Target "Team Owner"), also in
  new and cloned organizations. "Individual Users" bills each member, and stops
  a Public Anonymous widget, which needs the owner to pay.
- Whoever pays sees the spending on their own `https://junis.ai/usage`, By AI
  Team. Dashboard → Usage shows activity, not cost.
- `update_organization` changes name and description (owner or admin of that
  organization). Never send `settings` with `junis_api PUT
  /management/organizations/<id>`: that replaces the whole settings object and
  can switch the graph widget off.

The user's steps for each surface, with their links, are in
[user-steps.md](user-steps.md) ("Putting a squad in front of people").
