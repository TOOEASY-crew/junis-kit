---
type: llm
focus: mock_calls
arm: with-only
---

wiki_append only adds to a page that already exists; on a missing page it fails.
Look at the calls that set up ReportWriter (update_agent, patch_agent_instruction) and any junis_api call.
PASS if at least one holds: ReportWriter's tools include wiki_create (or wiki_update) besides wiki_append; or a junis_api PUT /management/wiki/content call created the page; or ReportWriter was given only wiki_create/wiki_update (no append).
FAIL if ReportWriter was given wiki_append as its only wiki tool and no call created the page.
