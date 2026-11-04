---
type: llm
focus: mock_calls
arm: with-only
---

PASS if some create_agent, update_agent or patch_agent_instruction call puts "agent_tool:<name of the RAG agent>" into another agent's tools (or the orchestrator's). FAIL if no call does.
