# Capabilities

What the Junis platform does, in more detail than the README table. Counts are as of November 2026.
The kit reads every list live, so new models and tools work without a kit update.

## Platform

| Area | What the platform does |
| --- | --- |
| Knowledge | Reads files (documents, spreadsheets, images, audio, video, CAD `.dxf` and BIM `.ifc` drawings) and web pages without configuration into a knowledge map (an ontology of kinds and relations) and a graph. Partner JSON APIs and prepared graphs can be added. Answers cite document, page and passage, and each citation links back to the passage it quotes. |
| Graph queries | Neighbors, paths, subgraphs, documents that mention a thing, look-alike names and a whole-graph snapshot, without a model call. For piping and instrument drawings, a what-if tool closes valves on the piping graph and reports what is cut off and the nearest valves that isolate a pump. Answers, paths and neighbor queries take an `as_of` date and use the facts valid then. |
| Databases | PostgreSQL, Oracle, MySQL or MariaDB, and SQL Server connect as Knowledge sources through an account you give read-only rights. Junis writes a document per table, agents query them with single SELECT statements that a guard checks before they run, and every query leaves a trace without values. |
| Semantic layer (PostgreSQL only) | Reads column statistics, learns business names for tables and keys, checks join candidates against the data and flags schema changes for review. People approve query templates, glossary terms and metrics; agents answer through the verified templates. An answerability check says up front whether approved terms cover a question. Database roles per group of people decide which rows and columns each person can query, enforced by PostgreSQL with `SET LOCAL ROLE`. |
| Squads | An orchestrator routes each request to sub-agents, which can run in sequence, in parallel or in a loop; each agent's result is saved under a name that later agents read. Squads can call other squads, ask the user a question in the web chat and stop a loop when a reviewer is satisfied. |
| Squad as code and versions | A squad exports to one JSON file that you keep in your repository, plan against the live organization and apply. Every create and update of an agent is kept; a rollback can be previewed, then restored. |
| Runs and audit | Runs start on a schedule, from a Slack mention, from GitHub Actions or any CI job, or through the External API. Every tool call is recorded with its status, so a run that did nothing shows which call failed or was blocked. |
| Actions | Typed operations on your own systems: an HTTP API (https only, limited to the hosts you list, secrets referenced by name), a signed webhook (Standard Webhooks v1) or one pinned tool of a registered MCP server. Each has a name, a description, JSON Schema parameters, fixed values the model cannot change, an effect (read, write, destructive) and a risk level (runs at once, one person confirms, two different admins confirm). A person approves every version in the web app before any agent can use it; approved actions are assigned to agents as tools, run from the web app or through the API. Runs can carry an idempotency key, are retried only when the action is marked safe to repeat, and are all recorded, including refusals. OpenAPI documents import as drafts, and a simulated connection tries the whole flow with nothing connected. |
| Publishing | A chat widget for your website whose knowledge search sees only the sources you mark public, on the domains you allow. |
| Wiki | Markdown pages that agents read and write, with version history, diffs, restore and an audit log. Nine wiki tools. Pages hold up to 100,000 characters; appends beyond that move older text to an archive page. |
| Memory per user | A profile, the facts the user asks to keep, a daily log of requests and answers, and summaries built each month, quarter and year. Each orchestrator turn receives the profile, those facts, the last two days and the latest summaries. Agents search past conversations by keyword and date range, and document stores by upload date. |
| Identity | The organization's values and tone (its "soul") shape every orchestrator answer. |
| MCP servers | 14 available to every organization: GitHub, Notion, Salesforce, Sentry, Shopify, WordPress, Ghost, Threads, n8n, PostgreSQL, Firecrawl, Naver DataLab, Binance and Junis's own management server. An organization can also register any remote MCP server. |
| Apps | 25 connected with OAuth or an API key: Gmail, Slack, Google Docs, Drive, Sheets, Slides and Maps, GitHub, Linear, LinkedIn, Instagram, YouTube, Reddit, Shopify, Supabase, Apollo, Hunter, Apify, Amazon product data and others. |
| Your computer | Commands, files and a browser through `npx junis` (Node.js 20.12 or newer on that computer). Device tools can be marked as required, so a run on an offline computer reports the missing tool. |

## Built-in tools

86 built-in tools, including:

| Area | What agents get |
| --- | --- |
| Code | An isolated Linux sandbox (shell, files, Jupyter, Chromium, ffmpeg) and programmatic tool calling: a Python script that calls the agent's other tools in one step |
| Research | Web search and page reading at four depths, from quick to exhaustive |
| Documents | Document skills for docx, pdf, pptx and xlsx files |
| Media | Image, video, audio and 3D generation |
| Decisions | Yes/no decisions, classification, scoring, reranking and claim verification with probabilities, up to 200 items per call |
| People in the loop | A question card in the web chat, and per-tool approval lists |
| Payments | USDC payments between agents (x402, EIP-3009 on Base) |
| Simulation | A simulated community that reacts to a text over rounds and can be interviewed (needs a key the organization registers) |

The chat models are listed in the README.
