---
title: Brain (background LLM) providers
area: server
topic: brain
related_code:
  - apps/server/src/brain/**
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: generateOutline now asks for a distinct voice direction per NPC (Npc.voice)"
  - "2026-09-24: Initial version (OpenAI Responses API + Anthropic Messages API)"
---

# Brain (background LLM) providers

The "brain" is a text LLM that handles everything too slow or too large for the voice model.
Select it with `BRAIN_PROVIDER=openai|anthropic`.

## Interface (`brain/provider.ts`)

```ts
interface LLMProvider { name; model; complete({ system, prompt, maxTokens? }): Promise<string> }
completeJson(llm, { system, prompt, schema: zod, schemaName }): Promise<T>
```

- **OpenAI**: `client.responses.create({ model, instructions, input, max_output_tokens })` →
  `output_text`. The default model is `BRAIN_MODEL_OPENAI=gpt-5`.
- **Anthropic**: `client.messages.stream({ model, max_tokens, system, messages })` →
  `finalMessage()`. It streams so long outputs don't hit HTTP timeouts. It throws on
  `stop_reason: "refusal"`. There's no assistant prefill, since current Claude models reject it.
  The default model is `BRAIN_MODEL_ANTHROPIC=claude-opus-5`.
- `createProvider()` returns `undefined` when the selected provider has no API key. Features that
  need the brain then return a clear error, and `consult_brain` tells the DM to improvise.

`completeJson` is provider-agnostic:
1. It embeds the zod schema as JSON Schema in the system prompt.
2. `extractJson` pulls the first JSON value out of the reply (tolerating ``` fences and prose).
3. It validates with zod.
4. On failure it retries **once**, including the validation error in the prompt.

## Content functions (`brain/content.ts`)

| Function | Used by | Output |
|---|---|---|
| `generateOutline` | `/api/campaign/outline` | `Outline`: acts, 3–8 locations with top-down `mapPrompt` and grid size, NPCs (each with a distinct `voice` direction for the DM to perform), encounters using SRD monster names (the catalog's name list is in the prompt) |
| `generatePregens` | `/api/characters/pregens` | `CharacterDraft[]`: legal level-N characters with an `appearance` for sprites |
| `parseCharacterSheet` | `/api/characters/import` | `CharacterDraft` from pasted sheet text (up to 30k characters) |
| `consult` | `consult_brain` tool | Up to 120 words of guidance, given the outline, recaps, a state summary and the last 60 log lines |
| `summarizeSession` | `/api/campaign/end-session` | A read-aloud recap plus a `DM NOTES:` line, stored in `campaign.sessionSummaries` |

`CharacterDraft` is `Character` without `id`, `hp`, `spriteUrl` and `color`. The server fills those in.

## Adding a provider

Implement `LLMProvider`, add a branch in `createProvider()` and the config keys in
`config.ts` and `.env.example`, then document it here and in
[configuration](../setup/configuration.md).
