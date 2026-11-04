# junis-kit

One skill, one MCP server and one installer for operating the Junis platform
from any coding agent. This file is for agents and people working on the kit
itself; users of the kit read `README.md`.

## Layout

| Path | What it is |
| --- | --- |
| `skills/junis/SKILL.md` | The skill. Under 500 lines; routes each job to the reference files it needs. |
| `skills/junis/references/*.md` | Nineteen reference files, one level deep. Each starts by saying when to read it. |
| `skills/junis/scripts/junis.mjs` | The only executable: command line, stdio MCP bridge (`mcp`, `mcp --lazy`) and installer. Node 18+, no dependencies. |
| `skills/junis/scripts/lib/` | Its modules: argument parser, config, http, error advice, remote MCP client, External API client, bridge, kit tools (including browser login), browser opener, run (job handles), destructive-call rules, lint, JSONC reader, snapshot, doctor, installer, agent catalogue. |
| `kit.json` | Single source for name, version and descriptions. `scripts/build-manifests.mjs` generates every manifest from it. |
| `.claude-plugin/`, `.mcp.json`, `hooks/` | Claude Code plugin and marketplace. |
| `plugin.json`, `mcp.json`, `.codex-plugin/`, `.cursor-plugin/`, `.agents/plugins/`, `gemini-extension.json` | Generated manifests for the other agents. Do not edit by hand. |
| `GEMINI.md` | Context file of the Gemini CLI extension. Written by hand; keep it in step with the bridge's tools. |
| `README.md`, `README.ko.md`, `SECURITY.md` | User-facing documents in English and Korean, and the disclosure policy. Change both READMEs together. |
| `tests/` | `node --test` suites against an in-process mock of the External API and the hosted MCP server. |
| `evals/` | `claude plugin eval` cases with MCP mocks: behaviour of the skill in a real, isolated Claude Code session. Claude Code is the only agent with behaviour evals. |
| `docs/` | Architecture decision and methodology synthesis. |
| `.github/` | CI (`npm run check` on Node 18 and 20), code owners, issue template. |
| `CHANGELOG.md` | One entry per release tag; add a line under "Unreleased" with each user-visible change. |
| `research/` | Internal notes the kit was built from. Ignored by git, never shipped. |

## Rules

- No credential anywhere in the repository. Tests use keys containing
  `testkey`; `tests/skill.test.mjs` fails on anything else that looks like a
  key.
- Nothing here talks to a real Junis tenant. Tests use `tests/helpers/mock-junis.mjs`;
  evals use `evals/mocks/`. Manual checks against production need a throwaway
  organization and the user's consent.
- The scripts stay dependency-free and Node 18 compatible, so the same file
  runs inside every agent's MCP launcher.
- Change `kit.json`, then run `npm run manifests`. `npm run check` fails when
  a manifest or a version string drifts.
- To change the version: `node scripts/build-manifests.mjs --set-version <x.y.z>`,
  move the "Unreleased" entries of `CHANGELOG.md` under the new version, update
  the pinned tag in both READMEs and in `SECURITY.md`, then tag the release
  commit `v<x.y.z>` so users can pin it with `JUNIS_KIT_REF`. Leave `version` out of `.claude-plugin/plugin.json`: Claude
  Code then updates on every pushed commit instead of skipping an unchanged
  version string. That also means every commit on `main` reaches plugin users.
  Users who need a fixed version pin a tag.
- Skill text: third person, no model identifiers as facts (they change; the
  skill says `list_llm_models`; the only exception is the example list of
  direct GPT entries in operating rule 3, kept current with the platform),
  no customer names, no internal ids, frontmatter limited to the six portable
  fields.
- Shipped text and code comments never name internal repositories; say "the
  platform" or "the hosted server". Names users see in the web app, such as
  the `junis-magic-auto` key, are fine.
- User-facing claims match what is tested: behaviour evals run in Claude Code
  only, the other agents have install and MCP handshake tests. Update the
  "Tested with" table in both READMEs when that changes.
- Behaviour changes to the skill are proven with an eval case, not by reading.

## Commands

```
npm test                          # unit and integration suites
npm run check                     # manifests in sync + tests
claude plugin validate .          # manifest and skill structure
claude plugin eval . --no-publish --trust-plugin      # behaviour, with a no-plugin baseline
node skills/junis/scripts/junis.mjs --help
```
