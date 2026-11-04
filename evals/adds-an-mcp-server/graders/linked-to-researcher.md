---
type: llm
focus: mock_calls
arm: with-only
---

Look at every link_agent_mcp call.
PASS if there is no link_agent_mcp call, or every call links Researcher (agent_id 11111111-aaaa-4aaa-8aaa-000000000012) to a platform_id that an earlier create_mcp_platform or list_mcp_platforms reply actually returned.
FAIL if any link_agent_mcp call uses a platform_id that no reply returned, or links the orchestrator instead of Researcher.
