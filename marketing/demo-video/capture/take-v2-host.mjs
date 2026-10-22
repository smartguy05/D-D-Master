// Take v2 host: the Party tab on the laptop. Add an AI seat, bring Pip (saved from another
// campaign) in from the roster for it, and tick off the AI seat (host-roster).
import { launch, WEB, record, saveShots, sleep } from "./recorder.mjs";
import { connectLive } from "./live.mjs";

const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const b = await launch();
const host = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 })).newPage();
await host.goto(WEB + "/host");
await sleep(3000);
await host.getByRole("button", { name: /Party/ }).first().click();
await sleep(1500);
const slow = async (loc) => { await loc.scrollIntoViewIfNeeded(); await loc.hover(); await sleep(500); await loc.click(); };

const rec = await record(host, "host-roster", { width: 1920, height: 1080 });
await sleep(1500);
rec.mark("add AI player");
const name = host.getByPlaceholder("Player name");
await name.scrollIntoViewIfNeeded();
await name.click();
await name.pressSequentially("Robin", { delay: 120 });
await slow(host.getByRole("button", { name: /Add AI player/ }));
await live.waitFor((l) => l.state.players.some((p) => p.name === "Robin"), 10000);
await sleep(1200);
rec.mark("bring an existing hero");
await slow(host.getByRole("button", { name: "Bring an existing hero" }));
await sleep(1500);
const entry = host.locator(".roster-entry", { hasText: "Pip" });
await entry.scrollIntoViewIfNeeded();
await sleep(800);
const robin = live.state.players.find((p) => p.name === "Robin");
await entry.locator("select").selectOption(robin.id);
await sleep(800);
rec.mark("join campaign");
await slow(entry.getByRole("button", { name: "Join campaign" }));
await live.waitFor((l) => l.state.characters.some((c) => c.name === "Pip"), 10000);
await sleep(1500);
rec.mark("Pip in the party");
const row = host.locator("li", { hasText: "Robin" }).first();
await row.scrollIntoViewIfNeeded();
await sleep(3000);
rec.mark("end");
await saveShots([await rec.stop()]);
live.close();
await b.close();
process.exit(0);
