{
 "organization_id": "3f2b8c1e-5a4d-4e9b-9c7a-1d2e3f4a5b6c",
 "root": {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "agent_type": "LLM_AGENT", "is_active": true, "is_global": false, "is_org_orchestrator": true},
 "window": {"days": 30, "since": "2026-08-29T23:10:00+00:00", "until": "2026-09-28T23:10:00+00:00"},
 "amounts_included": false,
 "members": [
  {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "runtime_name": "Orchestrator_Acme", "agent_type": "LLM_AGENT", "is_active": true},
  {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000001", "name": "WeeklyPipeline", "runtime_name": "WeeklyPipeline", "agent_type": "SEQUENTIAL_AGENT", "is_active": true},
  {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000002", "name": "NewsCollector", "runtime_name": "NewsCollector", "agent_type": "LLM_AGENT", "is_active": true},
  {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000003", "name": "ReportWriter", "runtime_name": "ReportWriter", "agent_type": "LLM_AGENT", "is_active": true}
 ],
 "usage": {"agents": [
  {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000003", "name": "ReportWriter", "calls": 5, "input_tokens": 62000, "output_tokens": 2000, "models": [{"model_name": "northwind/atlas-3", "calls": 5, "input_tokens": 62000, "output_tokens": 2000, "total_tokens": 64000}], "total_tokens": 64000, "token_share": 0.6107},
  {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000002", "name": "NewsCollector", "calls": 20, "input_tokens": 30000, "output_tokens": 1200, "models": [{"model_name": "northwind/atlas-3-mini", "calls": 20, "input_tokens": 30000, "output_tokens": 1200, "total_tokens": 31200}], "total_tokens": 31200, "token_share": 0.2977},
  {"agent_id": "orchestrator-acme", "name": "Orchestrator_Acme", "calls": 10, "input_tokens": 9000, "output_tokens": 600, "models": [{"model_name": "northwind/atlas-3", "calls": 10, "input_tokens": 9000, "output_tokens": 600, "total_tokens": 9600}], "total_tokens": 9600, "token_share": 0.0916}
 ], "aux": [], "totals": {"calls": 35, "input_tokens": 101000, "output_tokens": 3800, "total_tokens": 104800}},
 "tools": {"rows": [{"agent_id": "11111111-aaaa-4aaa-8aaa-000000000002", "agent_name": "NewsCollector", "tool_name": "claude_web_fetch", "platform_id": null, "calls": 15, "errors": 0, "blocked": 0, "p95_ms": 4210, "top_error_type": null, "last_at": "2026-09-28T00:02:31+00:00", "error_rate": 0.0}], "truncated": false},
 "schedules": {
  "schedules": [{"schedule_id": "sch-77", "name": "weekly-competitor-report", "enabled": true, "target_agent_id": null, "outcomes": {"subagent_empty": 5}, "runs": 5, "skipped_ticks": 0}],
  "outcomes": {"subagent_empty": 5},
  "runs": 5,
  "skipped_ticks": 0,
  "success_runs": 0,
  "problem_runs": 5,
  "judged_runs": 5,
  "problem_rate": 1.0,
  "not_counted": ["stopped", "skipped_no_work", "in_progress", "unknown"],
  "agents_dropped": [],
  "cost_per_success": {"current": {"success_runs": 0}, "previous": {"success_runs": 0, "since": "2026-07-30T23:10:00+00:00", "until": "2026-08-29T23:10:00+00:00"}}
 },
 "interactive_outcomes": {"criteria": "none", "note": "success means no failure signal was seen; a turn counts for every agent that took part in it.", "agents": []},
 "unresolved_children": [],
 "unused_skills": [],
 "recent_changes_needing_review": [],
 "advice": [],
 "highlights": [
  {"code": "token_share_high", "message": "ReportWriter uses 61% of this squad's tokens.", "data": {"agent_id": "11111111-aaaa-4aaa-8aaa-000000000003", "token_share": 0.6107, "total_tokens": 64000}},
  {"code": "schedule_problem_rate_high", "message": "5 of 5 scheduled runs (100%) did not end in success.", "data": {"judged_runs": 5, "problem_runs": 5}}
 ],
 "thresholds": {
  "highlights": {"token_share": 0.5, "token_share_min_agents": 2, "tool_error_min_calls": 10, "tool_error_rate": 0.2, "schedule_min_runs": 5, "schedule_problem_rate": 0.2, "cost_ratio": 1.5, "cost_min_success_runs": 3},
  "limits": {"report_budget_seconds": 15.0, "statement_timeout_ms": 5000},
  "advice": {"unused_min_window_days": 30, "unused_min_agent_runs": 30, "unused_min_history_days": 30, "failing_min_calls": 20, "failing_rate": 0.9}
 },
 "attribution_notes": [
  "Usage and tool calls are matched to agents by name (the saved name and the name used while running). Renaming an agent splits its history: rows before the rename keep the old name and are not counted here.",
  "Copies made for each item of a list, and retries, are counted under the agent they copy. Agents that another agent calls as a tool are counted under their saved name.",
  "Helper work (quality checks, rewrites after a check, format repairs, history summaries) and paid tools are listed apart from the agents. Quality checks, history summaries and paid tools are counted when they ran in a conversation this squad took part in, so a conversation that also used agents outside this squad can add their share here.",
  "Tool error rates come from the tool call record, which keeps a row only for calls that were made. Error kinds are matched by pattern (no HTTP status is stored).",
  "Cost per successful run adds the usage rows written in that run's conversation between its start and five minutes after it ended. Image and video generation rows that store their conversation only in extra details are not included.",
  "Conversation turn outcomes: 'success' means no failure signal was seen — conversation turns have no declared success criteria."
 ],
 "notes": []
}
