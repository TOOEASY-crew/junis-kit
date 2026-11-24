{
 "session_id": "5e55105e-0000-4000-8000-000000000928",
 "messages": [
  {
   "event_id": "e1",
   "event_type": "user_message",
   "content": "[실행 시각(KST): 2026-09-28 09:00 (Mon)] Run the weekly report.",
   "created_at": "2026-09-28T09:00:04+09:00"
  },
  {
   "event_id": "e2",
   "event_type": "assistant_message",
   "agent": "Orchestrator_Acme",
   "content": "Handing over to WeeklyPipeline for the weekly report.",
   "created_at": "2026-09-28T09:00:09+09:00"
  },
  {
   "event_id": "e3",
   "event_type": "assistant_message",
   "agent": "NewsCollector",
   "content": "",
   "created_at": "2026-09-28T09:02:50+09:00"
  },
  {
   "event_id": "e4",
   "event_type": "assistant_message",
   "agent": "ReportWriter",
   "content": "No news was provided, so there is nothing to report this week. Please send the collected news.",
   "created_at": "2026-09-28T09:03:41+09:00"
  }
 ],
 "total": 4,
 "page": 1,
 "page_size": 50
}
