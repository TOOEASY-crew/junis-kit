# Steps only the user can do

Read this when a step needs the user's own hands in the web app: signing in,
paying, approving, entering a secret, or a setting that has no tool. Give the
exact link, say what to press, and continue when they return.

Web pages act on the organization currently selected in the web app and ignore
any `?org=` in the link. When the organization matters, first give
`https://junis.ai/chat?join=<slug>`, which switches the web app to it. It also
changes the account's default organization, which calls use when neither
`organization_id` nor a kit default (`junis_use_organization`) is set; keep
passing the id.

## Contents

- Account, plan and keys
- Organization and team
- Connections and credentials
- Knowledge and documents
- Squads, schedules and history
- Putting a squad in front of people

## Account, plan and keys

| Step | Where |
| --- | --- |
| Sign in; create, reveal, copy or revoke an API key; add permissions to a key | `https://junis.ai/settings/api-keys` |
| Approve a key request from this kit (browser login) | the link the kit returns, `https://junis.ai/auth/api-key?code=…` |
| Subscribe, change or cancel the plan, buy credits (API use needs Basic or Pro) | `https://junis.ai/subscription` |
| See spending | Whoever pays sees it at `https://junis.ai/usage`, broken down by AI team: the owner by default, or each member when the organization bills members. `https://junis.ai/admin/dashboard` → Usage shows adoption and activity, not cost. |
| Model prices | `https://junis.ai/subscription` → Model Token Pricing |
| See and edit their memory (Basic or Pro) | `https://junis.ai/memory`; editing there may be switched off, `patch_memory_content` always works for the profile |
| Feature flags, monthly spending cap, full erasure of a person | Junis staff: `contact@junis.ai` |

## Organization and team

| Step | Where |
| --- | --- |
| Invite, cancel an invitation, change roles (inviting needs the inviter's own Basic or Pro monthly plan; the pages offer only Admin and Member, and an owner row cannot be changed) | `https://junis.ai/team/members` (owners and admins) |
| Make someone an owner, or change or remove an owner | Junis staff: `contact@junis.ai` |
| Remove a member (never an owner); see members as a member | `https://junis.ai/settings/organization` → Members |
| Accept an invitation | the invitee signs in at junis.ai with the invited address and chooses **Accept** on the invitation Junis shows (or **Decline**); an invitation never activates on its own |
| Rename, logo, delete the organization (rename and delete: owner only); who pays; allowed email domains and auto-join; welcome suggestions; setup guide; sign-in session length; clear history; Slack workspaces | `https://junis.ai/admin/dashboard` → Settings |
| Organization API keys, including "Connect users from my own app" for partner accounts | `https://junis.ai/admin/dashboard` → API Keys |
| Audit log; member data export and scheduled erasure (runs only where Junis has enabled it) | `https://junis.ai/team/audit`, `https://junis.ai/team/compliance` |

## Connections and credentials

| Step | Where |
| --- | --- |
| Authorize or disconnect an OAuth app (Gmail, Drive, Instagram, …) | `https://junis.ai/team/integrations` |
| Register an organization secret (Org Keys) or a personal secret (My Keys); enter MCP credentials (organization: Edit on the platform; personal: My Credentials); test a connection | `https://junis.ai/team/mcp-skills` ("MCP & Keys") |
| Sign in to Shopify or Threads | `https://junis.ai/team/mcp-skills`: open Edit (organization) or My Credentials (personal) on a local platform whose name contains `shopify` or `threads`; if none is listed, ask Junis to add it (contact@junis.ai — command-based platforms are set up by Junis administrators) |
| Approve a drafted action (it does nothing before) or disable one; approve or reject an action run that is waiting; change a connection that approved actions use (owners and admins; none of these has a tool) | `https://junis.ai/team/actions`: Actions tab → "Approve" on the draft's row → "Approve this version" (or "Disable" on an approved one); waiting runs at `https://junis.ai/team/actions?tab=approvals`; connections under the Connections tab. A waiting run expires after 24 hours ([actions.md](actions.md)). |
| Trim the tools an MCP platform or OAuth app gives one agent (also possible from here: `get_agent_tool_access` → `set_agent_enabled_tools`) | `https://junis.ai/team/orchestration` → Agent List tab (not the graph) → edit the agent → select tools → save, then reopen to confirm. |
| Connect their computer | run `npx junis` on it and approve in the browser. Only owners and admins can link a device to an agent (`link_agent_device`, or the agent's settings at `https://junis.ai/team/orchestration`). |
| Register the simulation key (`ZEP_API_KEY`); cancel a running simulation | `https://junis.ai/team/simulations` |

## Knowledge and documents

| Step | Where |
| --- | --- |
| Database sources, renaming or removing map kinds, review queue, Rebuild graph, marking sources "Shared publicly" for the widget, recording audio; the "Set-level graph questions" switch (owner or admin; it opens `knowledge_graph_around` and verified graph questions); approving "Verified graph questions"; editing a kind's property definitions in the map editor; "Restricted types and relations" (hide a kind or relation from everyone but chosen groups; access control must be on); "Let members browse knowledge" (a read-only page for members) | `https://junis.ai/team/knowledge` |
| See the knowledge graph | `https://junis.ai/team/knowledge/graph` |
| RAG uploads over 10 MB (PDF and DOCX up to 50 MB) | `https://junis.ai/team/rag-knowledge` |
| Upload local files when there is no shell | the two pages above |

## Squads, schedules and history

| Step | Where |
| --- | --- |
| See agents and the squad graph | `https://junis.ai/team/orchestration` |
| Members create and manage their own schedules | `https://junis.ai/team/task-planning` |
| Edit the wiki or personality by hand | `https://junis.ai/team/wiki`, `https://junis.ai/team/soul` |
| Review agent suggestions; restore an earlier agent version (not the orchestrator; tool selections of connections still linked are kept) | `https://junis.ai/team/agent-proposals`, `https://junis.ai/team/agent-versions` |
| Delete generated media (the stored file is kept) | `https://junis.ai/team/content` |
| Start from a template team | `https://junis.ai/showcase` |

## Putting a squad in front of people

Details, costs and what visitors can reach: [publishing.md](publishing.md).

| Step | Where |
| --- | --- |
| Put the squad on a website: Embed Mode "Public Anonymous" (the only mode with iframe code; the owner then pays for all usage), the site's exact origin under Allowed Domains, message limit, blocked tools; paste the iframe for `https://junis.ai/embed/<slug>`; ask one question on the site | `https://junis.ai/settings/organization` → Publish |
| Show the knowledge graph on a website: switch it on, add the site under Publish → Allowed Domains, mark sources "Shared publicly" (the chat widget's Knowledge search uses only those too) | `https://junis.ai/team/knowledge` → "Embed the knowledge graph on your site" |
| Make the organization public (decide who pays first: any signed-in Junis user can then chat with the squad; by default the owner pays for everyone, and if the organization bills members, each user pays for their own use); share `https://junis.ai/team/public/<slug>` | `https://junis.ai/settings/organization` → Publish |
| Connect Slack (owner or admin; pick the organization on the page, or use the Slack card in that organization's Settings). An organization API key is created and linked automatically (named "Slack · workspace"); link one by hand only if the success page still says a key is needed. Set the default organization when several are linked | `https://junis.ai/slack`; the default: `https://junis.ai/admin/dashboard` → Settings → Slack |
| Share a conversation; publish an HTML result | the chat at `https://junis.ai/chat/<session_id>` → Share; Publish is in the code block's preview → Publish to Web |
