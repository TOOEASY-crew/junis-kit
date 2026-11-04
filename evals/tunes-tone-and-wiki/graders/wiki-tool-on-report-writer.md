---
type: llm
focus: mock_calls
arm: with-only
---

Look at the update_agent and patch_agent_instruction calls.
PASS if the ReportWriter agent (id 11111111-aaaa-4aaa-8aaa-000000000031, not the orchestrator) was given a wiki tool such as wiki_append (or wiki_update/wiki_create) in its tools, and its instruction was patched (not replaced with update_agent's "instruction" field) to write the report to a named wiki page key after producing it.
FAIL if the wiki tool was put on the orchestrator instead, if the instruction was replaced whole through update_agent, or if no wiki tool was given at all.
