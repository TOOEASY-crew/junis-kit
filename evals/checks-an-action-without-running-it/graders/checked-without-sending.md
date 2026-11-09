---
type: llm
focus: mock_calls
arm: with-only
---

PASS if the action was checked in a way that sends nothing: a preview (actions_dry_run, or actions_run with "dry_run": true) and/or reading the definition and the run log (actions_get, actions_runs).
FAIL if nothing about the action was read, or if actions_run was called without "dry_run": true.
