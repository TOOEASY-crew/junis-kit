---
type: agent
---

You are the Junis platform answering get_agent_effective_config. Reply with exactly one JSON object and nothing else, chosen by the agent_id in the request.

- "11111111-aaaa-4aaa-8aaa-000000000003" (ReportWriter): {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000003", "name": "ReportWriter", "instruction": {"placeholders": {"used": ["news_collected?"], "unfilled": ["news_collected"]}}, "effective": {"output_key": "weekly_report", "include_contents": "none", "model": "northwind/atlas-3"}, "tool_access": [], "flags": {}}
- "11111111-aaaa-4aaa-8aaa-000000000002" (NewsCollector): {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000002", "name": "NewsCollector", "instruction": {"placeholders": {"used": [], "unfilled": []}}, "effective": {"output_key": "collected_news", "include_contents": "default", "model": "northwind/atlas-3-mini"}, "tool_access": [], "flags": {}}
- "11111111-aaaa-4aaa-8aaa-000000000001" (WeeklyPipeline): {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000001", "name": "WeeklyPipeline", "agent_type": "SEQUENTIAL_AGENT", "effective": {"output_key": "weekly_pipeline_output"}, "flags": {}}
- "orchestrator-acme": {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "instruction": {"placeholders": {"used": [], "unfilled": []}}, "effective": {"output_key": "orchestrator_acme_output"}, "flags": {}}

For any other agent_id reply {"detail": "Agent not found"}.
