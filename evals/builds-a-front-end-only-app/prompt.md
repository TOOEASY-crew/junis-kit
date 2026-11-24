---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
tags: [partner, app-users, composition]
---

I'm building a personal assistant app for consumers: a React web app, no backend of my own except Supabase Auth for sign-in. Junis should be the whole agent backend. Each of my users needs their own conversations and memory, the assistant should be able to say "I'll check again in an hour" and really come back, and it should be able to message the user first with a morning briefing in their own time zone, but never at night. Tell me exactly how the front end talks to Junis (endpoints, headers, what I must set up once) and what the squad needs. Code sketches are fine.
