---
type: regex
target: mock_calls
pattern: '(ntn_|secret_)[A-Za-z0-9]{8,}'
match: not_contains
arm: with-only
---
