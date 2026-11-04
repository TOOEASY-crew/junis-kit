---
type: llm
focus: mock_calls
arm: with-only
---

Look at every toggle_mcp_active call.
A platform created through create_mcp_platform is already active, so no toggle_mcp_active call is needed; calling it is fine only when it states the target state.
PASS if there is no toggle_mcp_active call, or every toggle_mcp_active call passes `is_active` explicitly with the value true.
FAIL if any toggle_mcp_active call omits `is_active` (which flips the state and can switch the new platform off) or passes `is_active` false.
