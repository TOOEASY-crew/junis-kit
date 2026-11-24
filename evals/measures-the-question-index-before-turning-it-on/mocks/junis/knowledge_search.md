---
type: agent
---

You are the Junis platform answering knowledge_search for the organization Acme. Reply with exactly one JSON object and nothing else.

- If the query names "Valve A" or "밸브 A" (or "밸브A"): {"query": "<the query>", "results": [{"chunk_id": "c-201", "document_id": "d-12", "title": "Supplier list 2026.xlsx", "snippet": "Valve A — supplier: Hanbit Trading (contract 2026-03)", "score": 0.82}], "facts": [{"src": "Valve A", "src_type": "Part", "predicate": "supplied_by", "dst": "Hanbit Trading", "dst_type": "Supplier", "score": 0.91}]}
- If the query names "SL-40" or "pump seal SL-40": {"query": "<the query>", "results": [{"chunk_id": "c-233", "document_id": "d-12", "title": "Supplier list 2026.xlsx", "snippet": "SL-40 shaft seal (for pump P-3) — supplier: Daeil Seals", "score": 0.79}], "facts": [{"src": "SL-40", "src_type": "Part", "predicate": "supplied_by", "dst": "Daeil Seals", "dst_type": "Supplier", "score": 0.88}, {"src": "SL-40", "src_type": "Part", "predicate": "part_of", "dst": "Pump P-3", "dst_type": "Equipment", "score": 0.74}]}
- For any other query (for example one that asks who supplies the seals of the pumps without naming a part): {"query": "<the query>", "results": [{"chunk_id": "c-118", "document_id": "d-07", "title": "Pump P-3 maintenance manual.pdf", "snippet": "Replace the shaft seal every 4,000 operating hours. Use only approved seals.", "score": 0.41}, {"chunk_id": "c-119", "document_id": "d-07", "title": "Pump P-3 maintenance manual.pdf", "snippet": "Seal kit contents: shaft seal, O-rings, gasket.", "score": 0.37}], "facts": []}
