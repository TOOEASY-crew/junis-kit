# Live operations board — reference front-end

A single HTML page that draws an organization's Knowledge and stays current, with
no server of its own in the data path. It is the smallest working shape of what
the skill reference `skills/junis/references/knowledge.md` describes under
"Live dashboards and custom front-ends".

What it uses (all platform features, nothing custom on the Junis side):

| Step | Call |
| --- | --- |
| A short-lived browser token | your server: `POST /api/external/brain/browser-token` (admin key, `origin` = the page's origin) → the page gets `{token}` from `TOKEN_URL` |
| First draw | `GET /api/external/brain/entities?type=Asset&limit=200&offset=…` for each kind (paged); items carry `canonical_name` (the change feed uses `name`) |
| Stay current | `GET /api/external/brain/changes/stream?since=<ISO taken before the first draw>` read with `fetch()` streaming and `Authorization: Bearer` (the token never goes in the URL — `EventSource` cannot set headers, so the page parses SSE itself); every `changes` event carries its cursor as the SSE id — on `end` or an error, reconnect with `cursor=` / `Last-Event-ID` (never from the start of history) |
| Positions | the `location` attribute (`"lat,lon"`) declared as rule type `geo_point` — the `ops` knowledge-map preset declares it on Asset, Unit, Event, Sensor, Location |

To try it:

1. In the web app, Settings → Publish: add the page's origin to the allowed embed origins.
2. Apply the `ops` preset (`knowledge_map_apply_preset ops`) or extend your map so the kinds you draw have a `geo_point` location.
3. Import or push data: `knowledge_graph_import` for structure, `knowledge_entities_update_attrs` for positions and status as they change.
4. Stand up one endpoint on your server that returns `{"token": …}` from `POST /api/external/brain/browser-token`, set `TOKEN_URL`, and serve `index.html` from that origin.

Things this page does not do on purpose: it never holds an API key, never writes, and does not chat — writes go through your server with the key,
and chat goes through the chat widget. For agent runs as standard events use `GET /api/external/sessions/<id>/events?format=agui`.
