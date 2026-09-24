import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { NpcVoice, pickNpcVoice, speakAsNpc, type SpeechClient } from "./npc-voice.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(withClient = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "npcvoice-"));
  dirs.push(dataDir);
  const create = vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  const client: SpeechClient = { audio: { speech: { create } } };
  const voice = new NpcVoice(withClient ? client : undefined, { model: "gpt-4o-mini-tts", dmVoice: "cedar", dataDir, urlPrefix: "/media" });
  const events: ServerEvent[] = [];
  const logs: [string, string][] = [];
  const ctx = {
    campaignId: "cmp_1",
    npcs: [{ name: "Sister Maren", description: "", motive: "", voice: "breathy whisper, long pauses" }],
    voice,
    broadcast: (ev: ServerEvent) => events.push(ev),
    log: (speaker: string, text: string) => logs.push([speaker, text]),
  };
  return { dataDir, create, voice, events, logs, ctx };
}

describe("speak_as_npc", () => {
  it("synthesizes the line with the NPC's voice direction, saves an mp3 and broadcasts it", async () => {
    const { create, events, logs, ctx, dataDir } = setup();
    const out = await speakAsNpc({ npc_name: "sister maren", line: "Leave this place.", style: "terrified" }, ctx);
    expect(out.ok).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    const params = (create.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(params).toMatchObject({ model: "gpt-4o-mini-tts", input: "Leave this place.", response_format: "mp3", instructions: "breathy whisper, long pauses. terrified" });
    expect(params.voice).not.toBe("cedar");
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<ServerEvent, { type: "npc_speech" }>;
    expect(ev).toMatchObject({ type: "npc_speech", npcName: "Sister Maren", line: "Leave this place." });
    expect(ev.url).toMatch(/^\/media\/cmp_1\/npc_[0-9a-f]{12}\.mp3$/);
    const file = join(dataDir, "cmp_1", "assets", ev.url.split("/").pop()!);
    expect(existsSync(file)).toBe(true);
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);
    expect(logs).toEqual([["Sister Maren", "Leave this place."]]);
  });

  it("reuses the cached file for the same line", async () => {
    const { create, ctx } = setup();
    await speakAsNpc({ npc_name: "Sister Maren", line: "Again." }, ctx);
    await speakAsNpc({ npc_name: "Sister Maren", line: "Again." }, ctx);
    expect(create).toHaveBeenCalledOnce();
  });

  it("validates arguments", async () => {
    const { ctx, create } = setup();
    await expect(speakAsNpc({ npc_name: "Maren", line: "" }, ctx)).rejects.toThrow();
    await expect(speakAsNpc({ npc_name: "Maren", line: "x".repeat(401) }, ctx)).rejects.toThrow();
    await expect(speakAsNpc({ line: "Hi" }, ctx)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an error to the DM when NPC voices are off", async () => {
    const { ctx, events } = setup(false);
    const out = await speakAsNpc({ npc_name: "Maren", line: "Hi" }, ctx);
    expect(out).toMatchObject({ ok: false });
    expect(events).toEqual([]);
  });

  it("gives improvised NPCs a stable voice that is never the DM's", () => {
    expect(pickNpcVoice("Innkeeper Bram", "cedar")).toBe(pickNpcVoice(" innkeeper bram ", "cedar"));
    for (const n of ["a", "b", "c", "d", "e", "f", "g", "h"]) expect(pickNpcVoice(n, "cedar")).not.toBe("cedar");
  });
});
