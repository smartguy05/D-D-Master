# TODO before play testing

Collected 2026-10-18 after the first live voice tests (2 voices recognized correctly, DM
narration no longer interrupted). Not planned yet: each item lists what exists today, what is
missing, and open questions to settle when we plan it.

## 1. Missing D&D rules

**Today:** characters have HP, temp HP, AC, abilities, conditions, attacks, a free-text spell list,
inventory and gold. At 0 HP a character just gets `Unconscious`.

**Missing:**
- Spell slots per level (max/used), cast spending a slot, upcasting.
- Hit dice (pool by class die), spending them on a short rest.
- Short and long rests (restore slots, hit dice, HP, class features).
- Death saving throws at 0 HP: 3 successes/3 failures, nat 20 = 1 HP, nat 1 = two failures,
  damage at 0 HP = a failure (crit = two), stabilizing, and dying when failures hit 3.
- Concentration (one spell at a time; CON save on damage, DC max(10, half damage)).
- Level-up (HP, slots, features).

**Open questions:** structured spell data from the SRD (level, school, save, damage) or keep spells
as names? Which rests and resources the DM tracks on its own vs host buttons. Player phone sheets
should show slots, hit dice and death saves.

**Touches:** `packages/shared/src/schemas.ts` (with `.default(...)` for old saves), engine tools +
tests, `TOOL_DESCRIPTIONS`, `docs/reference/tool-catalog.md`, DM persona, player sheet.

## 2. Host board fixing

**Today:** the host can move the party (Go here / Reset party here) and spawn encounters. Fog,
token moves and monster placement only go through the DM or `/api/tools/*`.

**Missing:**
- Drag tokens on the host's map view (or click a token, then a cell).
- Fog controls: enable/disable, reset, reveal/hide by clicking or dragging over cells.
- Show the map features read from the painted map (entrance, focal, lit, others) and let the host
  move, resize, add or delete them. A host fix should survive until the map is repainted.
- Remove/hide a monster, toggle `hidden`.

**Open questions:** a small 2D grid view on /host or reuse the 3D board? Undo already records tool
calls; host edits should go through `runTool` so they are undoable.

## 3. Show that the voice call was lost

**Today:** if the server restarts or crashes, it loses the sideband to the OpenAI call, but the
browser keeps the WebRTC call open. Players can still talk to the DM, but no tools run (no rolls,
damage, moves, speaker ID). The server reports the DM `offline`; the host page shows nothing obvious.

**Missing:** the host page should notice "my WebRTC call is live but the server has no DM" and show
a clear warning with a one-click fix (Reconnect builds a new call and resumes, which already exists
as ↻ Reconnect). Optionally the server could re-attach the sideband to the existing `call_id` after
a restart (persist the call id).

**Touches:** `apps/web/src/lib/voice.ts`, `PlayTab.tsx`, `GameService.startVoice`, `DmSession`.

## 4. Skip turns with no words

**Today:** with `interrupt_response: false` a cough no longer cuts the DM off, but semantic VAD can
still commit it as a turn, and the DM may answer it after narrating ("bless you", "did someone say
something?").

**Missing:** don't answer turns whose transcript is empty or only noise/filler. Responses are
requested on `input_audio_buffer.committed`, before the transcript arrives, so this needs either
waiting for `…input_audio_transcription.completed` before `response.create` (adds latency) or a
cheap pre-check (speech duration, voice-ID confidence). Measure the latency cost first.

**Touches:** `apps/server/src/realtime/session.ts` + `session.test.ts`.

## 5. Spawn layout based on the map and player locations

**Today:** monsters spawn at the map's focal feature (or right-middle), one cell lower per extra
monster, so a group forms a vertical line.

**Missing:** spread a group naturally around its anchor (a loose cluster or arc facing the party),
keep a sensible distance from the party, avoid stacking on blocking features (pews, altar) and
respect fog (spawn inside or outside the revealed area on purpose). Let the DM say "near the altar"
or "behind the pews" by feature name instead of x/y.

**Touches:** `spawn_monster` in `apps/server/src/engine/tools.ts`, `packages/shared/src/features.ts`.

## 6. NPC voice overlap

**Today:** with `NPC_TTS` on, `speak_as_npc` plays a generated clip on the TV while the Realtime
DM's own audio plays on the host laptop. The persona asks the DM to wait, but nothing enforces it,
so the two can talk over each other. Off by default.

**Missing:** decide how to sequence them: hold the clip until the DM's audio buffer stops, mute or
duck one of them, or route both through one output. Live-test with real speakers.

**Touches:** `apps/server/src/realtime/npc-voice.ts`, `session.ts` (`speaking` state), table audio.

## 7. Animations for attacks and spells

**Today:** the TV already has board effects (`apps/web/src/table/Effects.tsx`): slash, fireball,
lightning, frost, poison, radiant, necrotic, thunder, arcane, heal, plus hit/crit/miss flashes and
a token shake. Damage, healing and natural 20s/1s flash automatically; everything else only plays
when the DM remembers to call `play_effect`, and `apply_damage` has no attacker, so nothing travels
from attacker to target.

**Wanted:** something quick and fun on the TV for every attack and spell, without the DM having to
ask for it:
- melee: a swing/slash from attacker to target;
- ranged weapons: an arrow/bolt flying across the board;
- spells: a projectile or burst in the damage type's color (fire, cold, lightning, radiant…),
  area spells showing their radius;
- hit vs miss vs crit reactions on the target;
- optional sound per effect (reuse the dice noise synth).

**Open questions:** pass `source_id` (attacker) and the attack/spell name through `apply_damage`
and attack rolls so effects are automatic; map damage types and weapon kinds to effects; keep each
animation under ~1 s so play doesn't wait.
