import { z } from "zod";
import { Character, Outline, type Campaign, type GameState } from "@dm/shared";
import { completeJson, type LLMProvider } from "./provider.js";

const DM_PERSONA =
  "You are an expert Dungeons & Dragons 5e (2024 rules, SRD 5.2) adventure designer and dungeon master.";

/** Character as produced by the brain (ids/hp/sprites are filled in by the server). */
export const CharacterDraft = Character.omit({ id: true, hp: true, spriteUrl: true, color: true }).extend({
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
- For each location write "mapPrompt": a description of a TOP-DOWN battle map of that place (layout, terrain, features, lighting), no text or labels, no characters.
- gridW/gridH: grid size in 5-ft squares for that map (between 16x12 and 30x20).
- encounters: balanced for the party, monsters use EXACT names from this SRD list where possible: ${monsterNames.join(", ")}
- 3-6 NPCs with motives. 3 acts.`,
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
  const mons = state.monsters.map((m) => `${m.name} ${m.hp}/${m.maxHp}`).join("; ");
  return `Location: ${loc}\nParty: ${chars || "none"}\nMonsters present: ${mons || "none"}`;
}

function recentLog(state: GameState, n = 60): string {
  return state.log
    .slice(-n)
    .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`)
    .join("\n");
}

export async function consult(llm: LLMProvider, campaign: Campaign, state: GameState, question: string): Promise<string> {
  return llm.complete({
    system: `${DM_PERSONA} You advise a live voice DM mid-session. Answer in at most 120 words of plain prose the DM can act on immediately: what happens, what NPCs want, what to reveal. Keep the story on track with the outline but follow the players' choices.`,
    prompt: `Adventure outline:\n${JSON.stringify(campaign.outline ?? {}, null, 1).slice(0, 12000)}\n\nPrevious sessions:\n${campaign.sessionSummaries.map((s) => s.summary).join("\n") || "none"}\n\nCurrent state:\n${stateSummary(state)}\n\nRecent play:\n${recentLog(state)}\n\nDM's question: ${question}`,
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
