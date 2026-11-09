{
 "items": [
  {
   "id": "conn-cmms-1",
   "name": "cmms",
   "kind": "http",
   "config": {
    "base_url": "https://cmms.example.com/api",
    "headers": {
     "Authorization": "Bearer {cred:CMMS_TOKEN}"
    },
    "allowed_hosts": [
     "cmms.example.com"
    ]
   },
   "is_active": true
  }
 ]
}
