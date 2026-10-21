---
title: Brain (background LLM) providers
area: server
topic: brain
related_code:
  - apps/server/src/brain/**
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: createProvider overrides (provider, models, timeout, effort); createAiPlayerProvider"
  - "2026-10-20: stateSummary lists away PCs while the party is split"
  - "2026-10-20: CharacterDraft omits lightRadius; characterFromDraft drops it (bugs/pregens-blind-in-fog)"
  - "2026-10-20: readMapFeatures tags interactive features"
  - "2026-10-20: readMapFeatures returns walls (polylines snapped by wallsFromLines)"
  - "2026-10-20: Anthropic stream deadline (withDeadline)"
  - "2026-10-20: Client timeout/maxRetries and reasoning effort"
  - "2026-09-24: generateOutline now asks for a distinct voice direction per NPC (Npc.voice)"
  - "2026-09-24: Initial version (OpenAI Responses API + Anthropic Messages API)"
  - "2026-10-18: Outline prompt asks for left-entrance / right-far-end map orientation"
  - "2026-10-18: Vision input (images) on both providers; readMapFeatures"
  - "2026-10-18: readMapFeatures also reads blocks"
  - "2026-10-18: consult uses effective features and flags hidden monsters"
  - "2026-10-18: CharacterDraft omits the derived rules-engine fields"
  - "2026-10-19: Outline prompt asks for per-location fog"
---

# Brain (background LLM) providers

The "brain" is a text LLM that handles everything too slow or too large for the voice model.
Select it with `BRAIN_PROVIDER=openai|anthropic`.

## Interface (`brain/provider.ts`)

```ts
interface LLMProvider { name; model; complete({ system, prompt, maxTokens?, images? }): Promise<string> }
// images?: { mediaType: "image/png" | "image/jpeg" | "image/webp"; base64 }[]
completeJson(llm, { system, prompt, schema: zod, schemaName }): Promise<T>
```

- **OpenAI**: `client.responses.create({ model, instructions, input, max_output_tokens })` →
  `output_text`, plus `reasoning: {effort}` when `BRAIN_REASONING_EFFORT` is set
  (`reasoningParam`). The default model is `BRAIN_MODEL_OPENAI=gpt-5`.
- Both clients are built with `brainClientOptions()`: `timeout: BRAIN_TIMEOUT_MS` (default 15 min; a one-shot adventure took ~6)
  and `maxRetries: 1`, so a hung call fails as a host job error instead of waiting half an hour.
- **Anthropic**: `client.messages.stream({ model, max_tokens, system, messages })` →
  `finalMessage()`, wrapped in `withDeadline(…, BRAIN_TIMEOUT_MS × (maxRetries + 1), () => stream.abort())`
  (room for the SDK's one retry): the
  SDK's own timeout stops at the response headers, so a stream that stalls later is aborted
  here. It streams so long outputs don't hit HTTP timeouts. It throws on
  `stop_reason: "refusal"`. There's no assistant prefill, since current Claude models reject it.
  The default model is `BRAIN_MODEL_ANTHROPIC=claude-opus-5`.
- **Images**: when `images` is set, OpenAI gets a user message with `input_image` data URLs
  (`detail: "high"`) before the `input_text`; Anthropic gets base64 `image` blocks before the text.
  `completeJson` passes them through, including on its repair retry. The brain model must accept
  vision input.
- `createProvider(provider?, models?, settings?)` defaults to the brain config; `settings` overrides
  `timeoutMs` and `reasoningEffort`. `createAiPlayerProvider()` builds the
  [AI players'](../gameplay/ai-players.md) model from `AI_PLAYER_*` (short timeout, effort `low`).
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
| `generateOutline` | `/api/campaign/outline` | `Outline`: acts, 3–8 locations with top-down `mapPrompt` (oriented with the entrance on the left and the far end on the right), grid size and `fog` (true for dark or explored places, false for shops, inns and lit rooms), NPCs (each with a distinct `voice` direction for the DM to perform), encounters using SRD monster names (the catalog's name list is in the prompt) |
| `generatePregens` | `/api/characters/pregens` | `CharacterDraft[]`: legal level-N characters with an `appearance` for sprites |
| `parseCharacterSheet` | `/api/characters/import` | `CharacterDraft` from pasted sheet text (up to 30k characters) |
| `consult` | `consult_brain` tool | Up to 120 words of guidance, given the outline (each location with its `effectiveFeatures`, so host Board fixes win), recaps, a state summary (hidden monsters flagged "hidden from the table") and the last 60 log lines |
| `readMapFeatures` | `GameService.generateMap` | `{ features: MapFeature[]; walls: WallSeg[] }`: up to 12 landmarks on a painted map (entrance, exit, focal, feature; `lit` for light sources; `blocks` for solid furniture, pillars; `interactive` for usable things: levers, switches, chests, altars, wheels, doors) and up to 60 wall/door/window polylines traced along the painted walls. The model returns boxes and polyline points as image fractions; `featureFromBox` converts boxes to grid cells and `wallsFromLines` snaps polylines to grid-line segments (doors start closed). A reply without `walls` gives `[]`. About 20–25 s with gpt-5 |
| `summarizeSession` | `/api/campaign/end-session` | A read-aloud recap plus a `DM NOTES:` line, stored in `campaign.sessionSummaries` |

`CharacterDraft` is `Character` without `id`, `hp`, `spriteUrl` and `color`, and without the
rules-engine state (`spellSlots`, `pactSlots`, `hitDice`, `deathSaves`, `concentration`,
`resources`). The server fills those in (the rules state from the SRD class table). It also has no
`lightRadius`: structured output fills every optional field, and a pregen came back with
`lightRadius: 0` (blind in fog of war). `characterFromDraft` drops a draft's `lightRadius` too, so
a pregen made before that fix still gets the default torch (`DEFAULT_LIGHT_RADIUS`).

## Adding a provider

Implement `LLMProvider`, add a branch in `createProvider()` and the config keys in
`config.ts` and `.env.example`, then document it here and in
[configuration](../setup/configuration.md).
