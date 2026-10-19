import { z } from "zod";
import { Character, MapFeature, Outline, effectiveFeatures, featureFromBox, type Campaign, type GameState, type Location } from "@dm/shared";
import { completeJson, type ImageInput, type LLMProvider } from "./provider.js";

const DM_PERSONA =
  "You are an expert Dungeons & Dragons 5e (2024 rules, SRD 5.2) adventure designer and dungeon master.";

/**
 * Character as produced by the brain (ids/hp/sprites are filled in by the server). The rules-engine
 * state (slots, hit dice, death saves, resources...) is derived by the server, never by the brain.
 */
export const CharacterDraft = Character.omit({
  id: true,
  hp: true,
  spriteUrl: true,
  color: true,
  spellSlots: true,
  pactSlots: true,
  hitDice: true,
  deathSaves: true,
  concentration: true,
  resources: true,
}).extend({
  playerName: z.string().default(""),
});
export type CharacterDraft = z.infer<typeof CharacterDraft>;

export async function generateOutline(
  llm: LLMProvider,
  input: { premise: string; partyLevel: number; partySize: number; length: "one-shot" | "short" | "campaign" },
  monsterNames: string[],
): Promise<Outline> {
  const locCount = input.length === "one-shot" ? "3-4" : input.length === "short" ? "4-6" : "6-8";
  return completeJson(llm, {
    system: `${DM_PERSONA} Design adventures that are fun to run out loud, with clear goals, memorable NPCs, and a mix of combat, exploration and roleplay.`,
    schemaName: "Outline",
    schema: Outline,
    prompt: `Create an adventure outline.
Premise from the players: ${input.premise || "(none - surprise us)"}
Party: ${input.partySize} characters of level ${input.partyLevel}. Length: ${input.length}.

Requirements:
- ${locCount} locations. Each location id must be short snake_case prefixed with "loc_". The first location is where play starts.
- For each location write "mapPrompt": a description of a TOP-DOWN battle map of that place (layout, terrain, features, lighting), no text or labels, no characters. Orient every map the same way: the party enters from the LEFT (west) edge and the far end with the main feature or enemies is on the RIGHT (east) edge; describe positions with left/right, not top/bottom.
- gridW/gridH: grid size in 5-ft squares for that map (between 16x12 and 30x20).
- "fog": true for places the party explores (dark interiors, dungeons, caves, wilderness, ruins); false for safe, well-lit places where everything is in view (shops, inns, homes, throne rooms, busy streets).
- encounters: balanced for the party, monsters use EXACT names from this SRD list where possible: ${monsterNames.join(", ")}
- 3-6 NPCs with motives. Give each NPC a "voice": one line of performance direction for a voice actor (accent, pitch, pace, verbal tic), e.g. "gravelly low Scottish burr, slow, ends sentences with 'aye?'". Make every NPC's voice clearly different from the others.
- 3 acts.`,
  });
}

export async function generatePregens(
  llm: LLMProvider,
  campaign: Campaign | undefined,
  count: number,
  level: number,
  wishes: string,
): Promise<CharacterDraft[]> {
  const res = await completeJson(llm, {
    system: `${DM_PERSONA} Build legal, ready-to-play 5e (2024) characters using SRD species and classes. Use standard array ability scores plus background bonuses, correct HP, AC, proficiency bonus, starting equipment and attacks (with toHit and damage like "1d8+3 slashing").`,
    schemaName: "Pregens",
    schema: z.object({ characters: z.array(CharacterDraft).min(1) }),
    prompt: `Create ${count} distinct level ${level} pregenerated characters that fit this adventure: ${campaign?.outline?.title ?? campaign?.name ?? "a classic fantasy adventure"} - ${campaign?.outline?.hook ?? campaign?.premise ?? ""}
Player wishes: ${wishes || "a balanced party"}
Leave playerName empty. Give each an "appearance" sentence suitable for drawing a token.`,
  });
  return res.characters;
}

export async function parseCharacterSheet(llm: LLMProvider, sheet: string, playerName: string): Promise<CharacterDraft> {
  return completeJson(llm, {
    system: `${DM_PERSONA} Convert character sheets (D&D Beyond exports, PDFs pasted as text, or notes) into structured data. Keep the numbers from the sheet; only infer what is missing.`,
    schemaName: "Character",
    schema: CharacterDraft,
    prompt: `Player: ${playerName}\nCharacter sheet:\n"""\n${sheet.slice(0, 30000)}\n"""`,
  });
}

