// Take B2: fog of war on in the Smuggler's Cove; the party walks single file along the north
// wall and the fog peels back around them (map-fog).
import { launch, TV, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PCS } from "./cast.mjs";

const live = connectLive();
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
await api("/api/dm/whisper", { text: "Keep fog of war ON in the cove for the rest of the session; do not call set_fog disable." });
await tool("set_fog", { mode: "reset" });
await tool("set_fog", { mode: "enable" });
// Start everyone back at the western entrance.
const start = [[1, 6], [1, 7], [0, 7]];
const ids = [PCS.Brienne, PCS.Quill, PCS.Morra];
for (let i = 0; i < 3; i++) await tool("move_token", { entity_id: ids[i], x: start[i][0], y: start[i][1], override: true });
await tool("set_fog", { mode: "reset" });
await table.goto(WEB + "/table");
await sleep(5000);

// Leader's path: up past the alcove, then east along row 2 toward the wreck; others follow.
const path = [[1, 5], [2, 4], [2, 3], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 3], [14, 4], [15, 5]];
const rec = await record(table, "map-fog");
await sleep(1500);
rec.mark("party advances into fog");
const trail = [start[0], start[1], start[2]];
for (const step of path) {
  trail.unshift(step);
  for (let i = 0; i < 3; i++) {
    const [x, y] = trail[i];
    await tool("move_token", { entity_id: ids[i], x, y, override: true }).catch((e) => console.log(e.message));
  }
  await sleep(550);
}
rec.mark("deep in the cove");
await sleep(3000);
shots: {
  const s = live.state;
  console.log("fog:", JSON.stringify(s?.fog)?.slice(0, 200));
}
const entry = await rec.stop();
await saveShots([entry]);
live.close();
await b.close();
