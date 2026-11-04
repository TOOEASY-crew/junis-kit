---
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill]
tags: [connections, mcp]
---

Acme의 Researcher 에이전트가 우리 Notion 워크스페이스를 읽을 수 있게 Notion MCP 서버를 붙여줘. 서버는 `npx -y @notionhq/notion-mcp-server` 로 뜨고, 환경변수 NOTION_TOKEN 이 필요해. 토큰은 내가 갖고 있어.
