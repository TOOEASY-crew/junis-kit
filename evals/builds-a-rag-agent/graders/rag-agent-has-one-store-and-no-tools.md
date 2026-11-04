---
type: tool_used
tool: mcp__plugin_junis_junis__create_agent
input_match: '^(?=[\s\S]*"agent_type"\s*:\s*"RAG_AGENT")(?=[\s\S]*"rag_tools"\s*:\s*\[\s*"rag_[^"]+"\s*\])(?![\s\S]*"tools"\s*:\s*\[\s*")(?![\s\S]*"mcp_platforms"\s*:\s*\[\s*")'
min: 1
arm: with-only
---
