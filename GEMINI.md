# Junis extension

This extension adds the `junis` MCP server, which operates the Junis
multi-agent platform (junis.ai, 주니스): connecting an account, building and
tuning agent squads, running them, reading results and improving them.

The server starts with a few discovery tools (`junis_status`, `junis_connect`,
`junis_use_organization`, `junis_find_tools`, `junis_describe_tool`,
`junis_read_tool`, `junis_call_tool`, `junis_run`, `junis_run_status`,
`junis_api`, `junis_lint_instruction`). Platform tools such as `list_agents` or
`create_agent` are found with `junis_find_tools`. Reads go through
`junis_read_tool` and changes through `junis_call_tool`. A call that deletes,
replaces a whole text, credentials or a list, clears fields, overwrites an
import, reveals stored secrets, switches the web app's organization
(`switch_organization`) or is a team batch containing any of these comes back
as `needs_confirmation`: ask the user, and only if they agree call again with
`confirmed=true`. A `reveal_secrets` read that comes back this way is sent
again through `junis_call_tool` with `confirmed=true`. `junis_api` does the
same for `DELETE`, `PUT`, `PATCH` and Knowledge POSTs that replace data.

Whenever the user mentions Junis, 주니스, a squad (스쿼드), an orchestrator or
sub-agents, or wants AI agents set up, changed, run, scheduled or fixed, read
`skills/junis/SKILL.md` in this extension's folder before acting, and follow the
reference files it points to for the job at hand. The skill holds the operating
rules that keep users from losing time or credits; the tools alone do not.

Start every Junis task by calling `junis_status`. If it reports no connection,
call `junis_connect` with `method: "browser"`: it returns a link where the
user signs in and approves a key request. The server keeps waiting and stores
the key as soon as it is approved; the next `junis_connect` call with
`method: "browser"` reports the result (it waits up to 45 seconds if the
approval is still pending). Nothing is copied, so this works without a
clipboard. If the
user prefers, they can instead copy a key from
`https://junis.ai/settings/api-keys` and `junis_connect` reads it from the
clipboard. Either way the key never enters the chat.
