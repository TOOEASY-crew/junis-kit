---
type: llm
arm: with-only
---

The server in this task is command-based (`npx`), and the platform answers 403 `local_mcp_admin_only` to any create_mcp_platform call that is local or sends command/args: only Junis administrators set those up.
PASS if the agent makes at most one such local create_mcp_platform call, and the final reply, in Korean, tells the user that Junis (support or contact@junis.ai) has to set up this command-based server, or offers a remote Notion server if one is known.
FAIL if the agent repeats the local create after the 403, resends the server as a remote platform without a server address, or claims the Notion server was created or connected.
