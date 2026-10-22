// v2 setup on the scratch copy: Pip (demo campaign) saved to the roster, then the cove campaign
// loaded with hand-drawn lighthouse walls and doors (the map predates wall detection).
import { api, tool, sleep } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { CAMPAIGN, LOCATIONS } from "./cast.mjs";

await api("/api/campaigns/cmp_45af792241/load", {});
await sleep(1000);
const live0 = connectLive();
await live0.waitFor((l) => l.state, 10000);
const pip = live0.state.characters.find((c) => c.name === "Pip");
console.log("roster", await api(`/api/roster/save/${pip.id}`, {}));
live0.close();

await api(`/api/campaigns/${CAMPAIGN}/load`, {});
await sleep(1000);
const live = connectLive();
await live.waitFor((l) => l.state, 10000);
if (live.state.locationId !== LOCATIONS.lighthouse) await tool("change_scene", { location_id: LOCATIONS.lighthouse, forced: true });
await sleep(1500);
await tool("edit_walls", { action: "reset" }).catch((e) => console.log(e.message));
// Bottom wall of the bedroom/storeroom block (y=7), with two doors; the dividing walls; the top.
const segs = [
  [0, 7, 3, 7, "wall"], [3, 7, 4, 7, "door"], [4, 7, 8, 7, "wall"], [8, 7, 9, 7, "door"], [9, 7, 13, 7, "wall"],
  [6, 3, 6, 7, "wall"], [10, 3, 10, 7, "wall"], [13, 3, 13, 7, "wall"],
  [0, 3, 13, 3, "wall"],
];
for (const [x1, y1, x2, y2, kind] of segs) await tool("edit_walls", { action: "add", segment: { x1, y1, x2, y2, kind } });
await sleep(500);
const loc = live.state;
console.log("walls set; location", loc.locationId);
live.close();
process.exit(0);
