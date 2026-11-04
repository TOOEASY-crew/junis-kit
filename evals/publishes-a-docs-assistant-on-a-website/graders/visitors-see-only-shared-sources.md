---
type: llm
arm: both
---

PASS if the final reply tells the user which documents anonymous website visitors can get answers from: with Junis Knowledge, only sources marked "Shared publicly" (a per-source public switch), so the articles must be marked; with a RAG datastore instead, the whole store is readable by visitors, so it must hold only these articles.
FAIL if the reply says nothing about what visitors can read, or implies visitors get answers from Knowledge sources without marking them public.
