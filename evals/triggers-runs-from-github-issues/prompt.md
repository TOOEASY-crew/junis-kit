---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
tags: [run, composition]
---

GitHub 리포에 새 이슈가 열릴 때마다 우리 Junis 스쿼드(오케스트레이터)가 그 이슈를 보고 문서가 빠진 건지 판단하게 하고 싶어. GitHub Actions 워크플로 파일 내용이랑 GitHub 쪽에 설정할 것만 알려줘. 같은 이슈로 두 번 돌면 안 돼.
