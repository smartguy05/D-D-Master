import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chunkMarkdown, RulesIndex } from "./srd.js";
import { MonsterCatalog } from "./monsters.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd");

describe("chunkMarkdown", () => {
  it("splits on headings and keeps stat-block subsections together", () => {
    const md = "# Top\nintro\n## Goblin\n### Goblin Warrior\n**AC** 15\n#### Actions\nScimitar\n### Goblin Boss\nboss";
    const chunks = chunkMarkdown("srd/m.md", md);
    const warrior = chunks.find((c) => c.title === "Goblin Warrior")!;
    expect(warrior.text).toContain("Actions:");
    expect(warrior.text).toContain("Scimitar");
    expect(warrior.breadcrumb).toBe("m > Top > Goblin");
  });
});

describe("SRD data", () => {
  const index = new RulesIndex();
  index.loadSrd(SRD_DIR);
  const catalog = new MonsterCatalog();
  catalog.load(SRD_DIR);

  it("indexes the SRD", () => {
    expect(index.chunks.length).toBeGreaterThan(1000);
  });

  it("finds spells and conditions", () => {
    expect(index.query("Fireball")[0].title).toBe("Fireball");
    expect(index.lookup("Grappled condition")).toMatch(/Grappled/);
  });

  it("parses monster stat blocks", () => {
    expect(catalog.size).toBeGreaterThan(320);
    const gob = catalog.find("Goblin Warrior")!;
    expect(gob).toMatchObject({ ac: 15, maxHp: 10, initiativeBonus: 2, cr: "1/4" });
    expect(gob.abilities?.dex).toBe(15);
    expect(gob.attacks[0]).toMatchObject({ name: "Scimitar", toHit: 4, damage: "1d6+2 slashing" });
    expect(catalog.find("wolves")?.name).toBe("Wolf");
  });
});
