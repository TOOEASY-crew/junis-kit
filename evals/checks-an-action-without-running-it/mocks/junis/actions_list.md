{
 "items": [
  {
   "id": "def-open-ticket-1",
   "name": "open_maintenance_ticket",
   "version": 1,
   "status": "approved",
   "title": "Open a maintenance ticket",
   "description": "Open a maintenance ticket for one piece of equipment. Use when a fault needs a technician.",
   "params_schema": {
    "type": "object",
    "properties": {
     "equipment": {
      "type": "string",
      "description": "Equipment tag, for example P-101"
     },
     "summary": {
      "type": "string",
      "maxLength": 200
     },
     "priority": {
      "type": "string",
      "enum": [
       "low",
       "normal",
       "high"
      ]
     }
    },
    "required": [
     "equipment",
     "summary",
     "priority"
    ],
    "additionalProperties": false
   },
   "fixed_args": {
    "site": "ulsan-1"
   },
   "executor": {
    "method": "POST",
    "path": "/tickets",
    "query": {},
    "headers": {},
    "body": {
     "site": "{site}",
     "asset": "{equipment}",
     "title": "{summary}",
     "priority": "{priority}"
    }
   },
   "effect": "write",
   "idempotent": false,
   "risk": "auto",
   "preconditions": [],
   "summary_template": "Open a {priority} ticket for {equipment}: {summary}",
   "timeout_s": 30,
   "rate_limit_per_hour": 30,
   "approved_by": "u-owner-1",
   "approved_at": "2026-11-03T02:10:00+00:00",
   "tool_name": "action_open_maintenance_ticket",
   "connection": {
    "id": "conn-cmms-1",
    "name": "cmms",
    "kind": "http",
    "is_active": true
   }
  }
 ]
}
