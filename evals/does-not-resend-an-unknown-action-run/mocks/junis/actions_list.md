{
 "items": [
  {
   "id": "def-order-part-2",
   "name": "order_part",
   "version": 2,
   "status": "approved",
   "title": "Order a part",
   "description": "Order a spare part for a piece of equipment. Use when maintenance needs a part that is out of stock.",
   "params_schema": {
    "type": "object",
    "properties": {
     "equipment": {
      "type": "string",
      "description": "Equipment tag"
     },
     "part_no": {
      "type": "string"
     },
     "quantity": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
     }
    },
    "required": [
     "equipment",
     "part_no",
     "quantity"
    ],
    "additionalProperties": false
   },
   "fixed_args": {
    "plant": "P1"
   },
   "executor": {
    "method": "POST",
    "path": "/orders",
    "query": {},
    "headers": {},
    "body": {
     "plant": "{plant}",
     "part": "{part_no}",
     "qty": "{quantity}",
     "asset": "{equipment}"
    }
   },
   "effect": "write",
   "idempotent": false,
   "risk": "auto",
   "preconditions": [
    {
     "param": "quantity",
     "op": "lte",
     "value": 50
    }
   ],
   "summary_template": "Order {quantity} × {part_no} for {equipment}",
   "timeout_s": 30,
   "rate_limit_per_hour": 60,
   "approved_by": "u-owner-1",
   "approved_at": "2026-10-30T01:00:00+00:00",
   "tool_name": "action_order_part",
   "connection": {
    "id": "conn-erp-1",
    "name": "erp",
    "kind": "http",
    "is_active": true
   }
  }
 ]
}
