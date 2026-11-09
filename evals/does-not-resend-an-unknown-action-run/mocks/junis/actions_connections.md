{
 "items": [
  {
   "id": "conn-erp-1",
   "name": "erp",
   "kind": "http",
   "config": {
    "base_url": "https://erp.example.com/api/v2",
    "headers": {
     "Authorization": "Bearer {cred:ERP_TOKEN}"
    },
    "allowed_hosts": [
     "erp.example.com"
    ]
   },
   "is_active": true
  }
 ]
}
