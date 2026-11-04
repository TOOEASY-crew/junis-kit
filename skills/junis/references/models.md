# Choosing models

Read this when setting or changing an agent's `model` or `reasoning_effort`.

## Contents

- The list is live
- Choosing by role
- Rules by family
- RAG agents
- Changing models across a squad
- Cost awareness

## The list is live

Call `list_llm_models` at the start of every build and choose only from its
result. The registry changes without notice, model generations turn over
within months, and an identifier that is not registered makes the agent fail
when it is called. Do not use names from memory, from old instructions or
from other agents in the organization without checking them against the list.

Each entry has `model_identifier` (what you pass as `model`, always
`provider/name`), `provider`, `description`, `is_recommended` and
`supports_thinking`. Prices and image support are not in the list. The payer
sees spending at `https://junis.ai/usage`.

Always pass `model`. Omitting it applies a schema default that may differ from
what the organization uses elsewhere.

## Choosing by role

When the request does not name a model or a provider, prefer the newest
OpenAI GPT models called directly: identifiers that start with `openai/`, not
the same models through `azure/` or `openrouter/`. As of 2026-10-01 these are
`openai/gpt-6.1-sol` (general; also the platform's default), `openai/gpt-6-astra`
(top reasoning, considerably more expensive than sol; see the pricing page) and `openai/gpt-6-luna`
(small and inexpensive). These names are examples: take the newest GPT entries
the live list actually has, and follow the role table below. This is the
starting preference, not a rule. Use another family when the user asks for
one, when the task requires it (a RAG agent runs on Gemini, a reviewer comes
from another family than the agent it checks), or when the organization's
data rules call for a specific provider such as Azure. If the list has no
direct GPT model, pick by tier from what it has, preferring entries marked
recommended.

The preference is for agents you create. Do not change the model of an
existing agent, the orchestrator included, unless the user asks for it.

| Role | Tier (as of 2026-10-01, when listed) | `reasoning_effort` |
| --- | --- | --- |
| Orchestrator, routing agent | General (`openai/gpt-6.1-sol`) | medium |
| Worker with tools | General (`openai/gpt-6.1-sol`) | low |
| Classification, extraction, short transformation | Small (`openai/gpt-6-luna`) | none |
| Agent that only passes work on | General, not the smallest (`openai/gpt-6.1-sol`) | low |
| Combiner, final report writer | General (`openai/gpt-6.1-sol`), or top for demanding reports | medium |
| Reviewer, critic, judge | A different provider family than the agent it checks (a Claude or Gemini model when the generator is GPT) | high |
| Hard analysis, planning, architecture | Top (`openai/gpt-6-astra`) | high |
| RAG agent | A Gemini flash model (required) | none |
| Image or file analysis | A model that accepts images; test with one image ([agent-settings.md](agent-settings.md), "Vision") | by difficulty |

Keep the small model to single-step work: in measurements it loops on tools
and invents more than the general model, and very small models have produced
empty hand-offs. `openai/gpt-6.1-sol` and `openai/gpt-6-astra` cannot switch
reasoning off, so `none` runs as `low` and is billed.

Higher tiers and higher effort cost more and answer slower. Use them where a
wrong answer is expensive. `none` is not free on every model; see the rules
below.

When the user asks for the best or the cheapest model, show the candidates from
the live list with their provider and recommended flag, state which you would
pick and why, and let them decide. You cannot see prices: they are at
`https://junis.ai/subscription` → "Model Token Pricing", and the payer's
spending by model is at `https://junis.ai/usage`.

## Rules by family

| Family | Rules |
| --- | --- |
| Claude, current generation | No `temperature`. Works with MCP tools at any effort. Claude 5 reasons by default, and `none` differs by model: sonnet-5 turns it off; sonnet-5-5 answers without reasoning first but writes short notes between tool calls; opus-5-5, fable-5 and fable-5-1 refuse to switch it off, and the other Claude 5 models are treated the same way: `none` is sent as adaptive reasoning at `low`. |
| GPT, current generation | No `temperature`. Any effort works with tools. gpt-6-astra and gpt-6.1-sol cannot switch reasoning off: `none` is sent as `low` and billed. `-pro` models need `medium` or higher (some only `high`); `low` is raised to `medium`. |
| Azure (`azure/gpt-6-*`, `azure_ai/DeepSeek-*`) | `azure/gpt-6-*` behave like the same GPT models (Responses API, no `temperature`; astra raises `none` to `low`). `azure_ai/DeepSeek-*`: `temperature` is not sent and images are not passed on. Web search on either adds the `openai_web_search` tool. Only these two families are wired through Azure; Claude or other models under `azure_ai/` are not. |
| Gemini | Set `temperature=1.0` on direct `gemini/` agents (the stored default 0.7 is sent to them). `none` turns reasoning off on 3.8-flash, 3-flash-preview, 3.1-flash-lite and 2.5-flash; other 3.x models still reason at their lowest level. |
| Models through OpenRouter | No automatic fallback. Cannot be used for RAG. Some wrap structured output in extra prose. Reasoning only where the model supports it. |
| Router model (`openrouter/typesafe/jev-router`, the only one) | Chooses the real model per conversation. Effort is ignored. Cannot be used for RAG. Billed on the provider's actual charge with a surcharge (see the pricing page). Avoid for organizations with strict data rules. |

`max` effort is accepted everywhere and is mapped to the highest level the
model supports. Other spellings are in [agent-settings.md](agent-settings.md).

## RAG agents

- The model identifier must start with `gemini`.
- RAG calls go through the provider's enterprise endpoint, where newly released
  or preview "pro" models may have no capacity even though they work for normal
  agents. Use a flash model that is already used by working RAG agents, and
  test retrieval after creating the agent.
- A non-Gemini model is refused at creation, but changing to one later is
  accepted and silently disables retrieval.

## Changing models across a squad

1. Snapshot the organization.
2. Check the new identifier is in `list_llm_models`.
3. Change one agent, test it in a new session, read the answer.
4. Then change the rest, agent by agent, with `update_agent(model=…)`.
5. Run the squad's usual request and compare with an earlier answer.
6. Report which agents changed, from what to what.

Provider outages and spending caps affect every agent on that provider at
once. If all agents of one family start failing with rate or quota errors,
the cause is on the provider side; moving the affected agents to another
family from the list is a valid temporary measure, with the user's agreement.

## Cost awareness

- Each agent in a chain is at least one more model call. Routing through the
  orchestrator to a sub-agent is two.
- Reasoning tokens are billed as output.
- A session that keeps being reused grows, and every call pays for its history.
  Start new sessions for unrelated requests.
- Web search, content generation, sandbox time and some MCP platforms are
  billed on top of tokens.
