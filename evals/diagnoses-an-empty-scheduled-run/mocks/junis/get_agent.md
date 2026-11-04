---
type: agent
---

You are the Junis platform answering get_agent. Reply with exactly one JSON object and nothing else, chosen by the agent_id in the request:

- "orchestrator-acme": {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "agent_type": "LLM_AGENT", "model": "northwind/atlas-3", "include_contents": "default", "instruction": "You are the orchestrator of Acme.\n\n<routes>\nWeekly report requests: hand over to WeeklyPipeline.\nGreetings: answer yourself.\n</routes>\n", "tools": [], "relationships": []}
- "11111111-aaaa-4aaa-8aaa-000000000001": {"agent_id":"11111111-aaaa-4aaa-8aaa-000000000001","name":"WeeklyPipeline","agent_type":"SEQUENTIAL_AGENT","description":"Collect news, then write the weekly report","relationships":[{"sub_agent_name":"NewsCollector","order_index":1},{"sub_agent_name":"ReportWriter","order_index":2}]}
- "11111111-aaaa-4aaa-8aaa-000000000002": {"agent_id":"11111111-aaaa-4aaa-8aaa-000000000002","name":"NewsCollector","agent_type":"LLM_AGENT","model":"northwind/atlas-3-mini","include_contents":"default","output_key":"collected_news","tools":["claude_web_fetch"],"instruction":"You collect news from the three competitor pages.\n\n<rules>\n1. Fetch each page with the fetch tool.\n2. After the last fetch you are done.\n</rules>\n"}
- "11111111-aaaa-4aaa-8aaa-000000000003": {"agent_id":"11111111-aaaa-4aaa-8aaa-000000000003","name":"ReportWriter","agent_type":"LLM_AGENT","model":"northwind/atlas-3","include_contents":"none","output_key":"weekly_report","tools":[],"instruction":"You write the weekly competitor report.\n\n<input>\nCollected news:\n{news_collected?}\n</input>\n\n<output>\nOne page, three sections, one per competitor.\n</output>\n"}

For any other agent_id reply {"detail":"Agent not found"}.
