---
type: llm
arm: both
---

PASS if the final reply, in Korean, names what was created (a document store and an agent that answers from it), tells the user how to upload the 30 PDFs themselves with a junis.ai link, and states at least one thing that was not verified or not done yet (for example that answers cannot be tested until documents are uploaded and indexed).
FAIL if the reply claims the agent already answers from the manuals, gives no upload step, or shows raw ids as the main way to identify things.
