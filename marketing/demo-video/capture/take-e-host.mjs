// Take E: the host laptop. Outline tab → Play tab → Start text-only DM → a player speaks and the
// table log fills live (host-start).
import { launch, TV, WEB, api, record, saveShots, sleep } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS } from "./cast.mjs";

const live = connectLive();
await api("/api/dm/stop", {}).catch(() => {});
const b = await launch();
const host = await (await b.newContext(TV)).newPage();
await host.goto(WEB + "/host");
await sleep(4000);
const rec = await record(host, "host-start");
await sleep(1500);
await host.mouse.wheel(0, 400);
await sleep(1200);
await host.mouse.wheel(0, -400);
await sleep(800);
rec.mark("open Play tab");
await host.getByRole("button", { name: /Play/ }).click();
await sleep(1500);
rec.mark("click Start text-only DM");
await host.getByRole("button", { name: /Start text-only DM/ }).click();
await live.waitFor((l) => l.dm?.status && l.dm.status !== "offline", 30000);
rec.mark("DM online");
await live.settle(3000, 40000);
rec.mark("player speaks");
await api("/api/dm/say", { text: "Brienne raises her sword toward the stairs: Stay behind me, Mara!", playerId: PLAYERS.Alice });
await live.settle(4000, 60000);
await sleep(1500);
rec.mark("end");
await saveShots([await rec.stop()]);
live.close();
await b.close();
