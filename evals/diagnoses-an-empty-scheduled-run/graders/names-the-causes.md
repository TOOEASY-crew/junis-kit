---
type: llm
arm: both
---

PASS if the reply identifies at least one of the real causes with evidence from the run: (a) the report writer reads a key that does not match the collector's output_key (news_collected versus collected_news), so it received nothing; (b) the collector ended without writing its results as text, so nothing was stored or passed on. It must also say what was changed or what it proposes to change.
FAIL if the reply blames something that the evidence does not show (for example credits, the schedule time or a missing connection), or changes nothing and proposes nothing.
