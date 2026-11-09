# Personality, memory and the wiki

Read this when the user wants to change how the squad speaks and thinks, what
it remembers about a person, or the shared notes it keeps.

## Contents

- Three layers
- Soul and identity
- Memory
- Wiki
- Typical requests

## Three layers

| Layer | Belongs to | What it holds | Reaches the model |
| --- | --- | --- | --- |
| Soul and identity | The organization | `soul.md`: values and way of reasoning. `identity.md`: tone and persona. | Built into the orchestrator's instruction |
| Memory | Each user | A profile and a layered diary of what was discussed | Appended to each orchestrator turn for that user |
| Wiki | The organization | Markdown documents, by key | Only when an agent calls a wiki tool |

Sub-agents receive none of these by themselves. A sub-agent's tone comes from
its own instruction.

## Soul and identity

| Job | Tool |
| --- | --- |
| See which files exist | `get_soul_directory` |
| Read one | `get_soul_content(file_key)` with `soul.md` or `identity.md` |
| Small change | `patch_soul_content(file_key, old_string, new_string)` |
| Full rewrite | `update_soul_content(file_key, content)` |

- Needs the owner or admin role.
- Braces are stored as parentheses. Read the file first and copy `old_string`
  from what you read.
- A change applies from the next request, also in open sessions. Earlier
  replies still show the old style, so test in a new conversation.
- Owners and admins can also change soul and identity by asking the
  orchestrator in chat (`update_soul`, `update_identity`).
- `soul.md` is for principles: what the organization values, how to weigh
  trade-offs, what it never does. `identity.md` is for expression: tone,
  vocabulary, how to address people, language. Keep both short; they are part
  of every orchestrator call.
- These files set character, not procedure. Put steps and rules in agent
  instructions.

## Memory

| Tier | Content | Written by |
| --- | --- | --- |
| `user` (`user.md`) | The person's profile: role, preferences, standing instructions | The user, the orchestrator, or you |
| `d0` | Lasting truths: what the user asked to remember, and one dated line of insight per day | The orchestrator (`save_to_eternal_memory`) and the nightly consolidation of the daily log |
| `d1` | Daily log: the first 200 characters of each request and 300 of each answer | The platform, after every turn (not for anonymous website widget turns) |
| `d30`, `d90`, `d365` | Monthly, quarterly, yearly summaries | The platform, on the first night of each month, quarter and year |

Each orchestrator turn receives the profile, `d0`, the last two days of `d1`
and the latest monthly, quarterly and yearly summaries.

| Job | Tool |
| --- | --- |
| List a user's memory files | `get_memory_directory` |
| Read one | `get_memory_content(memory_type, file_key)` |
| Small change to the profile | `patch_memory_content(old_string=…, new_string=…)` |
| Rewrite the profile | `update_memory_content("user", "user.md", content)` |

- Only `user.md` can be written from here. The other tiers are read-only.
- Without `user_id` the key owner's own memory is meant. Another person's
  memory is reachable only for accounts the organization provisioned, with the
  partner key and `junis_api`: `GET /management/memory/directory?user_id=<id>`,
  `GET /management/memory/<type>/<file_key>?user_id=<id>`, and for the profile
  `PUT /management/memory/user/user.md` or `POST …/patch` with `user_id` in the
  body ([partner-accounts.md](partner-accounts.md)).
- Pass arguments by name. The third positional argument of
  `patch_memory_content` is `replace_all`.
- File keys: `user.md`, `memory_d0.md`, `memory_YYYYMMDD.md`,
  `memory_YYYYMM.md`, `memory_YYYYQn.md`, `memory_YYYY.md`.
- Other members change their own profile or lasting facts by asking the
  orchestrator in chat ("remember that I prefer short answers").
- With an organization-level key even the key owner's own memory needs the
  owner or admin role.
- The user sees their memory at `https://junis.ai/memory` (Basic or Pro plan).
  Editing there may be switched off for the account; `patch_memory_content`
  always works for the profile.

