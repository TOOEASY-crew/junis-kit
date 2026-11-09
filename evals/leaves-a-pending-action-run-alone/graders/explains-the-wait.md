---
type: llm
arm: both
---

PASS if the reply says the earlier run has not been executed because it is waiting for a person's approval in the Junis web app, tells the user where to approve it (or to have an owner or admin approve it), and makes clear the action was not run a second time.
FAIL if the reply says the action was run again, that a ticket was created, that the earlier run failed, or proposes sending a new run as the way to get the ticket.
