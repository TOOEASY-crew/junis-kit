# Letting agents answer from documents and data

Read this when agents must use the organization's own material: manuals,
reports, product data, drawings, a database.

## Contents

- Two systems
- Knowledge (Second Brain): is it on, the API, fitting the knowledge map, how
  the graph changes, live dashboards and custom front-ends, reading states,
  asking, limits and cost
- Document stores (RAG)
- Uploading local files
- Writing documents that search well
- Citations

## Two systems

| | Knowledge (Second Brain) | Document store (RAG) |
| --- | --- | --- |
| What it is | Search plus a graph of entities and relations built from the sources | Search over uploaded documents |
| Sources | Files (documents, spreadsheets, images, audio, video, drawings incl. CAD `.dxf` and BIM `.ifc`), web pages, a partner JSON API, a read-only database, an existing document store, imported graphs | pdf, docx, pptx, txt, html, md, json (not `.jsonl`: accepted but never indexed) |
| Who uses it | The orchestrator, automatically | Any agent, through a RAG agent attached as a tool |
| Set up by | On for every organization. You add sources through the API, or owners and admins add them in the web app | You, with platform tools |
| Best for | Questions across many documents, "how is X connected to Y", answers that must cite page and passage | A defined set of documents for one agent or topic; agents that write documents for later runs |

Default to Knowledge when the user wants "an assistant that answers from our
documents". Use a document store when a specific agent needs its own
collection, when agents must upload as they work, or when the user asks for
RAG by name. Website widget visitors get Knowledge only from sources marked
"Shared publicly" and no graph facts. The per-source toggle on the web page
reads "Private" until pressed, and appears only for ready sources that are not
databases. The full rules are in [publishing.md](publishing.md).

## Knowledge (Second Brain)

### Is it on

From an MCP client four platform tools read Knowledge directly:
`knowledge_search(q)` returns passages with citations, `knowledge_answer(question)`
has the platform write the answer over one fixed evidence pool (billed to the
organization like the web app; `scope: "global"` for organization-wide
questions), `knowledge_ask(question)` runs the retrieval planner the
orchestrator uses (routes between lookup, list, multi-hop and global
questions, searches again when the evidence is thin, and answers
`decision: abstain` with `answer: null` rather than guess; prefer it for
multi-fact questions; 404 means the planner is off for this organization,
use `knowledge_answer`), and `knowledge_evidence(question)` returns the
evidence bundle without a generation call, for a client that writes the
answer with its own model (404 when Junis has switched the evidence pack
off).
For a connected database, `knowledge_db_answerable(question)` says whether approved
terms and query templates cover it, `knowledge_db_search(question)` returns the tables
that fit (concepts, keys, top values — no model call), `knowledge_db_describe(table)`
shows one table's concept, key and columns with their sensitivity flags (the step
between search and ask), and `knowledge_db_ask(question)` has the platform write one
read-only SELECT and run it with the agent's own guards (one model call, billed; an
owner or admin key with `brain:manage`; `skipped` / `feature_disabled` until Junis
enables it for the organization, which it does on request).
`knowledge_metrics` / `knowledge_metric_candidates` / `knowledge_metric_create` read
and draft metric definitions (people approve them in the web app),
`knowledge_map_versions` lists knowledge-map versions (rollback is web-only; with
`compare_version` it shows what changed from that version to the current map), and
`knowledge_db_connector_kinds` shows which database kinds the platform can connect
(`oracle`, `mysql`, `mssql`, `tibero`; Tibero's driver is not installed, so it answers
400; 404 `feature_disabled` means connectors are off for this organization).
Connecting happens from the kit too, with the password as a stored secret name or
`@env:` so it never passes through a model ("Connections" below).
Putting data in from the kit: `knowledge_add_file_source(files)` (base64, ≤20 files of
20MB each, about 15MB together per call — "Limits and cost" below)
and `knowledge_add_url_source(url)` queue an ingest; `knowledge_add_text_source(title, content)` adds a note
(a title and markdown text, no file — stored as one `.md` document, same pipeline; a duplicate title answers 409,
then `mode` "replace" or "add"); `knowledge_sources` / `knowledge_source(source_id)`
show the state (queued → reading → organizing → ready | failed) and `knowledge_source_retry(source_id)`
re-runs a failed one; `knowledge_ingest_and_wait(files|url)` does add + poll in one call
(≤120 s, then poll `knowledge_source`). Reading, organizing, the knowledge map (ontology) and the
graph are built automatically after ingest — nothing else to configure.

Every Knowledge endpoint of the External API is also a tool:
- Knowledge map: `knowledge_map`, `knowledge_map_presets`, `knowledge_map_preset_preview`,
  `knowledge_map_apply_preset` (once, before data), `knowledge_map_extend` (add kinds/relations),
  `knowledge_map_cost_estimate`, `knowledge_source_extract_types`, `knowledge_map_versions`.
- Graph reads (no model call): `knowledge_overview`, `knowledge_entities`, `knowledge_graph_neighbors`,
  `knowledge_graph_path`, `knowledge_graph_what_if`, `knowledge_graph_subgraph`, `knowledge_graph_documents`,
  `knowledge_graph_snapshot`, `knowledge_links`, `knowledge_graph_near_misses`, `knowledge_evidence_chunk`;
  an existing graph goes in with `knowledge_graph_preview` → `knowledge_graph_import`.
