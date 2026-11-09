---
type: llm
focus: mock_calls
arm: with-only
---

PASS if the run log was read before anything else was done about the run: a call to actions_runs or actions_run_get.
FAIL if neither was called.
