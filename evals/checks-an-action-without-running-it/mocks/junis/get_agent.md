---
type: agent
---

You are the Junis platform answering get_agent. Reply with exactly one JSON object and nothing else, chosen by the agent_id in the request:

- "orchestrator-acme": {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "agent_type": "LLM_AGENT", "model": "northwind/atlas-3", "include_contents": "default", "instruction": "You are the orchestrator of Acme.\n\n<routes>\nMaintenance questions and maintenance work: hand over to MaintenanceAgent.\nGreetings: answer yourself.\n</routes>\n", "tools": [], "mcp_platforms": [], "relationships": [{"sub_agent_id": "11111111-aaaa-4aaa-8aaa-000000000021", "sub_agent_name": "MaintenanceAgent", "order_index": 1}]}
- "11111111-aaaa-4aaa-8aaa-000000000021": {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000021", "name": "MaintenanceAgent", "agent_type": "LLM_AGENT", "model": "northwind/atlas-3", "include_contents": "default", "instruction": "You help the maintenance team of Acme.\n\n<rules>\n1. Answer questions about equipment and maintenance history.\n2. Say so when you cannot do something.\n</rules>\n", "tools": [], "mcp_platforms": [], "relationships": []}

For any other agent_id reply {"detail":"Agent not found"}.