function stateSummary(state: GameState): string {
  const loc = state.locationId ?? "none";
  const chars = state.characters.map((c) => `${c.name} (${c.className} ${c.level}, ${c.hp}/${c.maxHp} HP)`).join("; ");
  const mons = state.monsters.map((m) => `${m.name} ${m.hp}/${m.maxHp}${m.hidden ? " (hidden from the table)" : ""}`).join("; ");
  return `Location: ${loc}\nParty: ${chars || "none"}\nMonsters present: ${mons || "none"}`;
}

function recentLog(state: GameState, n = 60): string {
  return state.log
    .slice(-n)
    .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`)
    .join("\n");
}

/** The outline with each location's effective features (host Board fixes win over the map read). */
function outlineForBrain(campaign: Campaign, state: GameState) {
  const o = campaign.outline;
  if (!o) return {};
  return { ...o, locations: o.locations.map((l) => ({ ...l, features: effectiveFeatures(state, l) })) };
}

export async function consult(llm: LLMProvider, campaign: Campaign, state: GameState, question: string): Promise<string> {
  return llm.complete({
    system: `${DM_PERSONA} You advise a live voice DM mid-session. Answer in at most 120 words of plain prose the DM can act on immediately: what happens, what NPCs want, what to reveal. Keep the story on track with the outline but follow the players' choices.`,
    prompt: `Adventure outline:\n${JSON.stringify(outlineForBrain(campaign, state), null, 1).slice(0, 12000)}\n\nPrevious sessions:\n${campaign.sessionSummaries.map((s) => s.summary).join("\n") || "none"}\n\nCurrent state:\n${stateSummary(state)}\n\nRecent play:\n${recentLog(state)}\n\nDM's question: ${question}`,
    maxTokens: 4000,
  });
}

export async function summarizeSession(llm: LLMProvider, campaign: Campaign, state: GameState, transcript: string): Promise<string> {
  return llm.complete({
    system: `${DM_PERSONA} Write a "previously on..." recap a DM can read aloud at the start of the next session (120-200 words), then a line starting "DM NOTES:" with open threads, loot gained and where the party is.`,
    prompt: `Adventure: ${campaign.outline?.title ?? campaign.name}\n\nCurrent state:\n${stateSummary(state)}\n\nSession log:\n${transcript.slice(-40000)}`,
    maxTokens: 4000,
  });
}

const FeatureBoxes = z.object({
  features: z
    .array(
      z.object({
        name: z.string(),
        kind: MapFeature.shape.kind,
        lit: z.boolean().default(false),
        blocks: z.boolean().default(false),
        box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      }),
    )
    .max(16),
});

/**
 * Look at a painted battle map and locate its landmarks, so token placement, spawns and fog match
 * the picture. The model answers in image fractions; conversion to cells is done here.
 */
export async function readMapFeatures(
  llm: LLMProvider,
  loc: Pick<Location, "name" | "description" | "gridW" | "gridH">,
  image: ImageInput,
): Promise<MapFeature[]> {
  const res = await completeJson(llm, {
    system: "You read top-down tabletop battle maps and locate their landmarks precisely.",
    schemaName: "MapFeatures",
    schema: FeatureBoxes,
    images: [image],
    maxTokens: 4000,
    prompt: `This is the battle map for "${loc.name}": ${loc.description}
It is laid over a ${loc.gridW} x ${loc.gridH} grid of 5-ft squares (x to the right, y down).
List up to 12 landmarks that matter in play. Give each a bounding "box" [x0, y0, x1, y1] as fractions of the image width and height (0 = left/top edge, 1 = right/bottom edge), tight around the object itself.
- kind "entrance": the way the party comes in (door, stairs, gate, path). Exactly one if visible.
- kind "exit": other ways out.
- kind "focal": the main feature or lair (altar, idol, throne, boss area). At most one.
- kind "feature": other notable things (pillars, pews, pools, statues, chasms).
- lit: true only for visible light sources (lantern, candles, brazier, fire, glowing runes).
- blocks: true for solid things a creature cannot stand on: furniture (pews, tables, altars), pillars, statues, walls, rubble piles. False for floor features (rugs, pools you can wade, doorways, stairs).`,
  });
  return res.features
    .filter((f) => Math.abs(f.box[2] - f.box[0]) > 0.005 && Math.abs(f.box[3] - f.box[1]) > 0.005)
    .map((f) => featureFromBox(f, loc.gridW, loc.gridH));
}