- Set questions over the graph (no model call; off until an owner or admin switches on "Set-level
  graph questions" on the Knowledge page): `knowledge_graph_around`, and verified graph questions `knowledge_graph_templates` /
  `knowledge_graph_template_create` (draft only) / `knowledge_graph_template_test`
  ("Set questions and verified graph questions" below).
- Sources: `knowledge_report`, `knowledge_source_coverage`, design notes get/set, CSV/XLSX table
  mapping get/preview/set, `knowledge_source_delete` (destructive — confirm first).
- Connections: `knowledge_add_postgres_source`, `knowledge_db_connect` (Oracle · MySQL · SQL Server ·
  Tibero; kinds and driver status from `knowledge_db_connector_kinds`), `knowledge_api_source_test` →
  `knowledge_add_api_source`, `knowledge_api_source_update`. Secrets go in as `password_secret_name` /
  `api_key_secret_name` (an organization secret already in the Junis vault — preferred) or as a direct
  value; with the kit CLI write `@env:VAR` or `@file:path` for the value so it never enters the
  model's context.
- Example values from a database: by default Junis keeps a few sample rows and common column values
  per table so agents read the data correctly; columns named like personal data and values in common
  personal formats (phone numbers, e-mail addresses, card or resident numbers with separators) are masked. Pass `store_example_values: false`
  to `knowledge_add_postgres_source` / `knowledge_db_connect` to keep the database's values out of
  Junis (structure, keys and relations are still read). For a source already connected, an owner or
  admin key with `brain:manage` calls `api PUT /brain/sources/<source_id>/example-values` with
  `{"enabled": false}`: stored examples are removed at once and the database's tables are read again;
  `{"enabled": true}` reads them back. While the database is being read the call returns 409 — try again
  when it finishes. `reread_queued: false` after a change means the re-read did not start; run
  `knowledge_source_retry`. The web shows the same switch on the
  source row ("Stop storing example values").
- Connected-database management: `knowledge_db_state`, `knowledge_db_tables`,
  `knowledge_db_describe` (one table), `knowledge_db_rerun`, `knowledge_db_suggest_names` (billed),
  `knowledge_db_roles` / `knowledge_db_set_roles` (which database role each group of people queries
  with: `{"default": "<role>", "groups": [{"group_id", "role"}]}`, at most 20 groups, roles the
  database already has; the database enforces them), question checks `knowledge_db_checks` (list with
  last pass/fail), `knowledge_db_check_create` (runs the reference SQL once), `knowledge_db_checks_run`
  (billed: one model call per check, at most 50 ids), `knowledge_db_check_delete` (destructive — confirm
  first), query templates `knowledge_templates` / `knowledge_template_requests` /
  `knowledge_template_create` / `knowledge_template_test` (runs the SELECT with the guards, no
  approval), glossary `knowledge_glossary` / `knowledge_glossary_create` / `knowledge_glossary_export`
  (json, ossie or dbt) / `knowledge_glossary_import_preview` → `knowledge_glossary_import` (needs the
  preview's `content_hash`), `knowledge_sql_traces` (shape and status of queries, no values; up to 180
  days, 500 rows).
Approvals — template/glossary/metric status, verified graph questions, map rollback, relation decisions, AI glossary drafts —
are done by people in the web app; they have no tool on purpose.

Build Knowledge from scratch with the kit: pick a preset (`knowledge_map_presets` → preview → apply)
or extend the map → add sources (`knowledge_ingest_and_wait`, or add + poll) → check
`knowledge_report` / `knowledge_source_coverage` → ask (`knowledge_answer`, `knowledge_search`,
`knowledge_evidence`, graph tools). Databases: connect → `knowledge_db_state` until ready →
`knowledge_db_answerable` → `knowledge_db_ask`.
Everything else below is reached with `junis_api`.

Knowledge is on for every organization. `GET /brain/sources` returns
`ff_enabled`; if it is false, Junis switched it off for this organization
(`contact@junis.ai`). Owners and admins also manage it at
`https://junis.ai/team/knowledge`. Only there: importing an existing document
store, drafting glossary terms from a database, approving metrics and
templates, rolling back the knowledge map, renaming or removing kinds in the
knowledge map, resolving review items, Rebuild graph, marking a source "Shared
publicly" for the website widget, recording audio, the "Set-level graph
questions" switch, approving verified graph questions, editing a kind's
property definitions, "Restricted types and relations" (hide a kind or a relation from
everyone but chosen groups; needs access control switched on) and "Let members
browse knowledge" (a read-only page for members). None of these has a tool:
send the user to that page. Connecting databases and
partner APIs, and adding to the map, work from the kit.

Once one source is ready, the orchestrator gets the Knowledge tools by itself:
`brain_search`, `brain_graph_count`, `brain_graph_path`, `brain_graph_whatif`,
`brain_graph_subgraph`, `brain_graph_neighbors` and `brain_graph_documents` (together at most 5 calls
per turn), `brain_ask` where the planner is on, and with a ready database
source `brain_sql` (at most 200 rows per call; absent when the organization
allows approved templates only), `brain_query` (approved templates) and
`brain_db_schema` (schemas over about 40 tables); where "Set-level graph questions" is switched on, `brain_graph_around`,
and `brain_graph_query` once a verified graph question is approved. Do not list any of them in an agent's `tools`: on the orchestrator
a listed name loads even before Knowledge is ready, and a sub-agent gets it
without its usage note. Route knowledge questions through the orchestrator.
After a hand-over the session stays with that sub-agent, which has no
Knowledge tools: ask a knowledge question in a new session. In Slack,
Knowledge answers only the person who installed the app.

### Through the API

Needs a key with `brain:read`. Any change (sources, the knowledge map, graph
imports and the checks before them) needs `brain:manage` and the key's user
to be owner or admin of the organization ([onboarding.md](onboarding.md)).
Use `junis_api` or the `api` command. Paths are under `/brain`.

| Job | Call |
| --- | --- |
| List sources and their state (`public_in_widget` per source) | `GET /brain/sources` |
| One source with its documents and open review items (`review`) | `GET /brain/sources/<id>` |
| Add files | `POST /brain/sources/files` with `{"files": [{"filename": "manual.pdf", "content": "<base64>"}]}`; optional `"mode"` (`replace` or `add`, for file names that already exist), `"design_notes"`, `"reading_notes"`. Local files: "Uploading local files" below |
| Add a web page | `POST /brain/sources/url` with `{"url": "https://…", "title": "…"}` |
| Retry a failed source | `POST /brain/sources/<id>/retry` |
| Remove a source | `DELETE /brain/sources/<id>` (confirm with the user first) |
| Current knowledge map, and presets | `GET /brain/ontology`, `GET /brain/ontology/presets` |
| Change the map | "Fitting the knowledge map" below |
| Search | `GET /brain/search?q=…` |
| Answer with citations | `POST /brain/answer` with `{"question": "…"}` (up to 500 characters; see "Asking"); optional `"scope": "global"` for organization-wide questions, `"as_of": "YYYY-MM-DD"`, `"max_citations"` (up to 52, default 12) |
| Trace a citation to its text and page | `GET /brain/evidence/<chunk_id>` |
| Entities | `GET /brain/entities?q=…`, or `?type=Equipment&limit=200` for 200 entities of a kind and `&offset=200`, `400`, … (up to 5,000) for the rest (or `/brain/graph/snapshot?types=Equipment` in one call); `?entity_id=<id>` adds that entity's relations and mentions (read `entity`, not `items`) |
| How two things are connected | `GET /brain/graph/path?from=…&to=…` (`max_hops` up to 10, `direction`, `predicates`, `as_of`) |
| What surrounds one thing | `GET /brain/graph/neighbors?name=…` (`hops` 1–4, default 2; `direction` `any`, `downstream`, `upstream`, `out`, `in`; `predicates`; `limit` up to 200; `as_of`; `exclude=CL-102,CL-103` does not expand past those tags, for comparing a valve open and closed). An edge carries `qualifiers`, the values stated on that relation (for example `since: 2024-03`), only where the knowledge map declares properties on the relation and a value was read |
| A whole kind at once: which targets it reaches through one relation, and which of its entities have none | `GET /brain/graph/around?entity_type=Line&predicate=carries` (`knowledge_graph_around`; below) |
| Verified graph questions | `GET /brain/graph/templates`; `POST /brain/graph/templates` saves a draft; `POST /brain/graph/templates/<id>/test` with `{"params": {…}}` runs one (below) |
| Documents that mention a thing | `GET /brain/graph/documents?name=…` (`hops` 0–3, default 1; `predicates`, default `contains,on_line`; `limit` up to 100) |
| What is not yet connected | `GET /brain/links?unlinked_only=true` |
| Overview without a model call | `GET /brain/overview` (`q=<topic>` narrows it to a topic; `entities`, `hubs`, `docs` up to 50 each). The same material `/brain/answer` uses with `"scope": "global"` |
| Whole graph as data | `GET /brain/graph/snapshot` (up to 3,000 nodes and 10,000 edges; `meta.truncated` says when cut; `types=Equipment` for one kind; `as_of=YYYY-MM-DD` gives the graph as it was valid then) |
| What changed since a cursor (for a screen that stays current) | `GET /brain/changes?since=YYYY-MM-DD` then `?cursor=<returned cursor>` (`knowledge_changes`); `GET /brain/changes/stream` is the same as SSE for a server that holds a connection. Admin key. See "Live dashboards" below |
| Update attributes of existing entities without re-importing | `PATCH /brain/entities/attrs` with `{"items": [{"type": "Unit", "external_id": "u-17", "attrs": {"location": "37.5,127.0", "status": "moving"}}]}` (`knowledge_entities_update_attrs`; up to 500, no credits, `on_missing: "skip"` to tolerate entities not imported yet) |
| Entities near a point or inside a box (a location attribute declared with rule type `geo_point`, values "lat,lon") | `GET /brain/geo/near?lat=&lon=&radius_km=&attr=location` and `GET /brain/geo/within?bbox=south,west,north,east` (`knowledge_geo_near` / `knowledge_geo_within`; `type=` narrows the kind) |
| Push the change feed instead of polling (a receiver that cannot hold a connection) | `PUT /brain/changes/webhook` with `{"url": "https://…", "secret_name": "<Org Key holding the signing secret>"}` (`knowledge_changes_webhook_set`); every minute the platform POSTs what changed with Standard Webhooks headers; `GET` (`knowledge_changes_webhook`) shows config and delivery status; `DELETE` removes it. The secret is named, never pasted |
| Agent run as standard AG-UI events (RUN_*, TEXT_MESSAGE_*, TOOL_CALL_*, STEP_*, CUSTOM) | `GET /sessions/<id>/events?format=agui&wait=30` after starting the turn with `junis_run` or the chat API (the organization's event replay must be turned on by the Junis team — ask if the route answers 404 `feature_disabled`) |
| The map caps (kinds · relations · properties per kind) | `GET /brain/ontology/limits`; `PUT /brain/ontology/limits` with `{"types", "predicates", "properties", "confirm_cost": true}` (`knowledge_map_limits` / `knowledge_map_set_limits`; admin key) |
| Exact wiring around tags | `GET /brain/graph/subgraph?names=P-101,CL-102&hops=1` (`hops` 0–6; `box=x0,y0,x1,y1` also takes the nodes inside that area of the drawing; `page=W,H` adds pixel positions `xy_px` for a page rendered at that size) |
| Reachability with valves closed | `GET /brain/graph/what-if?from=P-101&to=T-101&closed=CL-102,CL-103&mode=downstream` (`upstream`, `any`; `use_positions=true` also closes valves recorded as normally closed). For a pipe route that must avoid a tag, ask the orchestrator |
| Near-identical tags (a leading 0, a zone number) | `GET /brain/graph/near-misses` |
| Notes on a source | `GET` / `PUT /brain/sources/<id>/design-notes` with `{"design_notes", "reading_notes"}`. Changed `design_notes` make documents already read be extracted again at the next retry or overnight (billed); a database source applies them at its next re-read or daily refresh. `reading_notes` apply only to files read from then on: for a file already read, upload it again with `"mode": "replace"` and the `reading_notes` in that request (it becomes a new source) |
| How much of a source reached the graph | `GET /brain/sources/<id>/coverage` |
| Spreadsheet rows as graph entities (CSV or XLSX in a file or datastore source) | `GET /brain/sources/<id>/table-mapping` shows the saved mapping and the spreadsheet documents; `POST /brain/sources/<id>/table-mapping/preview` with no body proposes one from the columns (no model call, nothing written) or checks a given `{"mapping": …}` against the map; `PUT /brain/sources/<id>/table-mapping` with `{"mapping": …}` saves it (`null` removes it together with the rows it loaded) and the spreadsheets are loaded again from the mapping instead of the extractor, each fact citing its sheet and row. Same mapping language as a JSON API source (`entities[{path,name,type,attrs,locator}]`, `relations[{path,src,dst,predicate,locator}]`, `"locator": "_locator"`); a parent column maps to `part_of`. Kinds and relations must exist in the map (422 says what is missing). A spreadsheet without a mapping is read as before and gets a `table_mapping_suggested` review item holding the proposal |
| A report people can read | `GET /brain/report` (Markdown; the knowledge map with kinds, properties and relations and their counts, sources and documents, connected databases with their tables, join decisions, query templates and glossary names, the review queue, quality counts and embedding models; names and counts only, no values; admin key) |
| Pull a partner's JSON API | Check with `POST /brain/sources/api/test`, then `POST /brain/sources/api` with the same body (`base_url`, `path`, `api_key`, …); `PUT /brain/sources/<id>/api-config` to change it |
| JSON API source: import every item again | `POST /brain/sources/<id>/retry?reimport=true` (JSON API sources only) |
| JSON API source: apply a removal the last sync held back (review item `api_mass_removal_blocked`) | `POST /brain/sources/<id>/retry?confirm_removal=true`, once, after the user agrees |
| Import a prepared graph | `POST /brain/graph/preview` to check, then `POST /brain/graph` with `{"payload": {…}, "external_key": "<stable id>"}` (2,000 entities and 5,000 relations per call); `"mode": "replace"` re-imports one drawing without duplicates (ask the user first) |
| Token for embedding the graph on a website | `POST /brain/embed-token` with `{"embed_domain": "https://site"}` → `embed_url` (details in [publishing.md](publishing.md)) |

### Set questions and verified graph questions

For a question about every entity of one kind ("which lines carry the most
equipment", "which suppliers have no contract"), call
`knowledge_graph_around(entity_type, predicate)` once instead of looping
`knowledge_graph_neighbors` over each entity. Take both names from
`knowledge_map`; an unknown kind, relation or attribute answers 422 with the
names that exist.

- Arguments: `direction` `forward` (the kind is the subject of the relation,
  the default) or `reverse`; `name_contains` narrows the set by name;
  `attribute` with `value` narrows it by one declared property (422
  `attribute_needs_value` without the value); `limit` 1 to 50 targets,
  default 20.
- Result: `sources_total`, `sources_linked`, `sources_unlinked` with up to ten
  `unlinked_examples`, `top_sources` (starting entities with the most links:
  `name`, `count`), `targets` (`name`, `type`, `count`, most linked first),
  `truncated` and `citations`.
- Read the two notes before reporting. `direction_note` says the knowledge
  map declares the relation the other way round and the server read it from
  that side: the numbers are right, describe the direction as the note does.
  `hint` says nothing is linked because the kind is on neither side of that
  relation. That is not "no such relations exist": check the kind and the
  relation in `knowledge_map` and ask again before answering "none".
- 404 `feature_disabled`: the "Set-level graph questions" switch is off (it
  is off by default). Do not retry. Ask the user to have an owner or admin
  turn it on at `https://junis.ai/team/knowledge` (Team Management → Ontology
  Knowledge); the organization does it itself and there is no tool for the
  switch. Meanwhile a small set can be answered with
  `knowledge_graph_neighbors` per entity.

A verified graph question is one such traversal saved under a name, with
parameters, that a person has approved. The same switch gates it.

1. `knowledge_graph_template_create(template_key, title, entity_type,
   predicate, …)` saves a draft. A field is fixed (`value`,
   `name_contains`) or filled by the caller at run time (`value_param`,
   `name_param` with a parameter name); giving both for one field is an
   error. Write `description` and up to five `question_examples` for the
   agent that will choose it. 422 `invalid_template` lists every problem and
   saves nothing. Saving an existing key makes its next version, again a
   draft.
2. `knowledge_graph_template_test(template_id, params)` runs it, drafts
   included, and changes nothing. `bad_params` names what is expected;
   `template_needs_check` means the map no longer declares its kind, relation
   or attribute, so a new version must be saved and approved.
3. A person approves it: `https://junis.ai/team/knowledge` → "Verified graph
   questions". No tool approves. Only then does the orchestrator get it,
   through its `brain_graph_query` tool. `knowledge_graph_templates` lists
   each key's newest version with its `status` (`draft`, `approved`,
   `needs_check`, `retired`). Never report a draft as available to agents.

### Connected databases: definitions, verified queries, checks

When a PostgreSQL source is ready, Junis reads its catalog by itself:
business names for tables, keys, join candidates checked against the data,
and schema changes. People decide the rest at
`https://junis.ai/team/knowledge` (Database setup, Query templates, Glossary,
Question checks). Approving a query template or a glossary term, and
accepting or rejecting a relationship, is only possible there, by a person;
keys can create drafts and read everything below. All of these calls need an
owner or admin key.

| Job | Call |
| --- | --- |
| What was understood (tables, how many relationships wait for a person) | `GET /brain/db/state`, then `GET /brain/db/sources/<id>/tables`; relationships are reviewed on the web |
| Read the source again after the database changed | `POST /brain/db/sources/<id>/rerun` |
| Better table names from the model (one call per source, billed; only names and types are sent) | `POST /brain/db/sources/<id>/suggest-names`; a person presses Use on the web |
| Who sees which rows and columns (database roles per access group) | `GET` / `PUT /brain/db/sources/<id>/roles` with `{"default": "<role>", "groups": [{"group_id": "…", "role": "…"}]}`. The database enforces it; saving checks that each role exists and that the connection account can switch to it |
| Draft a verified query template | `POST /brain/templates` with `{"source_id", "template_key", "title", "sql_template"}` (values only as `$1`, `$2`; optional `params`, `question_examples`, `grain`); try it with `POST /brain/templates/<id>/test` |
| Questions the agents could not answer from a template | `GET /brain/templates/requests` |
| Company definitions (glossary) | `GET /brain/glossary`, draft with `POST /brain/glossary` (`{"term", "definition"}`); export `GET /brain/glossary/export?format=json` (or `ossie`, `dbt`); import with `POST /brain/glossary/import/preview` then `POST /brain/glossary/import` (`{"payload", "content_hash"}`; a dbt semantic layer YAML file goes in as a string) |
| Check that answers stay right | `POST /brain/db/checks` with `{"source_id", "question", "reference_sql"}`, then `POST /brain/db/checks/run`; results in `GET /brain/db/checks` (pass or fail only, never data) |
| Which queries the agents ran | `GET /brain/sql-traces` (shape, tables, row count, status; no values) |

Agents use approved templates through `brain_query`, which runs only the
approved SQL with bound values and marks the answer as verified. Oracle, MySQL,
MariaDB and SQL Server are connected the same way as PostgreSQL
(`knowledge_db_connect` with a read-only account; Tibero is not installed).
Databases the platform cannot connect (BigQuery, Spanner, …) are reached as an
MCP server such as Google MCP Toolbox: turn off its tools marked "Runs any SQL"
and keep the predefined query tools.

### Fitting the knowledge map

The map lists the kinds (`Equipment`) and relations (`feeds`) the graph may
hold: at most 12 kinds, 24 relations and 12 properties per kind. Kinds are
English PascalCase, relations and properties snake_case; names are converted to
these forms, and a name without English letters or digits (a Korean one, for
example) cannot be added. An import whose kinds or relations the map lacks is
refused whole (422 `graph_rejected`, nothing written); a JSON API source still
connects and rejects those items on every sync. So check first, then fit:

1. `POST /brain/graph/preview` (same body as the import) or
   `POST /brain/sources/api/test` (same body as `/brain/sources/api`, result in
   `preview.map_check`). Both write nothing. Read `errors`, `suggestions`
   (`map_additions`, `rename`, `not_addable`, `room`), `existing` (entities that
   attach to ones already in the graph), `recommendations` (a fitting preset)
   and `skippable`. `needs_mapping: true`: save the proposed `mapping` with the
   source, or every item is rejected. From `/brain/graph/preview`,
   `auto_detected: true` means the shape was guessed: send the returned
   `mapping` with `/brain/graph`, or the import is refused.
2. Fit, in this order, and send the same fields with `/brain/graph`,
   `/brain/sources/api` or `PUT …/api-config`:

| Way | How |
| --- | --- |
| Rename onto what the map has | `"rename": {"types": {"Pump": "Equipment"}, "predicates": {"flowsTo": "feeds"}}` |
| Add to the map, if `room` allows | `POST /brain/ontology/extend` with `{"entity_types": [{"name": "Supplier", "description": "…", "properties": ["country"]}], "predicates": [{"name": "supplied_by", "src": "Equipment", "dst": "Supplier", "cardinality": "many"}]}`. Adds only (new kinds and relations, properties a kind lacks); never changes an entry. Over a limit or an unusable name: 422, nothing written. `changed: false`: nothing was new. Use these field names (`properties`, `src`, `dst`) through `knowledge_map_extend` too, whatever its description says: other names are dropped and the relation is saved with both ends open |
| Leave out what does not fit | `"on_unknown": "skip"`; the response counts what was left out. Tell the user |

Property definitions. A kind may declare `property_defs` for its properties
(`knowledge_map` shows them). They are part of the knowledge map and are
saved with the whole map: an owner or admin edits them in the map editor at
`https://junis.ai/team/knowledge`, in each kind's details. No tool here saves
a whole map, and `knowledge_map_extend` only adds kinds, relations and
properties, so put this step in the user's part. They check and count; they
never change a value:

- `type`, `length` and `required` are compared with each value read at ingest
  and the mismatches are only counted in the ingest report. Placeholders such
  as TBD or N/A are not counted as values.
- `key: true` opens a `key_conflict` review item when two entities share a
  value of that property. Nothing is merged: a person resolves it in the
  review queue.
- `unit` is stored with the values kept per source.

Presets. There are two: `pid` (plant drawings plus operating manuals) and `ops` (assets, units, events, sensors and
locations with a `geo_point` location, for live boards).

- Preview first: `POST /brain/ontology/preset/preview` with
  `{"name": "pid", "mode": "merge"}` returns the new map (`spec`), `diff`,
  `errors` and `fits`, and writes nothing.
- If `GET /brain/ontology` shows a `version`, the map is in use: apply with
  `POST /brain/ontology/preset` and `{"name": "pid", "mode": "merge"}`, the
  preset plus what only this map has (422 `map_limit` if that exceeds the
  limits).
- `"mode": "replace"`, the default, makes the map exactly the preset and removes
  the kinds and relations it lacks. Documents already read are then extracted
  again overnight, so their facts of removed kinds disappear, and the
  extraction is billed. Use it only on an empty map or after the user agrees;
  the kit asks before sending it.
- For plant material, apply the preset before the first upload and import
  drawing graphs before the manuals. Otherwise skip presets: the first source
  drafts a map.

### How the graph changes over time

- The map also grows by itself. Every new map version (preset, extension, web
  edit, growth) makes documents already read be extracted again overnight, 50
  per night, billed. Imported graphs and JSON API sources are not re-extracted.
  Rebuild graph at `https://junis.ai/team/knowledge` clears and re-extracts
  every read document at once (billed; imported graphs and JSON API items are
  kept).
- New names attach to existing entities as they are written, and similar names
  of the same kind are merged overnight when a model judges them the same (the
  merged name stays as an alias). `/brain/graph/near-misses` lists look-alike
  tags for a person to judge. No call merges or splits entities or reads the
  question log; `knowledge_map_versions` lists earlier map versions, and
  rolling back to one is done in the web app.
- Database and JSON API sources refresh daily, web pages weekly, files only
  when uploaded again.

### Live dashboards and custom front-ends

A team can build its own screen — an operations room, a control tower, a
map of assets — on top of an organization's Knowledge with the kit and the
External API alone. The knowledge side (map, sources, imports, agents) is
built with the tools above. The screen never holds an API key. It has a
small server of its own that holds the key and does one of two things: it
calls Junis on the screen's behalf, or — so the browser can call Junis
directly — it asks `POST /api/external/brain/browser-token` (admin key,
`origin` = the page's origin, which must be in the organization's allowed
embed origins under Settings → Publish) for a **browser token** each time a
page opens and hands it to the page. The page then calls the read endpoints
itself with `Authorization: Bearer <token>` — the change stream too, read with
`fetch()` streaming rather than `EventSource`, because a token in a URL ends up
in access logs and the server does not accept one there. The
token is read-only, lives at most 15 minutes, is bound to that origin and
to the issuing key, and dies when the key is disabled or the origin is removed.
It opens only the GET read endpoints a screen draws from (snapshot, changes and
its stream, entities, search, overview, the map, graph neighbors/path/around/
subgraph/documents/what-if, links, evidence); answers (`/brain/answer`),
imports, state updates and anything that bills go through the team's server
with the key. Chat stays with the chat widget (its own 30-minute token). Many
visitors share the issuing key's rate limit, so browsers should hold the
stream rather than poll `changes`.

1. **Fit the map first.** The `ops` preset (`knowledge_map_apply_preset ops`)
   is a general operations-board vocabulary — Asset, Unit, Area, Location,
   Event, Sensor, Report, Task — with `location` already declared as
   `geo_point`; extend it with the domain's own kinds. A map larger than the
   defaults (12 kinds, 24 relations) needs `knowledge_map_limits` →
   `knowledge_map_set_limits` with `confirm_cost: true` after showing the
   user the estimate the first call returns.
2. **Load the structure once** with `knowledge_graph_import` (an
   `external_id` per entity — that key is how state updates find them later).
3. **Draw once, then follow changes.** `knowledge_graph_snapshot` for the
   first render; then `knowledge_changes` with the returned `cursor` (call
   again at once while `has_more` is true; keep the cursor across restarts).
   The server can instead hold `GET /api/external/brain/changes/stream`
   (SSE: `event: changes` with the same body and `id:` = cursor; `: keepalive`
   while quiet; `event: end` after five minutes — reconnect with the
   `Last-Event-ID` header, which `EventSource` sends by itself). One open
   stream counts as one request against the key's rate limit; at most 20 per
   organization at a time.
   A receiver that cannot hold a connection (a serverless function) registers
   a signed webhook instead (`knowledge_changes_webhook_set`; the signing
   secret is an Org Key the user creates in the web app — pass its name).
   Deletions are not in the feed (a source removed, a `replace` re-import):
   redraw from `knowledge_graph_snapshot` at each `end` or on a timer. The
   feed never skips a slow import: its cursor stops at the oldest write still
   in progress (`watermark` in the reply).
4. **Push fast-changing state** with `knowledge_entities_update_attrs`:
   positions, levels, statuses — up to 500 entities per call, no document,
   no embedding, no credits. Only attributes declared on that kind are kept
   (`dropped_attrs` counts the rest), values are stored as strings, the
   newest wins. An entity that was never imported is a 422 unless
   `on_missing: "skip"`. Updates appear in `knowledge_changes` as `updated`.
   The search card of that entity is rebuilt at the next import, not on each
   update; graph reads, entity reads and attribute evidence see the new
   value at once.
5. **Ask through the squad.** The orchestrator with `brain_*` tools answers
   questions over the same graph (`junis_run`), and an agent `output_schema`
   can force a JSON card the screen renders. Typed operations on outside
   systems go through Actions ([actions.md](actions.md)).
6. **Types for the client** come from `GET /api/external/openapi.json`
   (API key; External routes only) — feed it to an OpenAPI client generator.

7. **Map screens**: declare the location attribute with rule type
   `geo_point` (values `"37.5665,126.9780"`), import or update it like any
   attribute, then ask `knowledge_geo_near` / `knowledge_geo_within` for
   "what is within 5 km" or "what is inside this box" — no model call, and
   the browser token may call both.
8. **Standard agent events**: a screen that uses an AG-UI client renders the
   run from `GET /api/external/sessions/<id>/events?format=agui` (RUN_STARTED,
   TEXT_MESSAGE_*, TOOL_CALL_*, STEP_*, RUN_FINISHED; Junis-only events such as
   a tool confirmation arrive as `CUSTOM` named `junis.<kind>`). Start the turn
   with the chat API, then attach to the events of the same session.

A working single-file example of all of this is `examples/live-dashboard/`
in the kit repository (token endpoint, paged first draw, SSE follow, map dots
from `location`).

What this does not give: writes or chat from the browser token (writes go
through the team's server with the key; chat through the widget) and
approvals — those stay with a person in the web app.

### Reading states

| Object | States |
| --- | --- |
| Source | `queued`, `reading`, `organizing`, `ready`, `failed`, `paused_budget` |
| Document | `queued`, `indexed`, `failed`; graph state `pending`, `done`, `failed`, `failed_final` |

A source is completely ready when it is `ready` and every document is
`indexed` with graph `done`. A long document takes on the order of fifteen
minutes. `paused_budget` means credits ran out or the source used its reading
budget: add credits if needed, then retry the source; reading continues where
it stopped.

### Asking

- Send the user's question to `/brain/answer` once, exactly as they wrote it
  (up to 500 characters). Do not split or rephrase it: several parts are
  answered in one reply, parts without evidence come back in `limits`, and the
  server looks again by itself when the first answer is weak. Only a question
  longer than 500 characters is split, and then each part names its tag or
  line ("that valve" means nothing to the server).
- Conversational follow-ups ("and the one before it?") go to the orchestrator
  with `junis_run`.
- `status` in the answer: `ok`, `partial` (cited but incomplete),
  `no_evidence`, `no_results`. `limits` says in one sentence what the evidence
  does not cover. Report `partial` and `no_evidence` as such; do not fill the
  gap from general knowledge. A `partial` may carry a `reason`
  (`value_not_stated`, `illegible`, `conflicting_evidence`); unanswered
  questions may carry `suggestions` (similar tags) worth offering.
- For complete lists ("all pumps on line 3") use the graph endpoints, which are
  deterministic, rather than an answer.
- If `/brain/answer` fails with 402, 502 or 503, `/brain/search` still works.

### Limits and cost

- 20 files per upload. One API request is at most 20 MB of JSON, and base64
  adds a third, so send about 15 MB of files per request; larger files go
  through the web page (20 MB per file, 100 MB per upload).
- Uploading a file name that exists needs `"mode"` (`replace` or `add`), otherwise 409 listing the duplicates.
- Reading and building the graph costs credits; searching is cheap; each
  answer is a billed model call (see the pricing page for the rate), and a
  weak first answer may get a second lookup and model call, also billed.
- Questions, answers and searches are logged, encrypted, for about six months.

## Document stores (RAG)

### Steps

1. `create_datastore(display_name)`. One store per kind of data.
2. Upload: `upload_rag_document(datastore_id, files)` where each file is
   `{"filename", "content": "<base64>"}`. At most ten files and 10 MB per file
   per call; upload one call after another, not at once. Local files:
   "Uploading local files" below.
3. `get_upload_status(upload_id)` until `completed`. Indexing takes minutes.
4. Create the RAG agent: `agent_type="RAG_AGENT"`, a Gemini model
   ([models.md](models.md)), `rag_tools=["rag_<datastore_id>"]`,
   `include_contents="none"`, a short instruction.
5. Give it to the agent that needs it: add `agent_tool:<RAG agent name>` to
   that agent's `tools`.
6. In that agent's instruction, say which store answers which questions and
   what to do when nothing is found.
7. Test: ask something only the documents can answer.

If the user has no documents ready, create the empty store and the agent
anyway, and put "upload documents" with `https://junis.ai/team/rag-knowledge`
in the user's checklist. An empty store returns empty answers.

Do not upload `.jsonl` or files whose names start with `existing_`: they are
accepted but never indexed. Convert them to `.json` or `.md`. PDF and DOCX
files over 10 MB, up to 50 MB, go through the web page; other types stop at
10 MB.

### Rules

| Rule | Otherwise |
| --- | --- |
| Exactly one `rag_<datastore_id>` in `rag_tools` | More than one is refused; none or a malformed entry is accepted and the agent retrieves nothing |
| No other tools, no MCP, no web search on a RAG agent | Refused or ignored |
| Attach as a tool, never as a sub-agent | Hand-over to a RAG agent does not work |
| Keep the RAG agent on a Gemini model | A later change to another family is accepted and retrieval stops silently |
| Never add `search_rag_documents` to the RAG agent itself | It replaces the real retrieval |

### Agents that write to a store

An agent with `upload_rag_document` in its `tools` can save its own results:

```
upload_rag_document(datastore_name="<exact store name>", file_name="report-2026-09-29.md", content="<markdown>", overwrite=False)
```

- The name must match a store's display name exactly. Without a match in this
  organization, the tool uses a same-named store in another organization the
  running user administers, and only then creates a new store. A typo therefore
  creates a stray store; give the exact name in the instruction.
- A file name that already exists in the store and was last uploaded more than
  24 hours ago is refused unless `overwrite=True`; re-uploading the same name
  within 24 hours passes. Put the date in file names so each period gets its
  own file instead of reusing a stale name. In the same run, a second upload
  of the same name, or of identical content under another name, is skipped.
- Agents that have a RAG agent as a tool also get `search_rag_documents` to
  search by upload date. The dates are upload dates, not dates written in the
  documents.

### Replacing and removing

- Uploading a file name that exists replaces that document. To remove one,
  `delete_datastore_file` needs a key with `rag:delete`, which the default key
  lacks ([onboarding.md](onboarding.md)). A failed upload is retried on the
  web page, or uploaded again.
- `delete_datastore` removes the store and all its documents for good, and is
  refused with 409 while an agent uses it unless forced. Confirm with the user
  and detach the agents first.

## Uploading local files

Never paste base64 into a tool call: a few megabytes become millions of
characters in the conversation.

- With a shell, the kit reads the file (`@base64:` works anywhere in the JSON):
  `node <skill>/scripts/junis.mjs tools call knowledge_add_file_source --json '{"organization_id":"<uuid>","files":[{"filename":"a.pdf","content":"@base64:./a.pdf"}]}'`
  (or the raw endpoint: `api POST /brain/sources/files --json '{"files":[…]}'`).
  The same form serves a document store:
  `node <skill>/scripts/junis.mjs tools call upload_rag_document --json '{"organization_id":"<uuid>","datastore_id":"<id>","files":[{"filename":"a.md","content":"@base64:./a.md"}]}'`.
- Without a shell, an owner or admin uploads at
  `https://junis.ai/team/knowledge` or `https://junis.ai/team/rag-knowledge`
  (both pages need that role).

## Writing documents that search well

- One topic per document; a title and headings that use the words people will
  search for.
- Put dates, product names and identifiers in the text, not only in the file
  name.
- Markdown or clean text beats scanned images.
- For Knowledge, short notes to the reader help: what the document set is,
  what the identifiers mean (`design_notes`), and what to copy exactly such as
  titles and numbers (`reading_notes`). Set them with the first upload.

## Citations

Tell agents that answer from documents to cite: document title, and page or
section where available, after each claim, and to say "not found in the
documents" rather than answering from general knowledge. Knowledge answers
carry citations with identifiers that `/brain/evidence/<chunk_id>` resolves to
the exact passage.
