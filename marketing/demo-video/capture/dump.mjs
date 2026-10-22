// Print a summary of the live game state (ids for scripting takes).
import { connectLive } from "./live.mjs";
const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const s = live.state;
console.log(Object.keys(s).join(" "));
console.log("loc", s.locationId, "combat", s.combat?.active, "scenes", Object.keys(s.scenes ?? {}));
for (const c of s.characters) console.log("PC", c.id, c.name, c.hp + "/" + c.maxHp, "sprite", !!c.spriteUrl, JSON.stringify(c.position ?? c.token ?? null), "player", c.playerId);
for (const m of s.monsters ?? []) console.log("M", m.id, m.name, m.hp, m.ally ? "ally" : m.neutral ? "neutral" : "foe", m.attitude, !!m.spriteUrl);
for (const p of s.players ?? []) console.log("P", p.id, p.name, p.ai ? "AI" : "");
for (const l of s.outline?.locations ?? s.campaign?.outline?.locations ?? []) console.log("L", l.id, l.name, (l.doors ?? []).length + " doors", l.mapUrl ? "map" : "");
console.log("tokens", JSON.stringify(s.tokens ?? s.scene?.tokens)?.slice(0, 600));
console.log("mapObjects", JSON.stringify(s.mapObjects ?? s.scene?.objects)?.slice(0, 300));
live.close();
process.exit(0);
