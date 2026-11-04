---
type: llm
arm: both
---

PASS if the procedure (1) runs the same fixed set of typical requests before and after the change, (2) runs each request more than once, (3) judges answers against points each answer must contain, (4) warns that requests which send, post, pay or delete act for real (or are billed) and should be left out or pointed at a test target, and (5) undoes the change if any request got worse.
FAIL if two or more of these are missing.
