import { describe, expect, it } from "vitest";
import { Campaign, Character, emptyGameState, type GameState } from "@dm/shared";
import { joinBlocked, rosterLabel, rosterPrompt, rosterRefreshKey, unlinkedCharacters, updatedAgo } from "./roster";

type Entry = Parameters<typeof rosterLabel>[0];
const entry = (patch: Partial<Entry> = {}): Entry =>
  ({ id: "ros_1", name: "Mara", playerName: "Sam", className: "Fighter", subclass: "Champion", level: 5, species: "Human", hasVoiceprint: false, updatedAt: 1, ...patch }) as Entry;

const pc = (id: string, rosterId?: string) => Character.parse({ id, playerName: "", name: id, maxHp: 5, hp: 5, ...(rosterId ? { rosterId } : {}) } as never);

function state(): GameState {
  const s = emptyGameState("cmp_1");
  s.characters = [pc("pc_a", "ros_a"), pc("pc_b"), pc("pc_c")];
  return s;
}
const campaign = (status: "active" | "completed" | "failed") => Campaign.parse({ id: "cmp_1", name: "A", createdAt: 1, updatedAt: 1, status });

describe("rosterLabel", () => {
  it("class, subclass and level", () => {
    expect(rosterLabel(entry())).toBe("Fighter (Champion) · Lv 5");
  });

  it("omits the parenthesis without a subclass", () => {
    expect(rosterLabel(entry({ subclass: "" }))).toBe("Fighter · Lv 5");
  });

  it("falls back to 'Adventurer' without a class", () => {
    expect(rosterLabel(entry({ className: "", subclass: "", level: 1 }))).toBe("Adventurer · Lv 1");
  });
});

describe("unlinkedCharacters", () => {
  it("returns the characters with no rosterId", () => {
    expect(unlinkedCharacters(state()).map((c) => c.id)).toEqual(["pc_b", "pc_c"]);
  });

  it("is empty without a state", () => {
    expect(unlinkedCharacters(null)).toEqual([]);
  });
});

describe("rosterPrompt", () => {
  it("lists the unlinked PCs once the campaign is completed or failed", () => {
    expect(rosterPrompt(campaign("completed"), state()).map((c) => c.id)).toEqual(["pc_b", "pc_c"]);
    expect(rosterPrompt(campaign("failed"), state()).map((c) => c.id)).toEqual(["pc_b", "pc_c"]);
  });

  it("is empty while the campaign is active, or with no campaign/state", () => {
    expect(rosterPrompt(campaign("active"), state())).toEqual([]);
    expect(rosterPrompt(null, state())).toEqual([]);
    expect(rosterPrompt(campaign("completed"), null)).toEqual([]);
  });

  it("is empty when every PC is linked", () => {
    const s = state();
    s.characters = [pc("pc_a", "ros_a")];
    expect(rosterPrompt(campaign("completed"), s)).toEqual([]);
  });
});

describe("joinBlocked", () => {
  it("names the campaign character that already carries the roster id", () => {
    expect(joinBlocked("ros_a", state())).toBe("Already in this campaign as pc_a");
  });

  it("is null for a roster id not in the campaign, and asks for a campaign without a state", () => {
    expect(joinBlocked("ros_z", state())).toBeNull();
    expect(joinBlocked("ros_a", null)).toBe("Load a campaign first");
  });
});

describe("updatedAgo", () => {
  const now = 10_000_000_000;
  it("rounds down to the largest unit", () => {
    expect(updatedAgo(now - 5_000, now)).toBe("just now");
    expect(updatedAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(updatedAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(updatedAgo(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });

  it("never goes negative for a clock ahead of ours", () => {
    expect(updatedAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("rosterRefreshKey", () => {
  it("changes when the campaign ends (end_campaign saves linked PCs back to the roster)", () => {
    const open = rosterRefreshKey(campaign("active"));
    expect(rosterRefreshKey(campaign("completed"))).not.toBe(open);
    expect(rosterRefreshKey(campaign("failed"))).not.toBe(open);
  });

  it("is stable while the campaign stays open, and without a campaign", () => {
    expect(rosterRefreshKey(campaign("active"))).toBe(rosterRefreshKey(campaign("active")));
    expect(rosterRefreshKey(null)).toBe(rosterRefreshKey(null));
  });

  it("differs per campaign", () => {
    const other = Campaign.parse({ id: "cmp_2", name: "B", createdAt: 1, updatedAt: 1, status: "completed" });
    expect(rosterRefreshKey(other)).not.toBe(rosterRefreshKey(campaign("completed")));
  });
});
