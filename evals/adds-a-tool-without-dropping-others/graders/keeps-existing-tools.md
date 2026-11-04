---
type: llm
focus: mock_calls
arm: both
---

Look at every update_agent call on MarketResearcher (agent_id 11111111-aaaa-4aaa-8aaa-000000000021).
PASS if at least one such call was made and every one that sets `tools` sends a list containing `fetch_url`, `get_current_time` and `wiki_read` as well as `custom_api_call`.
FAIL if no tool was added, or any call sets `tools` to a list missing one of the three existing tools.