Every run is logged to the acting user's daily memory, including test runs and
runs sent through the API. Anonymous turns on the public website widget are
the exception: they never read or write the owner's memory. For squads called
by programs with data about other people, this matters: that data accumulates
in the key owner's memory and is fed into later prompts. Such integrations
should act on behalf of dedicated accounts
([partner-accounts.md](partner-accounts.md)). Tell the user when you see this
pattern.

## Wiki

Platform tools do not include the wiki. Use the API, the orchestrator or the
web page.

| Way | How |
| --- | --- |
| Through the API (key with `wiki:read` / `wiki:manage`, owner or admin) | `api GET /management/wiki`, `GET /management/wiki/content?file_key=…`, `GET /management/wiki/search?q=…`, `PUT /management/wiki/content` `{"file_key", "content", "annotation", "expected_version", "summary"}`, `POST /management/wiki/content/append` (existing pages only), `DELETE /management/wiki/content?file_key=…` |
| History of a page (where Junis has version history on; `status: "disabled"` otherwise) | `GET /management/wiki/versions?file_key=…` lists versions, `GET /management/wiki/versions/content?file_key=…&version=N` one version, `GET /management/wiki/versions/diff?file_key=…&from=…&to=…` the difference, `POST /management/wiki/versions/restore` `{"file_key", "version"}` puts one back (the kit asks first), `GET /management/wiki/deleted` lists removed pages. Agents read old versions with `wiki_history` and `wiki_read(version=N)`. |
| From the command line, safely | `wiki get <file_key> [--out f]` (content, version, sha256), `wiki put <file_key> --file f\|--text=s [--annotation s] [--summary s] [--min-chars n]` — refuses an empty body, backs up the current page under the kit home (`backups/wiki/`), writes with the version it read (409 → `conflict` with the backup path), reads back and compares; replacing an existing page from an agent (no terminal) needs `--yes` after the user agrees, a new page does not — and `wiki append <file_key> --file f\|--text=s` |
| Through the orchestrator | Send a request: `run orchestrator "Add a wiki page 'pricing/2026' with the following content: …"` |
| By the user | `https://junis.ai/team/wiki` |
| By a sub-agent | Add the wiki tools it needs to its `tools` |

- Wiki tools work only when the acting user is an owner or admin of the
  organization; otherwise they answer `denied`. A scheduled run acts as the
  schedule's creator.
- Keys are paths such as `pricing/2026`, without leading or trailing slash and
  without `..`. Each page has a one-line annotation, which is what agents see
  in the index, so write it as a description of when to read the page.
- A page holds up to 100,000 characters. When `wiki_append` goes beyond that,
  the whole body moves to an archive page `<key>/archive/<time>` and the page
  keeps its header and the latest ~20,000 characters. `wiki_read` returns at
  most 20,000 characters per call (`offset`, or `tail=true` for the end).
- `wiki_append` adds to an existing page only; on a missing page it fails and
  says to use `wiki_create`. For a running log, give the agent `wiki_create`
  as well and say in its instruction to create the page when the append
  reports it missing, or create the page once before the first run
  (`PUT /management/wiki/content` with a heading and an annotation; the kit
  asks the user first because PUT can overwrite). To change a page nobody
  else may have edited meanwhile, read it first and send its `version` as
  `expected_version`: a stale one is refused with 409 `wiki_version_conflict`
  instead of overwriting.
- Agents cannot delete pages. Delete through the API above or in the web app.
- Every write is recorded in the organization's audit log.

Use the wiki for things agents should look up when needed: procedures, price
lists, decision records, running logs of a recurring job. Use soul for what
should colour every answer, and memory for what concerns one person.

## Typical requests

| The user says | Do |
| --- | --- |
| "Make it sound more formal" | Patch `identity.md`. Test with a new conversation. |
| "It should always put customer safety first" | Patch `soul.md`. |
| "Remember that I am the marketing lead" | Patch the user's `user.md`. |
| "Keep a log of what the weekly job found" | Give the job's last agent `wiki_append` and `wiki_create`, name the page in its instruction, and say to create it when the append reports it missing. |
| "What does it know about me?" | Read the memory directory and summarize; point to `https://junis.ai/memory`. |
